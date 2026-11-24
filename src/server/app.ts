/**
 * Hono app: `/api` first, static SPA second.
 *
 * Ordering is load-bearing. Routes registered before a middleware run before
 * it, so the API answers without ever touching the static handler, and the SPA
 * fallback only fires for navigation-shaped requests (anything with a file
 * extension falls through to a real 404 instead of getting index.html back
 * with a 200, which would break every stale asset URL).
 */
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { join } from 'node:path'
import { emailGate, session } from './auth'
import { feedRoutes } from './feed'
import { api } from './routes'
import * as storage from './storage'
import type { AppEnv } from './auth'

// The whole served tree: built SPA (index.html + assets/) and runtime uploads
// (assets/uploads/, reached through /uploads/<key> below).
const publicDir = join(import.meta.dir, '..', '..', 'public')
const publicIndex = join(publicDir, 'index.html')

export const app = new Hono<AppEnv>()

app.use('/api/*', session)
// Runs after session (it needs `c.var.user`) and before every route, so forced
// email binding cannot be bypassed by calling the API directly.
app.use('/api/*', emailGate)
app.route('/api', api)

// Feeds live at the site root, where readers and <link rel="alternate"> point.
// They are public, so they are mounted before the SPA fallback but after the
// session middleware that covers only /api.
app.route('/', feedRoutes)

// Uploaded objects. The public path is backend-independent, which is what lets
// a post body written against local disk keep working after moving to S3.
app.use('/uploads/*', async (c, next) => {
  await next()
  // Belt and braces on top of the magic-byte allowlist: a browser must never
  // decide for itself what an uploaded file is.
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
})

if (storage.driver === 's3') {
  app.get('/uploads/*', async (c) => {
    // A bare `*` no longer lands in `c.req.param('*')` on Hono 4.13 (both
    // routers match it anonymously), so read the key off the path instead.
    // `isValidKey` is still the gate, and it forbids anything needing decoding.
    const key = c.req.path.slice('/uploads/'.length)
    if (!storage.isValidKey(key)) return c.notFound()
    const target = await storage.publicUrl(key)
    if (!target) return c.notFound()
    // Always 302: a presigned target is re-minted per request, so a cached
    // permanent redirect would eventually point at an expired signature.
    return c.redirect(target, 302)
  })
} else {
  app.use(
    '/uploads/*',
    serveStatic({
      root: storage.uploadDir,
      rewriteRequestPath: (path) => path.replace(/^\/uploads/, ''),
    }),
  )
}

// Built frontend present? Serve it. Absent (fresh clone, dev against Vite),
// skip — `bun run dev` puts the UI on :5173 instead.
if (await Bun.file(publicIndex).exists()) {
  app.use('/*', serveStatic({ root: publicDir }))

  app.get('*', async (c, next) => {
    // Never let the SPA fallback answer for the API, or an unknown endpoint
    // would return index.html with a 200 instead of the JSON 404 below.
    if (c.req.path.startsWith('/api')) return await next()
    // Anything with a file extension is a real asset request: a 404 is the
    // honest answer, and returning HTML there breaks stale asset URLs.
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return await next()
    // serveStatic joins its root and path, so the file must be expressed as
    // root + relative name — an absolute `path` is silently joined into a
    // nonexistent relative one and every deep link 404s.
    return serveStatic({ root: publicDir, path: 'index.html' })(c, next)
  })
}

app.notFound((c) =>
  c.req.path.startsWith('/api')
    ? c.json({ error: '接口不存在' }, 404)
    : c.text('Not Found', 404),
)
