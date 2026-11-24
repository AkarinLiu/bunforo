# BunForo — Agent Notes

A forum framework: Bun + Hono backend, Vue 3 + Vite frontend, Reka UI components,
and one codebase that runs on SQLite, PostgreSQL or MySQL.

## Commands

- Install: `bun install`
- Dev (API + Vite together): `bun run dev` → UI on :5173, API on :3000, `/api` proxied
- API only: `bun run start` → :3000, serves `public/` too if it has been built
- Build frontend: `bun run build` → `public/` (index.html + assets/)
- Migrate uploads to S3: `bun run migrate:s3`
- Import GitHub Discussions: `bun run import:github` (needs `GITHUB_TOKEN` + `GITHUB_REPO`)
- Typecheck: `bun run typecheck` (`tsc --noEmit`)
- Tests: `bun test`

## Stack

- Runtime: Bun 1.4.2+ (`bun:sqlite`, `Bun.password`, `Bun.serve`)
- Backend: Hono 4 — routes in `src/server/routes.ts`, session in `src/server/auth.ts`
- DB: Drizzle ORM 0.45 — drivers `drizzle-orm/bun-sqlite`, `node-postgres`, `mysql2`
- Frontend: Vue 3.5 `<script setup>`, vue-router 5, Vite 8
- UI: Reka UI 2 (headless — all styling is in `src/web/style.css`)
- Markdown: markdown-it 15, configured safe-by-construction (see below)
- Storage: local disk or any S3-compatible bucket, via Bun's native
  `Bun.S3Client` (no AWS SDK, no aws4fetch)

## Layout

```
index.ts                 server entry: ensureSchema() then Bun.serve
src/shared/types.ts      row contract, imported by BOTH db and web (dependency-free)
src/db/ddl.ts            hand-written bootstrap DDL, one list per dialect
src/db/schema/{sqlite,pg,mysql}.ts   Drizzle table defs, one file per dialect
src/db/index.ts          picks a driver from DATABASE_URL, exports db/tables
src/db/legacy.ts         one-off buntalk.db → bunforo.db rename on boot
src/db/repo.ts           every query, written once for all three engines
src/import/github/       Discussions import: mapper, GraphQL client, media, writer
src/import/github/media.ts  download GitHub-hosted images/video and rewrite bodies
src/server/github.ts     GitHub OAuth login and placeholder-account claim
src/server/legacy-uploads.ts  ./uploads → ./public/assets/uploads upgrade move
src/server/app.ts        Hono app: /api first, /uploads, static SPA last
src/server/routes.ts     the whole API surface
src/server/storage.ts    local/S3 object storage, one `put`/`publicUrl` pair
src/server/mailer.ts     SMTP sending; no client is built unless SMTP_HOST is set
src/server/filetype.ts   magic-byte sniffing — the upload security boundary
src/web/                 Vue app; `pages/` are routes, `components/` are pieces
src/web/markdown.ts      the markdown renderer — a security boundary, see below
scripts/migrate-to-s3.ts one-shot local → bucket copy
scripts/import-github.ts GitHub Discussions import CLI
test/                    bun:test checks: db, post tree, markdown, uploads, s3
bunfig.toml              test preload; keeps tests off the real db/upload dir
```

## Non-obvious rules

**Drizzle has no cross-dialect table builder.** `sqliteTable`, `pgTable` and
`mysqlTable` are mutually incompatible, so there are three schema files and
`db`/`tables` are deliberately typed `any` (see the header of `src/db/index.ts`).
Type safety comes from `src/shared/types.ts` instead. When you add a column, you
must touch **all four** places: `shared/types.ts`, the three `schema/*.ts`, and
`ddl.ts`.

**The schema is bootstrapped, not migrated.** `ensureSchema()` runs the
idempotent DDL in `ddl.ts` on every boot — there is no `db:push` step to forget.
Table statements are strict (a failure aborts startup); index statements are
tolerant because MySQL has no `CREATE INDEX IF NOT EXISTS`.

