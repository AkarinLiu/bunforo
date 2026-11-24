/**
 * Shapes for the GitHub Discussions importer. `Raw*` mirrors exactly what the
 * GraphQL queries request; `Mapped*` is the local, engine-independent model that
 * the pure mapper produces and the importer writes.
 */

export interface RawAuthor {
  login: string
  avatarUrl: string | null
  databaseId?: number | null
  name?: string | null
}

export interface RawPageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

export interface RawPage<T> {
  nodes: T[]
  pageInfo: RawPageInfo
}

export interface RawComment {
  id: string
  body: string
  createdAt: string
  author: RawAuthor | null
  /** Present on top-level comments; the client fills in every page before mapping. */
  replies?: RawPage<RawComment>
}

export interface RawDiscussion {
  id: string
  number: number
  title: string
  body: string
  createdAt: string
  locked: boolean
  category: { name: string; description: string | null } | null
  author: RawAuthor | null
}

export interface MappedAuthor {
  /** null only for a deleted GitHub account. */
  login: string | null
  githubId: string | null
  name: string
  avatarUrl: string
}

export interface MappedPost {
  /** GitHub DiscussionComment node id. */
  nodeId: string
  /** Top-level comment (null) or the top-level comment this reply belongs to. */
  parentNodeId: string | null
  body: string
  createdAt: string
  author: MappedAuthor | null
}

export interface MappedThread {
  nodeId: string
  number: number
  title: string
  body: string
  createdAt: string
  isLocked: boolean
  categoryName: string
  categoryDescription: string
  author: MappedAuthor | null
  /** Top-level comments and their replies, in createdAt order. */
  posts: MappedPost[]
}

export interface ImportFailure {
  nodeId: string
  title: string
  error: string
}

export interface ImportSummary {
  discussionsSeen: number
  categoriesCreated: number
  usersCreated: number
  threadsCreated: number
  threadsSkipped: number
  postsCreated: number
  postsSkipped: number
  /** GitHub media URLs seen in newly imported bodies. */
  mediaFound: number
  /** Media rewritten to a local /uploads path. */
  mediaImported: number
  /** Candidates that were not an accepted image/video, or too large. */
  mediaSkipped: number
  /** Download/store failures; the original URL stays in the body. */
  mediaFailed: number
  failures: ImportFailure[]
}
