/**
 * DEE-212 / BP-7 — Org-0 live execution operator CLI (bounded, terminating).
 *
 * Subcommands:
 *   request       Request org live-enable (-> REQUESTED)
 *   confirm       Confirm with ack phrase (-> COOLING_OFF)
 *   mark-enabled  Mark ENABLED after cooling-off elapsed
 *   disable       Disable org live-enable (-> DISABLED)
 *   status        Preview org live-enable state
 *   cycle         Run one bounded live cycle (Strategy → Risk → Execution → Reconciliation → Reporting)
 *
 * Requires DATABASE_URL, WAIA_TRADER_CLI=1, WAIA_TRADER_ORG0_ORGANIZATION_ID for live paths.
 */

import path from "node:path";

import { getDb } from "@/db/client";
import type { WaiaDb } from "@/db/types";
import { createSqliteCredentialService } from "@/lib/trader/credentials";
import {
  createSqliteFeeComputationService,
  createSqliteHwmLedgerService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import {
  createExecutionLiveAuthorizationHook,
  createLiveConnectorForMode,
  createLiveHtxConnector,
  createSqliteOrgLiveEnableService,
  runLiveCycleOnce,
  type LiveCycleDeps,
} from "@/lib/trader/live";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { createSqliteStrategyPromotionService } from "@/lib/trader/validation-gate";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

type Flags = Map<string, string>;

const SUBCOMMANDS = ["request", "confirm", "mark-enabled", "disable", "status", "cycle"] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

function printUsage(): void {
  console.log(`Org-0 live execution operator CLI (DEE-212 / BP-7)

Usage:
  pnpm trader:live:<subcommand> -- [--flag=value ...]

Subcommands (trader:live:enable maps to request/confirm/mark-enabled):
  request       --org-id --actor-id --cap=<max_notional>
  confirm       --org-id --actor-id --expected-state-version --ack
  mark-enabled  --org-id --actor-id --expected-state-version
  disable       --org-id --actor-id --expected-state-version [--reason]
  status        --org-id
  cycle         --org-id --account-key --exchange-account-id --strategy --version --credential-id --fixture-path [--quantity] [--notional-cap]

Environment:
  DATABASE_URL                         SQLite database path (required)
  WAIA_TRADER_CLI=1                    Required safety gate
  WAIA_TRADER_ORG0_ORGANIZATION_ID     Org-0 allowlist (required for live cycle)
  WAIA_TRADER_EXECUTION_HOST_URL       Execution host /health URL (required for live cycle)`);
}

export function parseFlags(argv: string[], allowed: readonly string[]): Flags {
  const allowedSet = new Set(allowed);
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`[trader:live] unexpected positional argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    if (eq <= 2) {
      throw new Error(`[trader:live] flags must use --key=value form: ${arg}`);
    }
    const key = arg.slice(2, eq);
    if (!allowedSet.has(key)) {
      throw new Error(`[trader:live] unknown flag --${key}`);
    }
    flags.set(key, arg.slice(eq + 1));
  }
  return flags;
}

function requireFlag(flags: Flags, key: string): string {
  const value = flags.get(key)?.trim();
  if (!value) {
    throw new Error(`[trader:live] --${key} is required`);
  }
  return value;
}

function operatorActor(flags: Flags): { actorType: "admin"; actorId: string } {
  return { actorType: "admin", actorId: requireFlag(flags, "actor-id") };
}

function requireStateVersion(flags: Flags): number {
  const raw = requireFlag(flags, "expected-state-version");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("[trader:live] --expected-state-version must be a positive integer");
  }
  return parsed;
}

async function runRequest(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const cap = requireFlag(flags, "cap");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteOrgLiveEnableService(db);
  const updated = await service.requestEnable(operatorActor(flags), context, {
    maxNotionalCap: cap,
  });
  console.log(
    `[trader:live] requested orgId=${orgId} state=${updated.state} stateVersion=${updated.stateVersion} cap=${updated.maxNotionalCap}`,
  );
}

async function runConfirm(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const ack = requireFlag(flags, "ack");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteOrgLiveEnableService(db);
  const updated = await service.confirmEnable(operatorActor(flags), context, {
    expectedStateVersion: requireStateVersion(flags),
    ackPhrase: ack,
  });
  console.log(
    `[trader:live] confirmed orgId=${orgId} state=${updated.state} coolingOffEndsAt=${updated.coolingOffEndsAt?.toISOString() ?? "n/a"}`,
  );
}

async function runMarkEnabled(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteOrgLiveEnableService(db);
  const updated = await service.markEnabled(operatorActor(flags), context, {
    expectedStateVersion: requireStateVersion(flags),
  });
  console.log(
    `[trader:live] enabled orgId=${orgId} state=${updated.state} enabledAt=${updated.enabledAt?.toISOString() ?? "n/a"}`,
  );
}

async function runDisable(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteOrgLiveEnableService(db);
  const updated = await service.disable(operatorActor(flags), context, {
    expectedStateVersion: requireStateVersion(flags),
    reason: flags.get("reason") ?? null,
  });
  console.log(`[trader:live] disabled orgId=${orgId} state=${updated.state}`);
}

async function runStatus(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteOrgLiveEnableService(db);
  const preview = await service.preview(context);
  console.log(
    `[trader:live] status orgId=${orgId} state=${preview.state?.state ?? "DISABLED"} confirmable=${preview.confirmable} enableEligible=${preview.enableEligible} remainingMs=${preview.remainingMs}`,
  );
}

async function buildLiveCycleDeps(
  db: WaiaDb,
  credentialId: string,
  orgId: string,
): Promise<LiveCycleDeps> {
  const context = requireOrgContext(orgId);
  const writeAudit = (input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input);
  const nowMs = () => Date.now();
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const riskLimitsService = createSqliteRiskLimitsService(db);
  const promotionService = createSqliteStrategyPromotionService(db);
  const orgLiveEnableService = createSqliteOrgLiveEnableService(db);
  const credentialService = createSqliteCredentialService(db);

  const liveConnector = await createLiveHtxConnector({
    context,
    credentialId,
    credentialService,
  });
  const connectorForMode = createLiveConnectorForMode(liveConnector);

  const assertLiveAuthorized = createExecutionLiveAuthorizationHook({
    orgLiveEnableService,
    promotionService,
    killSwitchResolver,
    riskLimitsService,
    credentialService,
  });

  const riskEngine = createRiskEngineService({
    limitsService: riskLimitsService,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode,
    writeAudit,
    nowMs,
    assertLiveAuthorized,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode,
    nowMs,
    writeAudit,
  });

  const reportingBridge = createSqliteReportingPeriodLifecycleService(db);
  const feeComputation = createSqliteFeeComputationService(db);

  return {
    execution,
    reconciliation,
    reportingBridge,
    feeComputation,
    hwmLedger: createSqliteHwmLedgerService(db),
    orderRepository: repo,
  };
}

async function runCycle(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const accountKey = requireFlag(flags, "account-key");
  const exchangeAccountId = requireFlag(flags, "exchange-account-id");
  const strategyId = requireFlag(flags, "strategy");
  const strategyVersion = requireFlag(flags, "version");
  const credentialId = requireFlag(flags, "credential-id");
  const fixturePathRaw = requireFlag(flags, "fixture-path");
  const fixturePath = path.isAbsolute(fixturePathRaw)
    ? fixturePathRaw
    : path.join(process.cwd(), fixturePathRaw);

  const db = getDb();
  const context = requireOrgContext(orgId);
  const deps = await buildLiveCycleDeps(db, credentialId, orgId);
  const replay = new FixtureBarReplaySource({
    fixturePath,
    mode: "full",
    cycleIdPrefix: "live-cycle",
  });
  const next = replay.next();
  if (next.done) {
    throw new Error("[trader:live] fixture replay produced no snapshot");
  }
  const snapshot = next.snapshot;

  const orgLive = await createSqliteOrgLiveEnableService(db).getState(context);
  const result = await runLiveCycleOnce(deps, {
    context,
    snapshot,
    accountKey,
    exchangeAccountId,
    strategyId,
    strategyVersion,
    credentialId,
    defaultQuantity: flags.get("quantity") ?? "0.001",
    notionalCap: flags.get("notional-cap") ?? orgLive?.maxNotionalCap,
  });

  const evidence = {
    organizationId: orgId,
    strategySignalId: result.strategyStage?.strategySignalId ?? null,
    strategyId: result.strategyStage?.strategyId ?? null,
    strategyVersion: result.strategyStage?.strategyVersion ?? null,
    riskDecisionId:
      result.execution && result.execution.status === "submitted"
        ? result.execution.order.riskDecisionId
        : result.execution && "riskDecision" in result.execution
          ? (result.execution.riskDecision?.riskDecisionId ?? null)
          : null,
    orderId:
      result.execution && result.execution.status === "submitted"
        ? result.execution.order.id
        : null,
    orderState:
      result.execution && result.execution.status === "submitted"
        ? result.execution.order.state
        : null,
    exchangeOrderId:
      result.execution && result.execution.status === "submitted"
        ? result.execution.order.exchangeOrderId
        : null,
    reconciliationOutcomes: result.reconciliation?.outcomes ?? [],
    reportingPeriodId: result.reporting?.reportingPeriodId ?? null,
    realizedPnl: result.reporting?.realizedPnl ?? null,
    periodRealizedStrategyProfit: result.reporting?.periodRealizedStrategyProfit ?? null,
    submitBlocked: result.submitBlocked,
    skipReason: result.skipReason ?? null,
  };

  console.log(JSON.stringify(evidence, null, 2));
  if (result.submitBlocked) {
    throw new Error(`[trader:live] cycle blocked: ${result.skipReason ?? "unknown"}`);
  }
}

export const HANDLERS: Record<
  Subcommand,
  { allowed: string[]; run: (flags: Flags) => Promise<void> }
> = {
  request: {
    allowed: ["org-id", "actor-id", "cap"],
    run: runRequest,
  },
  confirm: {
    allowed: ["org-id", "actor-id", "expected-state-version", "ack"],
    run: runConfirm,
  },
  "mark-enabled": {
    allowed: ["org-id", "actor-id", "expected-state-version"],
    run: runMarkEnabled,
  },
  disable: {
    allowed: ["org-id", "actor-id", "expected-state-version", "reason"],
    run: runDisable,
  },
  status: {
    allowed: ["org-id"],
    run: runStatus,
  },
  cycle: {
    allowed: [
      "org-id",
      "account-key",
      "exchange-account-id",
      "strategy",
      "version",
      "credential-id",
      "fixture-path",
      "quantity",
      "notional-cap",
    ],
    run: runCycle,
  },
};

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("[trader:live] Refusing to run without WAIA_TRADER_CLI=1");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("[trader:live] DATABASE_URL is required");
  }

  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    return;
  }

  const subcommand = argv[0] as Subcommand;
  const handler = HANDLERS[subcommand];
  if (!handler) {
    printUsage();
    throw new Error(`[trader:live] unknown subcommand: ${subcommand}`);
  }

  const flags = parseFlags(argv.slice(1), handler.allowed);
  await handler.run(flags);
}

if (process.env.VITEST !== "true") {
  main().catch((err: unknown) => {
    console.error("[trader:live] FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
