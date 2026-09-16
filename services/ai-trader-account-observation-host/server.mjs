import http from "node:http";
import { fileURLToPath } from "node:url";

/**
 * DEE-1015: health listener for the dedicated account-observation host. Deliberately a separate
 * service identity and port from `ai-trader-execution-host`; it reads no secret and no credential.
 */

/** @typedef {{ status: 'installed'; service: 'ai-trader-account-observation-host' }} HealthBody */

const SERVICE_NAME = "ai-trader-account-observation-host";
const DEFAULT_PORT = 8090;

/** @returns {HealthBody} */
export function buildObservationHealthBody() {
  return { status: "installed", service: SERVICE_NAME };
}

/**
 * @param {{ port?: number; getHealthBody?: () => Record<string, unknown> }} [options]
 * @returns {{ server: import('node:http').Server; port: number }}
 */
export function createObservationHealthServer(options = {}) {
  const port = options.port ?? Number(process.env.OBSERVATION_HOST_PORT ?? DEFAULT_PORT);

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = options.getHealthBody?.() ?? buildObservationHealthBody();
      res.writeHead(body.status === "degraded" ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
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
  const { server, port } = createObservationHealthServer();

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
