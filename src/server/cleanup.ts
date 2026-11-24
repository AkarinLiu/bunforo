/**
 * Reclaims uploads that never became an attachment.
 *
 * The composer uploads a file before the post is submitted, so an abandoned
 * draft leaves an orphan object. A file is deleted only when it is older than
 * the grace period AND its key appears in no content column — see
 * `referencedUploadKeys` for the exact scope.
 *
 * Runs in-process on a timer (single-instance app); deletes are per object so
 * one failure does not stop the sweep.
 */
import * as repo from '../db/repo'
import { listObjects, remove } from './storage'

/** A new upload cannot be swept until this long after it landed. */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000

/** How often the server sweeps. Cheap when nothing is old enough. */
export const UPLOAD_SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * Keys produced by `/api/uploads`: a UUID plus the sniffed extension. Anything
 * else in the directory or bucket is left alone — the sweeper must never touch
 * files an operator put there.
 */
const MANAGED_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i

export interface UploadCleanupResult {
  /** managed files old enough to be considered */
  scanned: number
  deleted: number
  failed: number
}

export async function runUploadCleanup(now = Date.now()): Promise<UploadCleanupResult> {
  const objects = await listObjects()
  const candidates = objects.filter(
    (object) =>
      MANAGED_KEY_RE.test(object.key) &&
      // lastModified 0 means the backend did not report a time: never delete
      // on an unknown age.
      object.lastModified > 0 &&
      now - object.lastModified >= UPLOAD_GRACE_MS,
  )
  if (!candidates.length) return { scanned: 0, deleted: 0, failed: 0 }

  const referenced = await repo.referencedUploadKeys(candidates.map((object) => object.key))
  const result: UploadCleanupResult = { scanned: candidates.length, deleted: 0, failed: 0 }
  for (const object of candidates) {
    if (referenced.has(object.key)) continue
    try {
      await remove(object.key)
      result.deleted += 1
    } catch (err) {
      result.failed += 1
      console.error(`[bunforo] could not remove unused upload ${object.key}:`, err)
    }
  }
  return result
}
