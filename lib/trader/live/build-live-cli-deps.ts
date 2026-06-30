import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  createPostgresFeeComputationService,
  createPostgresHwmLedgerService,
  createPostgresReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { createPostgresCredentialService } from "@/lib/trader/credentials";
import type { CredentialServiceDeps } from "@/lib/trader/credentials/types";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import { createExecutionLiveAuthorizationHook } from "@/lib/trader/live/assert-live-path-authorized";
import {
  createLiveConnectorForMode,
  createLiveHtxConnector,
} from "@/lib/trader/live/live-connector";
import {
  createPostgresOrgLiveEnableService,
  type OrgLiveEnableService,
} from "@/lib/trader/live/org-live-enable-service";
import type { LiveCycleDeps } from "@/lib/trader/live/run-live-cycle";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import type { TraderAuditInput } from "@/lib/trader/types";
import { createPostgresStrategyPromotionService } from "@/lib/trader/validation-gate";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type BuildLiveCliPostgresDepsInput = {
  organizationId: string;
  credentialId: string;
  env?: Record<string, unknown>;
  createProvider?: CredentialServiceDeps["createProvider"];
};

export type BuildLiveCliPostgresDepsResult = {
  deps: LiveCycleDeps;
  orgLiveEnableService: OrgLiveEnableService;
  dispose: () => Promise<void>;
};

/**
 * Postgres live-cli dependency factory (IMP-U1 S6).
 *
 * Mirrors SQLite composition in `scripts/trader/live-cli.ts` `buildLiveCycleDeps`.
 * Callers must `await dispose()` in a `finally` block when using per-request Postgres sockets.
 */
export async function buildLiveCliPostgresDeps(
  input: BuildLiveCliPostgresDepsInput,
): Promise<BuildLiveCliPostgresDepsResult> {
  const runtime = await getWaiaRuntimeDb();
  if (runtime.kind !== "postgres") {
    throw new Error(
      "[trader:live] buildLiveCliPostgresDeps requires WAIA_DB_BACKEND=postgres and a non-empty DATABASE_URL_POSTGRES.",
    );
  }

  const db = runtime.db;
  const context = requireOrgContext(input.organizationId);
  const writeAudit = (auditInput: TraderAuditInput) => writeTraderAuditLogPostgres(db, auditInput);
  const nowMs = () => Date.now();
  const orderRepository = createPostgresOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createPostgresKillSwitchRepository(db),
    nowMs,
  });
  const riskLimitsService = createPostgresRiskLimitsService(db);
  const promotionService = createPostgresStrategyPromotionService(db);
  const orgLiveEnableService = createPostgresOrgLiveEnableService(db);
  const createProvider = input.createProvider ?? (() => createMasterKeyProvider());
  const credentialService = createPostgresCredentialService(db, { createProvider });

  const liveConnector = await createLiveHtxConnector({
    context,
    credentialId: input.credentialId,
    credentialService,
  });
  const connectorForMode = createLiveConnectorForMode(liveConnector);

  const assertLiveAuthorized = createExecutionLiveAuthorizationHook({
    orgLiveEnableService,
    promotionService,
    killSwitchResolver,
    riskLimitsService,
    credentialService,
    env: input.env,
  });

  const riskEngine = createPostgresRiskEngineService(db, {
    limitsService: riskLimitsService,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode,
    writeAudit,
    nowMs,
    assertLiveAuthorized,
  });

  const reconciliation = createPostgresReconciliationService(db, {
    connectorForMode,
    nowMs,
    writeAudit,
  });

  const reportingBridge = createPostgresReportingPeriodLifecycleService(db);
  const feeComputation = createPostgresFeeComputationService(db);
  const hwmLedger = createPostgresHwmLedgerService(db);

  return {
    deps: {
      execution,
      reconciliation,
      reportingBridge,
      feeComputation,
      hwmLedger,
      orderRepository,
    },
    orgLiveEnableService,
    dispose: () => disposeWaiaRuntimeDb(runtime).then(() => undefined),
  };
}
