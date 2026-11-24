import { describe, expect, test } from 'bun:test'
import { lastPostAt, mapThread, placeholderUsername } from '../src/import/github/map'
import type { RawComment, RawDiscussion } from '../src/import/github/types'

const discussion = (overrides: Partial<RawDiscussion> = {}): RawDiscussion => ({
  id: 'D_1',
  number: 7,
  title: 'Hello',
  body: 'Body',
  createdAt: '2024-01-01T00:00:00Z',
  locked: false,
  category: { name: 'General', description: 'Talk' },
  author: { login: 'Alice', avatarUrl: 'https://a/1.png', databaseId: 42, name: 'Alice A' },
  ...overrides,
})

describe('placeholderUsername', () => {
  test('makes a GitHub login legal for the forum', () => {
    expect(placeholderUsername('octo-cat', new Set())).toBe('gh_octo_cat')
    expect(placeholderUsername('---', new Set())).toBe('gh_user')
  })

  test('fits the 32-char limit and resolves collisions deterministically', () => {
    const long = placeholderUsername('a'.repeat(39), new Set())
    expect(Array.from(long).length).toBe(32)
    expect(placeholderUsername('octo-cat', new Set(['gh_octo_cat']))).toBe('gh_octo_cat_2')
  })
})

describe('mapThread', () => {
  test('parents top-level comments to the opening post and replies to their comment', () => {
    const comments: RawComment[] = [
      {
        id: 'C_1',
        body: 'first',
        createdAt: '2024-01-02T00:00:00Z',
        author: { login: 'bob', avatarUrl: '', databaseId: 2 },
        replies: {
          nodes: [
            {
              id: 'C_2',
              body: 'reply',
              createdAt: '2024-01-03T00:00:00Z',
              author: { login: 'carol', avatarUrl: '', databaseId: 3 },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      { id: 'C_3', body: 'second', createdAt: '2024-01-02T12:00:00Z', author: null },
    ]

    const mapped = mapThread(discussion(), comments)

    expect(mapped.posts.map((p) => p.nodeId)).toEqual(['C_1', 'C_3', 'C_2'])
    expect(mapped.posts.find((p) => p.nodeId === 'C_1')?.parentNodeId).toBeNull()
    expect(mapped.posts.find((p) => p.nodeId === 'C_2')?.parentNodeId).toBe('C_1')
    expect(mapped.posts.find((p) => p.nodeId === 'C_3')?.author).toBeNull()
    expect(mapped.author?.login).toBe('alice')
    expect(mapped.isLocked).toBe(false)
  })

  test('normalises time, truncates long titles and falls back to a category name', () => {
    const mapped = mapThread(
      discussion({ title: 'x'.repeat(250), category: null, createdAt: '2024-01-01T12:00:00+08:00' }),
      [],
    )
    expect(Array.from(mapped.title).length).toBe(200)
    expect(mapped.categoryName).toBe('General')
    expect(mapped.createdAt).toBe('2024-01-01T04:00:00.000Z')
  })

  test('lastPostAt is the newest instant, never older than an existing value', () => {
    const mapped = mapThread(discussion(), [
      { id: 'C_1', body: '', createdAt: '2024-01-02T00:00:00Z', author: null },
    ])
    expect(lastPostAt(mapped.createdAt, mapped.posts)).toBe('2024-01-02T00:00:00.000Z')
    expect(lastPostAt(mapped.createdAt, mapped.posts, '2025-01-01T00:00:00.000Z')).toBe(
      '2025-01-01T00:00:00.000Z',
    )
  })
})
