import http from "node:http";
import { fileURLToPath } from "node:url";

/** @typedef {{ status: 'ok'; service: 'ai-trader-execution-host' }} HealthBody */

const SERVICE_NAME = "ai-trader-execution-host";

/** @returns {HealthBody} */
export function buildHealthBody() {
  return { status: "ok", service: SERVICE_NAME };
}

/**
 * @param {{ port?: number }} [options]
 * @returns {{ server: import('node:http').Server; port: number }}
 */
export function createHealthServer(options = {}) {
  const port = options.port ?? Number(process.env.EXECUTION_HOST_PORT ?? 8080);

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildHealthBody()));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return { server, port };
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const { server, port } = createHealthServer();

  server.listen(port, () => {
    process.stdout.write(`[${SERVICE_NAME}] listening port=${port}\n`);
  });

  /** @param {NodeJS.Signals} signal */
  const shutdown = (signal) => {
    process.stdout.write(`[${SERVICE_NAME}] ${signal} received; shutting down\n`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (isMainModule()) {
  main();
}
