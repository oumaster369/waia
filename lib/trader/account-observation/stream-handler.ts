import "server-only";
import {
  OBSERVATION_STREAM_INTERVAL_MS,
  OBSERVATION_STREAM_MAX_BYTES,
  OBSERVATION_STREAM_MAX_CYCLES,
  OBSERVATION_STREAM_MAX_FRAME_BYTES,
  OBSERVATION_STREAM_MAX_MS,
  type ObservationStreamEvent,
} from "./stream-protocol";

const headers = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-store, no-transform",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Accel-Buffering": "no",
};

/** Each invocation must perform the complete authenticated, fenced stored read
 * and dispose its own database resources. No authority is retained between reads. */
export async function handleAccountObservationStream(
  request: Request,
  read: (request: Request) => Promise<Response>,
): Promise<Response> {
  const abort = new AbortController();
  let stopped = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let resolveAbort!: () => void;
  const aborted = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(expiry);
    clearTimeout(delay);
    wake?.();
    resolveAbort();
    abort.abort();
    request.signal.removeEventListener("abort", stop);
    try {
      controller?.close();
    } catch {
      /* consumer already cancelled */
    }
  };
  request.signal.addEventListener("abort", stop, { once: true });
  const expiry = setTimeout(stop, OBSERVATION_STREAM_MAX_MS);
  if (request.signal.aborted) stop();
  const unavailable = () =>
    Response.json(
      { error: "ACCOUNT_OBSERVATION_UNAVAILABLE" },
      {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
  const load = async () => {
    if (stopped) return unavailable();
    return Promise.race([
      read(new Request(request, { signal: abort.signal })).then(async (response) => {
        if (stopped) {
          await response.body?.cancel();
          return unavailable();
        }
        return response;
      }),
      aborted.then(unavailable),
    ]);
  };
  let first: Response;
  try {
    first = await load();
  } catch {
    stop();
    return unavailable();
  }
  if (stopped) return unavailable();
  if (first.status !== 200 && first.status !== 204) {
    stop();
    return first;
  }
  // Preflight decides the HTTP status, but never queues an authorized snapshot.
  // A slow consumer must get a fresh fenced read when it actually pulls bytes.
  try {
    await first.body?.cancel();
  } catch {
    stop();
    return unavailable();
  }
  if (stopped) return unavailable();
  let cycles = 1;
  let initialPull = true;
  let totalBytes = 0;
  let lastRead = Date.now();
  const encoder = new TextEncoder();
  const frame = async (response: Response): Promise<Uint8Array> => {
    let event: ObservationStreamEvent;
    let data = "null";
    if (response.status === 200) {
      event = "observation";
      if (!response.body) throw new Error("MISSING_BODY");
      const reader = response.body.getReader();
      const cancel = () => {
        void reader.cancel().catch(() => undefined);
      };
      abort.signal.addEventListener("abort", cancel, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > OBSERVATION_STREAM_MAX_FRAME_BYTES - 64) throw new Error("BODY_LIMIT");
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        // Compact JSON prevents embedded line breaks changing SSE framing.
        data = JSON.stringify(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      } finally {
        abort.signal.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } else {
      event =
        response.status === 204
          ? "missing"
          : response.status === 401 || response.status === 403
            ? "revoked"
            : "error";
      await response.body?.cancel();
    }
    const bytes = encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
    if (bytes.byteLength > OBSERVATION_STREAM_MAX_FRAME_BYTES) throw new Error("FRAME_LIMIT");
    return bytes;
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      async pull(value) {
        if (stopped) return;
        try {
          if (!initialPull) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              delay = setTimeout(
                resolve,
                Math.max(0, lastRead + OBSERVATION_STREAM_INTERVAL_MS - Date.now()),
              );
            });
            wake = undefined;
            if (stopped) return;
          }
          initialPull = false;
          const response = await load();
          lastRead = Date.now();
          if (stopped) {
            await response.body?.cancel();
            return;
          }
          const bytes = await frame(response);
          if (stopped) return;
          totalBytes += bytes.byteLength;
          if (totalBytes > OBSERVATION_STREAM_MAX_BYTES) throw new Error("STREAM_LIMIT");
          value.enqueue(bytes);
          cycles++;
          if (
            cycles >= OBSERVATION_STREAM_MAX_CYCLES ||
            (response.status !== 200 && response.status !== 204)
          )
            stop();
        } catch {
          if (!stopped) value.enqueue(encoder.encode("event: error\ndata: null\n\n"));
          stop();
        }
      },
      cancel() {
        stop();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { headers });
}
