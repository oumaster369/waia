import http from "node:http";
import { fileURLToPath } from "node:url";

/** Localhost-only FHV observer daemon entry (DEE-416). */

export type FhvObserverServerOptions = Readonly<{
  port?: number;
  host?: string;
  runRoot: string;
  runId: string;
  organizationId: string;
  commandSecret: string;
}>;

export function createFhvObserverHttpServer(options: FhvObserverServerOptions): http.Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.FHV_OBSERVER_PORT ?? 9471);

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
      const { buildFhvObserverStatusSnapshot, createFhvObserverState } = await import(
        "../../lib/trader/observability/fhv-observer-core.ts"
      );
      const state = createFhvObserverState({
        runRoot: options.runRoot,
        runId: options.runId,
        organizationId: options.organizationId,
        commandSecret: options.commandSecret,
        bindHost: host,
        port,
      });
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
        command?: unknown;
      };
      const { createFhvObserverState, handleFhvObserverCommand } = await import(
        "../../lib/trader/observability/fhv-observer-core.ts"
      );
      const state = createFhvObserverState({
        runRoot: options.runRoot,
        runId: options.runId,
        organizationId: options.organizationId,
        commandSecret: options.commandSecret,
        bindHost: host,
        port,
      });
      const result = handleFhvObserverCommand(
        state,
        body.command as import("../../lib/trader/observability/fhv-operator-command-v1.ts").FhvOperatorCommandV1,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/v1/detail/")) {
      const url = new URL(req.url, `http://${host}:${port}`);
      const kind = url.pathname.split("/").pop() ?? "";
      const cursor = url.searchParams.get("cursor");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
      const { buildFhvObserverDetailPage } = await import(
        "../../lib/trader/observability/fhv-observer-core.ts"
      );
      const page = buildFhvObserverDetailPage(options.runRoot, kind, cursor, limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(page));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const runRoot = process.env.FHV_RUN_ROOT?.trim();
  const runId = process.env.FHV_RUN_ID?.trim();
  const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
  const commandSecret = process.env.FHV_OPERATOR_COMMAND_SECRET?.trim();
  if (!runRoot || !runId || !organizationId || !commandSecret) {
    process.stderr.write(
      "[ai-trader-fhv-observer] FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_OPERATOR_COMMAND_SECRET required\n",
    );
    process.exit(1);
  }

  const server = createFhvObserverHttpServer({
    runRoot,
    runId,
    organizationId,
    commandSecret,
  });
  const host = "127.0.0.1";
  const port = Number(process.env.FHV_OBSERVER_PORT ?? 9471);
  server.listen(port, host, () => {
    process.stdout.write(`[ai-trader-fhv-observer] listening ${host}:${port}\n`);
  });
}

if (isMainModule()) {
  main();
}
