/**
 * DEE-277 — Strategy Validation Gate operator runway (CLI, mock/paper evidence only).
 *
 * Minimal, governance-compliant operator surface over the EXISTING DEE-272 service
 * layer (ADR-0010 gate, ADR-0011 single-operator governance). It exposes the gate
 * PROCESS; it never decides whether a strategy deserves capital.
 *
 * The runway:
 *   - never computes an edge/profitability/ranking/scoring judgment
 *   - never auto-approves or auto-rejects
 *   - never writes promotion or audit rows directly (only via the service, which audits)
 *   - never exposes a cooling-off override (cooling-off is server-enforced)
 *   - stops at an EFFECTIVE record + a version-bound authorization boolean (no live orders)
 *
 * Subcommands:
 *   export    Generate a digest-sealed PaperEvaluationExportDocument from the paper DB
 *   request   Assemble + request a promotion (-> PENDING_CONFIRM)
 *   status    Preview a promotion record (state, cooling-off, eligibility)
 *   confirm   Confirm a promotion (-> COOLING_OFF); cooling-off from env/default only
 *   effective Mark a promotion effective (-> EFFECTIVE); requires elapsed cooling-off + typed --ack
 *   cancel    Cancel a pending/cooling-off promotion (-> CANCELLED)
 *   audit     Print the ordered immutable audit chain for a record
 *   authz     Check version-bound live authorization for a strategy (read-only)
 *   demote    Demote an effective promotion (-> REVOKED)
 *
 * Requires DATABASE_URL (SQLite) and WAIA_TRADER_CLI=1 (set by pnpm trader:gate).
 */

import fs from "node:fs";

import { getDb } from "@/db/client";
import { createSqliteOrderRepository } from "@/lib/trader/execution";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import { traderEntityTypes } from "@/lib/trader/types";
import {
  assertEffectiveAck,
  buildAssembleInput,
  createSqliteStrategyPromotionService,
  parseOperatorPromotionInputs,
  parsePaperEvaluationExportDocument,
  summarizePaperEvidence,
} from "@/lib/trader/validation-gate";
import type { PromotionActor } from "@/lib/trader/validation-gate";
import { listAuditLogsForEntitySqlite } from "@/lib/waia-core/audit/read";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

type Flags = Map<string, string>;

const SUBCOMMANDS = [
  "export",
  "request",
  "status",
  "confirm",
  "effective",
  "cancel",
  "audit",
  "authz",
  "demote",
] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

function printUsage(): void {
  console.log(`Strategy Validation Gate operator runway (DEE-277)

Usage:
  pnpm trader:gate -- <subcommand> [--flag=value ...]

Subcommands:
  export    --org-id --window-start --window-end --strategy-signal-ids --execution-mode [--out]
  request   --org-id --actor-id --evidence --inputs [--idempotency-key]
  status    --org-id --record-id
  confirm   --org-id --actor-id --record-id --expected-state-version
  effective --org-id --actor-id --record-id --expected-state-version --ack
  cancel    --org-id --actor-id --record-id --expected-state-version
  audit     --org-id --record-id
  authz     --org-id --strategy-id --strategy-version [--probe-version]
  demote    --org-id --actor-id --strategy-id --expected-state-version [--reason]

Environment:
  DATABASE_URL       SQLite database path (required)
  WAIA_TRADER_CLI=1  Required safety gate (set by pnpm trader:gate)

This CLI exposes the gate PROCESS. It does not decide whether a strategy deserves
capital. Cooling-off is server-enforced; there is no override flag.`);
}

export function parseFlags(argv: string[], allowed: readonly string[]): Flags {
  const allowedSet = new Set(allowed);
  const flags: Flags = new Map();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    if (eq === -1) {
      throw new Error(`Flag must be --key=value: ${arg}`);
    }
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    if (!allowedSet.has(key)) {
      throw new Error(`Unknown flag: --${key}`);
    }
    flags.set(key, value);
  }
  return flags;
}

function requireFlag(flags: Flags, key: string): string {
  const value = flags.get(key);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required flag: --${key}`);
  }
  return value;
}

function requireStateVersion(flags: Flags): number {
  const raw = requireFlag(flags, "expected-state-version");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--expected-state-version must be a non-negative integer");
  }
  return parsed;
}

function requireDate(flags: Flags, key: string): Date {
  const raw = requireFlag(flags, key);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--${key} must be an ISO date`);
  }
  return date;
}

function requireExecutionMode(flags: Flags): PaperBookExecutionMode {
  const raw = requireFlag(flags, "execution-mode");
  if (raw !== "mock" && raw !== "paper") {
    throw new Error("--execution-mode must be 'mock' or 'paper'");
  }
  return raw;
}