**MySQL needs care that the other two don't.**
- A `TEXT` column cannot be `UNIQUE`/`INDEX`ed without a key length → short
  indexed strings are `VARCHAR(191)`.
- A `TEXT` column cannot have a `DEFAULT` → the app passes every value on insert.
- There is no `INSERT ... RETURNING` → `insertReturningId()` in `repo.ts` uses
  `$returningId()` for MySQL and `.returning()` elsewhere.

**PostgreSQL returns `count()` as a string bigint.** Always go through
`groupCounts`/`countWhere` in `repo.ts`, which `Number()`s the result.

**Hono's signed-cookie helpers take arguments in different orders:**
`getSignedCookie(c, secret, name)` but `setSignedCookie(c, name, value, secret, opts)`.

**Drizzle selects every column, so a cast can hide a leak.** `findUserById` and
`findUserByUsername` return rows that genuinely contain `password_hash` at
runtime; the `UserAuthRow` type is honest about that. The session middleware
stores a `PublicUser` projection in `c.var.user` so no route can serialize a
hash. If you add a user query, strip it with `toPublicUser` before responding.

**`src/web/markdown.ts` is a security boundary, not a formatting helper.** Post
bodies are stored as raw Markdown and reach the DOM through `v-html`, so the
renderer must be structurally unable to emit attacker HTML. It is safe because
`html: false` escapes raw HTML (every emitted tag is one markdown-it generated)
and markdown-it's default `validateLink` drops `javascript:` / `vbscript:` /
non-image `data:` URLs. **Do not enable `html: true` or override `validateLink`**
without adding a sanitizer. `test/markdown.test.ts` asserts structural
properties (no executable tag) rather than output substrings — an escaped
payload legitimately appears in the output as text, so substring checks there
are meaningless and will lie to you.

**A `<script setup>` component exposes nothing by default.** `MarkdownEditor`
calls `defineExpose({ focus })` so parents can focus it; a template `ref` on such
a component is an empty object without that call.

**Uploads keep one public URL across backends — that invariant is load-bearing.**
An object is always `/uploads/<key>`, never a bucket URL, and Hono always answers
that path (`app.ts`): local streams the bytes, S3 issues a 302. This is the only
reason `migrate:s3` can be a plain file copy — post bodies and `avatarUrl`
already contain `/uploads/<key>` and are never rewritten. **Never store a
bucket-absolute URL in the database**: it would silently break every existing
image on migration. `S3_PUBLIC_URL` is a serving detail, not a stored value.

**`src/server/filetype.ts` is the upload security boundary.** The request's
`Content-Type` and filename are attacker-controlled; a file that *is* HTML but is
labelled `image/png`, served back under the client's claimed type, is stored XSS
on this origin. So the extension and the served Content-Type are both derived
from the bytes. When adding a format, add its magic signature here and nothing
else — and note SVG is deliberately excluded because it can carry script.

**Branch on `driver`, never on `configured`.** `STORAGE_DRIVER=local` has to be a
hard override even when credentials are present in the environment, so the S3
client is only constructed for the s3 driver. Branching on "are credentials set"
makes the override a lie.

**`serveStatic` joins `root` and `path` — never pass an absolute file
path.** The SPA fallback serves `index.html` as `{ root: publicDir, path:
'index.html' }`. Passing `{ path: publicIndex }` joins `./` with an absolute
path, which silently becomes a relative one: every deep link (`/t/1`, `/feeds`)
404s while `/` still works, because `/` is served by the earlier static
middleware.

**The build output and runtime uploads share `public/`.** `vite build` writes
`public/index.html` + `public/assets/index-*`, and uploads default to
`public/assets/uploads` — Hono serves the whole tree as the web root. That is
why `build.emptyOutDir` is `false` (Vite would delete the uploads) and why
`scripts/clean-public.ts` clears the previous bundles before each build, leaving
`assets/uploads` alone. `publicDir: false` keeps Vite from copying the tree into
itself.

