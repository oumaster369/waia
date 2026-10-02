import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { withJoinedScheduledTransactionV1, withScheduledOwnedPostgresPoolV1 } from "./scheduled-owned-postgres-pool-v1";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { emitTraderTelemetry, type WaiaTraderTelemetryPayload } from "@/lib/observability/waia-trader-telemetry";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import {
  createPostgresOrderExecutionServiceFromExecutor,
  createPostgresReconciliationServiceFromExecutor,
  createPostgresStartupReconciliationRunnerFromExecutor,
} from "@/lib/trader/execution";
import { createOrdinaryPaperOrderRepositoryFromExecutorPostgres } from "@/lib/trader/execution/ordinary-paper-order-repository-postgres";
import { createUnqualifiedPaperDecisionCapitalAuthorityV2 } from "@/lib/trader/execution/v2/org-order-path";
import { computeSemanticSha256Hex, canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import type { Bar } from "@/lib/trader/intelligence/types";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import { getFreshnessThreshold } from "@/lib/trader/market-data/reliability/freshness-policy";
import { buildPaperBarCloseCycleCompletePayload } from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
import { resolveHtxInformationInquiryCycleV1, runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import { buildPreQualificationPaperEnvelope } from "@/lib/trader/paper/pre-qualification-paper-envelope";
import { loadPaperLoopConfig } from "@/lib/trader/paper/build-worker-deps";
import { buildMarkPricesFromSnapshot, buildPaperLoopPortfolioContext } from "@/lib/trader/paper/run-paper-loop-cycle";
import type { PaperLoopCycleReport, PaperLoopWorkerConfig } from "@/lib/trader/paper/paper-loop-worker.types";
import { defaultStopDistanceProvider, derivePortfolioAccountState, toAccountRiskState } from "@/lib/trader/portfolio";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createPostgresRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { mergeCronEnv } from "@/lib/trader/cron/worker-cron-env";

const DOMAIN = "SCHEDULED_PAPER_NO_TRADE_V1" as const;
const AUTHORITY = "NONCAPITAL_OPERATIONAL_RECEIPT_ONLY" as const;
const RECEIPT_SCHEMA = "waia.trader.scheduled_noncapital_cycle_receipt.v1" as const;
const ADVISORY_CLASS = 1_125_001;
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 8 * 1024;
// One technical budget for the entire public poll, including HTX retry delays.
const PUBLIC_POLL_DEADLINE_MS = 45_000;
const DATABASE_DEADLINE_MS = 60_000;
const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HeldTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type Identity = Readonly<{ organizationId: string; symbol: string; interval: string; closedBarUtc: string }>;
type ReceiptBinding = Readonly<{
  identity: Identity;
  accountKey: string;
  configDigest: string;
  releaseSha: string;
  inputDigest: string;
}>;
type ReceiptRow = {
  account_key: string;
  config_digest: string;
  release_sha: string;
  input_digest: string;
  receipt_digest: string;
  authority: string;
  report_json: string;
};

export type ScheduledNoncapitalOwnerResultV1 =
  | Readonly<{ status: "NOOP_DISABLED" | "BUSY"; report: null }>
  | Readonly<{ status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY"; report: PaperLoopCycleReport; receiptDigest: string }>
  | Readonly<{ status: "COMMIT_UNCERTAIN"; report: null }>;

/** Operational status only; cycle completion is emitted separately after confirmed commit. */
export function logScheduledNoncapitalOwnerStatusV1(result: ScheduledNoncapitalOwnerResultV1): void {
  try {
    if (result.status === "COMMIT_UNCERTAIN") {
      console.error(JSON.stringify({ event: "waia_paper_loop_owner", phase: "commit_uncertain", status: result.status }));
    } else if (result.status === "BUSY" || result.status === "REPLAYED" ||
               result.status === "CONFIRMED_AFTER_UNCERTAINTY") {
      console.info(JSON.stringify({ event: "waia_paper_loop_owner", phase: "owner_status", status: result.status }));
    }
  } catch {
    // Logging is observational and cannot change an already durable outcome.
  }
}

export class ScheduledNoncapitalOwnerRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ScheduledNoncapitalOwnerRefusedError";
  }
}

function refuse(reason: string): never {
  throw new ScheduledNoncapitalOwnerRefusedError(reason);
}

function canonicalOrganizationId(value: string): string {
  const scoped = requireOrgContext(value).organizationId;
  if (!UUID.test(scoped)) refuse("SCHEDULED_PAPER_ORG_INVALID");
  return scoped.toLowerCase();
}

function copyJson<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > MAX_INPUT_BYTES) {
    refuse("SCHEDULED_PAPER_INPUT_BUDGET_EXCEEDED");
  }
  return JSON.parse(encoded) as T;
}

