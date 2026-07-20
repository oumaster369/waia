/**
 * HC-3.5 Phase 1 — Postgres paper evaluation export (read-only).
 *
 * Generates a digest-sealed PaperEvaluationExportDocument from U1 Postgres order
 * history via the existing domain builder. For production launch evidence (HC-3.5
 * Step 1) — not SQLite replay / BP-5 process proof (use pnpm trader:gate export).
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:paper:export -- \
 *     --org-id=<uuid> \
 *     --window-start=2026-06-01T00:00:00.000Z \
 *     --window-end=2026-06-15T00:00:00.000Z \
 *     --strategy-signal-ids=mean_reversion_v0 \
 *     --execution-mode=paper \
 *     --out=./evidence.json
 *
 * Validate an existing export file (dry-run, no DB):
 *   pnpm trader:paper:export -- --validate=./evidence.json
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import fs from "node:fs";

import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { createPostgresOrderRepository } from "@/lib/trader/execution";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperEvaluationExportDocument } from "@/lib/trader/paper/paper-evaluation-export.types";
import { computePaperEvaluationExportDigest } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  OperatorEvidenceError,
  parsePaperEvaluationExportDocument,
  summarizePaperEvidence,
} from "@/lib/trader/validation-gate";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type PaperEvaluationExportCliFlags = Map<string, string>;

const LOG_PREFIX = "[trader:paper:export]";

const EXPORT_FLAG_KEYS = [
  "org-id",
  "window-start",
  "window-end",
  "strategy-signal-ids",
  "execution-mode",
  "out",
  "validate",
] as const;

export function printPaperEvaluationExportUsage(): void {
  console.log(`Postgres paper evaluation export (HC-3.5 Phase 1 — read-only)

Usage:
  pnpm trader:paper:export -- [export flags | --validate=<path>]

Export flags (all required except --out):
  --org-id=<uuid>
  --window-start=<ISO-8601>
  --window-end=<ISO-8601>
  --strategy-signal-ids=<id>[,<id>...]
  --execution-mode=mock|paper
  --out=<path>              Optional; default stdout

Validate existing export (no database):
  --validate=<path>         Parse + recompute digest; exit 0 on success

Environment (export mode):
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES      Non-empty Postgres connection URL
  WAIA_TRADER_CLI=1          Set by pnpm trader:paper:export

SQLite replay / BP-5 process proof remains: pnpm trader:gate -- export ...`);
}

export function parsePaperEvaluationExportFlags(
  argv: string[],
  allowed: readonly string[] = EXPORT_FLAG_KEYS,
): PaperEvaluationExportCliFlags {
  const allowedSet = new Set(allowed);
  const flags: PaperEvaluationExportCliFlags = new Map();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} Unexpected positional argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    if (eq === -1) {
      throw new Error(`${LOG_PREFIX} Flag must be --key=value: ${arg}`);
    }
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    if (!allowedSet.has(key)) {
      throw new Error(`${LOG_PREFIX} Unknown flag: --${key}`);
    }
    flags.set(key, value);
  }
  return flags;
}

function requireFlag(flags: PaperEvaluationExportCliFlags, key: string): string {
  const value = flags.get(key);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${LOG_PREFIX} Missing required flag: --${key}`);
  }
  return value;
}

function requireDate(flags: PaperEvaluationExportCliFlags, key: string): Date {
  const raw = requireFlag(flags, key);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${LOG_PREFIX} --${key} must be an ISO-8601 date`);
  }
  return date;
}

function requireExecutionMode(flags: PaperEvaluationExportCliFlags): PaperBookExecutionMode {
  const raw = requireFlag(flags, "execution-mode");
  if (raw !== "mock" && raw !== "paper") {
    throw new Error(`${LOG_PREFIX} --execution-mode must be 'mock' or 'paper'`);
  }
  return raw;
}

function parseStrategySignalIds(flags: PaperEvaluationExportCliFlags): string[] {
  const strategySignalIds = requireFlag(flags, "strategy-signal-ids")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (strategySignalIds.length === 0) {
    throw new Error(`${LOG_PREFIX} --strategy-signal-ids must list at least one id`);
  }
  return strategySignalIds;
}

export function assertPostgresExportDatabaseEnv(): void {
  const config = getResolvedWaiaDbRuntimeConfig();
  if (config.backend !== "postgres") {
    throw new Error(
      `${LOG_PREFIX} Export requires WAIA_DB_BACKEND=postgres and non-empty DATABASE_URL_POSTGRES.`,
    );
  }
}

/** Recompute digest — throws on mismatch. Used for operator dry-run validation. */
export function validatePaperEvaluationExportDocument(
  document: PaperEvaluationExportDocument,
): void {
  parsePaperEvaluationExportDocument(JSON.stringify(document));
  const recomputed = computePaperEvaluationExportDigest(document.evidenceBody);
  if (recomputed !== document.envelope.contentDigest) {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_DIGEST_MISMATCH",
      "Evidence contentDigest does not match evidenceBody",
    );
  }
}

