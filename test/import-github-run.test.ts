/**
 * End-to-end importer run against the in-memory database. The GitHub client is
 * a fake: no network, while the repo writes and the idempotency rules are real.
 */
import { describe, expect, test } from 'bun:test'
import * as store from '../src/db/index'
import * as repo from '../src/db/repo'
import type { ImportClient } from '../src/import/github/client'
import { runImport } from '../src/import/github/importer'
import type { RawComment, RawDiscussion } from '../src/import/github/types'

await store.ensureSchema()
await repo.ensureSystemUser()

let seq = 0
const stamp = Date.now().toString(36)
const uniq = (prefix: string) => `${prefix}-${stamp}-${seq++}`

function fakeClient(
  discussions: RawDiscussion[],
  comments: Record<string, RawComment[]>,
): ImportClient {
  const page = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })
  return {
    async listDiscussions() {
      return page(discussions)
    },
    async listComments(id) {
      return page(comments[id] ?? [])
    },
    async listReplies() {
      return page([])
    },
  }
}

function discussion(
  id: string,
  category: string,
  login: string,
  overrides: Partial<RawDiscussion> = {},
): RawDiscussion {
  return {
    id,
    number: 1,
    title: `Imported ${id}`,
    body: 'Opening body',
    createdAt: '2024-01-01T00:00:00Z',
    locked: false,
    category: { name: category, description: 'Imported board' },
    // GitHub ids are globally unique; fixtures must be too, because the local
    // github_id column is unique (two accounts cannot share an id).
    author: { login, avatarUrl: 'https://avatars.example/u.png', databaseId: 100000 + seq++, name: login },
    ...overrides,
  }
}

const comment = (id: string, createdAt: string, login = 'commenter', reply?: RawComment): RawComment => ({
  id,
  body: `body of ${id}`,
  createdAt,
  author: { login, avatarUrl: '', databaseId: 200000 + seq++, name: 'Commenter' },
  ...(reply
    ? { replies: { nodes: [reply], pageInfo: { hasNextPage: false, endCursor: null } } }
    : {}),
})

