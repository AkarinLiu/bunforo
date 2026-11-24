/**
 * Thin GitHub GraphQL client. The fetch implementation is injectable so tests
 * exercise pagination and error mapping without touching the network, and no
 * error message ever includes the token.
 */
import { COMMENTS_QUERY, DISCUSSIONS_QUERY, REPLIES_QUERY, commentsVars, discussionVars } from './queries'
import type { RawComment, RawDiscussion, RawPage } from './types'

export type GithubErrorKind = 'auth' | 'graphql' | 'rate_limit' | 'network'

export class GithubApiError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly retryAt?: string,
  ) {
    super(message)
    this.name = 'GithubApiError'
  }
}

export interface ImportClient {
  listDiscussions(input: { first: number; after: string | null }): Promise<RawPage<RawDiscussion>>
  listComments(discussionId: string, after: string | null): Promise<RawPage<RawComment>>
  listReplies(commentId: string, after: string | null): Promise<RawPage<RawComment>>
}

export interface ClientOptions {
  token: string
  owner: string
  name: string
  /** Tests point this at a fake server; production leaves it undefined. */
  apiBase?: string
  fetchImpl?: typeof fetch
  pageSize?: number
}

interface GraphQLResponse<T> {
  data?: T
  errors?: { type?: string; message?: string }[]
}

export function createGithubClient(options: ClientOptions): ImportClient {
  const apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const pageSize = options.pageSize ?? 50

  const retryAt = (headers: Headers): string | undefined => {
    const reset = headers.get('x-ratelimit-reset')
    if (reset && /^\d+$/.test(reset)) return new Date(Number(reset) * 1000).toISOString()
    const after = headers.get('retry-after')
    if (after && /^\d+$/.test(after)) return new Date(Date.now() + Number(after) * 1000).toISOString()
    return undefined
  }

  const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    let response: Response
    try {
      response = await fetchImpl(`${apiBase}/graphql`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'bunforo-import',
        },
        body: JSON.stringify({ query, variables }),
      })
    } catch (err) {
      throw new GithubApiError('network', `无法连接 GitHub API：${(err as Error).message}`)
    }

    const limitedUntil = retryAt(response.headers)
    if (response.status === 401) throw new GithubApiError('auth', 'GITHUB_TOKEN 无效或已过期')
    if (response.status === 403 || response.status === 429) {
      throw new GithubApiError(
        'rate_limit',
        `GitHub API 限流${limitedUntil ? `，${limitedUntil} 后可重试` : ''}`,
        limitedUntil,
      )
    }
    if (!response.ok) throw new GithubApiError('graphql', `GitHub API 返回 HTTP ${response.status}`)

    let body: GraphQLResponse<T> | null = null
    try {
      body = (await response.json()) as GraphQLResponse<T>
    } catch {
      throw new GithubApiError('graphql', 'GitHub API 返回了非 JSON 响应')
    }
    if (body.errors?.length) {
      const limited = body.errors.some(
        (e) => e.type === 'RATE_LIMITED' || /rate limit/i.test(e.message ?? ''),
      )
      const message = body.errors.map((e) => e.message ?? e.type ?? 'unknown').join('; ').slice(0, 300)
      if (limited) {
        throw new GithubApiError(
          'rate_limit',
          `GitHub API 限流${limitedUntil ? `，${limitedUntil} 后可重试` : ''}`,
          limitedUntil,
        )
      }
      throw new GithubApiError('graphql', `GitHub GraphQL 错误：${message}`)
    }
    if (!body.data) throw new GithubApiError('graphql', 'GitHub GraphQL 响应没有 data')
    return body.data
  }

  const empty = <T>(): RawPage<T> => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })

  return {
    async listDiscussions(input) {
      const data = await graphql<{
        repository: { discussions: RawPage<RawDiscussion> } | null
      }>(DISCUSSIONS_QUERY, discussionVars(options.owner, options.name, input.first, input.after))
      if (!data.repository) {
        throw new GithubApiError('graphql', `仓库 ${options.owner}/${options.name} 不存在或无权访问`)
      }
      return data.repository.discussions
    },

    async listComments(discussionId, after) {
      const data = await graphql<{
        node: { comments?: RawPage<RawComment> } | null
      }>(COMMENTS_QUERY, commentsVars(discussionId, pageSize, after))
      return data.node?.comments ?? empty<RawComment>()
    },

    async listReplies(commentId, after) {
      const data = await graphql<{
        node: { replies?: RawPage<RawComment> } | null
      }>(REPLIES_QUERY, commentsVars(commentId, pageSize, after))
      return data.node?.replies ?? empty<RawComment>()
    },
  }
}