export type BuildPaperEvaluationExportParams = {
  organizationId: string;
  orderRepository: OrderRepository;
  window: { start: Date; end: Date };
  strategySignalIds: string[];
  executionMode: PaperBookExecutionMode;
  exportedAt?: Date;
};

/** Domain export via existing builder — inject OrderRepository for tests. */
export async function buildPaperEvaluationExportForOrg(
  params: BuildPaperEvaluationExportParams,
): Promise<PaperEvaluationExportDocument> {
  return buildPaperEvaluationExportDocument({
    context: requireOrgContext(params.organizationId),
    orderRepository: params.orderRepository,
    window: params.window,
    strategySignalIds: params.strategySignalIds,
    executionMode: params.executionMode,
    exportedAt: params.exportedAt ?? new Date(),
  });
}

export async function exportPaperEvaluationFromPostgres(
  params: Omit<BuildPaperEvaluationExportParams, "orderRepository">,
): Promise<PaperEvaluationExportDocument> {
  assertPostgresExportDatabaseEnv();
  const runtime = await getWaiaRuntimeDb();
  try {
    if (runtime.kind !== "postgres") {
      throw new Error(
        `${LOG_PREFIX} Postgres backend requires WAIA_DB_BACKEND=postgres and DATABASE_URL_POSTGRES.`,
      );
    }
    const orderRepository = createPostgresOrderRepository(runtime.db);
    return buildPaperEvaluationExportForOrg({
      ...params,
      orderRepository,
    });
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}

function writeExportOutput(
  document: PaperEvaluationExportDocument,
  outPath: string | undefined,
): void {
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (outPath && outPath.trim().length > 0) {
    fs.writeFileSync(outPath, serialized, "utf8");
    console.info(`${LOG_PREFIX} export written: ${outPath}`);
  } else {
    process.stdout.write(serialized);
  }
}

function logExportSummary(document: PaperEvaluationExportDocument): void {
  const summary = summarizePaperEvidence(document);
  console.error(
    `${LOG_PREFIX} summary org=${document.envelope.organizationId} executionMode=${summary.executionMode} ` +
      `window=${summary.window.start}..${summary.window.end} reconciliation=${summary.reconciliationStatus} ` +
      `closedTrades=${summary.closedTradeCount} noFillStrategies=[${summary.strategiesWithNoFills.join(",")}] ` +
      `digest=${document.envelope.contentDigest}`,
  );
  if (summary.insufficientEvidence) {
    console.error(
      `${LOG_PREFIX} ⚠ INSUFFICIENT_EVIDENCE — ${summary.insufficientReasons.join("; ")}\n` +
        `${LOG_PREFIX} ⚠ Advisory only. Export still generated. Promotion remains operator judgment (ADR-0010).`,
    );
  }
}

export async function runPaperEvaluationExportCli(
  flags: PaperEvaluationExportCliFlags,
): Promise<void> {
  const validatePath = flags.get("validate")?.trim();
  if (validatePath) {
    const raw = fs.readFileSync(validatePath, "utf8");
    const document = parsePaperEvaluationExportDocument(raw);
    validatePaperEvaluationExportDocument(document);
    console.info(
      `${LOG_PREFIX} validate PASS org=${document.envelope.organizationId} digest=${document.envelope.contentDigest}`,
    );
    return;
  }

  const orgId = requireFlag(flags, "org-id");
  const document = await exportPaperEvaluationFromPostgres({
    organizationId: orgId,
    window: {
      start: requireDate(flags, "window-start"),
      end: requireDate(flags, "window-end"),
    },
    strategySignalIds: parseStrategySignalIds(flags),
    executionMode: requireExecutionMode(flags),
  });

  validatePaperEvaluationExportDocument(document);
  writeExportOutput(document, flags.get("out"));
  logExportSummary(document);
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error(`${LOG_PREFIX} Refusing to run without WAIA_TRADER_CLI=1`);
  }

  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printPaperEvaluationExportUsage();
    return;
  }

  const flags = parsePaperEvaluationExportFlags(argv);
  await runPaperEvaluationExportCli(flags);
}

if (process.env.VITEST !== "true") {
  main().catch((error: unknown) => {
    console.error(`${LOG_PREFIX} FAIL:`, error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
