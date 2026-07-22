import { startFhvObserverRuntimeFromEnv } from "@/lib/trader/observability/fhv-observer-runtime";

const runtime = startFhvObserverRuntimeFromEnv(process.env);
process.stdout.write(
  `[ai-trader-fhv-observer] listening ${runtime.env.bindHost}:${runtime.env.port}\n`,
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void runtime.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
