import {
  observationBindingSchema,
  parseAccountObservation,
  sameObservationBinding,
} from "@/lib/trader/account-observation/validation";
import type { ObservationSubscriber } from "./use-account-observation";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function readBoundedObservationJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  if (
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
    !response.body
  ) {
    throw new Error("INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const abortRead = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abortRead, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("READ_ABORTED");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("INVALID_RESPONSE");
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } finally {
    signal.removeEventListener("abort", abortRead);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Reusable transport, not a mounted production endpoint. 200=validated direct DTO,
 * 204=not yet observed, 401/403=access ended. Never calls HTX from the browser. */
export function createPollingObservationSubscriber({
  endpointPath,
  fetcher,
  intervalMs = 5_000,
  requestTimeoutMs = 10_000,
  maxBackoffMs = 30_000,
}: {
  endpointPath: string;
  fetcher: typeof fetch;
  intervalMs?: number;
  requestTimeoutMs?: number;
  maxBackoffMs?: number;
}): ObservationSubscriber {
  if (
    !/^\/api\/[a-zA-Z0-9/_-]+$/.test(endpointPath) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1_000 ||
    intervalMs > 60_000 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1_000 ||
    requestTimeoutMs > 60_000 ||
    !Number.isSafeInteger(maxBackoffMs) ||
    maxBackoffMs < intervalMs ||
    maxBackoffMs > 300_000
  ) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_TRANSPORT_CONFIG");
  }
  return (binding, emit, signal) => {
    const exactBinding = observationBindingSchema.parse(binding);
    const query = new URLSearchParams(exactBinding);
    const url = `${endpointPath}?${query.toString()}`;
    let stopped = false;
    let failures = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(next);
      clearTimeout(deadline);
      request?.abort();
      signal.removeEventListener("abort", stop);
    };
    const poll = async () => {
      if (stopped) return;
      const controller = new AbortController();
      request = controller;
      deadline = setTimeout(() => {
        if (stopped) return;
        failures = Math.min(failures + 1, 16);
        controller.abort();
        emit({ type: "error" });
      }, requestTimeoutMs);
      try {
        const response = await fetcher(url, {
          method: "GET",
          credentials: "same-origin",
          mode: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (stopped || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          emit({ type: "revoked" });
          stop();
          return;
        }
        if (response.status === 204) {
          emit({ type: "connected" });
        } else {
          if (!response.ok) throw new Error("READ_FAILED");
          const observation = parseAccountObservation(
            await readBoundedObservationJson(response, controller.signal),
          );
          if (stopped || controller.signal.aborted) return;
          if (!sameObservationBinding(observation.binding, exactBinding))
            throw new Error("IDENTITY_MISMATCH");
          emit({ type: "observation", observation });
        }
        failures = 0;
      } catch {
        if (!stopped) {
          if (!controller.signal.aborted) {
            failures = Math.min(failures + 1, 16);
            emit({ type: "error" });
          }
        }
      } finally {
        clearTimeout(deadline);
        request = undefined;
        // Schedule only after prior fetch/body settles. An adapter ignoring abort
        // cannot accumulate overlapping requests or publish a late response.
        if (!stopped)
          next = setTimeout(
            () => {
              void poll();
            },
            Math.min(maxBackoffMs, intervalMs * 2 ** failures),
          );
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    else void poll();
    return stop;
  };
}