function releaseSha(env: Readonly<Record<string, unknown>>): string {
  const primaryPresent = Object.hasOwn(env, "WAIA_RELEASE_SHA");
  const primary = primaryPresent ? env.WAIA_RELEASE_SHA : undefined;
  const vercel = env.VERCEL_GIT_COMMIT_SHA;
  if (primaryPresent && (typeof primary !== "string" || primary.trim() === "")) {
    refuse("SCHEDULED_PAPER_RELEASE_REQUIRED");
  }
  const selected = primaryPresent ? primary : vercel;
  if (typeof selected !== "string" || !FULL_SHA.test(selected.trim().toLowerCase())) {
    refuse("SCHEDULED_PAPER_RELEASE_REQUIRED");
  }
  const normalized = selected.trim().toLowerCase();
  if (vercel !== undefined && vercel !== null && String(vercel).trim() !== "" &&
      (!FULL_SHA.test(String(vercel).trim().toLowerCase()) || String(vercel).trim().toLowerCase() !== normalized)) {
    refuse("SCHEDULED_PAPER_RELEASE_CONFLICT");
  }
  return normalized;
}

function captureConfig(env: Readonly<Record<string, unknown>>): Readonly<{
  config: PaperLoopWorkerConfig;
  releaseSha: string | null;
  postgresUrl: string | null;
  configDigest: string | null;
}> {
  const loaded = loadPaperLoopConfig(env);
  if (!loaded.enabled) return Object.freeze({ config: Object.freeze({ ...loaded }), releaseSha: null, postgresUrl: null, configDigest: null });
  const config = Object.freeze({ ...loaded, organizationId: canonicalOrganizationId(loaded.organizationId) });
  if (Buffer.byteLength(config.accountKey, "utf8") > 256) refuse("SCHEDULED_PAPER_ACCOUNT_KEY_INVALID");
  const capturedRelease = releaseSha(env);
  const postgresUrl = env.DATABASE_URL_POSTGRES;
  if (typeof postgresUrl !== "string" || postgresUrl.trim() === "") {
    refuse("SCHEDULED_PAPER_POSTGRES_REQUIRED");
  }
  const configDigest = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.scheduled_paper_config.v1",
    ...config,
    htxRestHost: config.htxRestHost ?? null,
    portfolioRunConfig: {
      ...DEFAULT_PORTFOLIO_RUN_CONFIG,
      startingBalanceUsdt: config.startingBalanceUsdt,
      defaultStopDistancePct: config.defaultStopDistancePct,
    },
    riskLimits: DEFAULT_ORG_RISK_LIMITS,
  });
  return Object.freeze({ config, releaseSha: capturedRelease, postgresUrl: postgresUrl.trim(), configDigest });
}

function semanticPollProjection(bundle: GatewayPollResult): unknown {
  // cycleIndex/cycleId are per-process labels; all actual evaluation inputs remain.
  return {
    snapshot: {
      bars: bundle.snapshot.bars,
      quote: bundle.snapshot.quote,
      evaluatedAt: bundle.snapshot.evaluatedAt,
      activeStrategyIds: bundle.snapshot.activeStrategyIds ?? null,
    },
    fusedContext: bundle.fusedContext,
  };
}

