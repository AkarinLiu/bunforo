import { describe, expect, test } from 'bun:test'
import { GithubApiError, createGithubClient } from '../src/import/github/client'

const clientWith = (response: () => Response) =>
  createGithubClient({
    token: 'super-secret-token',
    owner: 'o',
    name: 'n',
    fetchImpl: (async () => response()) as unknown as typeof fetch,
  })

describe('github client', () => {
  test('turns a GraphQL RATE_LIMITED error into a retryable error', async () => {
    const client = clientWith(
      () =>
        new Response(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), {
          status: 200,
          headers: { 'x-ratelimit-reset': '1700000000' },
        }),
    )
    const err = await client.listDiscussions({ first: 1, after: null }).catch((e) => e)
    expect(err).toBeInstanceOf(GithubApiError)
    expect((err as GithubApiError).kind).toBe('rate_limit')
    expect((err as GithubApiError).retryAt).toBe(new Date(1700000000 * 1000).toISOString())
    expect((err as GithubApiError).message).not.toContain('super-secret-token')
  })

  test('maps 401 to auth without echoing the token', async () => {
    const client = clientWith(() => new Response('nope', { status: 401 }))
    const err = await client.listDiscussions({ first: 1, after: null }).catch((e) => e)
    expect((err as GithubApiError).kind).toBe('auth')
    expect(String(err)).not.toContain('super-secret-token')
  })

  test('passes the cursor through and returns the page', async () => {
    let seen: unknown
    const client = createGithubClient({
      token: 't',
      owner: 'o',
      name: 'n',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = JSON.parse(String(init.body)).variables
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                discussions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
              },
            },
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch,
    })
    await client.listDiscussions({ first: 5, after: 'CUR' })
    expect(seen).toEqual({ owner: 'o', name: 'n', first: 5, after: 'CUR' })
  })
})
