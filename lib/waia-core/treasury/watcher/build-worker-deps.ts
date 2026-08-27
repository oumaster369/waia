import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createPostgresTreasuryDomainServices,
  createPostgresTreasuryRepository,
  createTreasuryTransactionService,
} from "@/lib/waia-core/treasury";
import { createTreasuryTronAdapter } from "@/lib/waia-core/treasury/watcher/tron-adapter";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher/config";
import { createStdoutTreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
import { createPostgresTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/postgres-repository";
import type { TreasuryWatcherCycleDeps } from "@/lib/waia-core/treasury/watcher/cycle";

export const TREASURY_WATCHER_ORGANIZATION_ENV = "TREASURY_WATCHER_ORGANIZATION_ID" as const;

function bridge(env: Record<string, unknown>, key: string): void {
  const value = env[key];
  if (typeof value === "string" && value.trim()) process.env[key] = value;
}

function independentSecondaryConfigured(primaryUrl: string, secondaryUrl: string): boolean {
  if (!secondaryUrl) return false;
  try {
    return new URL(primaryUrl).origin !== new URL(secondaryUrl).origin;
  } catch {
    return false;
  }
}

export function treasuryWatcherReadiness(env: Record<string, unknown>) {
  const config = loadTreasuryWatcherConfig(env);
  const organizationId =
    typeof env[TREASURY_WATCHER_ORGANIZATION_ENV] === "string"
      ? env[TREASURY_WATCHER_ORGANIZATION_ENV].trim()
      : "";
  const databasePresent =
    typeof env.DATABASE_URL_POSTGRES === "string" && env.DATABASE_URL_POSTGRES.trim() !== "";
  const primaryKeyPresent = config.tronGridApiKey !== "";
  const secondaryConfigured = independentSecondaryConfigured(
    config.tronPrimaryUrl,
    config.tronSecondaryUrl,
  );
  return {
    enabled: config.enabled,
    organizationIdPresent: organizationId !== "",
    databasePresent,
    primaryKeyPresent,
    secondaryConfigured,
    // TronGrid is the canonical Treasury observation channel. A second provider is an
    // optional failover only and must never block readiness or production activation.
    ready: organizationId !== "" && databasePresent && primaryKeyPresent,
  };
}

export async function buildTreasuryWatcherDepsFromEnv(env: Record<string, unknown>): Promise<{
  context: OrgContext;
  deps: TreasuryWatcherCycleDeps;
  dispose: () => Promise<void>;
}> {
  for (const key of [
    "DATABASE_URL_POSTGRES",
    "TREASURY_WATCHER_ENABLED",
    "TREASURY_WATCHER_ORGANIZATION_ID",
    "TREASURY_WATCHER_TRONGRID_API_KEY",
    "TREASURY_WATCHER_TRON_PRIMARY_URL",
    "TREASURY_WATCHER_TRON_SECONDARY_URL",
    "TREASURY_WATCHER_TRON_SECONDARY_API_KEY",
  ]) {
    bridge(env, key);
  }
  const organizationId =
    typeof env[TREASURY_WATCHER_ORGANIZATION_ENV] === "string"
      ? env[TREASURY_WATCHER_ORGANIZATION_ENV].trim()
      : "";
  const context = requireOrgContext(organizationId);
  const config = loadTreasuryWatcherConfig(env);
  const runtime = createPerRequestPostgresRuntime();
  const domain = createPostgresTreasuryDomainServices(runtime.db);
  return {
    context,
    deps: {
      config,
      chainAdapter: createTreasuryTronAdapter(config),
      watcherRepository: createPostgresTreasuryWatcherRepository(runtime.db),
      treasuryRepository: domain.repository,
      transactions: domain.transactions,
      logger: createStdoutTreasuryWatcherLogger(),
      runAtomic: (fn) =>
        runWaiaPostgresTransaction(runtime.db, async (tx) => {
          const repository = createPostgresTreasuryRepository(tx);
          const writeAudit = (input: Parameters<typeof writeAuditLogPostgres>[1]) =>
            writeAuditLogPostgres(tx, input);
          const transactions = createTreasuryTransactionService({
            repository,
            writeAudit,
            runAtomic: async (nested) => nested({ repository, writeAudit }),
          });
          return fn({
            watcherRepository: createPostgresTreasuryWatcherRepository(tx),
            transactions,
          });
        }),
    },
    dispose: async () => {
      await runtime._sql.end({ timeout: 5 });
    },
  };
}