describe('GitHub Discussions importer', () => {
  test('creates a category, placeholder author, thread, opening post and nested reply', async () => {
    const id = uniq('D')
    const category = uniq('Import QA')
    const login = uniq('octo-cat')
    const reply = comment(uniq('R'), '2024-01-03T00:00:00Z', 'replier')
    const top = comment(uniq('C'), '2024-01-02T00:00:00Z', login, reply)
    const client = fakeClient([discussion(id, category, login)], { [id]: [top] })

    const summary = await runImport({ client, dryRun: false, limit: 10, log: () => {} })

    expect(summary.threadsCreated).toBe(1)
    expect(summary.postsCreated).toBe(2)
    expect(summary.usersCreated).toBe(2)
    expect(summary.categoriesCreated).toBe(1)
    expect(summary.failures).toEqual([])

    const threadId = await repo.findThreadIdByExternalId(`github:${id}`)
    expect(threadId).not.toBeNull()
    const thread = await repo.findThread(threadId!)
    expect(thread?.title).toBe(`Imported ${id}`)
    expect(thread?.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(thread?.lastPostAt).toBe('2024-01-03T00:00:00.000Z')

    const posts = await repo.listPosts(threadId!, null)
    expect(posts.length).toBe(3)
    const opening = posts.find((p) => p.parentId === null)!
    const topPost = posts.find((p) => p.id !== opening.id && p.parentId === opening.id)!
    const replyPost = posts.find((p) => p.parentId === topPost.id)!
    expect(replyPost.body).toBe(`body of ${reply.id}`)

    const author = await repo.findUserByGithubLogin(login.toLowerCase())
    expect(author?.passwordHash).toBe('')
    expect(author?.githubId).toMatch(/^\d+$/)
    expect((await repo.listCategories()).some((c) => c.name === category)).toBe(true)
  })

  test('is idempotent: a second run adds nothing', async () => {
    const id = uniq('D')
    const category = uniq('Import QA')
    const login = uniq('octo')
    const client = fakeClient([discussion(id, category, login)], {
      [id]: [comment(uniq('C'), '2024-01-02T00:00:00Z')],
    })

    const first = await runImport({ client, dryRun: false, limit: 10, log: () => {} })
    const second = await runImport({ client, dryRun: false, limit: 10, log: () => {} })

    expect(first.threadsCreated).toBe(1)
    expect(second.threadsCreated).toBe(0)
    expect(second.postsCreated).toBe(0)
    expect(second.threadsSkipped).toBe(1)
    expect(second.usersCreated).toBe(0)
  })

  test('incremental run appends only the new comment and advances lastPostAt', async () => {
    const id = uniq('D')
    const category = uniq('Import QA')
    const login = uniq('octo')
    const comments = [comment(uniq('C'), '2024-01-02T00:00:00Z')]
    const client = fakeClient([discussion(id, category, login)], { [id]: comments })

    await runImport({ client, dryRun: false, limit: 10, log: () => {} })
    comments.push(comment(uniq('C'), '2024-02-01T00:00:00Z'))
    const summary = await runImport({ client, dryRun: false, limit: 10, log: () => {} })

    expect(summary.threadsCreated).toBe(0)
    expect(summary.postsCreated).toBe(1)
    const threadId = await repo.findThreadIdByExternalId(`github:${id}`)
    const thread = await repo.findThread(threadId!)
    expect(thread?.lastPostAt).toBe('2024-02-01T00:00:00.000Z')
  })

  test('dry-run counts everything but writes nothing', async () => {
    const id = uniq('D')
    const category = uniq('Import QA')
    const login = uniq('octo')
    const client = fakeClient([discussion(id, category, login)], {
      [id]: [comment(uniq('C'), '2024-01-02T00:00:00Z', login)],
    })

    const summary = await runImport({ client, dryRun: true, limit: 10, log: () => {} })

    expect(summary.threadsCreated).toBe(1)
    expect(summary.postsCreated).toBe(1)
    expect(summary.usersCreated).toBe(1)
    expect(summary.categoriesCreated).toBe(1)
    expect(await repo.findThreadIdByExternalId(`github:${id}`)).toBeNull()
    expect(await repo.findUserByGithubLogin(login.toLowerCase())).toBeNull()
    expect((await repo.listCategories()).some((c) => c.name === category)).toBe(false)
  })

  test('downloads embedded GitHub media and rewrites bodies to /uploads', async () => {
    const id = uniq('D')
    const category = uniq('Import QA')
    const login = uniq('octo')
    const image = 'https://user-images.githubusercontent.com/1/shot.png'
    const raw = discussion(id, category, login, { body: `Opening ![shot](${image})` })
    const cid = uniq('C')
    const client = fakeClient([raw], {
      [id]: [{ id: cid, body: `Reply ![again](${image})`, createdAt: '2024-01-02T00:00:00Z', author: null }],
    })

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let downloads = 0
    const mediaFetch = (async () => {
      downloads++
      return new Response(png, { status: 200 })
    }) as unknown as typeof fetch

    const summary = await runImport({
      client,
      dryRun: false,
      limit: 10,
      mediaFetch,
      log: () => {},
    })

    expect(summary.mediaFound).toBe(2)
    expect(summary.mediaImported).toBe(2)
    expect(summary.mediaFailed).toBe(0)
    // The same URL is downloaded once thanks to the per-run cache.
    expect(downloads).toBe(1)

    const threadId = await repo.findThreadIdByExternalId(`github:${id}`)
    const posts = await repo.listPosts(threadId!, null)
    expect(posts.length).toBe(2)
    for (const post of posts) {
      expect(post.body).toContain('/uploads/')
      expect(post.body).not.toContain(image)
    }
  })

  test('--limit stops after the requested number of discussions', async () => {
    const first = uniq('D')
    const second = uniq('D')
    const category = uniq('Import QA')
    const client = fakeClient(
      [discussion(first, category, uniq('octo')), discussion(second, category, uniq('octo'))],
      {},
    )

    const summary = await runImport({ client, dryRun: false, limit: 1, log: () => {} })

    expect(summary.discussionsSeen).toBe(1)
    expect(await repo.findThreadIdByExternalId(`github:${first}`)).not.toBeNull()
    expect(await repo.findThreadIdByExternalId(`github:${second}`)).toBeNull()
  })
})
