/**
 * The upload endpoint over HTTP: real multipart parsing, session gate, byte
 * sniffing and the new video formats. Storage is the temp dir pinned by the
 * test preload, so the real upload folder is never touched.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as store from '../src/db/index'
import * as repo from '../src/db/repo'
import * as storage from '../src/server/storage'
import { app } from '../src/server/app'

await store.ensureSchema()
await repo.ensureSystemUser()

let seq = 0
const uniq = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${seq++}`

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

const MP4 = (() => {
  const bytes = new Uint8Array(32)
  bytes.set([0x66, 0x74, 0x79, 0x70], 4) // ftyp
  bytes.set([...'isom'].map((c) => c.charCodeAt(0)), 8)
  return bytes
})()

const sessionCookie = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

async function register(): Promise<string> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: uniq('uploader'),
      displayName: 'Uploader',
      password: 'password123',
    }),
  })
  expect(res.status).toBe(201)
  return sessionCookie(res)
}

async function upload(cookie: string, bytes: Uint8Array, name: string, type: string) {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return app.request('/api/uploads', { method: 'POST', headers: { cookie }, body: form })
}

describe('POST /api/uploads', () => {
  test('requires a session', async () => {
    const form = new FormData()
    form.append('file', new File([PNG], 'a.png', { type: 'image/png' }))
    expect((await app.request('/api/uploads', { method: 'POST', body: form })).status).toBe(401)
  })

  test('stores an image under the configured upload directory', async () => {
    const cookie = await register()
    const res = await upload(cookie, PNG, 'a.png', 'image/png')
    expect(res.status).toBe(201)
    const body = (await res.json()) as { key: string; url: string; mime: string }
    expect(body.mime).toBe('image/png')
    expect(body.url).toBe(`/uploads/${body.key}`)
    expect(existsSync(join(storage.uploadDir, body.key))).toBe(true)
  })

  test('accepts MP4 video and rejects HTML labelled as video', async () => {
    const cookie = await register()
    const video = await upload(cookie, MP4, 'clip.mp4', 'video/mp4')
    expect(video.status).toBe(201)
    expect(((await video.json()) as { mime: string }).mime).toBe('video/mp4')

    const fake = await upload(cookie, new TextEncoder().encode('<!doctype html>'), 'x.mp4', 'video/mp4')
    expect(fake.status).toBe(400)
  })
})