/** Pure input check for proof fixtures; only the closed Worker entrypoint can own a DB phase. */
export function captureScheduledNoncapitalPolledBundleV1(bundle: GatewayPollResult, organizationId: string): Readonly<{
  bundle: GatewayPollResult;
  identity: Identity;
  inputDigest: string;
}> {
  const canonicalOrg = canonicalOrganizationId(organizationId);
  const copied = deepFreezeInquiry(copyJson(bundle));
  if (copied.informationAcquisition !== null || copied.snapshot.activeStrategyIds !== undefined) {
    refuse("SCHEDULED_PAPER_UNEXPECTED_INFORMATION_AUTHORITY");
  }
  const bars = copied.snapshot.bars;
  const last = bars.at(-1);
  if (!last || bars.length > 256 || bars.length < 1 || !last.symbol || !last.interval ||
      copied.snapshot.evaluatedAt !== last.barCloseTime ||
      copied.snapshot.quote.symbol !== last.symbol ||
      copied.fusedContext.instrumentId !== last.symbol ||
      copied.fusedContext.fusedAtUtc !== last.barCloseTime ||
      bars.some((bar: Bar, index: number) =>
        bar.symbol !== last.symbol || bar.interval !== last.interval ||
        !Number.isFinite(Date.parse(bar.barOpenTime)) ||
        !Number.isFinite(Date.parse(bar.barCloseTime)) ||
        Date.parse(bar.barOpenTime) >= Date.parse(bar.barCloseTime) ||
        (index > 0 && Date.parse(bars[index - 1]!.barCloseTime) >= Date.parse(bar.barCloseTime)))) {
    refuse("SCHEDULED_PAPER_BAR_IDENTITY_INVALID");
  }
  const identity = Object.freeze({
    organizationId: canonicalOrg,
    symbol: last.symbol,
    interval: last.interval,
    closedBarUtc: last.barCloseTime,
  });
  const inputDigest = computeSemanticSha256Hex(copyJson(semanticPollProjection(copied)));
  return Object.freeze({ bundle: copied, identity, inputDigest });
}

function receiptDigest(binding: ReceiptBinding, report: PaperLoopCycleReport): string {
  return computeSemanticSha256Hex({ schemaVersion: RECEIPT_SCHEMA, authority: AUTHORITY, domain: DOMAIN, ...binding, report });
}

function parseReport(value: unknown, identity: Identity): PaperLoopCycleReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("SCHEDULED_PAPER_RECEIPT_SHAPE_INVALID");
  const report = value as PaperLoopCycleReport;
  if (report.organizationId !== identity.organizationId ||
      (report.outcome !== "blocked" && report.outcome !== "skipped_no_signal") ||
      report.strategySubmittedCount !== 0 ||
      !Number.isSafeInteger(report.strategySignalCount) || report.strategySignalCount < 0 ||
      !Number.isSafeInteger(report.startupReconciledOrders) || report.startupReconciledOrders !== 0 ||
      !Number.isFinite(report.durationMs) || report.durationMs < 0 ||
      typeof report.cycleId !== "string") {
    refuse("SCHEDULED_PAPER_RECEIPT_SHAPE_INVALID");
  }
  return report;
}

