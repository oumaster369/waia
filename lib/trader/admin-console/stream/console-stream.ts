import {
  ADMIN_COCKPIT_MAX_STREAM_MS,
  ADMIN_COCKPIT_STREAM_HEADERS,
} from "@/lib/trader/admin/cockpit-stream";
import {
  adminSuccess,
  assertAdminPermission,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  credentialRevoked,
  readChangeLogBacklog,
  readChangeLogSince,
  readMinChangeLogXid,
} from "@/lib/trader/admin-console/repositories/change-log.postgres";
import {
  readSnapshotXmin,
  withAdminReadSnapshot,
} from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { parseAdminConsoleQuery, parseAdminStreamTopics } from "@/lib/trader/admin-console/scope";
import {
  accessRevokedEvent,
  heartbeatEvent,
  planStreamTick,
  projectChangeRow,
  type ChangeLogRow,
  type ConsoleStreamEvent,
  type ProjectedChange,
} from "@/lib/trader/admin-console/stream/protocol";
import {
  emitWaiaRuntimeRouteTelemetry,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";

const encoder = new TextEncoder();

export function encodeAdminConsoleSse(event: ConsoleStreamEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

async function projectRow(
  tx: Parameters<typeof credentialRevoked>[0],
  row: ChangeLogRow,
): Promise<ProjectedChange | null> {
  const projected = projectChangeRow(row);
  if (!projected) return null;
  if (row.sourceTable !== "exchange_credentials") return projected;
  const revoked = row.op === "DELETE" || (await credentialRevoked(tx, row.entityId));
  return { ...projected, removed: revoked || projected.removed };
}

async function readTick(
  db: Parameters<typeof withAdminReadSnapshot>[0],
  cursor: string | null,
  sent: Map<string, string>,
  topics: readonly string[],
  now: string,
) {
  return withAdminReadSnapshot(db, async (tx) => {
    const w1 = await readSnapshotXmin(tx);
    const watermark = cursor ?? w1;
    const [{ rows, moreRemain }, backlog, minRetainedXid] = await Promise.all([
      readChangeLogSince(tx, watermark),
      readChangeLogBacklog(tx, watermark),
      readMinChangeLogXid(tx),
    ]);
    const projected = new Map<string, ProjectedChange | null>();
    for (const row of rows) {
      projected.set(row.seq, await projectRow(tx, row));
    }
    const tick = planStreamTick({
      cursor,
      w1,
      rows,
      moreRemain,
      backlog,
      sent,
      minRetainedXid,
      now,
      topics,
      project: (row) => projected.get(row.seq) ?? null,
    });
    return tick;
  });
}

export async function handleAdminConsoleStreamPoll(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const query = parseAdminConsoleQuery(url);
  if (!query.ok) return query.result;
  const topics = parseAdminStreamTopics(query.query.topics);
  if (!topics.ok) return topics.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const resume = query.query.resume ?? request.headers.get("last-event-id");
  const cursor = resume && resume.length > 0 ? resume : null;
  try {
    const tick = await readTick(
      opened.runtime.db,
      cursor,
      new Map(),
      topics.topics,
      new Date().toISOString(),
    );
    return adminSuccess({ cursor: tick.value.cursor, events: tick.value.events }, "postgres");
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

function wantsPoll(request: Request): boolean {
  const transport = new URL(request.url).searchParams.get("transport");
  const acceptsStream = request.headers.get("accept")?.includes("text/event-stream") === true;
  return transport === "poll" || !acceptsStream;
}

export async function serveAdminConsoleStream(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<Response> {
  const started = Date.now();
  if (wantsPoll(request)) {
    const result = await handleAdminConsoleStreamPoll(request, deps);
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "trader_admin_console_stream",
      waia_db_backend: result.waiaDbBackend,
      http_status: result.status,
      outcome: result.outcome,
      duration_ms: Date.now() - started,
      error_class: result.errorClass,
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const url = new URL(request.url);
  const query = parseAdminConsoleQuery(url);
  if (!query.ok) {
    return Response.json(query.result.body, { status: query.result.status });
  }
  const topics = parseAdminStreamTopics(query.query.topics);
  if (!topics.ok) {
    return Response.json(topics.result.body, { status: topics.result.status });
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) {
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "trader_admin_console_stream",
      http_status: opened.result.status,
      outcome: opened.result.outcome,
      duration_ms: Date.now() - started,
    });
    return Response.json(opened.result.body, { status: opened.result.status });
  }

  const headerResume = request.headers.get("last-event-id");
  let cursor =
    query.query.resume ?? (headerResume && headerResume.length > 0 ? headerResume : null);
  const sent = new Map<string, string>();
  const deadline = Date.now() + ADMIN_COCKPIT_MAX_STREAM_MS;
  let lastWrite = 0;
  let closed = false;
  const runtime = opened.runtime;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = async () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        await deps.disposeRuntimeDb(runtime);
      };
      const write = (event: ConsoleStreamEvent) => {
        controller.enqueue(encodeAdminConsoleSse(event));
        lastWrite = Date.now();
      };
      try {
        while (!request.signal.aborted && Date.now() < deadline) {
          const allowed = await authorizeStill(opened.userId, opened.contextOrgId, runtime);
          if (!allowed) {
            write(accessRevokedEvent(new Date().toISOString()));
            break;
          }
          const tick = await readTick(
            runtime.db,
            cursor,
            sent,
            topics.topics,
            new Date().toISOString(),
          );
          cursor = tick.value.cursor;
          sent.clear();
          for (const [seq, xid] of tick.value.retained) sent.set(seq, xid);
          if (tick.value.events.length > 0) {
            for (const event of tick.value.events) write(event);
          } else if (Date.now() - lastWrite >= 15_000) {
            write(heartbeatEvent(cursor ?? "0", new Date().toISOString()));
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch (err) {
        emitWaiaRuntimeRouteTelemetry({
          event: "waia_runtime_route",
          route: "trader_admin_console_stream",
          http_status: 500,
          outcome: "internal_error",
          duration_ms: Date.now() - started,
          error_class: safeTelemetryErrorClass(err),
        });
      } finally {
        await close();
      }
    },
    async cancel() {
      if (!closed) {
        closed = true;
        await deps.disposeRuntimeDb(runtime);
      }
    },
  });

  emitWaiaRuntimeRouteTelemetry({
    event: "waia_runtime_route",
    route: "trader_admin_console_stream",
    waia_db_backend: "postgres",
    http_status: 200,
    outcome: "success",
    duration_ms: Date.now() - started,
  });
  return new Response(body, { status: 200, headers: ADMIN_COCKPIT_STREAM_HEADERS });
}

async function authorizeStill(
  userId: string,
  organizationId: string,
  runtime: Parameters<typeof assertAdminPermission>[0],
): Promise<boolean> {
  const check = await assertAdminPermission(runtime, userId, organizationId, "admin.audit.read");
  return check.allowed;
}
