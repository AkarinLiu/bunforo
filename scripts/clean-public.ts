/**
 * Removes the previous build from public/assets before Vite writes the next one.
 *
 * The build output lives inside the served directory, so Vite's `emptyOutDir`
 * cannot be used (it would delete public/assets/uploads). This keeps hashed
 * bundles from piling up across deploys while never touching uploads.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const assetsDir = join(import.meta.dir, '..', 'public', 'assets')

for (const name of await readdir(assetsDir).catch(() => [])) {
  if (name === 'uploads') continue
  await rm(join(assetsDir, name), { recursive: true, force: true })
}
