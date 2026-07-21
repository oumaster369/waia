import http from "node:http";

import {
  buildFhvObserverDetailPage,
  buildFhvObserverStatusSnapshot,
  createFhvObserverState,
  handleFhvObserverCommand,
  type FhvObserverConfig,
} from "@/lib/trader/observability/fhv-observer-core";
import type { FhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";

export function createFhvObserverHttpServer(config: FhvObserverConfig): http.Server {
  const host = config.bindHost ?? "127.0.0.1";
  const port = config.port ?? 9471;
  const state = createFhvObserverState(config);

  return http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "ai-trader-fhv-observer" }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/status") {
      const status = buildFhvObserverStatusSnapshot(state);
      res.writeHead(status ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status ?? { error: "status_unavailable" }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/commands") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        command?: FhvOperatorCommandV1;
      };
      if (!body.command) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "command_required" }));
        return;
      }
      const result = handleFhvObserverCommand(state, body.command);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/v1/detail/")) {
      const url = new URL(req.url, `http://${host}:${port}`);
      const kind = url.pathname.split("/").pop() ?? "";
      const cursor = url.searchParams.get("cursor");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
      const page = buildFhvObserverDetailPage(config.runRoot, kind, cursor, limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(page));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

export function startFhvObserverServer(config: FhvObserverConfig): http.Server {
  const host = config.bindHost ?? "127.0.0.1";
  const port = config.port ?? 9471;
  const server = createFhvObserverHttpServer(config);
  server.listen(port, host, () => {
    process.stdout.write(`[ai-trader-fhv-observer] listening ${host}:${port}\n`);
  });
  return server;
}
