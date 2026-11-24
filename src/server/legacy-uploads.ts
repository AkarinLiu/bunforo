/**
 * One-off move for the buntalk → BunForo storage change.
 *
 * Uploads used to live in ./uploads; they now default to
 * ./public/assets/uploads. Serving still goes through /uploads/<key>, so only
 * the filesystem location changed. If an old directory exists, it is adopted
 * so existing avatars and post images keep working — a move when the new dir is
 * free, otherwise a non-destructive merge.
 *
 * Only called when UPLOAD_DIR is unset. An operator who pinned a path keeps it.
 * A failed move/merge aborts startup: silently serving an empty upload directory
 * would turn every stored image into a 404.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LEGACY_UPLOAD_DIR = './uploads'
export const DEFAULT_UPLOAD_DIR = './public/assets/uploads'

function move(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (err) {
    throw new Error(
      `[bunforo] could not move ${from} to ${to}: ${(err as Error).message}. Stop the server and move it manually before starting BunForo.`,
    )
  }
}

/**
 * Adopts the legacy directory. If the new one already exists (a previous boot
 * or a deployment tool created it), files are merged instead of skipped —
 * skipping is what would leave old `/uploads/<key>` URLs 404ing.
 */
export function migrateLegacyUploadDir(dir = '.'): void {
  const target = join(dir, DEFAULT_UPLOAD_DIR)
  const legacy = join(dir, LEGACY_UPLOAD_DIR)
  if (!existsSync(legacy)) return

  if (!existsSync(target)) {
    try {
      mkdirSync(dirname(target), { recursive: true })
      renameSync(legacy, target)
    } catch (err) {
      throw new Error(
        `[bunforo] could not move ${legacy} to ${target}: ${(err as Error).message}. Stop the server and move it manually before starting BunForo.`,
      )
    }
    console.log(`[bunforo] migrated ${LEGACY_UPLOAD_DIR} → ${DEFAULT_UPLOAD_DIR}`)
    return
  }

  mkdirSync(target, { recursive: true })
  let copied = 0
  for (const name of readdirSync(legacy)) {
    const from = join(legacy, name)
    const to = join(target, name)
    // Same key already present: leave it. Keys are content-addressed UUIDs, so
    // a collision is a duplicate, not a different file.
    if (existsSync(to)) continue
    move(from, to)
    copied++
  }
  if (readdirSync(legacy).length === 0) rmdirSync(legacy)
  else console.warn(`[bunforo] ${LEGACY_UPLOAD_DIR} still has files that also exist in ${DEFAULT_UPLOAD_DIR}; review and remove it when safe.`)
  console.log(`[bunforo] merged ${copied} file(s) from ${LEGACY_UPLOAD_DIR} into ${DEFAULT_UPLOAD_DIR}`)
}
