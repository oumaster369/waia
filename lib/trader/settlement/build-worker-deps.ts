import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { createPostgresConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-postgres";
import {
  runSettlementCycle,
  type SettlementCycleDeps,
} from "@/lib/trader/settlement/run-settlement-cycle";
import { createPostgresSettlementService } from "@/lib/trader/settlement/settlement-service";
import { createStdoutSettlementLogger } from "@/lib/trader/settlement/settlement-logger";

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

function parseMaxPaymentsPerCycle(env: Record<string, unknown>): number {
  const raw = env.SETTLEMENT_MAX_PAYMENTS_PER_CYCLE;
  if (typeof raw !== "string" || raw.trim() === "") {
    return 50;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

/** Build settlement dependencies for Cron / scheduled handlers (AT-E12 S3-B). */
export async function buildSettlementDepsFromEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<{ deps: SettlementCycleDeps; dispose: () => Promise<void> }> {
  const env = mergeEnv(explicitEnv);
  const runtime = await createPerRequestPostgresRuntime();
  const db = runtime.db;

  const deps: SettlementCycleDeps = {
    settlementService: createPostgresSettlementService(db, {}, db),
    confirmedPaymentsReader: createPostgresConfirmedPaymentsReader(db),
    logger: createStdoutSettlementLogger(),
    maxPaymentsPerCycle: parseMaxPaymentsPerCycle(env),
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

export { runSettlementCycle };
