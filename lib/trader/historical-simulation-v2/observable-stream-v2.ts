import type { HistoricalObservableProjectionV2 } from "./observable-read-model-v2";

const encoder = new TextEncoder();
// Reconnection and polling pass the route's session and permission gates again.
export const HISTORICAL_OBSERVABLE_MAX_STREAM_MS = 30_000;
export const HISTORICAL_OBSERVABLE_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-store, no-transform",
  Connection: "keep-alive", "X-Accel-Buffering": "no",
} as const;

export function encodeHistoricalObservableSseV2(
  event: "historical.snapshot" | "heartbeat" | "error",
  id: string,
  payload: unknown,
): Uint8Array {
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function createHistoricalObservablePollingStreamV2(input: Readonly<{
  signal: AbortSignal;
  lastEventId: string | null;
  load: () => Promise<HistoricalObservableProjectionV2>;
  pollMs?: number;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
  dispose?: () => Promise<void>;
}>): ReadableStream<Uint8Array> {
  const pollMs = Math.max(250, input.pollMs ?? 1_000);
  const heartbeatMs = Math.max(pollMs, input.heartbeatMs ?? 15_000);
  const requestedLifetime = input.maxLifetimeMs ?? HISTORICAL_OBSERVABLE_MAX_STREAM_MS;
  if (!Number.isFinite(requestedLifetime) || requestedLifetime <= 0) {
    throw new Error("Historical stream lifetime must be finite and positive.");
  }
  const deadline = Date.now() + Math.min(requestedLifetime, HISTORICAL_OBSERVABLE_MAX_STREAM_MS);
  let previous = input.lastEventId;
  let lastWrite = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    try { controllerRef?.close(); } catch { /* consumer already cancelled */ }
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (abortHandler) input.signal.removeEventListener("abort", abortHandler);
    close();
    await input.dispose?.();
  };
  return new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      // Independent of DB completion: a stalled read must not extend authority.
      expiryTimer = setTimeout(() => void stop().catch(() => {}), Math.max(0, deadline - Date.now()));
      const tick = async (): Promise<void> => {
        if (stopped || input.signal.aborted || Date.now() >= deadline) { await stop(); close(); return; }
        try {
          const projection = await input.load();
          if (stopped || input.signal.aborted || Date.now() >= deadline) {
            await stop();
            return;
          }
          const now = Date.now();
          if (projection.eventId !== previous) {
            controller.enqueue(encodeHistoricalObservableSseV2("historical.snapshot", projection.eventId, projection));
            previous = projection.eventId; lastWrite = now;
          } else if (now - lastWrite >= heartbeatMs) {
            controller.enqueue(encodeHistoricalObservableSseV2("heartbeat", projection.eventId, { observedAt: projection.observedAt }));
            lastWrite = now;
          }
        } catch {
          if (stopped || input.signal.aborted || Date.now() >= deadline) { await stop(); return; }
          controller.enqueue(encodeHistoricalObservableSseV2("error", previous ?? "0", {
            code: "HISTORICAL_OBSERVABLE_READ_FAILED",
            message: "Historical projection temporarily unavailable; reconnecting automatically.",
          }));
        }
        if (!stopped) timer = setTimeout(() => void tick().catch(() => {}), pollMs);
      };
      abortHandler = () => void stop().catch(() => {});
      input.signal.addEventListener("abort", abortHandler, { once: true });
      await tick();
    },
    async cancel() { await stop(); },
  });
}
