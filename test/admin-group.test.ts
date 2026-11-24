/**
 * The seeded 管理员 group: adoption of a same-named group, idempotent seeding,
 * and the role↔membership sync that boot runs.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()
const makeUser = (username: string, role: 'admin' | 'user') =>
  repo.createUser({
    username,
    displayName: username,
    passwordHash: 'x',
    role,
    bio: '',
    avatarUrl: '',
    createdAt: iso(),
  })

describe('built-in admin group', () => {
  test('adopts a same-named group and seeds only once', async () => {
    await store.ensureSchema()

    // An install that created 管理员 by hand must not end up with a duplicate.
    const manual = await repo.createGroup({ name: '管理员', color: '#123456', position: 3 })
    const id = await repo.ensureAdminGroup()
    expect(id).toBe(manual)
    expect(await repo.ensureAdminGroup()).toBe(manual)

    const groups = await repo.listGroups()
    expect(groups.filter((g) => g.name === '管理员')).toHaveLength(1)
    expect(groups.find((g) => g.id === manual)?.builtin).toBe(true)
  })

  test('group membership is the source of truth for the admin role', async () => {
    const adminId = await makeUser('builtin_group_admin', 'admin')
    const memberId = await makeUser('builtin_group_member', 'user')
    const groupId = await repo.ensureAdminGroup()

    const admin = await repo.findUserById(adminId)
    expect(admin?.groupId).toBe(groupId)
    expect(admin?.role).toBe('admin')
    const member = await repo.findUserById(memberId)
    expect(member?.groupId).toBeNull()
    expect(member?.role).toBe('user')

    // Joining the group grants admin on the next sync.
    await repo.setUserGroup(memberId, groupId)
    await repo.syncAdminGroup()
    expect((await repo.findUserById(memberId))?.role).toBe('admin')

    // An admin parked in a custom group is moved back into the built-in one.
    const custom = await repo.createGroup({ name: 'Custom badge', color: '#123456', position: 5 })
    await repo.setUserGroup(adminId, custom)
    await repo.syncAdminGroup()
    expect((await repo.findUserById(adminId))?.groupId).toBe(groupId)
    expect((await repo.findUserById(adminId))?.role).toBe('admin')
  })
})
