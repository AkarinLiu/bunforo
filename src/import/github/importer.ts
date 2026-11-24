/**
 * The writing half of the importer. Reads every page it needs, maps with the
 * pure functions in `map.ts`, then writes through `repo`. Idempotent: a thread
 * is identified by `github:<discussion node id>`, and a re-run only adds
 * comments that are missing.
 */
import * as repo from '../../db/repo'
import * as storage from '../../server/storage'
import { SYSTEM_USER_ID } from '../../shared/types'
import { GithubApiError } from './client'
import type { ImportClient } from './client'
import { lastPostAt, mapThread, placeholderUsername } from './map'
import { downloadGithubMedia, localizeMedia } from './media'
import type { ImportSummary, MappedAuthor, MappedPost, RawComment, RawDiscussion } from './types'

export interface ImportOptions {
  client: ImportClient
  dryRun: boolean
  /** How many discussions to process, oldest first. */
  limit: number
  /** GitHub token, used only for downloads from github.com itself. */
  token?: string
  /** Injectable media fetcher; production uses global fetch. */
  mediaFetch?: typeof fetch
  log?: (line: string) => void
}

const PAGE = 50

const message = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : '未知错误'

const aborting = (err: unknown): boolean =>
  err instanceof GithubApiError && (err.kind === 'auth' || err.kind === 'rate_limit' || err.kind === 'network')

