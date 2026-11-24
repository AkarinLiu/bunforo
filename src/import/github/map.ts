/**
 * Pure mapping: GitHub nodes → local thread/post model. No DB, no network, so
 * every rule here (parenting, ordering, truncation) is unit-testable.
 */
import type { MappedAuthor, MappedPost, MappedThread, RawAuthor, RawComment, RawDiscussion } from './types'

const TITLE_MAX = 200
const NAME_MAX = 32
const USERNAME_MAX = 32

/**
 * GitHub logins allow hyphens and run to 39 chars; the forum's usernames allow
 * neither. `gh_` also stops a placeholder from shadowing a real local account,
 * and the identity itself is always the `github_login` column.
 */
export function placeholderUsername(login: string, taken: ReadonlySet<string>): string {
  const cleaned = login
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'user'
  const base = `gh_${cleaned}`.slice(0, USERNAME_MAX)
  let candidate = base
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = `_${n}`
    candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix
  }
  return candidate
}

export function mapAuthor(author: RawAuthor | null): MappedAuthor | null {
  if (!author) return null
  return {
    login: author.login.toLowerCase(),
    githubId: author.databaseId != null ? String(author.databaseId) : null,
    name: (author.name || author.login).slice(0, NAME_MAX),
    avatarUrl: author.avatarUrl ?? '',
  }
}

const iso = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid GitHub timestamp: ${value}`)
  return date.toISOString()
}

const truncate = (value: string, max: number): string => Array.from(value).slice(0, max).join('')

/**
 * Flattens one discussion into the forum's two-level post model: a top-level
 * comment attaches to the opening post, and every reply attaches to its
 * top-level comment (even when GitHub's `replyTo` points at another reply,
 * because this forum has no third level).
 */
export function mapThread(raw: RawDiscussion, comments: RawComment[]): MappedThread {
  const posts: MappedPost[] = []
  for (const comment of comments) {
    posts.push({
      nodeId: comment.id,
      parentNodeId: null,
      body: comment.body,
      createdAt: iso(comment.createdAt),
      author: mapAuthor(comment.author),
    })
    for (const reply of comment.replies?.nodes ?? []) {
      posts.push({
        nodeId: reply.id,
        parentNodeId: comment.id,
        body: reply.body,
        createdAt: iso(reply.createdAt),
        author: mapAuthor(reply.author),
      })
    }
  }
  posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.nodeId.localeCompare(b.nodeId))

  return {
    nodeId: raw.id,
    number: raw.number,
    title: truncate(raw.title.trim() || `Discussion #${raw.number}`, TITLE_MAX),
    body: raw.body,
    createdAt: iso(raw.createdAt),
    isLocked: Boolean(raw.locked),
    categoryName: (raw.category?.name || 'General').trim(),
    categoryDescription: raw.category?.description ?? '',
    author: mapAuthor(raw.author),
    posts,
  }
}

/** Newest instant in a thread, optionally floored by what a re-run already has. */
export function lastPostAt(threadCreatedAt: string, posts: MappedPost[], floor = ''): string {
  let latest = floor > threadCreatedAt ? floor : threadCreatedAt
  for (const post of posts) if (post.createdAt > latest) latest = post.createdAt
  return latest
}