function operatorActor(flags: Flags): PromotionActor {
  return { actorType: "admin", actorId: requireFlag(flags, "actor-id") };
}

function readFile(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    throw new Error(`Cannot read file: ${path}`);
  }
}

async function runExport(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const window = {
    start: requireDate(flags, "window-start"),
    end: requireDate(flags, "window-end"),
  };
  const executionMode = requireExecutionMode(flags);
  const strategySignalIds = requireFlag(flags, "strategy-signal-ids")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (strategySignalIds.length === 0) {
    throw new Error("--strategy-signal-ids must list at least one id");
  }

  const db = getDb();
  const context = requireOrgContext(orgId);
  const orderRepository = createSqliteOrderRepository(db);

  const document = await buildPaperEvaluationExportDocument({
    context,
    orderRepository,
    window,
    strategySignalIds,
    executionMode,
    exportedAt: new Date(),
  });

  const summary = summarizePaperEvidence(document);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const outPath = flags.get("out");
  if (outPath && outPath.trim().length > 0) {
    fs.writeFileSync(outPath, serialized, "utf8");
    console.info(`[trader:gate] export written: ${outPath}`);
  } else {
    process.stdout.write(serialized);
  }

  console.error(
    `[trader:gate] summary executionMode=${summary.executionMode} window=${summary.window.start}..${summary.window.end} ` +
      `reconciliation=${summary.reconciliationStatus} closedTrades=${summary.closedTradeCount} ` +
      `noFillStrategies=[${summary.strategiesWithNoFills.join(",")}] digest=${document.envelope.contentDigest}`,
  );
  if (summary.insufficientEvidence) {
    console.error(
      `[trader:gate] ⚠ INSUFFICIENT_EVIDENCE — ${summary.insufficientReasons.join("; ")}\n` +
        `[trader:gate] ⚠ This is advisory. Export still generated. Promotion remains an operator judgment (ADR-0010).`,
    );
  }
}

async function runRequest(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const actor = operatorActor(flags);
  const document = parsePaperEvaluationExportDocument(readFile(requireFlag(flags, "evidence")));
  const inputs = parseOperatorPromotionInputs(readFile(requireFlag(flags, "inputs")));
  const assembly = buildAssembleInput({ organizationId: orgId, inputs, document });

  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const idempotencyKey = flags.get("idempotency-key");
  const record = await service.requestPromotion(actor, context, {
    idempotencyKey: idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : undefined,
    assembly,
  });

  console.log(
    `[trader:gate] requested recordId=${record.id} state=${record.state} stateVersion=${record.stateVersion} ` +
      `strategyId=${record.strategyId} strategyVersion=${record.strategyVersion}`,
  );
}

async function runStatus(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const recordId = requireFlag(flags, "record-id");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const preview = await service.previewPromotion(context, recordId);
  console.log(
    `[trader:gate] status recordId=${preview.record.id} state=${preview.record.state} ` +
      `stateVersion=${preview.record.stateVersion} coolingOffEndsAt=${preview.eligibleAt?.toISOString() ?? "n/a"} ` +
      `remainingMs=${preview.remainingMs} confirmable=${preview.confirmable} effectiveEligible=${preview.effectiveEligible}`,
  );
}

async function runConfirm(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const actor = operatorActor(flags);
  const recordId = requireFlag(flags, "record-id");
  const expectedStateVersion = requireStateVersion(flags);

  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  // No cooling-off override is accepted from the operator: cooling-off uses env/default.
  const record = await service.confirmPromotion(actor, context, recordId, { expectedStateVersion });
  console.log(
    `[trader:gate] confirmed recordId=${record.id} state=${record.state} stateVersion=${record.stateVersion} ` +
      `coolingOffEndsAt=${record.coolingOffEndsAt?.toISOString() ?? "n/a"}`,
  );
}

async function runEffective(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const actor = operatorActor(flags);
  const recordId = requireFlag(flags, "record-id");
  const expectedStateVersion = requireStateVersion(flags);
  assertEffectiveAck(flags.get("ack"));

  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const record = await service.markEffective(actor, context, recordId, { expectedStateVersion });
  console.log(
    `[trader:gate] effective recordId=${record.id} state=${record.state} stateVersion=${record.stateVersion} ` +
      `effectiveAt=${record.effectiveAt?.toISOString() ?? "n/a"}`,
  );
}