**`/uploads/*` is not under `/api`.** Anything that routes `/api` must route
`/uploads` too — that is why `vite.config.ts` has a second proxy entry, and why
the SPA fallback had to learn to keep its hands off both.

**Uploads moved, but their public URL did not.** Files default to
`./public/assets/uploads`; when the effective path is that default (including an
explicit `UPLOAD_DIR=./public/assets/uploads` copied from the example),
`migrateLegacyUploadDir()` adopts a leftover `./uploads` on boot — renaming it
when the target is absent, merging missing keys when it already exists, so old
`/uploads/<key>` URLs do not 404. A failed move/merge aborts startup. Stored
bodies and avatars still hold `/uploads/<key>`, served by Hono from `uploadDir`;
never write the filesystem path or an S3 URL into the database. `vite.config.ts`
sets `publicDir: false` so a build cannot copy runtime uploads into the build
output (which is `public/` itself).

**Video is in the upload allowlist now; SVG still is not.** `filetype.ts` accepts
MP4/MOV brands inside ISO-BMFF and WebM (EBML DocType `webm`, not Matroska).
`MAX_UPLOAD_MB` caps images/PDF, `MAX_VIDEO_MB` caps video, and the Bun body cap
in `index.ts` must stay at the larger of the two.

**Imported media is downloaded, never hot-linked.** `src/import/github/media.ts`
only fetches GitHub-owned hosts (discussion bodies are attacker-controlled, so
arbitrary URLs would be SSRF), judges the bytes with `sniff()`, stores them via
`storage.put`, and rewrites the body to `/uploads/<key>`. The token is attached
only to `github.com`; signed `*.githubusercontent.com` URLs must not receive it.
HTML `<img>` becomes Markdown (the renderer escapes raw HTML) and `<video>`
becomes a link (there is no player). A download failure leaves the original URL
and does not fail the thread.

**S3 is Bun's native client.** `storage.ts` builds a `Bun.S3Client` only for the
s3 driver and uses `write`/`exists`/`presign`/`list`. `virtualHostedStyle` is
`!endpoint`: AWS gets the bucket-host form, MinIO/R2 keep path-style. Presigning
is local, so `publicUrl` still mints a fresh 302 target per request. The bucket
layout is root-level `<uuid>.<ext>`; `migrate:s3` lists keys first and skips
objects already there.

**The default SQLite filename is a compatibility surface.** `src/db/index.ts`
opens `./bunforo.db`; when `DATABASE_URL` is unset, `migrateLegacySqliteFile()`
renames a leftover `./buntalk.db` (and `-wal`/`-shm`) before the connection is
opened. A failed rename must abort startup — falling back to an empty database is
exactly the silent data loss this exists to prevent. An explicit `DATABASE_URL`
never triggers it. The session cookie is still `buntalk_session`: renaming it
would log every existing user out, so it is a deliberate legacy literal.

**Imported rows carry a namespaced external id, and that is the idempotency key.**
`threads.external_id` is `github:<discussion node id>`; `posts.external_id` is
`github:<comment node id>`. The opening post has **no** external id (GitHub has
no node id for it) — find it with `findOpeningPostId`. `createThread`/`createPost`
always stamp "now"; imports must use `createImportedThread`/`createImportedPost`
so source timestamps survive. There is still no transaction API: a failed import
leaves a partial thread and the next run repairs it, which is why the writer
skips existing external ids instead of trusting a clean run.

**A GitHub placeholder account has `password_hash = ''` on purpose.** `/auth/login`
routes an empty hash through its dummy verify, so no password can ever match; the
owner signs in through OAuth. `github_login` (lowercased, nullable, unique) is the
identity key — never the username, which is a generated `gh_*` slug. `github_id`
is nullable because bots expose no `databaseId`. The OAuth claim refuses a
different numeric id for the same login (recycled-login takeover).

