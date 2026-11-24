/**
 * Domain row shapes — the contract between the database layer and everything
 * that reads its rows (API responses, Vue components).
 *
 * This module is deliberately dependency-free: both `src/db` and `src/web`
 * import from it, so importing a *value* here can never drag Drizzle, `pg` or
 * `bun:sqlite` into the browser bundle. Always `import type` from this file
 * on the client.
 *
 * Drizzle has no cross-dialect table builder (`sqliteTable` / `pgTable` /
 * `mysqlTable` are mutually incompatible), so `db/schema/` holds one file per
 * dialect and this file holds the contract all three must satisfy.
 *
 * All timestamps are ISO-8601 UTC strings, not DB timestamps: identical
 * behaviour on all three engines, and they sort correctly as text.
 */

export type Dialect = 'sqlite' | 'pg' | 'mysql'
export type Role = 'user' | 'admin'

/**
 * Reserved account for system-generated content (welcome private messages,
 * future notices). A negative id can never collide with an auto-increment row
 * and `idOf()` (which requires `> 0`) can never target it, so no route can ban,
 * edit or impersonate it.
 */
export const SYSTEM_USER_ID = -1
export const SYSTEM_USERNAME = 'system'

export interface UserRow {
  id: number
  username: string
  displayName: string
  bio: string
  avatarUrl: string
  role: Role
  /** badge group, null when ungrouped */
  groupId: number | null
  banned: boolean
  /** reputation; new accounts start at CREDIT_START (100) */
  credit: number
  /** admin-facing; '' when not banned */
  banReason: string
  /** ISO timestamp for a temporary ban, null for a permanent one / not banned */
  bannedUntil: string | null
  createdAt: string
  /** bound email, lowercased; '' when none */
  email: string
  /** whether `email` has been confirmed with a mailed code */
  emailVerified: boolean
  /**
   * Bumped on password reset. The session cookie carries it, so a bump makes
   * every previously issued cookie stale — that is how a reset logs everyone out.
   */
  sessionVersion: number
}

/** Auth path only — never serialize this to the client. */
export interface UserAuthRow extends UserRow {
  passwordHash: string
  /** GitHub login, lowercased; null for ordinary accounts. Claim key for OAuth. */
  githubLogin: string | null
  /** GitHub numeric user id as text; null when GitHub did not expose one (bots). */
  githubId: string | null
}

/** A display group members are assigned to; carries a badge colour, not permissions. */
export interface UserGroupRow {
  id: number
  name: string
  /** badge colour, `#rrggbb` */
  color: string
  position: number
  /** seeded admin group: cannot be renamed or deleted */
  builtin: boolean
  /** filled by list queries only */
  memberCount?: number
}

export interface CategoryRow {
  id: number
  /** null for a top-level 版块; set to the parent id for a 子版块 (one level only) */
  parentId: number | null
  name: string
  description: string
  position: number
  /** filled by list queries only */
  threadCount?: number
  childCount?: number
}

export interface TagRow {
  id: number
  name: string
  /** filled by list queries only */
  threadCount?: number
}

/** Site-wide settings; the single row (id = 1) holds the site's editable texts. */
export interface SettingsRow {
  siteName: string
  siteDescription: string
  /** full-width announcement on the home page, Markdown; hidden when '' */
  siteNotice: string
  /** footer line, shown on every page; hidden when '' */
  siteFooter: string
  /** minimum credit to start or send a private message; 0 = no limit */
  dmMinCredit: number
  /** ceiling for credit awards; 0 = no limit */
  creditMax: number
  /** automatic +1 credit per this many minutes; 0 = disabled */
  creditRecoverMinutes: number
}

/**
 * Per-user preferences. Site-wide texts live in SettingsRow; these are the
 * switches a single account owns, currently all about notifications.
 */
export interface UserSettings {
  /** someone replied to my thread or to my post */
  notifyReply: boolean
  /** someone @mentioned me */
  notifyMention: boolean
  /** someone liked my post */
  notifyLike: boolean
  /** a private message arrived */
  notifyDm: boolean
}

/** A user this account has blocked (shown in settings). */
export type BlockedUser = Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl'>

/** A preset reason offered in the report dialog; admins manage the list. */
export interface ReportReasonRow {
  id: number
  label: string
  position: number
}

export interface ThreadRow {
  id: number
  categoryId: number
  authorId: number
  title: string
  /** pinned within its own category */
  isPinned: boolean
  /** site-wide announcement: home + every board; at most GLOBAL_PIN_LIMIT at once */
  isGlobalPinned: boolean
  /** shown at the top of every board page (but not the home feed) */
  isAllBoardsPinned: boolean
  isLocked: boolean
  createdAt: string
  lastPostAt: string
  /** incremented by the view beacon; a real column, always present */
  viewCount: number
  /** filled by list queries only */
  author?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl'>
  postCount?: number
  tags?: TagRow[]
}

