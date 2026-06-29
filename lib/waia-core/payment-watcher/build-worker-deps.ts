import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

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
    // Cron passes secrets on `env`; avoid Object.entries(process.env) in workerd.
    return explicitEnv;
  }
  try {
    const cfEnv = getCloudflareContext().env as unknown as Record<string, unknown>;
    return { ...process.env, ...cfEnv };
  } catch {
    return { ...process.env };
  }
}

function bridgeEnvKey(env: Record<string, unknown>, key: string): void {
  const value = env[key];
  if (typeof value === "string" && value.trim() !== "") {
    process.env[key] = value;
  }
}

/** Cron scheduled handlers receive secrets on `env`, not always on `process.env`. */
function bridgeCronEnvToProcess(env: Record<string, unknown>): void {
  bridgeEnvKey(env, "DATABASE_URL_POSTGRES");
  bridgeEnvKey(env, "DATABASE_URL");
  bridgeEnvKey(env, "TRONGRID_API_KEY");
  bridgeEnvKey(env, "TRON_RPC_PRIMARY_URL");
  bridgeEnvKey(env, "TRON_RPC_SECONDARY_URL");
  bridgeEnvKey(env, "TRON_RPC_SECONDARY_API_KEY");
  bridgeEnvKey(env, "WATCHER_ENABLED");
  bridgeEnvKey(env, "WAIA_DB_BACKEND");
}

/** Build watcher dependencies for Cron / scheduled handlers (R13 env bridging). */
export async function buildWatcherDepsFromEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<{ deps: WatcherDeps; dispose: () => Promise<void> }> {
  const env = mergeEnv(explicitEnv);
  bridgeCronEnvToProcess(env);
  const config = loadWatcherConfig(env);
  const postgresUrl =
    typeof env.DATABASE_URL_POSTGRES === "string" ? env.DATABASE_URL_POSTGRES.trim() : "";
  if (postgresUrl) {
    process.env.DATABASE_URL_POSTGRES = postgresUrl;
  }
  const runtime = createPerRequestPostgresRuntime();
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
