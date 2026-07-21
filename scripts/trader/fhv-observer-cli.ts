import { startFhvObserverServer } from "@/lib/trader/observability/fhv-observer-http";

const runRoot = process.env.FHV_RUN_ROOT?.trim();
const runId = process.env.FHV_RUN_ID?.trim();
const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
const commandSecret = process.env.FHV_OPERATOR_COMMAND_SECRET?.trim();

if (!runRoot || !runId || !organizationId || !commandSecret) {
  process.stderr.write(
    "[fhv-observer-cli] FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_OPERATOR_COMMAND_SECRET required\n",
  );
  process.exit(1);
}

const server = startFhvObserverServer({
  runRoot,
  runId,
  organizationId,
  commandSecret,
  bindHost: "127.0.0.1",
  port: Number(process.env.FHV_OBSERVER_PORT ?? 9471),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
