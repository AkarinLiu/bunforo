/**
 * One-off upgrade path for the buntalk → BunForo rename.
 *
 * The default SQLite file is now ./bunforo.db. Starting with the new name in a
 * directory that still holds ./buntalk.db would silently open an empty database
 * — every existing post would appear to be gone. So before the connection is
 * opened we rename the old file (and its WAL sidecars) into place.
 *
 * Only called when `DATABASE_URL` is unset: an operator who pinned an explicit
 * path keeps exactly that path. A failed rename aborts startup on purpose; the
 * one outcome we refuse to produce is "served an empty forum that looks fine".
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const LEGACY = 'buntalk.db'
const CURRENT = 'bunforo.db'

/** Renames the legacy default database in `dir` when the new name is free. */
export function migrateLegacySqliteFile(dir = '.'): void {
  const target = join(dir, CURRENT)
  if (existsSync(target)) return
  const legacy = join(dir, LEGACY)
  if (!existsSync(legacy)) return

  // The main file first; -wal/-shm may exist while the old process is still
  // shutting down. Stop the old server before upgrading (README says so).
  for (const [from, to] of [
    [legacy, target],
    [legacy + '-wal', target + '-wal'],
    [legacy + '-shm', target + '-shm'],
  ] as const) {
    if (!existsSync(from)) continue
    try {
      renameSync(from, to)
    } catch (err) {
      throw new Error(
        `[bunforo] could not rename ${from} -> ${to}: ${(err as Error).message}. Stop the server and rename it manually before starting BunForo.`,
      )
    }
  }
  console.log(`[bunforo] migrated ${legacy} → ${target}`)
}
