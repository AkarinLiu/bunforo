import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Dev runs two processes: Vite serves the UI on :5173 and proxies /api to the
// Hono server on :3000 (`bun run dev` starts both). Production builds to
// `public/`, which Hono serves as the site root — no proxy involved.
export default defineConfig({
  plugins: [vue()],
  // Runtime uploads live under public/assets/uploads but are served by Hono at
  // /uploads/<key>. Turning the public dir off is essential here: the build
  // output is `public/` itself, so Vite copying its publicDir would try to copy
  // the tree into itself (and must never touch user uploads).
  publicDir: false,
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      // Uploaded objects are served by Hono, not by Vite — without this the
      // images inserted into a post would 404 in dev but work in production.
      '/uploads': 'http://localhost:3000',
      // Feeds are public files at the site root, not SPA routes. Without these
      // entries Vite answers with index.html and the router bounces the click
      // back to the home page — the feed looks broken only in dev.
      '/feed.xml': 'http://localhost:3000',
      '/rss.xml': 'http://localhost:3000',
      // A board feed only; /c/<id> itself must stay an SPA route.
      '^/c/\\d+/feed\\.xml$': 'http://localhost:3000',
    },
  },
  build: {
    // One served root: public/index.html plus public/assets/, sitting next to
    // the uploads directory. `emptyOutDir` must stay false — Vite would delete
    // public/assets/uploads; scripts/clean-public.ts removes the generated
    // bundles before each build instead.
    outDir: 'public',
    emptyOutDir: false,
  },
})
