import type { HistoricalObservableProjectionV2 } from "./observable-read-model-v2";

const encoder = new TextEncoder();
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
  dispose?: () => Promise<void>;
}>): ReadableStream<Uint8Array> {
  const pollMs = Math.max(250, input.pollMs ?? 1_000);
  const heartbeatMs = Math.max(pollMs, input.heartbeatMs ?? 15_000);
  let previous = input.lastEventId;
  let lastWrite = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    if (abortHandler) input.signal.removeEventListener("abort", abortHandler);
    close();
    await input.dispose?.();
  };
  return new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      const tick = async (): Promise<void> => {
        if (stopped || input.signal.aborted) { await stop(); close(); return; }
        try {
          const projection = await input.load();
          if (stopped || input.signal.aborted) {
            close();
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
        } catch (error) {
          if (stopped || input.signal.aborted) return;
          controller.enqueue(encodeHistoricalObservableSseV2("error", previous ?? "0", {
            code: "HISTORICAL_OBSERVABLE_READ_FAILED",
            message: "Historical projection temporarily unavailable; reconnecting automatically.",
          }));
        }
        if (!stopped) timer = setTimeout(() => void tick(), pollMs);
      };
      abortHandler = () => void stop();
      input.signal.addEventListener("abort", abortHandler, { once: true });
      await tick();
    },
    async cancel() { await stop(); },
  });
}
