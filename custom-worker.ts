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
        const { deps, dispose } = await buildWatcherDepsFromEnv(env);
        try {
          await runWatcherCycle(deps);
        } finally {
          await dispose();
        }
      })(),
    );
  },
};

// @ts-expect-error `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