**The OAuth state cookie lives in `auth.ts`.** `SECRET` is module-private there,
so `setOauthStateCookie`/`takeOauthStateCookie` must stay in that file; the route
in `routes.ts` only encodes `{state, next}`. `next` is same-site-only (no `//`,
no `/api`). The import CLI refuses to run when `countUsers() === 0`: creating
placeholder users before `/setup` would make the site permanently admin-less.

**Live updates are SSE on one process-local hub, with a 5s heartbeat.**
`GET /api/events` (`src/server/events.ts` + `routes.ts`) streams `notification`,
`dm:message`, `thread:post` and `thread:created`. Public `thread:*` events go to
every open stream; the other two are addressed to one user. Bun closes a
connection idle for 10s, so the route pings every 5s — a 20s heartbeat silently
dropped every quiet tab. The hub is a `Map` in memory: running more than one
instance would need Redis pub/sub, and the `publish*` helpers are the only place
that changes. EventSource reconnects by itself and does not replay missed events,
so every page still loads its data once on mount.

**Colours are tokens only, and light mode is a media query.**
`src/web/style.css` defines the dark palette on `:root` and re-points the same
variables inside `@media (prefers-color-scheme: light)` — there is no JS toggle
and no `data-theme` attribute. Never hard-code a hex in a rule: it will be
wrong in one of the two themes. Accent tints use
`rgb(var(--accent-rgb) / N%)`, and danger/ok chrome uses the
`--danger-*`/`--ok-*` tokens. `color-scheme` follows the media query so native
controls and scrollbars match.

**Feeds live at the site root, not under `/api`.** `src/server/feed.ts`
serves `/feed.xml` and `/c/:id/feed.xml`, mounted in `app.ts` before the SPA
fallback. A parent board's feed uses `listThreadsInCategoryTree` so it carries
its direct sub-boards' threads; the `/c/:id` page itself stays direct-only.
`/feeds` is the in-app directory of every feed (sidebar → RSS 订阅).
They also need their own `vite.config.ts` proxy entries: without them Vite answers
`/feed.xml` with `index.html` and the router redirects the click to `/`, so the
feed looks broken only in dev. The board rule is a regex so `/c/:id` itself
stays an SPA route. Every user-supplied string goes through `escapeXml()` in
`src/server/rss.ts` (title, author, board name, URLs); the body is flattened
with `plainText()`, never rendered HTML. Absolute links use `PUBLIC_BASE_URL`
when set (the same reverse-proxy rule as the OAuth callback) and otherwise the
request origin, including `X-Forwarded-*`. Responses are cached for 5 minutes.

**Notifications are rows with pre-rendered text.** `notifications` stores the
recipient, the actor, the target (`thread_id` / `post_id` / `dm_thread_id`), a
Chinese headline in `body` and a flattened one-line `excerpt` of the reply or
message — the client prints both verbatim and never formats a notification in
Vue. `excerptOf()` strips Markdown (images become a placeholder) because the
preview is plain text, not `v-html`.
Reply, @mention, like and DM write them in `routes.ts`; a mention is skipped when
that user already gets a reply notice for the same post. A DM keeps at most one
unread bell row per conversation (`hasUnreadDmNotification`), and opening the
conversation marks it read. The target columns are nullable because deleting a
thread, post or DM cascades its notifications away.

**The 管理员 group is seeded, and membership is the admin role.** `ensureAdminGroup()`
creates a `user_groups` row with `builtin = true` (or adopts an existing group of
that name). There is no separate "make admin" action: assigning the group in
`PATCH /admin/users/:id` also sets `role = 'admin'`, and assigning any other
group (or none) sets `role = 'user'`. An admin cannot drop their own membership
(self-lockout guard). `syncAdminGroup()` runs on boot to enforce the same
invariant for rows that predate it: admins are moved into the group (even out of
a custom badge — one group per user), then group members are made admin. Its
name and deletion are refused in `/admin/groups`; colour and position stay
editable.

