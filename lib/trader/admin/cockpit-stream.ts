import { createHash } from "node:crypto";

import { handleAdminCockpitRead, type AdminCockpitReadDeps } from "@/lib/trader/admin/cockpit-read";
import type { AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";

const encoder = new TextEncoder();

export const ADMIN_COCKPIT_MAX_STREAM_MS = 30_000;
export const ADMIN_COCKPIT_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export type AdminCockpitSseEvent = "cockpit.snapshot" | "heartbeat" | "error";

export function encodeAdminCockpitSse(
  event: AdminCockpitSseEvent,
  id: string,
  payload: unknown,
): Uint8Array {
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function eventIdForBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function createAdminCockpitPollingStream(
  input: Readonly<{
    signal: AbortSignal;
    lastEventId: string | null;
    load: () => Promise<Pick<AdminRouteHandlerResult, "status" | "body">>;
    pollMs?: number;
    heartbeatMs?: number;
    maxLifetimeMs?: number;
    dispose?: () => Promise<void>;
  }>,
): ReadableStream<Uint8Array> {
  const pollMs = Math.max(250, input.pollMs ?? 1_000);
  const heartbeatMs = Math.max(pollMs, input.heartbeatMs ?? 15_000);
  const requestedLifetime = input.maxLifetimeMs ?? ADMIN_COCKPIT_MAX_STREAM_MS;
  if (!Number.isFinite(requestedLifetime) || requestedLifetime <= 0) {
    throw new Error("Cockpit stream lifetime must be finite and positive.");
  }
  const deadline = Date.now() + Math.min(requestedLifetime, ADMIN_COCKPIT_MAX_STREAM_MS);
  let previous = input.lastEventId;
  let lastWrite = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      controllerRef?.close();
    } catch {
      /* consumer already cancelled */
    }
  };
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    if (expiryTimer) {
      clearTimeout(expiryTimer);
    }
    if (abortHandler) {
      input.signal.removeEventListener("abort", abortHandler);
    }
    close();
    await input.dispose?.();
  };
  return new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      expiryTimer = setTimeout(
        () => void stop().catch(() => {}),
        Math.max(0, deadline - Date.now()),
      );
      const tick = async (): Promise<void> => {
        if (stopped || input.signal.aborted || Date.now() >= deadline) {
          await stop();
          return;
        }
        try {
          const result = await input.load();
          if (stopped || input.signal.aborted || Date.now() >= deadline) {
            await stop();
            return;
          }
          const now = Date.now();
          if (result.status !== 200) {
            controller.enqueue(
              encodeAdminCockpitSse("error", previous ?? "cockpit-read-failed", {
                code: "COCKPIT_READ_FAILED",
                status: result.status,
              }),
            );
            lastWrite = now;
          } else {
            const eventId = eventIdForBody(result.body);
            if (eventId !== previous) {
              controller.enqueue(encodeAdminCockpitSse("cockpit.snapshot", eventId, result.body));
              previous = eventId;
              lastWrite = now;
            } else if (now - lastWrite >= heartbeatMs) {
              controller.enqueue(
                encodeAdminCockpitSse("heartbeat", eventId, { kind: "heartbeat" }),
              );
              lastWrite = now;
            }
          }
        } catch {
          if (stopped || input.signal.aborted || Date.now() >= deadline) {
            await stop();
            return;
          }
          controller.enqueue(
            encodeAdminCockpitSse("error", previous ?? "cockpit-read-failed", {
              code: "COCKPIT_READ_FAILED",
            }),
          );
        }
        if (!stopped) {
          timer = setTimeout(() => void tick().catch(() => {}), pollMs);
        }
      };
      abortHandler = () => void stop().catch(() => {});
      input.signal.addEventListener("abort", abortHandler, { once: true });
      await tick();
    },
    async cancel() {
      await stop();
    },
  });
}

function wantsPollingFallback(request: Request): boolean {
  const url = new URL(request.url);
  const transport = url.searchParams.getAll("transport");
  const namedPoll = transport.length === 1 && transport[0] === "poll";
  const acceptsStream = request.headers.get("accept")?.includes("text/event-stream") === true;
  return namedPoll || !acceptsStream;
}

export async function serveAdminCockpit(
  request: Request,
  deps: AdminCockpitReadDeps,
): Promise<Response> {
  const load = () => handleAdminCockpitRead(request, deps);
  if (wantsPollingFallback(request)) {
    const result = await load();
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const preflight = await load();
  if (preflight.status !== 200) {
    return Response.json(preflight.body, {
      status: preflight.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const body = createAdminCockpitPollingStream({
    signal: request.signal,
    lastEventId: request.headers.get("last-event-id"),
    load,
  });
  return new Response(body, { status: 200, headers: ADMIN_COCKPIT_STREAM_HEADERS });
}
