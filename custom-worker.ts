// @ts-expect-error `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(
    _event: unknown,
    env: Record<string, unknown>,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        // Lazy-load watcher deps so postgres-client (createRequire) is not
        // evaluated at Worker upload validation — only on Cron invocation.
        const { buildWatcherDepsFromEnv } =
          await import("@/lib/waia-core/payment-watcher/build-worker-deps");
        const { runWatcherCycle } =
          await import("@/lib/waia-core/payment-watcher/run-watcher-cycle");
        const { buildSettlementDepsFromEnv, runSettlementCycle } =
          await import("@/lib/trader/settlement/build-worker-deps");

        try {
          const { deps, dispose } = await buildWatcherDepsFromEnv(env);
          try {
            await runWatcherCycle(deps);
          } catch (watcherError) {
            console.error(
              JSON.stringify({
                event: "waia_payment_watcher",
                phase: "cycle_error",
                error: watcherError instanceof Error ? watcherError.message : String(watcherError),
              }),
            );
          } finally {
            await dispose();
          }
        } catch (watcherDepsError) {
          console.error(
            JSON.stringify({
              event: "waia_payment_watcher",
              phase: "deps_error",
              error:
                watcherDepsError instanceof Error
                  ? watcherDepsError.message
                  : String(watcherDepsError),
            }),
          );
        }

        try {
          const { deps: settlementDeps, dispose: settlementDispose } =
            await buildSettlementDepsFromEnv(env);
          try {
            await runSettlementCycle(settlementDeps);
          } finally {
            await settlementDispose();
          }
        } catch (settlementError) {
          console.error(
            JSON.stringify({
              event: "waia_settlement_cycle",
              phase: "cycle_error",
              error:
                settlementError instanceof Error
                  ? settlementError.message
                  : String(settlementError),
            }),
          );
        }
      })(),
    );
  },
};

// @ts-expect-error `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
