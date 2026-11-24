/**
 * Session state. One reactive object shared by every component — no Pinia.
 * The badge groups are cached here too: they are tiny, public, and read by the
 * post and profile views on almost every page.
 */
import { reactive } from 'vue'
import { http } from './api'
import type { DmThreadsResponse, NotificationsResponse, SessionResponse } from './api'
import type { NotificationRow, SelfUser, UserGroupRow } from '../shared/types'

export const auth = reactive<{
  user: SelfUser | null
  loaded: boolean
}>({
  user: null,
  loaded: false,
})

export const groups = reactive<{
  loaded: boolean
  list: UserGroupRow[]
}>({
  loaded: false,
  list: [],
})

/** Re-reads the session cookie. Never throws — an anonymous visitor is not an error. */
export async function refreshSession(): Promise<void> {
  try {
    const { user } = await http.get<SessionResponse>('/auth/me')
    auth.user = user
  } catch {
    auth.user = null
  } finally {
    auth.loaded = true
  }
}

export async function logout(): Promise<void> {
  await http.post('/auth/logout')
  auth.user = null
}

/** Loaded once by the router guard, like the setup/meta probes. */
export async function loadGroups(): Promise<void> {
  try {
    groups.list = await http.get<UserGroupRow[]>('/groups')
  } catch {
    groups.list = []
  } finally {
    groups.loaded = true
  }
}

export const groupById = (id: number | null | undefined): UserGroupRow | null =>
  id == null ? null : (groups.list.find((g) => g.id === id) ?? null)

/** Inbox state shared by the header bell, the sidebar badge and the inbox page. */
export const notifications = reactive<{
  items: NotificationRow[]
  unread: number
  loaded: boolean
}>({
  items: [],
  unread: 0,
  loaded: false,
})

/** Total unread private messages, kept in sync by live events. */
export const dmUnread = reactive<{ count: number }>({ count: 0 })

/** Replaces the inbox with the server's newest 30 rows. */
export async function loadNotifications(): Promise<void> {
  if (!auth.user) return
  try {
    const res = await http.get<NotificationsResponse>('/notifications')
    notifications.items = res.items
    notifications.unread = res.unread
  } catch {
    // A failed badge must never break navigation.
  } finally {
    notifications.loaded = true
  }
}

/** Marks the given ids read (or the whole inbox when ids is omitted). */
export async function markNotificationsRead(ids?: number[]): Promise<void> {
  if (!auth.user) return
  try {
    const res = await http.post<{ unread: number }>(
      '/notifications/read',
      ids && ids.length ? { ids } : {},
    )
    const now = new Date().toISOString()
    for (const item of notifications.items) {
      if ((!ids || ids.includes(item.id)) && !item.readAt) item.readAt = now
    }
    notifications.unread = res.unread
  } catch {
    // Leave the badge as-is; the next load repairs it.
  }
}

/** Applies an inbox row that arrived over the live channel. */
export function pushNotification(row: NotificationRow): void {
  if (notifications.items.some((n) => n.id === row.id)) return
  notifications.items.unshift(row)
  if (notifications.items.length > 30) notifications.items.length = 30
  if (!row.readAt) notifications.unread += 1
}

/** Recomputes the private-message badge from the inbox list. */
export async function loadDmUnread(): Promise<void> {
  if (!auth.user) return
  try {
    const threads = await http.get<DmThreadsResponse>('/dm')
    dmUnread.count = threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0)
  } catch {
    // Non-critical: the badge simply stays where it was.
  }
}

/** Clears per-session live state on logout. */
export function resetRealtimeState(): void {
  notifications.items = []
  notifications.unread = 0
  notifications.loaded = false
  dmUnread.count = 0
}

