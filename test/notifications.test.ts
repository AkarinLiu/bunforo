/**
 * Notification inbox: insert, list with the actor join, unread count and the
 * read watermark. SQLite path only — every dialect is exercised by the same
 * repo code, so this is the query-shape check.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()

describe('notifications', () => {
  test('records, lists and marks read', async () => {
    await store.ensureSchema()

    const actorId = await repo.createUser({
      username: 'notif_actor',
      displayName: 'Actor',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const recipientId = await repo.createUser({
      username: 'notif_recipient',
      displayName: 'Recipient',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const categoryId = await repo.createCategory({
      name: 'Notices',
      description: '',
      position: 0,
      parentId: null,
    })
    const threadId = await repo.createThread({
      categoryId,
      authorId: actorId,
      title: 'Release notes',
      body: 'hello',
    })

    const row = await repo.createNotification({
      userId: recipientId,
      type: 'reply',
      actorId,
      threadId,
      body: 'Actor 回复了你的主题',
      excerpt: '这是回复的内容',
    })
    expect(row.id).toBeGreaterThan(0)
    expect(row.readAt).toBeNull()

    expect(await repo.countUnreadNotifications(recipientId)).toBe(1)
    const list = await repo.listNotifications(recipientId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: row.id,
      type: 'reply',
      body: 'Actor 回复了你的主题',
      excerpt: '这是回复的内容',
      actor: { id: actorId, displayName: 'Actor' },
    })

    await repo.markNotificationsRead(recipientId, [row.id])
    expect(await repo.countUnreadNotifications(recipientId)).toBe(0)
    expect((await repo.listNotifications(recipientId))[0]?.readAt).toBeTruthy()
  })

  test('one unread dm notice per conversation', async () => {
    const creatorId = await repo.createUser({
      username: 'dm_creator',
      displayName: 'Creator',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const peerId = await repo.createUser({
      username: 'dm_peer',
      displayName: 'Peer',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const dmId = await repo.createDmThread({
      creatorId,
      title: 'Chat',
      participantIds: [peerId],
      body: 'first',
    })

    expect(await repo.hasUnreadDmNotification(peerId, dmId)).toBe(false)
    await repo.createNotification({
      userId: peerId,
      type: 'dm',
      actorId: creatorId,
      dmThreadId: dmId,
      body: 'Creator 在私信「Chat」中发来消息',
    })
    expect(await repo.hasUnreadDmNotification(peerId, dmId)).toBe(true)
    // Another message in the same conversation must not add a second bell row.
    expect(await repo.countUnreadNotifications(peerId)).toBe(1)

    await repo.markDmNotificationsRead(peerId, dmId)
    expect(await repo.hasUnreadDmNotification(peerId, dmId)).toBe(false)
    expect(await repo.countUnreadNotifications(peerId)).toBe(0)
  })
})