async function readReceipt(ex: Pick<WaiaPostgresDb, "execute">, binding: ReceiptBinding): Promise<{
  report: PaperLoopCycleReport;
  digest: string;
} | null> {
  const { identity } = binding;
  const rows = await ex.execute<ReceiptRow>(sql`
    SELECT account_key,config_digest,release_sha,input_digest,receipt_digest,authority,
           report_json::text AS report_json
    FROM public.trader_scheduled_noncapital_cycle_receipts_v1
    WHERE organization_id=${identity.organizationId}::uuid AND ownership_domain=${DOMAIN}
      AND symbol=${identity.symbol} AND bar_interval=${identity.interval}
      AND closed_bar_utc=${identity.closedBarUtc}::timestamptz
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) refuse("SCHEDULED_PAPER_RECEIPT_CARDINALITY");
  const row = rows[0]!;
  if (row.account_key !== binding.accountKey || row.config_digest !== binding.configDigest ||
      row.release_sha !== binding.releaseSha || row.input_digest !== binding.inputDigest ||
      row.authority !== AUTHORITY || !DIGEST.test(row.receipt_digest) ||
      typeof row.report_json !== "string" || Buffer.byteLength(row.report_json, "utf8") > MAX_REPORT_BYTES) {
    refuse("SCHEDULED_PAPER_SAME_BAR_CONFLICT");
  }
  let decoded: unknown;
  try { decoded = JSON.parse(row.report_json); } catch { refuse("SCHEDULED_PAPER_RECEIPT_SHAPE_INVALID"); }
  const report = parseReport(decoded, identity);
  if (receiptDigest(binding, report) !== row.receipt_digest) refuse("SCHEDULED_PAPER_RECEIPT_DIGEST_INVALID");
  return { report, digest: row.receipt_digest };
}

function assertCurrentInputAtDatabaseTime(bundle: GatewayPollResult, nowMs: number): void {
  const last = bundle.snapshot.bars.at(-1)!;
  const barAgeMs = nowMs - Date.parse(last.barCloseTime);
  const quoteAgeMs = nowMs - Date.parse(bundle.snapshot.quote.timestamp);
  if (!Number.isFinite(barAgeMs) || barAgeMs < 0 ||
      barAgeMs > getFreshnessThreshold("ohlcv_bar").staleMs ||
      !Number.isFinite(quoteAgeMs) || quoteAgeMs < 0 ||
      quoteAgeMs > getFreshnessThreshold("quote_l1").staleMs) {
    refuse("SCHEDULED_PAPER_POLL_STALE");
  }
}

async function pollMandatoryBundleWithDeadline(config: PaperLoopWorkerConfig, organizationId: string): Promise<GatewayPollResult> {
  const controller = new AbortController();
  const fetchImpl: HtxFetchFn = (resource, init) => {
    if (controller.signal.aborted) refuse("SCHEDULED_PAPER_POLL_DEADLINE");
    if (resource instanceof Request || (init?.method ?? "GET").toUpperCase() !== "GET" ||
        init?.headers != null || init?.body != null || init?.credentials != null || init?.signal != null) {
      refuse("SCHEDULED_PAPER_PUBLIC_GET_ONLY");
    }
    return fetch(resource, { method: "GET", signal: controller.signal });
  };
  const poll = new HtxBarPollSource({
    cycleIdPrefix: config.cycleIdPrefix, restHost: config.htxRestHost, fetchImpl,
  });
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      reject(new ScheduledNoncapitalOwnerRefusedError("SCHEDULED_PAPER_POLL_DEADLINE"));
    }, PUBLIC_POLL_DEADLINE_MS);
  });
  try {
    const resolved = await Promise.race([
      resolveHtxInformationInquiryCycleV1({
        poll, expectedOrganizationId: organizationId, expectedAccountId: config.accountKey,
      }),
      deadline,
    ]);
    if (controller.signal.aborted) refuse("SCHEDULED_PAPER_POLL_DEADLINE");
    return resolved.bundle;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

async function refuseExistingOrdinaryOrders(tx: HeldTx, organizationId: string): Promise<void> {
  // A fresh seed connector is never proof of a prior simulated order's venue state.
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM public.trader_orders
    WHERE organization_id=${organizationId}::uuid
      AND historical_run_id IS NULL AND historical_account_key IS NULL
      AND execution_mode IN ('mock','paper')
    LIMIT 1
  `);
  if (rows.length > 0) refuse("SCHEDULED_PAPER_ORDINARY_RECOVERY_REQUIRED");
}

