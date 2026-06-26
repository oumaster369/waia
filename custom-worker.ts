// @ts-expect-error `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";

import { buildWatcherDepsFromEnv } from "@/lib/waia-core/payment-watcher/build-worker-deps";
import { runWatcherCycle } from "@/lib/waia-core/payment-watcher/run-watcher-cycle";

export default {
  fetch: handler.fetch,

  async scheduled(
    _event: unknown,
    env: Record<string, unknown>,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
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
