import { describe, expect, test } from 'bun:test'
import {
  collectMediaUrls,
  downloadGithubMedia,
  localizeMedia,
} from '../src/import/github/media'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

describe('collectMediaUrls', () => {
  test('finds Markdown images, HTML tags and bare media URLs', () => {
    const body = [
      '![shot](https://user-images.githubusercontent.com/1/shot.png)',
      '<img src="https://github.com/user-attachments/assets/uuid" alt="x">',
      '<video controls src="https://github.com/user-attachments/assets/clip.mp4"></video>',
      'see https://user-images.githubusercontent.com/1/other.png.',
    ].join('\n')
    const urls = collectMediaUrls(body)
    expect(urls).toContain('https://user-images.githubusercontent.com/1/shot.png')
    expect(urls).toContain('https://github.com/user-attachments/assets/uuid')
    expect(urls).toContain('https://github.com/user-attachments/assets/clip.mp4')
    expect(urls).toContain('https://user-images.githubusercontent.com/1/other.png')
  })

  test('ignores external hosts and ordinary GitHub links', () => {
    const body = [
      '![x](https://example.com/a.png)',
      'https://example.com/b.jpg',
      '[workflow](https://github.com/owner/repo/actions)',
      'https://github.com/owner/repo',
    ].join('\n')
    expect(collectMediaUrls(body)).toEqual([])
  })

  test('decodes HTML entities in attachment URLs', () => {
    const body = '![a](https://github.com/user-attachments/assets/x?raw=1&amp;download=1)'
    expect(collectMediaUrls(body)).toEqual([
      'https://github.com/user-attachments/assets/x?raw=1&download=1',
    ])
  })
})

describe('localizeMedia', () => {
  test('rewrites Markdown images, converts HTML img and video tags', async () => {
    const body = [
      '![a](https://user-images.githubusercontent.com/1/a.png)',
      '<img src="https://user-images.githubusercontent.com/1/b.png" alt="shot">',
      '<video controls><source src="https://github.com/user-attachments/assets/c.mp4"></video>',
    ].join('\n')

    const result = await localizeMedia(body, {
      resolve: async () => '/uploads/local.png',
    })

    expect(result.imported).toBe(3)
    expect(result.body).toContain('![a](/uploads/local.png)')
    expect(result.body).toContain('![shot](/uploads/local.png)')
    expect(result.body).toContain('[视频](/uploads/local.png)')
    expect(result.body).not.toContain('<img')
    expect(result.body).not.toContain('<video')
  })

  test('keeps the original when a URL is skipped or fails', async () => {
    const skip = '![skip](https://user-images.githubusercontent.com/1/skip.png)'
    const boom = '![boom](https://user-images.githubusercontent.com/1/boom.png)'
    const ok = '![ok](https://user-images.githubusercontent.com/1/ok.png)'

    const result = await localizeMedia([skip, boom, ok].join('\n'), {
      resolve: async (url) => {
        if (url.includes('skip')) return null
        if (url.includes('boom')) throw new Error('network')
        return '/uploads/ok.png'
      },
    })

    expect(result).toMatchObject({ found: 3, imported: 1, skipped: 1, failed: 1 })
    expect(result.body).toContain(skip)
    expect(result.body).toContain(boom)
    expect(result.body).toContain('![ok](/uploads/ok.png)')
  })

  test('dry-run only counts candidates', async () => {
    const body = '![a](https://user-images.githubusercontent.com/1/a.png)'
    const result = await localizeMedia(body, {
      dryRun: true,
      resolve: async () => {
        throw new Error('must not download in dry-run')
      },
    })
    expect(result).toMatchObject({ body, found: 1, imported: 0, failed: 0 })
  })
})

describe('downloadGithubMedia', () => {
  const response = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
    new Response(bytes, { status: 200, headers })

  test('returns sniffed bytes and sends the token only to github.com', async () => {
    const seen: Record<string, string>[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>)
      return response(PNG)
    }) as unknown as typeof fetch

    const first = await downloadGithubMedia('https://github.com/user-attachments/assets/x', {
      token: 'secret',
      maxBytes: 1024,
      fetchImpl,
    })
    expect(first?.kind).toEqual({ mime: 'image/png', ext: 'png' })
    expect(seen[0]?.Authorization).toBe('Bearer secret')

    await downloadGithubMedia('https://user-images.githubusercontent.com/1/a.png', {
      token: 'secret',
      maxBytes: 1024,
      fetchImpl,
    })
    expect(seen[1]?.Authorization).toBeUndefined()
  })

  test('refuses non-GitHub hosts, oversized bodies and non-media bytes', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return response(PNG, { 'content-length': '2048' })
    }) as unknown as typeof fetch

    expect(
      await downloadGithubMedia('https://example.com/a.png', { maxBytes: 1024, fetchImpl }),
    ).toBeNull()
    expect(called).toBe(false)

    expect(
      await downloadGithubMedia('https://user-images.githubusercontent.com/1/a.png', {
        maxBytes: 1024,
        fetchImpl,
      }),
    ).toBeNull()

    const textFetch = (async () =>
      response(new TextEncoder().encode('<!doctype html>'))) as unknown as typeof fetch
    expect(
      await downloadGithubMedia('https://user-images.githubusercontent.com/1/a.png', {
        maxBytes: 1024,
        fetchImpl: textFetch,
      }),
    ).toBeNull()
  })

  test('throws on a non-2xx response so the caller can count it as a failure', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(
      downloadGithubMedia('https://user-images.githubusercontent.com/1/a.png', {
        maxBytes: 1024,
        fetchImpl,
      }),
    ).rejects.toThrow('HTTP 404')
  })
})
