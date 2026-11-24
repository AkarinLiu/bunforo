/**
 * In-process live event hub behind GET /api/events (Server-Sent Events).
 *
 * Bun runs the whole app in one process, so a Map of open streams is enough and
 * needs no broker dependency. It is deliberately not a cross-process bus: to
 * run several instances, replace the delivery functions with Redis pub/sub —
 * every route only calls these four helpers.
 *
 * Event payloads are plain JSON; the client never re-fetches to render one.
 */
export type EventName = 'notification' | 'dm:message' | 'thread:post' | 'thread:created'

type Subscriber = (event: EventName, data: unknown) => void

/** userId → its open tabs. A user may legitimately have several. */
const subscribers = new Map<number, Set<Subscriber>>()

/** Registers a listener for one user and returns its unsubscribe function. */
export function subscribe(userId: number, fn: Subscriber): () => void {
  const existing = subscribers.get(userId)
  const set = existing ?? new Set<Subscriber>()
  if (!existing) subscribers.set(userId, set)
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size) subscribers.delete(userId)
  }
}

/** Sends to every open tab of one user. A dead stream must not break the sender. */
export function publishToUser(userId: number, event: EventName, data: unknown): void {
  const set = subscribers.get(userId)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(event, data)
    } catch {
      // The SSE writer marks its own stream closed; nothing else to do here.
    }
  }
}

export function publishToUsers(userIds: number[], event: EventName, data: unknown): void {
  for (const id of new Set(userIds)) publishToUser(id, event, data)
}

/** Public content (a new thread or reply) reaches every open stream. */
export function publishToAll(event: EventName, data: unknown): void {
  for (const id of [...subscribers.keys()]) publishToUser(id, event, data)
}

/** Diagnostic: how many users currently have at least one stream open. */
export function streamCount(): number {
  return subscribers.size
}
