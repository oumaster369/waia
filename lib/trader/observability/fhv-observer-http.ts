import http from "node:http";

import {
  buildFhvObserverDetailPage,
  buildFhvObserverStatusSnapshot,
  createFhvObserverState,
  handleFhvObserverCommand,
  type FhvObserverConfig,
} from "@/lib/trader/observability/fhv-observer-core";
import type { FhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  FHV_OBSERVER_AUTH_HEADER,
  FHV_OBSERVER_MAX_BODY_BYTES,
  sha256Hex,
  verifyFhvObserverAuthToken,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import { createFhvObserverTransportNonceCacheForRunRoot } from "@/lib/trader/observability/fhv-observer-transport-nonce-cache";

const OBSERVER_RATE_LIMIT_PER_MINUTE = 120;

type ObserverRateBucket = {
  timestamps: number[];
};

function jsonError(res: http.ServerResponse, status: number, code: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code }));
}

function assertLocalhostBinding(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("FHV_OBSERVER_BIND_FORBIDDEN");
  }
}

function parseTenantQuery(url: URL): { organizationId: string; campaignRunId: string } | null {
  const organizationId = url.searchParams.get("organization_id")?.trim();
  const campaignRunId = url.searchParams.get("campaign_run_id")?.trim();
  if (!organizationId || !campaignRunId) {
    return null;
  }
  return { organizationId, campaignRunId };
}

async function readBoundedBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > FHV_OBSERVER_MAX_BODY_BYTES) {
      throw new Error("FHV_OBSERVER_BODY_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function createFhvObserverHttpServer(config: FhvObserverConfig): http.Server {
  const host = config.bindHost ?? "127.0.0.1";
  assertLocalhostBinding(host);
  const port = config.port ?? 9471;
  const state = createFhvObserverState(config);
  const nonceCache = createFhvObserverTransportNonceCacheForRunRoot(config.runRoot);
  const rateBuckets = new Map<string, ObserverRateBucket>();

  function checkRateLimit(key: string, nowMs: number): boolean {
    const bucket = rateBuckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((ts) => nowMs - ts < 60_000);
    if (bucket.timestamps.length >= OBSERVER_RATE_LIMIT_PER_MINUTE) {
      rateBuckets.set(key, bucket);
      return false;
    }
    bucket.timestamps.push(nowMs);
    rateBuckets.set(key, bucket);
    return true;
  }

  function verifyRequestAuth(input: {
    req: http.IncomingMessage;
    method: string;
    pathWithQuery: string;
    organizationId: string;
    campaignRunId: string;
    body: Buffer;
    nowMs: number;
  }): void {
    if (input.organizationId !== config.organizationId) {
      throw new Error("FHV_OBSERVER_ORG_MISMATCH");
    }
    if (input.campaignRunId !== config.runId) {
      throw new Error("FHV_OBSERVER_RUN_MISMATCH");
    }
    verifyFhvObserverAuthToken({
      headerValue: (input.req.headers[FHV_OBSERVER_AUTH_HEADER] as string | undefined) ?? null,
      payload: {
        method: input.method,
        path: input.pathWithQuery,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
        timestampMs: 0,
        nonce: "",
        bodySha256: sha256Hex(input.body),
      },
      secret: config.observerTunnelSecret,
      nowMs: input.nowMs,
      nonceCache,
    });
  }

  return http.createServer(async (req, res) => {
    const nowMs = Date.now();
    try {
      if (!req.url) {
        jsonError(res, 400, "bad_request");
        return;
      }

      const url = new URL(req.url, `http://${host}:${port}`);
      const pathWithQuery = `${url.pathname}${url.search}`;

      if (req.method === "GET" && url.pathname === "/v1/health") {
        const remote = req.socket.remoteAddress ?? "";
        if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
          jsonError(res, 403, "forbidden");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "ai-trader-fhv-observer" }));
        return;
      }

      const tenant = parseTenantQuery(url);
      if (!tenant) {
        jsonError(res, 400, "tenant_query_required");
        return;
      }

      const rateKey = `${tenant.organizationId}:${tenant.campaignRunId}:${req.method}:${url.pathname}`;
      if (!checkRateLimit(rateKey, nowMs)) {
        jsonError(res, 429, "rate_limited");
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/status") {
        verifyRequestAuth({
          req,
          method: "GET",
          pathWithQuery,
          organizationId: tenant.organizationId,
          campaignRunId: tenant.campaignRunId,
          body: Buffer.alloc(0),
          nowMs,
        });
        const status = buildFhvObserverStatusSnapshot(state);
        res.writeHead(status ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status ?? { error: "status_unavailable" }));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/detail/")) {
        verifyRequestAuth({
          req,
          method: "GET",
          pathWithQuery,
          organizationId: tenant.organizationId,
          campaignRunId: tenant.campaignRunId,
          body: Buffer.alloc(0),
          nowMs,
        });
        const kind = url.pathname.split("/").pop() ?? "";
        const cursor = url.searchParams.get("cursor");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
        const page = buildFhvObserverDetailPage(config.runRoot, kind, cursor, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(page));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/commands") {
        const contentType = req.headers["content-type"] ?? "";
        if (!contentType.includes("application/json")) {
          jsonError(res, 415, "content_type_required");
          return;
        }
        const body = await readBoundedBody(req);
        verifyRequestAuth({
          req,
          method: "POST",
          pathWithQuery,
          organizationId: tenant.organizationId,
          campaignRunId: tenant.campaignRunId,
          body,
          nowMs,
        });
        let parsed: { command?: FhvOperatorCommandV1 };
        try {
          parsed = JSON.parse(body.toString("utf8")) as { command?: FhvOperatorCommandV1 };
        } catch {
          jsonError(res, 400, "malformed_json");
          return;
        }
        if (!parsed.command) {
          jsonError(res, 400, "command_required");
          return;
        }
        const result = await handleFhvObserverCommand(state, parsed.command);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      jsonError(res, 404, "not_found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      const status =
        message.includes("AUTH") ||
        message.includes("MISMATCH") ||
        message.includes("EXPIRED") ||
        message.includes("REPLAY")
          ? 401
          : message.includes("BODY_TOO_LARGE")
            ? 413
            : 500;
      jsonError(res, status, message);
    }
  });
}

export function startFhvObserverServer(config: FhvObserverConfig): http.Server {
  const host = config.bindHost ?? "127.0.0.1";
  assertLocalhostBinding(host);
  const port = config.port ?? 9471;
  const server = createFhvObserverHttpServer(config);
  server.listen(port, host, () => {
    process.stdout.write(`[ai-trader-fhv-observer] listening ${host}:${port}\n`);
  });
  return server;
}
