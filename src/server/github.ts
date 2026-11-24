/**
 * GitHub OAuth: how an imported placeholder account is claimed by its real
 * owner. GitHub only exposes the authorising user's own email, so it cannot be
 * used to enrich other people's imported posts — importing creates placeholders
 * keyed by login, and this module links the same login to a live session.
 *
 * Configuration is read at call time (unlike the storage/db modules) so a test
 * can toggle it without spawning a child process.
 */
import { randomBytes } from 'node:crypto'
import * as repo from '../db/repo'
import { placeholderUsername } from '../import/github/map'

export const GITHUB_SCOPE = 'read:user user:email'

const CLIENT_ID = () => process.env.GITHUB_CLIENT_ID?.trim() ?? ''
const CLIENT_SECRET = () => process.env.GITHUB_CLIENT_SECRET?.trim() ?? ''

/** The button/route is enabled only when a complete OAuth app is configured. */
export const oauthConfigured = (): boolean => Boolean(CLIENT_ID() && CLIENT_SECRET())

export type OauthErrorCode =
  | 'banned'
  | 'mismatch'
  | 'linked-elsewhere'
  | 'other-email'
  | 'exchange'
  | 'profile'
  | 'email'

export class GithubOauthError extends Error {
  constructor(readonly code: OauthErrorCode) {
    super(code)
    this.name = 'GithubOauthError'
  }
}

export const newState = (): string => randomBytes(32).toString('hex')

export function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: redirectUri,
    scope: GITHUB_SCOPE,
    state,
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

/** PUBLIC_BASE_URL exists for reverse proxies, where the request origin is the proxy's. */
export function callbackUrl(origin: string): string {
  const base = (process.env.PUBLIC_BASE_URL?.trim() || origin).replace(/\/$/, '')
  return `${base}/api/auth/github/callback`
}

const api = 'https://api.github.com'
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'bunforo-oauth',
})

export async function exchangeCode(
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        code,
        redirect_uri: redirectUri,
      }),
    })
  } catch {
    throw new GithubOauthError('exchange')
  }
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; error?: string }
    | null
  if (!response.ok || !body?.access_token) throw new GithubOauthError('exchange')
  return body.access_token
}

export interface GithubIdentity {
  login: string
  githubId: string | null
  name: string
  avatarUrl: string
  email: string | null
}

export async function fetchProfile(token: string, fetchImpl: typeof fetch = fetch): Promise<GithubIdentity> {
  let response: Response
  try {
    response = await fetchImpl(`${api}/user`, { headers: headers(token) })
  } catch {
    throw new GithubOauthError('profile')
  }
  if (!response.ok) throw new GithubOauthError('profile')
  const body = (await response.json().catch(() => null)) as {
    login?: string
    id?: number
    name?: string | null
    avatar_url?: string
    email?: string | null
  } | null
  if (!body?.login) throw new GithubOauthError('profile')
  return {
    login: body.login.toLowerCase(),
    githubId: body.id != null ? String(body.id) : null,
    name: (body.name || body.login).slice(0, 32),
    avatarUrl: body.avatar_url ?? '',
    email: body.email ? body.email.toLowerCase() : null,
  }
}

/** The primary verified address, or the first verified one; null without scope. */
export async function fetchVerifiedEmail(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetchImpl(`${api}/user/emails`, { headers: headers(token) })
  } catch {
    return null
  }
  if (!response.ok) return null
  const rows = (await response.json().catch(() => null)) as
    | { email?: string; primary?: boolean; verified?: boolean }[]
    | null
  if (!Array.isArray(rows)) return null
  const verified = rows.filter((r) => r.verified && r.email)
  const chosen = verified.find((r) => r.primary) ?? verified[0]
  return chosen?.email ? chosen.email.toLowerCase() : null
}

/**
 * Finds, claims or creates the local account behind a GitHub identity.
 *
 * Claim rules:
 *   * an existing github_login is authoritative; a different numeric id for the
 *     same login means the name was recycled, so refuse (it would be a takeover);
 *   * an empty email on the claimed account is filled from this verified
 *     authorisation, unless another account already owns that address;
 *   * no github account yet, but a verified local account holds the same email
 *     → link them rather than create a duplicate;
 *   * otherwise create a password-less account, exactly like the importer does.
 */
export async function resolveGithubAccount(
  identity: GithubIdentity,
): Promise<{ userId: number; sessionVersion: number }> {
  const login = identity.login.toLowerCase()
  const existing = await repo.findUserByGithubLogin(login)

  if (existing) {
    if (existing.banned) throw new GithubOauthError('banned')
    if (existing.githubId && identity.githubId && existing.githubId !== identity.githubId) {
      throw new GithubOauthError('mismatch')
    }
    if (identity.email && !existing.email) {
      const owner = await repo.findUserByEmail(identity.email)
      if (owner && owner.id !== existing.id) throw new GithubOauthError('other-email')
      await repo.updateUserEmail(existing.id, identity.email, true)
    }
    if (!existing.githubId && identity.githubId) {
      await repo.linkGithubAccount(existing.id, { githubLogin: login, githubId: identity.githubId })
    }
    return { userId: existing.id, sessionVersion: existing.sessionVersion }
  }

  if (identity.email) {
    const byEmail = await repo.findVerifiedUserByEmail(identity.email)
    if (byEmail) {
      if (byEmail.banned) throw new GithubOauthError('banned')
      if (byEmail.githubLogin && byEmail.githubLogin !== login) {
        throw new GithubOauthError('linked-elsewhere')
      }
      await repo.linkGithubAccount(byEmail.id, { githubLogin: login, githubId: identity.githubId })
      return { userId: byEmail.id, sessionVersion: byEmail.sessionVersion }
    }
  }

  const username = placeholderUsername(login, await repo.listUsernames())
  const userId = await repo.createGithubUser({
    username,
    displayName: identity.name || login.slice(0, 32),
    avatarUrl: identity.avatarUrl,
    email: identity.email ?? '',
    emailVerified: Boolean(identity.email),
    githubLogin: login,
    githubId: identity.githubId,
    createdAt: new Date().toISOString(),
  })
  return { userId, sessionVersion: 0 }
}