**Credit recovers on a timer, driven by a process-local clock.**
`settings.credit_recover_minutes` (admin → 站点, 0 = off) makes
`src/server/credit.ts` award +1 per interval to every real account below the
ceiling. The scheduler in `index.ts` checks once a minute and reads the interval
each time, so a change applies live; the first tick after boot only starts the
clock, and a restart resets it (no per-user timestamp column — acceptable for a
reputation score). `creditRecoveryTick` advances by whole intervals so the
cadence does not drift, and `recoverCredit` clamps at `credit_max`. The cron
never runs inside tests; the tick takes an injectable `now`.

**Credit has a configurable ceiling.** `settings.credit_max` (admin → 站点,
0 = unlimited, default 1000) is applied inside `applyCredit`: only increases are
clamped, and a score already above a newly lowered cap is grandfathered —
deductions still work. `startingCredit()` also clamps a new account's initial
score, so a cap below `CREDIT_START` is honoured for registrations and GitHub
placeholders. `applyCredit` is the only reward path; a manual `creditDelta` in
the admin API and accepted-report penalties both go through it.

**Private messages can require a minimum credit score.** `settings.dm_min_credit`
(admin → 站点, 0 = off) is served publicly through `/api/meta` so the client can
hide the composer. The gate lives in both DM write routes
(`POST /dm/threads` and `POST /dm/threads/:id/messages`); reading is never
blocked. Admins are exempt, and so are banned accounts — their only remaining
channel is the appeal DM to staff, and a report penalty must not cut it off.
The threshold is read from `getSettings()` per request, so a change applies
immediately without a restart.

**Blacklists are directional and gate mentions + DMs only.** `user_blocks`
stores `(blocker_id, blocked_id)`; `isBlocked(blocker, sender)` means the sender
may not reach the blocker. `notifyMentions` silently skips a blocked mention
(the post still publishes), and both DM write routes refuse when any other
participant has blocked the sender. The blocker may still DM the blocked user —
the relation is one-way, not a mutual ban. Scope is deliberately narrow: replies
and likes still notify, and public content stays readable.

**Admin warnings and bans are notices, not just flags.** `POST /admin/users/:id/warn`
records a row in `user_warnings` (surfaced as `warningCount` on `AdminUser`) and
writes a `warning` notification. Every switch into the banned state — the admin
toggle, the report-resolution ban checkbox and a credit drop below the
auto-ban threshold — calls `notifyBan` exactly once (`target.banned` is the
"was already banned" check); un-banning and re-saving a ban stay silent.
`warning`/`ban` sit in `NOTIFICATION_PREF` with `null`, so preference mutes can
never hide policy messages. Warning self/system targets is refused.

**A banned account is read-only except for DMs to administrators.** `session`
keeps it signed in and `toSelfUser` carries its own `banned`/`banReason`/
`bannedUntil` (never in `PublicUser`). `POST /threads`, `POST /threads/:id/posts`
return `BANNED_WRITE`; creating or replying in a DM requires every other
participant to be an admin (`BANNED_DM`). `adminOnly` and `canManage` also
ignore the admin half of a banned admin, so a ban cannot be moderated around.
The client hides the composer/new-thread entries and shows a banner from
`auth.user`; the server checks are the real gate.