async function runHeldNoTradeCycle(input: Readonly<{
  tx: HeldTx;
  config: PaperLoopWorkerConfig;
  bundle: GatewayPollResult;
  telemetryLines: string[];
}>): Promise<Readonly<{ report: PaperLoopCycleReport; completion: WaiaTraderTelemetryPayload }>> {
  const { tx, config, bundle } = input;
  const context = requireOrgContext(config.organizationId);
  const telemetrySink = (line: string) => { input.telemetryLines.push(line); };
  const paperOrders = createOrdinaryPaperOrderRepositoryFromExecutorPostgres(tx, context.organizationId, "paper");
  const mockOrders = createOrdinaryPaperOrderRepositoryFromExecutorPostgres(tx, context.organizationId, "mock");
  const writeAudit = (audit: Parameters<typeof writeTraderAuditLogPostgres>[1]) => writeTraderAuditLogPostgres(tx, audit);
  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
  await createPostgresRiskLimitsService(tx).getOrCreateLimitsForOrg(context);
  const mockReconciliation = createPostgresReconciliationServiceFromExecutor(tx, {
    orderRepository: mockOrders,
    connectorForMode: () => connector,
    writeAudit,
    reconciliationTelemetrySink: telemetrySink,
  });
  const startup = await createPostgresStartupReconciliationRunnerFromExecutor(tx, {
    reconciliationService: mockReconciliation,
    reconciliationTelemetrySink: telemetrySink,
  }).runStartupReconciliation(context, "mock");
  if (startup.reconciliation.outcomes.length !== 0 || startup.escalation.escalationsAttempted !== 0) {
    refuse("SCHEDULED_PAPER_UNEXPECTED_RECONCILIATION");
  }
  const portfolio = buildPaperLoopPortfolioContext(config, buildMarkPricesFromSnapshot(bundle.snapshot.bars));
  const refresh = async () => {
    const state = await derivePortfolioAccountState({
      context, orderRepository: paperOrders, runConfig: portfolio.runConfig,
      limits: portfolio.limits, stopDistanceProvider: defaultStopDistanceProvider,
      executionMode: "paper", markPrices: portfolio.markPrices,
    });
    const openOrders = await paperOrders.listOpenOrders(context, { executionMode: "paper" });
    return toAccountRiskState({ portfolio: state, openOrderCount: openOrders.length });
  };
  const accountState = await refresh();
  const realExecution = createPostgresOrderExecutionServiceFromExecutor(tx);
  const execution = Object.freeze({
    ...realExecution,
    async submitOrder(): Promise<never> { refuse("SCHEDULED_PAPER_SUBMISSION_FORBIDDEN"); },
  });
  const paperReconciliation = createPostgresReconciliationServiceFromExecutor(tx, {
    orderRepository: paperOrders,
    connectorForMode: () => connector,
    writeAudit,
    reconciliationTelemetrySink: telemetrySink,
  });
  const startedMs = Date.now();
  const result = await runPaperCycleOnce({
    execution,
    reconciliation: paperReconciliation,
    decisionCapitalAuthorityV2: createUnqualifiedPaperDecisionCapitalAuthorityV2(),
    canonicalOrdinaryCapitalEnvelopeV2: buildPreQualificationPaperEnvelope(),
  }, {
    context, snapshot: bundle.snapshot, fusedContext: bundle.fusedContext,
    accountKey: config.accountKey, defaultQuantity: config.defaultQuantity,
    accountState, executionMode: "paper", telemetrySink,
    informationSufficiencyAuthority: undefined, orderRepository: paperOrders,
    refreshAccountStateBetweenStrategies: true, portfolio,
  });
  if (result.strategyExecutions.some((entry) => entry.execution !== null || !entry.submitBlocked) ||
      result.execution !== null ||
      result.canonicalOrdinaryCapitalCycleV2?.status === "EXECUTION_BOUND") {
    refuse("SCHEDULED_PAPER_ACTIONABLE_RESULT_FORBIDDEN");
  }
  let accountStateAfterCycle = accountState;
  let stateRefreshed = true;
  try { accountStateAfterCycle = await refresh(); } catch { stateRefreshed = false; }
  const report: PaperLoopCycleReport = Object.freeze({
    outcome: result.submitBlocked && result.skipReason === "no_signal" ? "skipped_no_signal" : "blocked",
    organizationId: context.organizationId,
    cycleId: bundle.snapshot.cycleId,
    strategySignalCount: result.strategyExecutions.length,
    strategySubmittedCount: 0,
    startupReconciledOrders: 0,
    stateRefreshed,
    accountStateStatus: stateRefreshed ? "current" : "stale",
    durationMs: Date.now() - startedMs,
  });
  const completion = buildPaperBarCloseCycleCompletePayload({
    organizationId: context.organizationId, cycleId: bundle.snapshot.cycleId,
    cyclesRun: 1, durationMs: report.durationMs, result,
    stateRefreshed, accountStateStatus: stateRefreshed ? "current" : "stale",
    accountStateAfterCycle, executionMode: "paper",
  });
  return Object.freeze({ report, completion });
}

