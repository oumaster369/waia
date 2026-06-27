// Wrangler entrypoint (see wrangler.jsonc). Excluded from root tsconfig — Next.js
// typechecks during `next build` before OpenNext emits `.open-next/worker.js`.
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

        try {
          const { buildMarketBrainDepsFromEnv, runMarketBrainCycle } =
            await import("@/lib/trader/market-brain/build-worker-deps");
          const { deps: marketBrainDeps, dispose: marketBrainDispose } =
            await buildMarketBrainDepsFromEnv(env);
          try {
            await runMarketBrainCycle({
              deps: marketBrainDeps,
              organizationId: marketBrainDeps.config.organizationId,
            });
          } finally {
            await marketBrainDispose();
          }
        } catch (marketBrainError) {
          console.error(
            JSON.stringify({
              event: "waia_market_brain",
              phase: "cycle_error",
              error:
                marketBrainError instanceof Error
                  ? marketBrainError.message
                  : String(marketBrainError),
            }),
          );
        }

        try {
          const { buildPaperLoopDepsFromEnv, runPaperLoopCycle } =
            await import("@/lib/trader/paper/build-worker-deps");
          const { deps: paperLoopDeps, dispose: paperLoopDispose } =
            await buildPaperLoopDepsFromEnv(env);
          try {
            await runPaperLoopCycle({ deps: paperLoopDeps });
          } finally {
            await paperLoopDispose();
          }
        } catch (paperLoopError) {
          console.error(
            JSON.stringify({
              event: "waia_paper_loop",
              phase: "cycle_error",
              error:
                paperLoopError instanceof Error ? paperLoopError.message : String(paperLoopError),
            }),
          );
        }
      })(),
    );
  },
};

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
