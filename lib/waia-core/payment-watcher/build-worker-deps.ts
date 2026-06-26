import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { createPostgresPaymentAddressInboundResolver } from "@/lib/waia-core/payment-addresses/payment-address-inbound-resolver-postgres";
import { createPostgresPaymentService } from "@/lib/waia-core/payments/payment-service";
import { createPostgresWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import { listDetectedInboundPaymentsPostgres } from "@/lib/waia-core/payment-watcher/list-detected-inbound-payments-postgres";
import { createStdoutWatcherLogger } from "@/lib/waia-core/payment-watcher/watcher-logger";
import { createTronAdapter } from "@/lib/waia-core/payment-watcher/tron-adapter";
import { loadWatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
import type { WatcherDeps } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";

function mergeEnv(explicitEnv?: Record<string, unknown>): Record<string, unknown> {
  if (explicitEnv) {
    for (const [key, value] of Object.entries(process.env)) {
      if (explicitEnv[key] === undefined && value !== undefined) {
        explicitEnv[key] = value;
      }
    }
    return explicitEnv;
  }
  try {
    const cfEnv = getCloudflareContext().env as unknown as Record<string, unknown>;
    return { ...process.env, ...cfEnv };
  } catch {
    return { ...process.env };
  }
}

/** Build watcher dependencies for Cron / scheduled handlers (R13 env bridging). */
export async function buildWatcherDepsFromEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<{ deps: WatcherDeps; dispose: () => Promise<void> }> {
  const env = mergeEnv(explicitEnv);
  const config = loadWatcherConfig(env);
  const runtime = await createPerRequestPostgresRuntime();
  const db = runtime.db;

  const deps: WatcherDeps = {
    config,
    chainAdapter: createTronAdapter(config),
    checkpointRepository: createPostgresWatcherCheckpointRepositoryAdapter(db),
    paymentService: createPostgresPaymentService(db, {}, db),
    inboundResolver: createPostgresPaymentAddressInboundResolver(db),
    logger: createStdoutWatcherLogger(),
    listDetectedInboundPayments: () => listDetectedInboundPaymentsPostgres(db),
  };

  return {
    deps,
    dispose: async () => {
      if (runtime._sql) {
        await runtime._sql.end({ timeout: 5 });
      }
    },
  };
}