async function insertReceipt(tx: HeldTx, binding: ReceiptBinding, report: PaperLoopCycleReport): Promise<string> {
  const digest = receiptDigest(binding, report);
  const reportJson = canonicalizeSemanticJsonString(report);
  if (Buffer.byteLength(reportJson, "utf8") > MAX_REPORT_BYTES) refuse("SCHEDULED_PAPER_REPORT_BUDGET_EXCEEDED");
  const { identity } = binding;
  const inserted = await tx.execute<{ receipt_digest: string }>(sql`
    INSERT INTO public.trader_scheduled_noncapital_cycle_receipts_v1
      (organization_id,ownership_domain,symbol,bar_interval,closed_bar_utc,account_key,
       config_digest,release_sha,input_digest,receipt_digest,authority,report_json)
    VALUES (${identity.organizationId}::uuid,${DOMAIN},${identity.symbol},${identity.interval},
            ${identity.closedBarUtc}::timestamptz,${binding.accountKey},${binding.configDigest},
            ${binding.releaseSha},${binding.inputDigest},${digest},${AUTHORITY},${reportJson}::jsonb)
    RETURNING receipt_digest
  `);
  if (inserted.length !== 1 || inserted[0]!.receipt_digest !== digest) refuse("SCHEDULED_PAPER_RECEIPT_INSERT_FAILED");
  return digest;
}

