/**
 * Per-user settings: defaults without a row, save/update, and isolation
 * between accounts. The notification side is covered by the route-level gate
 * (NOTIFICATION_PREF) rather than here.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()
const DEFAULTS = { notifyReply: true, notifyMention: true, notifyLike: true, notifyDm: true }

async function makeUser(username: string): Promise<number> {
  return repo.createUser({
    username,
    displayName: username,
    passwordHash: 'x',
    role: 'user',
    bio: '',
    avatarUrl: '',
    createdAt: iso(),
  })
}

describe('user settings', () => {
  test('defaults before the first save, then persists and isolates', async () => {
    await store.ensureSchema()
    const alice = await makeUser('settings_alice')
    const bob = await makeUser('settings_bob')

    expect(await repo.getUserSettings(alice)).toEqual(DEFAULTS)

    const off = { notifyReply: false, notifyMention: true, notifyLike: false, notifyDm: true }
    await repo.saveUserSettings(alice, off)
    expect(await repo.getUserSettings(alice)).toEqual(off)

    // A second save updates the existing row instead of inserting a duplicate.
    await repo.saveUserSettings(alice, { ...DEFAULTS, notifyDm: false })
    expect(await repo.getUserSettings(alice)).toEqual({ ...DEFAULTS, notifyDm: false })

    // Bob has never saved, so he still sees the defaults.
    expect(await repo.getUserSettings(bob)).toEqual(DEFAULTS)
  })
})
