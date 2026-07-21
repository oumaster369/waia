import { fileURLToPath } from "node:url";

/** Localhost-only FHV observer daemon entry (DEE-416). */

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

async function main() {
  const runRoot = process.env.FHV_RUN_ROOT?.trim();
  const runId = process.env.FHV_RUN_ID?.trim();
  const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
  const commandSecret = process.env.FHV_OPERATOR_COMMAND_SECRET?.trim();
  const observerTunnelSecret = process.env.FHV_OBSERVER_TUNNEL_SECRET?.trim();
  if (!runRoot || !runId || !organizationId || !commandSecret || !observerTunnelSecret) {
    process.stderr.write(
      "[ai-trader-fhv-observer] FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_OPERATOR_COMMAND_SECRET, FHV_OBSERVER_TUNNEL_SECRET required\n",
    );
    process.exit(1);
  }

  const { startFhvObserverServer } =
    await import("../../lib/trader/observability/fhv-observer-http.ts");
  startFhvObserverServer({
    runRoot,
    runId,
    organizationId,
    commandSecret,
    observerTunnelSecret,
    bindHost: "127.0.0.1",
    port: Number(process.env.FHV_OBSERVER_PORT ?? 9471),
  });
}

if (isMainModule()) {
  void main();
}

export {};
