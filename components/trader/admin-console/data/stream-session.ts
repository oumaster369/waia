import { applyConsoleEvent, type EntityCache } from "@/lib/trader/admin-console/stream/protocol";

export const STREAM_TOPIC_BUFFER_CAP = 500;
export const STREAM_FRAME_LIMIT = 50;
export const STREAM_DISCONNECT_POLL_MS = 5_000;

export type StreamActivity = "paused" | "sse" | "poll";

/** Hidden tabs do not read. A broken stream falls back to a 5 second poll. */
export function streamActivity(input: { hidden: boolean; connected: boolean }): StreamActivity {
  if (input.hidden) return "paused";
  if (input.connected) return "sse";
  return "poll";
}

export type ClientStreamEvent = {
  eventId: string;
  type:
    | "upsert"
    | "entity_removed"
    | "snapshot"
    | "resync_required"
    | "access_revoked"
    | "heartbeat";
  topic: string;
  entityId: string;
  entityVersion: string;
  cursor: string;
  payload: unknown;
  acceptedAt?: string;
};

export type StreamSession = {
  cursor: string | null;
  transport: "sse" | "poll";
  seen: string[];
  queue: ClientStreamEvent[];
  cache: EntityCache;
  resync: boolean;
  accessRevoked: boolean;
};

export function createStreamSession(cursor: string | null = null): StreamSession {
  return {
    cursor,
    transport: "sse",
    seen: [],
    queue: [],
    cache: new Map(),
    resync: false,
    accessRevoked: false,
  };
}

export function streamRequestUrl(
  base: string,
  session: Pick<StreamSession, "cursor" | "transport">,
  topics?: string,
): string {
  const params = new URLSearchParams();
  if (topics) params.set("topics", topics);
  if (session.cursor) params.set("resume", session.cursor);
  if (session.transport === "poll") params.set("transport", "poll");
  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
}

export function failStream(session: StreamSession): StreamSession {
  return { ...session, transport: "poll" };
}

export function enqueueStreamEvent(
  session: StreamSession,
  event: ClientStreamEvent,
): StreamSession {
  if (
    session.seen.includes(event.eventId) ||
    session.queue.some((row) => row.eventId === event.eventId)
  ) {
    return session;
  }
  if (event.type === "access_revoked") {
    return {
      ...session,
      seen: [...session.seen, event.eventId],
      queue: [],
      cache: new Map(),
      accessRevoked: true,
      cursor: event.cursor || session.cursor,
    };
  }
  if (event.type === "resync_required") {
    return { ...createStreamSession(null), seen: [...session.seen, event.eventId], resync: true };
  }
  const queued = session.queue.filter((row) => row.topic === event.topic).length;
  if (queued >= STREAM_TOPIC_BUFFER_CAP) {
    return { ...createStreamSession(null), seen: session.seen, resync: true };
  }
  return {
    ...session,
    seen: [...session.seen, event.eventId],
    queue: [...session.queue, event],
    cursor: event.cursor || session.cursor,
  };
}

export function drainStreamFrame(
  session: StreamSession,
  limit = STREAM_FRAME_LIMIT,
): StreamSession {
  const batch = session.queue.slice(0, limit);
  const cache = new Map(session.cache);
  for (const event of batch) applyConsoleEvent(cache, event);
  return { ...session, queue: session.queue.slice(batch.length), cache };
}

export function applyStreamBurst(
  session: StreamSession,
  events: ClientStreamEvent[],
): StreamSession {
  let next = session;
  for (let index = 0; index < events.length; index += STREAM_FRAME_LIMIT) {
    for (const event of events.slice(index, index + STREAM_FRAME_LIMIT)) {
      next = enqueueStreamEvent(next, event);
      if (next.resync || next.accessRevoked) return next;
    }
    next = drainStreamFrame(next);
  }
  return next;
}
