/**
 * Public server capabilities, loaded once by the router guard (like the setup
 * check). `requireEmail` drives the binding gate; `mailConfigured` decides
 * whether the code field is worth showing.
 */
import { reactive } from 'vue'
import { http } from './api'
import type { MetaResponse } from './api'

export const meta = reactive({
  loaded: false,
  mailConfigured: false,
  requireEmail: false,
  githubOAuth: false,
  dmMinCredit: 0,
})

export async function loadMeta(): Promise<void> {
  try {
    const m = await http.get<MetaResponse>('/meta')
    meta.mailConfigured = m.mailConfigured
    meta.requireEmail = m.requireEmail
    meta.githubOAuth = m.githubOAuth
    meta.dmMinCredit = m.dmMinCredit ?? 0
  } catch {
    // Unreachable API: assume no forced binding rather than locking the UI.
  } finally {
    meta.loaded = true
  }
}
