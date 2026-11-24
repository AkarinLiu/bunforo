/**
 * The upload sweeper: only managed (`<uuid>.<ext>`) keys older than the grace
 * period are candidates, and only when no content column mentions them.
 */
import { describe, expect, test } from 'bun:test'
import { utimes } from 'node:fs/promises'
import { join } from 'node:path'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')
const storage = await import('../src/server/storage')
const cleanup = await import('../src/server/cleanup')

const iso = () => new Date().toISOString()
const OLD_MS = Date.now() - cleanup.UPLOAD_GRACE_MS - 60_000
const key = (ext = 'png') => `${crypto.randomUUID()}.${ext}`
const pathOf = (name: string) => join(storage.uploadDir, name)
const exists = (name: string) => Bun.file(pathOf(name)).exists()

async function place(name: string, old: boolean): Promise<void> {
  await storage.put(name, new Uint8Array([137, 80, 78, 71]), 'image/png')
  if (!old) return
  const when = new Date(OLD_MS)
  await utimes(pathOf(name), when, when)
}

describe('upload cleanup', () => {
  test('deletes old unreferenced uploads and leaves everything else alone', async () => {
    await store.ensureSchema()

    const userId = await repo.createUser({
      username: 'cleanup_owner',
      displayName: 'Cleanup Owner',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const peerId = await repo.createUser({
      username: 'cleanup_peer',
      displayName: 'Cleanup Peer',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: iso(),
    })
    const categoryId = await repo.createCategory({
      name: 'Cleanup board',
      description: '',
      position: 0,
      parentId: null,
    })

    const inPost = key()
    const inDraft = key()
    const inDm = key()
    const asAvatar = key()
    const inNotice = key()
    const orphan = key()
    const young = key()
    const foreign = 'operator-notes.txt'

    await repo.createThread({
      categoryId,
      authorId: userId,
      title: 'with image',
      body: `![x](/uploads/${inPost})`,
    })
    await repo.createDraft({
      authorId: userId,
      categoryId,
      title: 'draft',
      body: `![x](/uploads/${inDraft})`,
    })
    await repo.createDmThread({
      creatorId: userId,
      title: 'chat',
      participantIds: [peerId],
      body: `![x](/uploads/${inDm})`,
    })
    await repo.updateUserProfile(userId, {
      displayName: 'Cleanup Owner',
      bio: '',
      avatarUrl: `/uploads/${asAvatar}`,
    })
    await repo.saveSettings({
      siteName: 'Cleanup',
      siteDescription: '',
      siteNotice: `![x](/uploads/${inNotice})`,
      siteFooter: '',
      dmMinCredit: 0,
      creditMax: 1000,
      creditRecoverMinutes: 0,
    })

    for (const name of [inPost, inDraft, inDm, asAvatar, inNotice, orphan]) {
      await place(name, true)
    }
    await place(young, false)
    await Bun.write(pathOf(foreign), 'keep me')
    await utimes(pathOf(foreign), new Date(OLD_MS), new Date(OLD_MS))

    const result = await cleanup.runUploadCleanup()
    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(0)

    expect(await exists(orphan)).toBe(false)
    for (const name of [inPost, inDraft, inDm, asAvatar, inNotice, young, foreign]) {
      expect(await exists(name)).toBe(true)
    }
  })
})
