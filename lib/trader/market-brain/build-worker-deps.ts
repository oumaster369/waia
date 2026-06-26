import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { createPostgresMiObservationService } from "@/lib/trader/mi/observation-service";
import { createPostgresMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import { P3_MARKET_BRAIN_SYMBOLS } from "@/lib/trader/intelligence/types";
import type {
  MarketBrainCycleDeps,
  MarketBrainWorkerConfig,
} from "@/lib/trader/market-brain/types";

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

function parseEnabled(raw: unknown): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function loadMarketBrainConfig(env: Record<string, unknown>): MarketBrainWorkerConfig {
  const organizationId =
    typeof env.MARKET_BRAIN_ORGANIZATION_ID === "string"
      ? env.MARKET_BRAIN_ORGANIZATION_ID.trim()
      : "";

  return {
    enabled: parseEnabled(env.MARKET_BRAIN_ENABLED) && organizationId.length > 0,
    organizationId,
    htxRestHost:
      typeof env.HTX_REST_HOST === "string" && env.HTX_REST_HOST.trim() !== ""
        ? env.HTX_REST_HOST.trim()
        : undefined,
    symbols: P3_MARKET_BRAIN_SYMBOLS,
  };
}

function createStdoutMarketBrainLogger(): MarketBrainCycleDeps["logger"] {
  return {
    log(payload) {
      console.info(JSON.stringify(payload));
    },
  };
}

/** Build market-brain dependencies for Cron / scheduled handlers (Pipeline P3). */
export async function buildMarketBrainDepsFromEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<{ deps: MarketBrainCycleDeps; dispose: () => Promise<void> }> {
  const env = mergeEnv(explicitEnv);
  const config = loadMarketBrainConfig(env);
  const runtime = await createPerRequestPostgresRuntime();
  const db = runtime.db;
  const sourceRepo = createPostgresMiSourceProvenanceRepository(db);
  const miBundle = createPostgresMiObservationService(db, sourceRepo);

  const deps: MarketBrainCycleDeps = {
    config,
    observationService: miBundle.observation,
    logger: createStdoutMarketBrainLogger(),
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

export { runMarketBrainCycle } from "@/lib/trader/market-brain/run-market-brain-cycle";