/** Closed scheduled Worker entrypoint; no caller-owned bars, ports, results or authority callbacks. */
export async function runScheduledNoncapitalPaperLoopFromEnv(
  explicitEnv?: Readonly<Record<string, unknown>>,
): Promise<ScheduledNoncapitalOwnerResultV1> {
  const captured = captureConfig(mergeCronEnv(explicitEnv as Record<string, unknown> | undefined));
  if (!captured.config.enabled) return { status: "NOOP_DISABLED", report: null };
  const { config } = captured;
  const organizationId = requireOrgContext(config.organizationId).organizationId;
  const release = captured.releaseSha!;
  const postgresUrl = captured.postgresUrl!;
  const configDigest = captured.configDigest!;
  const polled = await pollMandatoryBundleWithDeadline(config, organizationId);
  const capturedPoll = captureScheduledNoncapitalPolledBundleV1(polled, organizationId);
  const binding: ReceiptBinding = Object.freeze({
    identity: capturedPoll.identity, accountKey: config.accountKey,
    configDigest, releaseSha: release, inputDigest: capturedPoll.inputDigest,
  });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(
    new ScheduledNoncapitalOwnerRefusedError("SCHEDULED_PAPER_DATABASE_DEADLINE"),
  ), DATABASE_DEADLINE_MS);
  let awaitingCommit = false;
  const telemetryLines: string[] = [];
  try {
    let outcome:
      | { status: "BUSY"; report: null }
      | { status: "REPLAYED"; report: PaperLoopCycleReport; receiptDigest: string }
      | { status: "COMMITTED"; report: PaperLoopCycleReport; receiptDigest: string; completion: WaiaTraderTelemetryPayload };
    try {
      outcome = await withScheduledOwnedPostgresPoolV1(postgresUrl, controller.signal, async (client) => {
        const db = drizzle(client, { schema: pgSchema });
        return withJoinedScheduledTransactionV1<HeldTx, typeof outcome>((work) => db.transaction(work), async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
          const lock = await tx.execute<{ acquired: boolean }>(sql`
            SELECT pg_try_advisory_xact_lock(${ADVISORY_CLASS}::integer,hashtext(${organizationId}::text)) AS acquired
          `);
          if (lock.length !== 1 || typeof lock[0]!.acquired !== "boolean") refuse("SCHEDULED_PAPER_LOCK_INVALID");
          if (!lock[0]!.acquired) return { status: "BUSY" as const, report: null };
          const existing = await readReceipt(tx, binding);
          if (existing) return { status: "REPLAYED" as const, report: existing.report, receiptDigest: existing.digest };
          const clock = await tx.execute<{ now_ms: string }>(sql`SELECT (extract(epoch from clock_timestamp())*1000)::bigint::text AS now_ms`);
          if (clock.length !== 1) refuse("SCHEDULED_PAPER_DATABASE_CLOCK_INVALID");
          assertCurrentInputAtDatabaseTime(capturedPoll.bundle, Number(clock[0]!.now_ms));
          await refuseExistingOrdinaryOrders(tx, organizationId);
          const completed = await runHeldNoTradeCycle({ tx, config, bundle: capturedPoll.bundle, telemetryLines });
          const digest = await insertReceipt(tx, binding, completed.report);
          awaitingCommit = true;
          return { status: "COMMITTED" as const, report: completed.report, receiptDigest: digest, completion: completed.completion };
        });
      });
    } catch (error) {
      if (!awaitingCommit || error instanceof ScheduledNoncapitalOwnerRefusedError) throw error;
      // The callback returned, so an error may be a lost COMMIT acknowledgment.
      // Resolve using a genuinely new connection; absence remains uncertain.
      if (controller.signal.aborted) return { status: "COMMIT_UNCERTAIN", report: null };
      try {
        const exact = await withScheduledOwnedPostgresPoolV1(postgresUrl, controller.signal,
          (verifier) => readReceipt(drizzle(verifier, { schema: pgSchema }), binding));
        if (exact) return { status: "CONFIRMED_AFTER_UNCERTAINTY", report: exact.report, receiptDigest: exact.digest };
      } catch (readError) {
        if (readError instanceof ScheduledNoncapitalOwnerRefusedError) throw readError;
      }
      return { status: "COMMIT_UNCERTAIN", report: null };
    }
    if (outcome.status === "COMMITTED") {
      // The root transaction has acknowledged commit. Telemetry is observational:
      // a logging failure must never relabel a committed receipt as uncertain.
      for (const line of telemetryLines) {
        try { emitTraderTelemetry(JSON.parse(line) as WaiaTraderTelemetryPayload); } catch { /* committed receipt remains authoritative */ }
      }
      try { emitTraderTelemetry(outcome.completion); } catch { /* committed receipt remains authoritative */ }
      try {
        console.info(JSON.stringify({ event: "waia_paper_loop", phase: "cycle_complete", organizationId,
          outcome: outcome.report.outcome, cycleId: outcome.report.cycleId,
          strategySubmittedCount: 0, startupReconciledOrders: 0 }));
      } catch { /* committed receipt remains authoritative */ }
      return { status: "COMMITTED", report: outcome.report, receiptDigest: outcome.receiptDigest };
    }
    return outcome;
  } finally {
    clearTimeout(deadline);
  }
}
