/**
 * A parent board's feed must carry its sub-boards' threads; the board page
 * itself stays direct-only. This is the behaviour that makes "subscribe to a
 * category" meaningful for a forum with nested boards.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()

describe('category feed tree', () => {
  test('includes direct sub-boards but not sibling boards', async () => {
    await store.ensureSchema()

    const userId = await repo.createUser({
      username: 'feed_tree_user',
      displayName: 'Feed Tree',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const parent = await repo.createCategory({
      name: 'Parent board',
      description: '',
      position: 0,
      parentId: null,
    })
    const child = await repo.createCategory({
      name: 'Child board',
      description: '',
      position: 1,
      parentId: parent,
    })
    const sibling = await repo.createCategory({
      name: 'Sibling board',
      description: '',
      position: 2,
      parentId: null,
    })

    const inParent = await repo.createThread({
      categoryId: parent,
      authorId: userId,
      title: 'in parent',
      body: 'a',
    })
    const inChild = await repo.createThread({
      categoryId: child,
      authorId: userId,
      title: 'in child',
      body: 'b',
    })
    const inSibling = await repo.createThread({
      categoryId: sibling,
      authorId: userId,
      title: 'in sibling',
      body: 'c',
    })

    const treeIds = (await repo.listThreadsInCategoryTree(parent, 30)).map((t) => t.id)
    expect(treeIds).toContain(inParent)
    expect(treeIds).toContain(inChild)
    expect(treeIds).not.toContain(inSibling)

    // The board page keeps its direct-only semantics.
    const directIds = (await repo.listThreads(parent, 30, 0)).map((t) => t.id)
    expect(directIds).toEqual([inParent])

    // An empty board still produces an empty (valid) feed.
    expect(await repo.listThreadsInCategoryTree(9999, 30)).toEqual([])
  })
})
