/**
 * Runs in a throwaway cwd with every storage variable cleared, because
 * `storage.ts` reads its configuration at import time. Verifies the default
 * directory and the legacy ./uploads move on a real boot.
 */
import { existsSync, readFileSync } from 'node:fs'

// The second case keeps UPLOAD_DIR to prove that writing the default path
// explicitly still adopts ./uploads instead of leaving old URLs 404ing.
const keepUploadDir = process.env.PROBE_KEEP_UPLOAD_DIR === '1'
for (const key of [
  'UPLOAD_DIR',
  'STORAGE_DRIVER',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
]) {
  if (key === 'UPLOAD_DIR' && keepUploadDir) continue
  delete process.env[key]
}
delete process.env.PROBE_KEEP_UPLOAD_DIR

const storage = await import('../src/server/storage')
const moved = './public/assets/uploads/legacy.png'

// The point of the move: the old /uploads/<key> URL must still resolve.
const { app } = await import('../src/server/app')
const response = await app.request('/uploads/legacy.png')
const served = await response.arrayBuffer()

console.log(
  JSON.stringify({
    dir: storage.uploadDir,
    legacyGone: !existsSync('./uploads'),
    moved: existsSync(moved),
    content: existsSync(moved) ? readFileSync(moved, 'utf8') : null,
    status: response.status,
    contentType: response.headers.get('content-type'),
    servedText: new TextDecoder().decode(served),
  }),
)
