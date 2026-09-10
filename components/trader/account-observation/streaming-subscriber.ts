import {
  observationBindingSchema,
  parseAccountObservation,
  sameObservationBinding,
} from "@/lib/trader/account-observation/validation";
import {
  OBSERVATION_STREAM_MAX_BYTES,
  OBSERVATION_STREAM_MAX_CYCLES,
  OBSERVATION_STREAM_MAX_FRAME_BYTES,
  OBSERVATION_STREAM_MAX_MS,
} from "@/lib/trader/account-observation/stream-protocol";
import { readBoundedObservationJson } from "./polling-subscriber";
import type { ObservationSubscriber } from "./use-account-observation";

/** Fetch SSE keeps HTTP denials visible and uses same-origin cookies. All retries
 * are serialized; three JSON polls provide fallback before another stream attempt. */
export function createStreamingObservationSubscriber({
  endpointPath,
  fetcher,
}: {
  endpointPath: string;
  fetcher: typeof fetch;
}): ObservationSubscriber {
  if (!/^\/api\/[a-zA-Z0-9/_-]+$/.test(endpointPath)) throw new Error("INVALID_ENDPOINT");
  return (binding, emit, signal) => {
    const exact = observationBindingSchema.parse(binding);
    const query = new URLSearchParams(exact);
    let stopped = false;
    let fallbackPolls = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      request?.abort();
      signal.removeEventListener("abort", stop);
    };
    const revoked = () => {
      emit({ type: "revoked" });
      stop();
    };
    const run = async () => {
      if (stopped) return;
      const streaming = fallbackPolls === 0;
      const controller = new AbortController();
      request = controller;
      let received = false;
      let response: Response | undefined;
      emit({ type: "transport", transport: streaming ? "RECONNECTING" : "POLLING" });
      deadline = setTimeout(
        () => {
          if (!stopped) {
            if (streaming) fallbackPolls = 3;
            failures = Math.min(failures + 1, 4);
            controller.abort();
            emit({ type: "error" });
          }
        },
        streaming ? OBSERVATION_STREAM_MAX_MS + 5_000 : 10_000,
      );
      const active = () => !stopped && !controller.signal.aborted;
      const observe = (input: unknown) => {
        const observation = parseAccountObservation(input);
        if (!sameObservationBinding(observation.binding, exact))
          throw new Error("BINDING_MISMATCH");
        if (!active()) return;
        emit({ type: "transport", transport: streaming ? "STREAMING" : "POLLING" });
        emit({ type: "observation", observation });
        received = true;
      };
      try {
        response = await fetcher(`${endpointPath}${streaming ? "/stream" : ""}?${query}`, {
          method: "GET",
          credentials: "same-origin",
          mode: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: streaming ? "text/event-stream" : "application/json" },
          signal: controller.signal,
        });
        if (!active()) return;
        if (response.status === 401 || response.status === 403) {
          revoked();
          return;
        }
        if (!streaming) {
          if (response.status === 204) {
            received = true;
            emit({ type: "connected" });
          } else {
            if (response.status !== 200) throw new Error("READ_FAILED");
            observe(await readBoundedObservationJson(response, controller.signal));
          }
          fallbackPolls--;
        } else {
          if (
            response.status !== 200 ||
            !response.body ||
            !/^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") ?? "")
          )
            throw new Error("STREAM_FAILED");
          const reader = response.body.getReader();
          const cancel = () => {
            void reader.cancel().catch(() => undefined);
          };
          controller.signal.addEventListener("abort", cancel, { once: true });
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let buffer = "";
          let bytes = 0;
          let frames = 0;
          try {
            while (active()) {
              const chunk = await reader.read();
              if (!active()) return;
              if (chunk.done) {
                buffer += decoder.decode();
                if (buffer || !received) throw new Error("TRUNCATED_STREAM");
                break;
              }
              bytes += chunk.value.byteLength;
              if (bytes > OBSERVATION_STREAM_MAX_BYTES) throw new Error("STREAM_LIMIT");
              buffer += decoder.decode(chunk.value, { stream: true });
              let boundary: number;
              while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                frames++;
                if (
                  frames > OBSERVATION_STREAM_MAX_CYCLES ||
                  new TextEncoder().encode(frame).byteLength + 2 >
                    OBSERVATION_STREAM_MAX_FRAME_BYTES
                )
                  throw new Error("FRAME_LIMIT");
                const match = /^event: (observation|missing|revoked|error)\ndata: ([^\n]*)$/.exec(
                  frame,
                );
                if (!match) throw new Error("INVALID_FRAME");
                if (match[1] === "observation") observe(JSON.parse(match[2]));
                else {
                  if (match[2] !== "null") throw new Error("INVALID_CONTROL");
                  if (match[1] === "revoked") {
                    revoked();
                    return;
                  }
                  if (match[1] === "error") throw new Error("READ_FAILED");
                  received = true;
                  emit({ type: "transport", transport: "STREAMING" });
                  emit({ type: "connected" });
                }
              }
              if (new TextEncoder().encode(buffer).byteLength > OBSERVATION_STREAM_MAX_FRAME_BYTES)
                throw new Error("FRAME_LIMIT");
            }
          } finally {
            controller.signal.removeEventListener("abort", cancel);
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
        }
        if (!active()) throw new Error("READ_ABORTED");
        failures = 0;
      } catch {
        if (!stopped) {
          failures = Math.min(failures + 1, 4);
          if (streaming) fallbackPolls = 3;
          emit({ type: "error" });
        }
      } finally {
        clearTimeout(deadline);
        controller.abort();
        await response?.body?.cancel().catch(() => undefined);
        request = undefined;
        // Await settlement even for an injected fetch ignoring abort. Never create
        // overlapping requests or publish its response after timeout/scope cleanup.
        if (!stopped) {
          if (streaming) emit({ type: "transport", transport: "RECONNECTING" });
          timer = setTimeout(
            () => {
              void run();
            },
            Math.min(30_000, 5_000 * 2 ** Math.max(0, failures - 1)),
          );
        }
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    else void run();
    return stop;
  };
}