export async function runImport(options: ImportOptions): Promise<ImportSummary> {
  const { client, dryRun, limit } = options
  const log = options.log ?? ((line: string) => console.log(line))

  const summary: ImportSummary = {
    discussionsSeen: 0,
    categoriesCreated: 0,
    usersCreated: 0,
    threadsCreated: 0,
    threadsSkipped: 0,
    postsCreated: 0,
    postsSkipped: 0,
    mediaFound: 0,
    mediaImported: 0,
    mediaSkipped: 0,
    mediaFailed: 0,
    failures: [],
  }

  // One download per URL per run; two posts embedding the same image share it.
  const mediaCache = new Map<string, string | null>()
  const maxMediaBytes = Math.max(storage.maxUploadBytes, storage.maxVideoBytes)

  const resolveMedia = async (url: string): Promise<string | null> => {
    const cached = mediaCache.get(url)
    if (cached !== undefined) return cached
    try {
      const fetched = await downloadGithubMedia(url, {
        token: options.token,
        maxBytes: maxMediaBytes,
        fetchImpl: options.mediaFetch,
      })
      if (!fetched) {
        mediaCache.set(url, null)
        return null
      }
      const limit = fetched.kind.mime.startsWith('video/')
        ? storage.maxVideoBytes
        : storage.maxUploadBytes
      if (fetched.bytes.byteLength > limit) {
        mediaCache.set(url, null)
        return null
      }
      const key = `${crypto.randomUUID()}.${fetched.kind.ext}`
      await storage.put(key, fetched.bytes, fetched.kind.mime)
      const local = `/uploads/${key}`
      mediaCache.set(url, local)
      return local
    } catch (err) {
      mediaCache.set(url, null)
      log(`[import:github] 媒体下载失败 ${url}: ${message(err)}`)
      throw err
    }
  }

  const localizeBody = async (body: string): Promise<string> => {
    const localized = await localizeMedia(body, { resolve: resolveMedia, dryRun })
    summary.mediaFound += localized.found
    summary.mediaImported += localized.imported
    summary.mediaSkipped += localized.skipped
    summary.mediaFailed += localized.failed
    return localized.body
  }

  const categories = new Map<string, number>()
  let nextPosition = 1
  for (const category of await repo.listCategories()) {
    const key = category.name.trim().toLowerCase()
    if (!categories.has(key) || category.parentId === null) categories.set(key, category.id)
    nextPosition = Math.max(nextPosition, category.position + 1)
  }

  const usernames = await repo.listUsernames()
  const users = new Map<string, number>()

  const authorId = async (author: MappedAuthor | null): Promise<number> => {
    if (!author?.login) return SYSTEM_USER_ID
    const key = author.login.toLowerCase()
    const cached = users.get(key)
    if (cached !== undefined) return cached

    const existing = await repo.findUserByGithubLogin(key)
    if (existing) {
      users.set(key, existing.id)
      return existing.id
    }
    if (dryRun) {
      summary.usersCreated++
      users.set(key, SYSTEM_USER_ID)
      return SYSTEM_USER_ID
    }
    const username = placeholderUsername(key, usernames)
    usernames.add(username)
    const id = await repo.createGithubUser({
      username,
      displayName: author.name || author.login,
      avatarUrl: author.avatarUrl,
      email: '',
      emailVerified: false,
      githubLogin: key,
      githubId: author.githubId,
      createdAt: new Date().toISOString(),
    })
    summary.usersCreated++
    users.set(key, id)
    return id
  }

  const categoryId = async (name: string, description: string): Promise<number> => {
    const key = name.trim().toLowerCase()
    const found = categories.get(key)
    if (found !== undefined) return found
    if (dryRun) {
      summary.categoriesCreated++
      categories.set(key, -1)
      return -1
    }
    const id = await repo.createCategory({
      name,
      description,
      position: nextPosition++,
      parentId: null,
    })
    summary.categoriesCreated++
    categories.set(key, id)
    return id
  }

  /** All comment pages, with every reply page folded into its parent comment. */
  const loadComments = async (discussionId: string): Promise<RawComment[]> => {
    const comments: RawComment[] = []
    let after: string | null = null
    for (;;) {
      const page = await client.listComments(discussionId, after)
      comments.push(...page.nodes)
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break
      after = page.pageInfo.endCursor
    }
    for (const comment of comments) {
      if (!comment.replies?.pageInfo?.hasNextPage) continue
      let cursor = comment.replies.pageInfo.endCursor
      const replies = [...comment.replies.nodes]
      for (;;) {
        const page = await client.listReplies(comment.id, cursor)
        replies.push(...page.nodes)
        if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break
        cursor = page.pageInfo.endCursor
      }
      comment.replies = { nodes: replies, pageInfo: { hasNextPage: false, endCursor: null } }
    }
    return comments
  }

  const writePosts = async (
    threadId: number,
    openingId: number,
    posts: MappedPost[],
    known: Map<string, number>,
  ): Promise<void> => {
    let synthetic = -1
    const parentOf = new Map<string, number>(known)

    // Top-level comments first: replies point at their local id.
    for (const post of posts.filter((p) => p.parentNodeId === null)) {
      if (parentOf.has(post.nodeId)) {
        summary.postsSkipped++
        continue
      }
      const author = await authorId(post.author)
      const body = await localizeBody(post.body)
      if (dryRun) {
        summary.postsCreated++
        parentOf.set(post.nodeId, synthetic--)
        continue
      }
      const id = await repo.createImportedPost({
        threadId,
        authorId: author,
        parentId: openingId,
        body,
        createdAt: post.createdAt,
        externalId: `github:${post.nodeId}`,
      })
      summary.postsCreated++
      parentOf.set(post.nodeId, id)
    }

    for (const post of posts.filter((p) => p.parentNodeId !== null)) {
      if (parentOf.has(post.nodeId)) {
        summary.postsSkipped++
        continue
      }
      const parentId = post.parentNodeId ? parentOf.get(post.parentNodeId) : undefined
      if (parentId === undefined) {
        summary.failures.push({
          nodeId: post.nodeId,
          title: '回复',
          error: `找不到父评论 ${post.parentNodeId ?? '(null)'}`,
        })
        continue
      }
      const author = await authorId(post.author)
      const body = await localizeBody(post.body)
      if (dryRun) {
        summary.postsCreated++
        parentOf.set(post.nodeId, synthetic--)
        continue
      }
      const id = await repo.createImportedPost({
        threadId,
        authorId: author,
        parentId,
        body,
        createdAt: post.createdAt,
        externalId: `github:${post.nodeId}`,
      })
      summary.postsCreated++
      parentOf.set(post.nodeId, id)
    }
  }

  const importOne = async (raw: RawDiscussion): Promise<void> => {
    const comments = await loadComments(raw.id)
    const thread = mapThread(raw, comments)
    const externalId = `github:${raw.id}`
    const existingId = await repo.findThreadIdByExternalId(externalId)

    if (existingId !== null) {
      summary.threadsSkipped++
      const openingId = await repo.findOpeningPostId(existingId)
      if (openingId === null) throw new Error('已有主题缺少开楼帖，无法追加回复')
      // Stored refs are namespaced ("github:<node id>"); the mapper works in raw
      // node ids, so normalise once.
      const known = new Map<string, number>()
      for (const [external, localId] of await repo.listPostRefs(existingId)) {
        if (external.startsWith('github:')) known.set(external.slice('github:'.length), localId)
      }
      const current = await repo.findThread(existingId)
      const latest = lastPostAt(thread.createdAt, thread.posts, current?.lastPostAt ?? '')
      await writePosts(existingId, openingId, thread.posts, known)
      if (!dryRun) await repo.updateThreadLastPostAt(existingId, latest)
      return
    }

    const latest = lastPostAt(thread.createdAt, thread.posts)
    const category = await categoryId(thread.categoryName, thread.categoryDescription)
    const author = await authorId(thread.author)
    const body = await localizeBody(thread.body)
    if (dryRun) {
      summary.threadsCreated++
      await writePosts(-1, -1, thread.posts, new Map())
      return
    }

    const id = await repo.createImportedThread({
      categoryId: category,
      authorId: author,
      title: thread.title,
      body,
      createdAt: thread.createdAt,
      lastPostAt: latest,
      externalId,
      isLocked: thread.isLocked,
    })
    summary.threadsCreated++
    const openingId = await repo.findOpeningPostId(id)
    if (openingId === null) throw new Error('开楼帖写入失败')
    await writePosts(id, openingId, thread.posts, new Map())
  }

  let after: string | null = null
  while (summary.discussionsSeen < limit) {
    const page = await client.listDiscussions({
      first: Math.min(PAGE, limit - summary.discussionsSeen),
      after,
    })
    if (!page.nodes.length) break

    for (const raw of page.nodes) {
      if (summary.discussionsSeen >= limit) break
      summary.discussionsSeen++
      try {
        await importOne(raw)
      } catch (err) {
        if (aborting(err)) throw err
        // Counters stay as they are: some rows may already have been written,
        // and a re-run repairs the gap rather than pretending nothing happened.
        summary.failures.push({
          nodeId: raw.id,
          title: raw.title.slice(0, 80),
          error: message(err),
        })
      }
      log(
        `${dryRun ? '[dry-run] ' : ''}${summary.discussionsSeen}/${limit} #${raw.number} ${raw.title}`,
      )
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break
    after = page.pageInfo.endCursor
  }

  return summary
}