export interface PostRow {
  id: number
  threadId: number
  authorId: number
  /** null only on a thread's opening post; every reply targets a post */
  parentId: number | null
  body: string
  createdAt: string
  /** filled by list queries only */
  author?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'role' | 'groupId'>
  likeCount?: number
  likedByMe?: boolean
}

/**
 * An unpublished thread, private to its author. Tags are deliberately not kept
 * here — the editor re-offers them when the draft is opened for publishing.
 */
export interface DraftRow {
  id: number
  authorId: number
  /** the intended board, null until the author picks one */
  categoryId: number | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
  /** filled by list queries only */
  categoryName?: string
}

/** Safe-to-send user projection — no passwordHash, no ban internals. */
export type PublicUser = Pick<
  UserRow,
  | 'id'
  | 'username'
  | 'displayName'
  | 'bio'
  | 'avatarUrl'
  | 'role'
  | 'groupId'
  | 'credit'
  | 'createdAt'
>

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  bio: u.bio,
  avatarUrl: u.avatarUrl,
  role: u.role,
  groupId: u.groupId ?? null,
  credit: u.credit,
  createdAt: u.createdAt,
})

/**
 * The session's own user: adds the email and its own ban state, neither of
 * which may leave the account — `PublicUser` (and every author field) omits
 * them. A banned account still signs in so it can browse and appeal by DM.
 */
export type SelfUser = PublicUser &
  Pick<UserRow, 'email' | 'emailVerified' | 'banned' | 'banReason' | 'bannedUntil'>

export const toSelfUser = (u: UserRow): SelfUser => ({
  ...toPublicUser(u),
  email: u.email,
  emailVerified: u.emailVerified,
  banned: u.banned,
  banReason: u.banReason,
  bannedUntil: u.bannedUntil,
})

/** `verify` confirms a bound email; `reset` authorizes a password change. */
export type EmailTokenKind = 'verify' | 'reset'

/** One active mailed code per (user, kind); re-issuing replaces the row. */
export interface EmailTokenRow {
  userId: number
  kind: EmailTokenKind
  codeHash: string
  expiresAt: string
  attempts: number
  createdAt: string
}

/** Admin-only user view: adds moderation fields that must never reach the public API. */
export interface AdminUser extends PublicUser {
  /** omitted from `PublicUser` on purpose; the admin table needs it */
  banned: boolean
  postCount: number
  /** total warnings ever issued to this account */
  warningCount: number
  banReason: string
  bannedUntil: string | null
}

export type ReportTarget = 'thread' | 'post'
export type ReportStatus = 'open' | 'accepted' | 'rejected'

/** A lightweight user projection carried on a report. */
export type ReportUser = Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'credit'>

export interface ReportRow {
  id: number
  reporterId: number
  targetType: ReportTarget
  targetId: number
  reason: string
  status: ReportStatus
  createdAt: string
  handledBy: number | null
  handledAt: string | null
  /** filled by list queries only */
  reporter?: ReportUser
  targetAuthor?: ReportUser
  /** thread title, or a short preview of a reported post */
  targetLabel?: string
  /** the thread the target lives in, for linking */
  targetThreadId?: number | null
}

/** A participant of a private conversation, with just enough to render a name. */
export type DmUser = Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'groupId'>

export interface DmMessageRow {
  id: number
  threadId: number
  authorId: number
  body: string
  createdAt: string
  /** filled by list queries only */
  author?: DmUser
}

/**
 * A private conversation — a titled "话题" between two or more members. Flat:
 * every message is a reply to the topic, not to another message.
 */
export interface DmThreadRow {
  id: number
  title: string
  creatorId: number
  createdAt: string
  lastMessageAt: string
  /** filled by list/detail queries only */
  participants?: DmUser[]
  lastMessage?: Pick<DmMessageRow, 'authorId' | 'body' | 'createdAt'>
  /** messages from others since the viewer last opened it */
  unreadCount?: number
  messageCount?: number
}

/** What produced a notification. A system notice has no actor and no target row. */
export type NotificationType =
  | 'reply'
  | 'mention'
  | 'like'
  | 'dm'
  | 'warning'
  | 'ban'
  | 'system'

/**
 * One inbox entry. The target columns are mutually exclusive in practice
 * (thread/post for public content, dm_thread for a private message) and are
 * nullable so deleting the target cascades the row away instead of leaving a
 * dangling link.
 */
export interface NotificationRow {
  id: number
  /** recipient */
  userId: number
  type: NotificationType
  /** who caused it; null for system notices or a deleted account */
  actorId: number | null
  threadId: number | null
  postId: number | null
  dmThreadId: number | null
  /** pre-rendered, human-readable text — the client never formats it */
  body: string
  /** plain-text preview of the reply/message that caused it; '' for system */
  excerpt: string
  readAt: string | null
  createdAt: string
  /** filled by list queries only */
  actor?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl'>
}
