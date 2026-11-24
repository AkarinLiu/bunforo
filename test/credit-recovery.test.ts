/**
 * Automatic credit recovery: +1 per configured interval, catch-up by whole
 * ticks, stop at the ceiling, and the feature can be switched off.
 *
 * The scheduler's clock is module state, so this file drives it with explicit
 * timestamps instead of sleeping.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')
const { creditRecoveryTick } = await import('../src/server/credit')

const baseSettings = {
  siteName: 'Recovery',
  siteDescription: '',
  siteNotice: '',
  siteFooter: '',
  dmMinCredit: 0,
  creditMax: 120,
}

const creditOf = async (id: number) => (await repo.findUserById(id))?.credit

describe('credit recovery', () => {
  test('awards one point per interval, catches up, and stops at the cap', async () => {
    await store.ensureSchema()
    await repo.saveSettings({ ...baseSettings, creditRecoverMinutes: 1 })

    const id = await repo.createUser({
      username: 'recover_user',
      displayName: 'Recover',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })
    expect(await creditOf(id)).toBe(100)

    const t0 = 1_000_000_000
    expect(await creditRecoveryTick(t0)).toBe(0) // baseline only
    expect(await creditRecoveryTick(t0 + 30_000)).toBe(0) // not due yet

    // The whole test DB is shared, so the return value counts every account;
    // assert the score of this user rather than the total.
    expect(await creditRecoveryTick(t0 + 90_000)).toBeGreaterThanOrEqual(1)
    expect(await creditOf(id)).toBe(101)

    // 340s elapsed since the last award = 5 whole intervals.
    expect(await creditRecoveryTick(t0 + 400_000)).toBeGreaterThanOrEqual(5)
    expect(await creditOf(id)).toBe(106)

    // Reach the ceiling: this user cannot gain any more.
    await repo.applyCredit(id, 1000)
    expect(await creditOf(id)).toBe(120)
    await creditRecoveryTick(t0 + 500_000)
    expect(await creditOf(id)).toBe(120)

    // Disabled: no awards, and re-enabling starts a fresh interval.
    await repo.saveSettings({ ...baseSettings, creditRecoverMinutes: 0 })
    await repo.applyCredit(id, -10)
    expect(await creditRecoveryTick(t0 + 900_000)).toBe(0)
    expect(await creditOf(id)).toBe(110)

    await repo.saveSettings({ ...baseSettings, creditRecoverMinutes: 1 })
    expect(await creditRecoveryTick(t0 + 960_000)).toBeGreaterThanOrEqual(1)
    expect(await creditOf(id)).toBe(111)
  })
})
