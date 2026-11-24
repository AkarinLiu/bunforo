/**
 * OAuth claim rules, run directly against the in-memory database. The token
 * exchange is not exercised here (no network); everything that decides which
 * local account a verified GitHub identity lands on is.
 */
import { describe, expect, test } from 'bun:test'
import * as store from '../src/db/index'
import * as repo from '../src/db/repo'
import {
  GithubOauthError,
  authorizeUrl,
  callbackUrl,
  resolveGithubAccount,
} from '../src/server/github'
import type { GithubIdentity } from '../src/server/github'

await store.ensureSchema()
await repo.ensureSystemUser()

let seq = 0
const uniq = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${seq++}`

const identity = (login: string, overrides: Partial<GithubIdentity> = {}): GithubIdentity => ({
  login,
  githubId: String(500000 + seq++),
  name: login,
  avatarUrl: '',
  email: null,
  ...overrides,
})

const placeholder = async (login: string, githubId: string | null) =>
  repo.createGithubUser({
    username: uniq('gh'),
    displayName: login,
    avatarUrl: '',
    email: '',
    emailVerified: false,
    githubLogin: login,
    githubId,
    createdAt: new Date().toISOString(),
  })

describe('resolveGithubAccount', () => {
  test('creates a password-less account with a verified email', async () => {
    const login = uniq('newbie')
    const email = `${uniq('new')}@example.com`
    const { userId, sessionVersion } = await resolveGithubAccount(identity(login, { email }))

    const user = await repo.findUserById(userId)
    expect(sessionVersion).toBe(0)
    expect(user?.githubLogin).toBe(login)
    expect(user?.email).toBe(email)
    expect(user?.emailVerified).toBe(true)
    expect(user?.passwordHash).toBe('')
  })

  test('claims a placeholder by login and fills its missing email', async () => {
    const login = uniq('claimed')
    const githubId = String(600000 + seq++)
    const id = await placeholder(login, githubId)
    const email = `${uniq('claimed')}@example.com`

    const result = await resolveGithubAccount(identity(login, { githubId, email }))

    expect(result.userId).toBe(id)
    const user = await repo.findUserById(id)
    expect(user?.email).toBe(email)
    expect(user?.emailVerified).toBe(true)
  })

  test('links an existing verified-email account instead of duplicating it', async () => {
    const login = uniq('linked')
    const email = `${uniq('linked')}@example.com`
    const id = await repo.createUser({
      username: uniq('local'),
      displayName: 'Local',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })
    await repo.updateUserEmail(id, email, true)

    const result = await resolveGithubAccount(identity(login, { email }))

    expect(result.userId).toBe(id)
    expect((await repo.findUserById(id))?.githubLogin).toBe(login)
  })

  test('refuses a recycled login whose numeric id changed', async () => {
    const login = uniq('recycled')
    await placeholder(login, '111')

    const error = await resolveGithubAccount(identity(login, { githubId: '222' })).catch((e) => e)
    expect(error).toBeInstanceOf(GithubOauthError)
    expect((error as GithubOauthError).code).toBe('mismatch')
  })

  test('refuses an email that already belongs to another account', async () => {
    const login = uniq('intruder')
    await placeholder(login, null)
    const email = `${uniq('owner')}@example.com`
    const other = await repo.createUser({
      username: uniq('owner'),
      displayName: 'Owner',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })
    await repo.updateUserEmail(other, email, true)

    const error = await resolveGithubAccount(identity(login, { email })).catch((e) => e)
    expect((error as GithubOauthError).code).toBe('other-email')
  })

  test('refuses a banned account', async () => {
    const login = uniq('banned')
    const id = await placeholder(login, null)
    await repo.setUserBan(id, { banned: true, reason: 'test', until: null })

    const error = await resolveGithubAccount(identity(login)).catch((e) => e)
    expect((error as GithubOauthError).code).toBe('banned')
  })
})

describe('OAuth wiring', () => {
  test('authorizeUrl carries the client, scope, redirect and state', () => {
    const previous = process.env.GITHUB_CLIENT_ID
    process.env.GITHUB_CLIENT_ID = 'client-123'
    try {
      const url = new URL(authorizeUrl('state-abc', 'https://forum.example/api/auth/github/callback'))
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
      expect(url.searchParams.get('client_id')).toBe('client-123')
      expect(url.searchParams.get('scope')).toBe('read:user user:email')
      expect(url.searchParams.get('state')).toBe('state-abc')
      expect(url.searchParams.get('redirect_uri')).toBe('https://forum.example/api/auth/github/callback')
    } finally {
      if (previous === undefined) delete process.env.GITHUB_CLIENT_ID
      else process.env.GITHUB_CLIENT_ID = previous
    }
  })

  test('callbackUrl honours PUBLIC_BASE_URL for reverse proxies', () => {
    const previous = process.env.PUBLIC_BASE_URL
    process.env.PUBLIC_BASE_URL = 'https://forum.example/'
    try {
      expect(callbackUrl('http://localhost:3000')).toBe('https://forum.example/api/auth/github/callback')
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = previous
    }
  })

  test('the route and meta flag stay off without credentials', async () => {
    const id = process.env.GITHUB_CLIENT_ID
    const secret = process.env.GITHUB_CLIENT_SECRET
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
    try {
      const { app } = await import('../src/server/app')
      const redirected = await app.request('/api/auth/github')
      expect(redirected.status).toBe(302)
      expect(redirected.headers.get('location')).toBe('/login?oauth=disabled')

      const meta = (await (await app.request('/api/meta')).json()) as { githubOAuth: boolean }
      expect(meta.githubOAuth).toBe(false)
    } finally {
      if (id !== undefined) process.env.GITHUB_CLIENT_ID = id
      if (secret !== undefined) process.env.GITHUB_CLIENT_SECRET = secret
    }
  })
})
