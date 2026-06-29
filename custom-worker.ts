// Wrangler entrypoint (see wrangler.jsonc). Excluded from root tsconfig — Next.js
// typechecks during `next build` before OpenNext emits `.open-next/worker.js`.
import { default as handler } from "./.open-next/worker.js";

async function runPaymentWatcherCycle(env: Record<string, unknown>): Promise<void> {
  console.log(
    JSON.stringify({
      event: "waia_payment_watcher",
      phase: "scheduled_start",
      watcher_enabled_present: env.WATCHER_ENABLED !== undefined,
      db_postgres_present:
        typeof env.DATABASE_URL_POSTGRES === "string" && env.DATABASE_URL_POSTGRES.trim() !== "",
    }),
  );

  let buildWatcherDepsFromEnv;
  let runWatcherCycle;
  try {
    ({ buildWatcherDepsFromEnv } =
      await import("@/lib/waia-core/payment-watcher/build-worker-deps"));
    ({ runWatcherCycle } = await import("@/lib/waia-core/payment-watcher/run-watcher-cycle"));
  } catch (importError) {
    console.error(
      JSON.stringify({
        event: "waia_payment_watcher",
        phase: "import_error",
        error: importError instanceof Error ? importError.message : String(importError),
      }),
    );
    return;
  }

  try {
    const { deps, dispose } = await buildWatcherDepsFromEnv(env);
    console.log(JSON.stringify({ event: "waia_payment_watcher", phase: "deps_ok" }));
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
          watcherDepsError instanceof Error ? watcherDepsError.message : String(watcherDepsError),
      }),
    );
  }
}

export default {
  fetch: handler.fetch,

  async scheduled(
    _event: unknown,
    env: Record<string, unknown>,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<void> {
    await runPaymentWatcherCycle(env);

    ctx.waitUntil(
      (async () => {
        let buildSettlementDepsFromEnv;
        let runSettlementCycle;
        try {
          ({ buildSettlementDepsFromEnv, runSettlementCycle } =
            await import("@/lib/trader/settlement/build-worker-deps"));
        } catch (importError) {
          console.error(
            JSON.stringify({
              event: "waia_settlement_cycle",
              phase: "import_error",
              error: importError instanceof Error ? importError.message : String(importError),
            }),
          );
          throw importError;
        }

        try {
          const { deps: settlementDeps, dispose: settlementDispose } =
            await buildSettlementDepsFromEnv(env);
          console.log(JSON.stringify({ event: "waia_settlement_cycle", phase: "deps_ok" }));
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
          let buildMarketBrainDepsFromEnv;
          let runMarketBrainCycle;
          try {
            ({ buildMarketBrainDepsFromEnv, runMarketBrainCycle } =
              await import("@/lib/trader/market-brain/build-worker-deps"));
          } catch (importError) {
            console.error(
              JSON.stringify({
                event: "waia_market_brain",
                phase: "import_error",
                error: importError instanceof Error ? importError.message : String(importError),
              }),
            );
            throw importError;
          }
          const { deps: marketBrainDeps, dispose: marketBrainDispose } =
            await buildMarketBrainDepsFromEnv(env);
          console.log(JSON.stringify({ event: "waia_market_brain", phase: "deps_ok" }));
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
          let buildPaperLoopDepsFromEnv;
          let runPaperLoopCycle;
          try {
            ({ buildPaperLoopDepsFromEnv, runPaperLoopCycle } =
              await import("@/lib/trader/paper/build-worker-deps"));
          } catch (importError) {
            console.error(
              JSON.stringify({
                event: "waia_paper_loop",
                phase: "import_error",
                error: importError instanceof Error ? importError.message : String(importError),
              }),
            );
            throw importError;
          }
          const { deps: paperLoopDeps, dispose: paperLoopDispose } =
            await buildPaperLoopDepsFromEnv(env);
          console.log(JSON.stringify({ event: "waia_paper_loop", phase: "deps_ok" }));
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
