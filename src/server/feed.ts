/**
 * Public RSS 2.0 feeds: the whole forum and one board at a time.
 *
 * Readers look for feeds at the root, so these are mounted outside /api in
 * app.ts. Absolute links matter: a feed is read from whatever app subscribed to
 * it. PUBLIC_BASE_URL wins behind a reverse proxy (same rule as the GitHub
 * OAuth callback); otherwise the request's own origin is the best guess.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as repo from '../db/repo'
import type { ThreadRow } from '../shared/types'
import type { AppEnv } from './auth'
import { plainText } from './plaintext'
import { buildRss } from './rss'

const FEED_LIMIT = 30
const FALLBACK_DESCRIPTION = '一个跑在 Bun + Hono 上的论坛'

function originOf(c: Context): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim()
  return `${proto || url.protocol.replace(':', '')}://${host || c.req.header('host') || url.host}`
}

async function respond(
  c: Context,
  opts: { threads: ThreadRow[]; selfPath: string; boardName?: string },
) {
  const [settings, categories] = await Promise.all([repo.getSettings(), repo.listCategories()])
  const siteName = settings.siteName || repo.DEFAULT_SITE_NAME
  const categoryNames = new Map(categories.map((cat) => [cat.id, cat.name]))
  const bodies = await repo.openingPostBodies(opts.threads.map((thread) => thread.id))
  const origin = originOf(c)

  const xml = buildRss({
    title: opts.boardName ? `${opts.boardName} · ${siteName}` : siteName,
    link: `${origin}/`,
    description: settings.siteDescription || FALLBACK_DESCRIPTION,
    selfUrl: origin + opts.selfPath,
    items: opts.threads.map((thread) => ({
      title: thread.title,
      link: `${origin}/t/${thread.id}`,
      // The feed describes the conversation, so the newest activity is the
      // item's timestamp; readers sort by it.
      pubDate: new Date(thread.lastPostAt || thread.createdAt).toUTCString(),
      description: plainText(bodies.get(thread.id) ?? '', 300) || '（无正文）',
      author: thread.author?.displayName,
      category: categoryNames.get(thread.categoryId),
    })),
  })

  return c.body(xml, 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    // Public content that changes whenever anyone posts; a short shared cache
    // keeps a polling reader from hitting the DB every minute.
    'Cache-Control': 'public, max-age=300',
  })
}

export const feedRoutes = new Hono<AppEnv>()

/** Everything, newest activity first. */
feedRoutes.get('/feed.xml', async (c) => {
  const threads = await repo.listAllThreads(FEED_LIMIT, 0)
  return respond(c, { threads, selfPath: '/feed.xml' })
})

/** Conventional alias; the canonical URL is /feed.xml. */
feedRoutes.get('/rss.xml', (c) => c.redirect('/feed.xml', 301))

/** One board; a parent board also carries its sub-boards' threads. */
feedRoutes.get('/c/:id/feed.xml', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.text('Not Found', 404)
  const category = await repo.findCategory(id)
  if (!category) return c.text('Not Found', 404)
  const threads = await repo.listThreadsInCategoryTree(id, FEED_LIMIT)
  return respond(c, { threads, selfPath: `/c/${id}/feed.xml`, boardName: category.name })
})
