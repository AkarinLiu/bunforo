/**
 * Credit ceiling: awards clamp to settings.credit_max, new accounts start at
 * min(CREDIT_START, cap), deductions always apply, and 0 means unlimited.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

const iso = () => new Date().toISOString()
const baseSettings = {
  siteName: 'Cap',
  siteDescription: '',
  siteNotice: '',
  siteFooter: '',
  dmMinCredit: 0,
  creditRecoverMinutes: 0,
}
const makeUser = (username: string) =>
  repo.createUser({
    username,
    displayName: username,
    passwordHash: 'x',
    role: 'user',
    bio: '',
    avatarUrl: '',
    createdAt: iso(),
  })
const creditOf = async (id: number) => (await repo.findUserById(id))?.credit

describe('credit ceiling', () => {
  test('caps awards and starting credit without blocking deductions', async () => {
    await store.ensureSchema()
    await repo.saveSettings({ ...baseSettings, creditMax: 120 })

    const id = await makeUser('credit_cap_user')
    expect(await creditOf(id)).toBe(100)

    expect((await repo.applyCredit(id, 50)).credit).toBe(120)
    expect((await repo.applyCredit(id, 50)).credit).toBe(120)
    expect((await repo.applyCredit(id, -30)).credit).toBe(90)

    // A cap below the starting score clamps new accounts too.
    await repo.saveSettings({ ...baseSettings, creditMax: 50 })
    const low = await makeUser('credit_cap_low')
    expect(await creditOf(low)).toBe(50)
  })

  test('zero means unlimited', async () => {
    await repo.saveSettings({ ...baseSettings, creditMax: 0 })
    const id = await makeUser('credit_cap_off')
    expect((await repo.applyCredit(id, 1000)).credit).toBe(1100)
  })
})
