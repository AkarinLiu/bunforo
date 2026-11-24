/**
 * Download the media embedded in an imported GitHub body and rewrite it to a
 * local `/uploads/<key>` URL.
 *
 * Only GitHub-owned hosts are fetched. A discussion is attacker-controlled
 * text, so following arbitrary URLs here would be an SSRF primitive; images
 * hosted elsewhere are left as remote links. The accepted bytes are judged by
 * `sniff()`, never by the URL or the response's Content-Type.
 */
import { sniff } from '../../server/filetype'
import type { FileKind } from '../../server/filetype'

/** GitHub media origins seen in Discussion bodies. */
const isGithubHost = (host: string): boolean =>
  host === 'github.com' || host.endsWith('.githubusercontent.com')

export function isDownloadableMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && isGithubHost(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|mp4|m4v|webm|mov)(?:[?#]|$)/i
const ATTACHMENT = /^\/user-attachments\/(assets|files)\//
const IMAGE_HOST = /^(user-images|private-user-images|media)\.githubusercontent\.com$/

/** Whether a plain link is likely to be media, without fetching it. */
function looksLikeMedia(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (MEDIA_EXT.test(url.pathname)) return true
    if (host === 'github.com' && ATTACHMENT.test(url.pathname)) return true
    return IMAGE_HOST.test(host)
  } catch {
    return false
  }
}

const attr = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null
}

const clean = (value: string | null): string | null => {
  if (!value) return null
  return value.replace(/&amp;/g, '&').replace(/^<|>$/g, '').trim()
}

/**
 * All GitHub media URLs in a body: image/video tags, Markdown images, Markdown
 * links and bare URLs that look like media. Tag/Markdown-image URLs do not need
 * a file extension (GitHub attachment URLs have none).
 */
export function collectMediaUrls(body: string): string[] {
  const urls = new Set<string>()
  const add = (raw: string | null, force: boolean) => {
    const url = clean(raw)
    if (!url || !isDownloadableMediaUrl(url)) return
    if (force || looksLikeMedia(url)) urls.add(url)
  }

  for (const match of body.matchAll(/<img\b[^>]*>/gi)) add(attr(match[0], 'src'), true)
  for (const match of body.matchAll(/<video\b[^>]*>/gi)) add(attr(match[0], 'src'), true)
  for (const match of body.matchAll(/<source\b[^>]*>/gi)) add(attr(match[0], 'src'), true)
  for (const match of body.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)/g)) add(match[1] ?? null, true)
  for (const match of body.matchAll(/\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)/g)) add(match[1] ?? null, false)
  for (const match of body.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    add(match[0].replace(/[.,;:!?]+$/, ''), false)
  }

  return [...urls]
}

export type MediaResolver = (url: string) => Promise<string | null>

export interface LocalizeResult {
  body: string
  /** Candidate GitHub media URLs seen. */
  found: number
  /** URLs rewritten to a local /uploads path. */
  imported: number
  /** Candidates that turned out not to be an accepted image/video, or too big. */
  skipped: number
  /** Download/store errors; the original URL is kept. */
  failed: number
}

/**
 * Rewrites every resolvable media URL. HTML `<img>` tags become Markdown images
 * (raw HTML is escaped by the renderer, so leaving the tag would show text), and
 * `<video>` blocks become links because the forum has no video player.
 */
export async function localizeMedia(
  body: string,
  options: { resolve: MediaResolver; dryRun?: boolean },
): Promise<LocalizeResult> {
  const candidates = collectMediaUrls(body)
  const result: LocalizeResult = { body, found: candidates.length, imported: 0, skipped: 0, failed: 0 }
  if (!candidates.length || options.dryRun) return result

  const replacements = new Map<string, string>()
  for (const url of candidates) {
    try {
      const local = await options.resolve(url)
      if (local) {
        replacements.set(url, local)
        result.imported++
      } else {
        result.skipped++
      }
    } catch {
      result.failed++
    }
  }
  if (!replacements.size) return result

  let out = body
  // Whole blocks first: a <video> wraps its <source>, so replacing only the src
  // inside it would leave an escaped tag that renders as text.
  out = out.replace(/<video\b[\s\S]*?<\/video>/gi, (block) => {
    const source = /<source\b[^>]*>/i.exec(block)
    const url = clean(attr(block, 'src')) ?? (source ? clean(attr(source[0], 'src')) : null)
    const local = url ? replacements.get(url) : undefined
    return local ? `[视频](${local})` : block
  })
  out = out.replace(/<video\b[^>]*\/?>/gi, (tag) => {
    const local = replacements.get(clean(attr(tag, 'src')) ?? '')
    return local ? `[视频](${local})` : tag
  })
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const local = replacements.get(clean(attr(tag, 'src')) ?? '')
    if (!local) return tag
    const alt = (clean(attr(tag, 'alt')) ?? '').replace(/[[\]()\r\n]/g, '').slice(0, 120)
    return `![${alt}](${local})`
  })

  // Remaining occurrences are Markdown destinations or bare URLs. Handle the
  // CommonMark `<...>` destination form before the bare one.
  for (const [url, local] of replacements) {
    out = out.split(`<${url}>`).join(local).split(url).join(local)
  }
  result.body = out
  return result
}

/**
 * Fetches one GitHub media URL. The token is attached only to github.com; media
 * on `*.githubusercontent.com` is either public or a signed URL and must not
 * receive it. Returns null when the body exceeds `maxBytes`.
 */
export async function downloadGithubMedia(
  url: string,
  options: { token?: string; maxBytes: number; fetchImpl?: typeof fetch },
): Promise<{ bytes: Uint8Array; kind: FileKind } | null> {
  if (!isDownloadableMediaUrl(url)) return null
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = { Accept: '*/*', 'User-Agent': 'bunforo-import' }
  if (options.token && new URL(url).hostname.toLowerCase() === 'github.com') {
    headers.Authorization = `Bearer ${options.token}`
  }
  const response = await fetchImpl(url, { headers, redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > options.maxBytes) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > options.maxBytes) return null
  // Prove the bytes are an accepted type before the caller stores them.
  const kind = sniff(bytes)
  if (!kind) return null
  return { bytes, kind }
}
