/**
 * Browser half of the live channel (GET /api/events, Server-Sent Events).
 *
 * One EventSource per signed-in session. Native reconnection is enough: the
 * server heartbeats every 5s, so an idle tab is not dropped and a broken
 * connection re-establishes itself without any retry logic here.
 */
export type LiveEvent = 'notification' | 'dm:message' | 'thread:post' | 'thread:created'

type Handler = (data: unknown) => void

const handlers = new Map<LiveEvent, Set<Handler>>()

let source: EventSource | null = null
let connectedFor: number | null = null

export function onLiveEvent(event: LiveEvent, fn: Handler): () => void {
  const existing = handlers.get(event)
  const set = existing ?? new Set<Handler>()
  if (!existing) handlers.set(event, set)
  set.add(fn)
  return () => {
    set.delete(fn)
  }
}

function emit(event: LiveEvent, raw: string): void {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  const set = handlers.get(event)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(data)
    } catch (err) {
      // One broken view must not stop the others from updating.
      console.error('[bunforo] live handler failed', err)
    }
  }
}

export function connectLive(userId: number): void {
  if (source && connectedFor === userId) return
  disconnectLive()
  connectedFor = userId
  // bun-types declares the global constructor without its URL argument (the
  // server-side shape), while the browser one requires it.
  const open = EventSource as unknown as new (url: string) => EventSource
  const es = new open('/api/events')
  source = es
  for (const name of ['notification', 'dm:message', 'thread:post', 'thread:created'] as LiveEvent[]) {
    es.addEventListener(name, (ev) => emit(name, (ev as MessageEvent).data))
  }
}

export function disconnectLive(): void {
  source?.close()
  source = null
  connectedFor = null
}
