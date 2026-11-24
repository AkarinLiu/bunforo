/**
 * Automatic credit recovery: every `creditRecoverMinutes` a single point is
 * returned to each account below the ceiling. The clock lives in this process —
 * a restart simply restarts the interval, which is acceptable for a reputation
 * score and avoids a per-user timestamp column.
 *
 * The scheduler calls `creditRecoveryTick` about once a minute; the first call
 * after boot only establishes the baseline, so a long downtime does not dump a
 * pile of points at once.
 */
import * as repo from '../db/repo'

/** How often the server checks whether a recovery is due. */
export const CREDIT_RECOVERY_CHECK_MS = 60_000

let lastAwardAt = 0

/**
 * Awards due recovery ticks. Returns the total points granted (0 when disabled
 * or nothing is due). `now` is injectable so tests can advance the clock.
 */
export async function creditRecoveryTick(now = Date.now()): Promise<number> {
  const settings = await repo.getSettings()
  const minutes = settings.creditRecoverMinutes
  if (minutes <= 0) {
    // Keep the baseline fresh so enabling the feature starts from "now".
    lastAwardAt = now
    return 0
  }
  if (lastAwardAt === 0) {
    lastAwardAt = now
    return 0
  }
  const interval = minutes * 60_000
  const ticks = Math.floor((now - lastAwardAt) / interval)
  if (ticks <= 0) return 0
  // Advance by whole intervals only, keeping the remainder so the cadence does
  // not drift with the one-minute polling.
  lastAwardAt += ticks * interval
  return repo.recoverCredit(ticks, settings.creditMax)
}
