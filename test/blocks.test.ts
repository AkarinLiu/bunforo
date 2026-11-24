/**
 * Blacklist storage: directional, listable, and removable. The @mention and DM
 * gates live in the routes and are covered by the end-to-end probe.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()
const makeUser = (username: string) =>
  repo.createUser({
    username,
    displayName: username,
    passwordHash: 'x',
    role: 'user',
    bio: '',
    avatarUrl: '',
    createdAt: iso(),
  })

describe('user blocks', () => {
  test('blocks one direction, lists, and unblocks', async () => {
    await store.ensureSchema()
    const alice = await makeUser('blocks_alice')
    const bob = await makeUser('blocks_bob')

    expect(await repo.listBlockedUsers(alice)).toEqual([])

    await repo.blockUser(alice, bob)
    expect(await repo.isBlocked(alice, bob)).toBe(true)
    // Directional: Bob has not blocked Alice.
    expect(await repo.isBlocked(bob, alice)).toBe(false)
    expect(await repo.listBlockedUsers(bob)).toEqual([])

    const list = await repo.listBlockedUsers(alice)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: bob, username: 'blocks_bob' })

    await repo.unblockUser(alice, bob)
    expect(await repo.isBlocked(alice, bob)).toBe(false)
    expect(await repo.listBlockedUsers(alice)).toEqual([])
  })
})