**Ban details are exposed only by `GET /users/:username`.** That response carries
an extra `ban: { reason, until } | null` (null for a permanent ban's `until`); it
is computed from `banned`/`ban_reason`/`banned_until` and `toPublicUser` still
omits them, so posts, notifications and author fields never leak a ban. The
endpoint also calls `clearExpiredBan` on the target, because a public read may be
the first request after a temporary ban expired. `PublicUser` must stay free of
these columns; widen the profile response instead.

**User settings are a separate table with lazy defaults.** `user_settings` has
one row per account and only appears after the first save; `getUserSettings`
returns `DEFAULT_USER_SETTINGS` otherwise, so every account starts with all four
notification switches on. `notifyUser` consults `NOTIFICATION_PREF` and skips the
row entirely when a category is muted — the suppression happens before the
insert, so nothing reaches the recipient's open stream either. Password change
verifies the current hash, calls `resetUserPassword` (which bumps the session
version) and then re-issues this tab's cookie; without that the person who just
proved the old password would log themselves out.

**Orphaned uploads are swept hourly after a 24h grace period.**
`src/server/cleanup.ts` lists storage (`listObjects`, both drivers), keeps only
`<uuid>.<ext>` keys, and deletes those older than `UPLOAD_GRACE_MS` whose key
appears in no content column. `referencedUploadKeys` covers posts, drafts (an
unpublished draft must keep its images), DM messages, avatars and the two
site-text fields — widen it when a new column can embed `/uploads/<key>`. A file
whose backend reports no mtime is never deleted. The sweep is scheduled from
`index.ts`; it assumes one process, and deletes are idempotent.

**Tests must stay off the real database and upload directory.** `bunfig.toml`
preloads `test/setup.ts`, which pins `DATABASE_URL=:memory:`,
`STORAGE_DRIVER=local` and a temp `UPLOAD_DIR` *before* any module reads its
config. Do not rely on setting env vars inside a test file — that was
order-dependent and once created a real `buntalk.db` in the repo.

**The s3 storage branch is tested out-of-process** (`test/s3.test.ts` spawning
`test/s3-probe.ts`), because `storage.ts` reads its configuration at import time
and the preload pins the test process to local. The probe blanks every `S3_*`
variable first so a developer's real `.env` cannot leak in and make the
assertions pass for the wrong reason.

**Templates are compiled as plain JS.** No TypeScript syntax survives in a Vue
template — no `!` assertions, no `(v: boolean) =>` on inline handlers. Inline
handlers with arguments do **not** receive `$event` implicitly; write
`@update:model-value="fn(thread, 'isPinned', $event)"`.

**A `ref` is unwrapped in a template, so passing it to a helper passes its
value.** `@click="addRow(categories)"` compiles to `addRow(categories.value)`,
so the helper must take the array (`list: string[]`), not the ref. Typing it as
`typeof categories` and calling `list.value.push()` typechecks and builds (no
`vue-tsc`) but throws at runtime — this is how the setup wizard's add-row buttons
broke.

**`tsc --noEmit` does not check `.vue` files** (they are shimmed in
`src/web/env.d.ts`) and Vite does not typecheck. `bun run build` is the real
frontend check: it catches unresolved imports, missing exports and broken
templates, but not wrong prop names. There is no `vue-tsc` — add one if template
type errors start costing more than the dependency.

## Conventions

- `"type": "module"` + `verbatimModuleSyntax: true` — use `import type` for types
- Timestamps are ISO-8601 UTC **strings** everywhere, never DB timestamp types:
  identical across engines, and they sort correctly as text
- Errors are `{ error: string }` with a Chinese user-facing message; the client
  turns them into `ApiError`
- `src/shared/types.ts` must stay dependency-free — the browser imports it
- The first registered account becomes admin (self-hosted convention)

## Gotchas

- No `.env` loading code — Bun loads `.env` itself
- `SESSION_SECRET` is required when `NODE_ENV=production`; the server refuses to
  start without it rather than silently using the dev fallback
- `bun.lock` is committed — run `bun install` after dependency changes
- Deleting a thread's opening post is rejected (`OPENING_POST`); delete the
  thread instead. Post/reply cascades are enforced by the DDL, not by app code.
- An uploaded file's public URL is a site-relative `/uploads/<key>`, so never put
  one in an `<input type="url">` — the browser rejects a relative path and blocks
  the whole form submit (this is what broke avatar editing). Use `type="text"`.