async function runCancel(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const actor = operatorActor(flags);
  const recordId = requireFlag(flags, "record-id");
  const expectedStateVersion = requireStateVersion(flags);

  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const record = await service.cancelPromotion(actor, context, recordId, { expectedStateVersion });
  console.log(`[trader:gate] cancelled recordId=${record.id} state=${record.state}`);
}

async function runAudit(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const recordId = requireFlag(flags, "record-id");
  const db = getDb();

  const rows = listAuditLogsForEntitySqlite(db, {
    organizationId: orgId,
    entityType: traderEntityTypes.strategyPromotion,
    entityId: recordId,
  });

  if (rows.length === 0) {
    console.log(`[trader:gate] audit recordId=${recordId} — no entries found`);
    return;
  }

  console.log(
    `[trader:gate] audit chain recordId=${recordId} (${rows.length} entries, oldest first):`,
  );
  for (const row of rows) {
    console.log(
      `  ${row.createdAt.toISOString()} action=${row.action} actorType=${row.actorType} actorId=${row.actorId ?? "n/a"}`,
    );
  }
}

async function runAuthz(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const strategyId = requireFlag(flags, "strategy-id");
  const strategyVersion = requireFlag(flags, "strategy-version");
  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const authorized = await service.isLiveAuthorized(context, { strategyId, strategyVersion });
  console.log(
    `[trader:gate] authz strategyId=${strategyId} strategyVersion=${strategyVersion} authorized=${authorized}`,
  );

  const probeVersion = flags.get("probe-version");
  if (probeVersion && probeVersion.length > 0) {
    const probe = await service.isLiveAuthorized(context, {
      strategyId,
      strategyVersion: probeVersion,
    });
    console.log(
      `[trader:gate] authz (probe) strategyId=${strategyId} strategyVersion=${probeVersion} authorized=${probe} ` +
        `(expected false unless it matches the effective version)`,
    );
  }
}

async function runDemote(flags: Flags): Promise<void> {
  const orgId = requireFlag(flags, "org-id");
  const actor = operatorActor(flags);
  const strategyId = requireFlag(flags, "strategy-id");
  const expectedStateVersion = requireStateVersion(flags);
  const reason = flags.get("reason");

  const db = getDb();
  const context = requireOrgContext(orgId);
  const service = createSqliteStrategyPromotionService(db);

  const record = await service.demoteStrategy(actor, context, strategyId, {
    expectedStateVersion,
    reason: reason && reason.length > 0 ? reason : undefined,
  });
  console.log(
    `[trader:gate] demoted strategyId=${strategyId} recordId=${record.id} state=${record.state}`,
  );
}

export const HANDLERS: Record<
  Subcommand,
  { allowed: string[]; run: (flags: Flags) => Promise<void> }
> = {
  export: {
    allowed: [
      "org-id",
      "window-start",
      "window-end",
      "strategy-signal-ids",
      "execution-mode",
      "out",
    ],
    run: runExport,
  },
  request: {
    allowed: ["org-id", "actor-id", "evidence", "inputs", "idempotency-key"],
    run: runRequest,
  },
  status: { allowed: ["org-id", "record-id"], run: runStatus },
  confirm: {
    allowed: ["org-id", "actor-id", "record-id", "expected-state-version"],
    run: runConfirm,
  },
  effective: {
    allowed: ["org-id", "actor-id", "record-id", "expected-state-version", "ack"],
    run: runEffective,
  },
  cancel: {
    allowed: ["org-id", "actor-id", "record-id", "expected-state-version"],
    run: runCancel,
  },
  audit: { allowed: ["org-id", "record-id"], run: runAudit },
  authz: {
    allowed: ["org-id", "strategy-id", "strategy-version", "probe-version"],
    run: runAuthz,
  },
  demote: {
    allowed: ["org-id", "actor-id", "strategy-id", "expected-state-version", "reason"],
    run: runDemote,
  },
};

function isSubcommand(value: string | undefined): value is Subcommand {
  return value !== undefined && (SUBCOMMANDS as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const first = argv[0];

  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    printUsage();
    return;
  }

  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error(
      "[trader:gate] Refusing to run without WAIA_TRADER_CLI=1 (use pnpm trader:gate)",
    );
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("[trader:gate] DATABASE_URL is required");
  }

  if (!isSubcommand(first)) {
    throw new Error(`Unknown subcommand: ${first} (expected one of ${SUBCOMMANDS.join(", ")})`);
  }

  const handler = HANDLERS[first];
  const flags = parseFlags(argv.slice(1), handler.allowed);
  await handler.run(flags);
}

if (process.env.VITEST !== "true") {
  main().catch((err: unknown) => {
    console.error("[trader:gate] FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
