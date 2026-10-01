import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { createAccountingFrontierRepositoryPostgres } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { buildHistoricalAccountingInceptionV2 } from "@/lib/trader/historical-simulation-v2/accounting-inception-v2";
import { createHistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { createHistoricalMockOrderRepositoryFromExecutor } from "@/lib/trader/execution/historical-mock-order-repository-postgres";
import { deterministicExecutionUuidV2, multiplyExecutionNotionalConservativelyV2 } from "@/lib/trader/execution/v2/contracts";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createAdvanceHistoricalModeledExecutionV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import {
  createHistoricalModeledExecutionRegistryV2,
  HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
  type HistoricalModeledExecutionReceiptV2,
} from "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import {
  buildHistoricalModeledPortfolioLifecycleV2,
  deriveHistoricalModeledRiskAccountingV2,
} from "@/lib/trader/historical-simulation-v2/historical-modeled-portfolio-reality-v2";
import {
  createHistoricalSimulationExecutionPersistenceV2,
  persistHistoricalModeledExecutionSubmissionV2,
} from "@/lib/trader/historical-simulation-v2/production-transaction-adapters-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { resolveDefaultStopDistance } from "@/lib/trader/portfolio/default-stop-distance-provider";
import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeResearchStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import { evaluateDrawdownPolicy } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { calculateRiskAdmissionV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import {
  addDecimal, compareDecimal, divideDecimal, multiplyDecimal, subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { evaluateResearchLookbackV1 } from "@/lib/trader/research/research-lookback-evaluator-v1";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "@/lib/trader/research/research-training-payload-postgres-v1";
import { resolveResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";

export const RESEARCH_TRAINING_DIAGNOSTIC_V1 = "waia.research.training-diagnostic.v1" as const;
const REQUEST = z.object({
  attemptId: z.string().uuid(), trialIndex: z.number().int().min(0).max(31),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();

function refuse(reason: string): never {
  throw new Error(`RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:${reason}`);
}

function assertNonnegativeCash(frontier: AccountingFrontierV1): void {
  // The canonical accounting engine represents arithmetic, including negative
  // cash. A spot-only research stage must not silently create simulated credit
  // when the next eligible fill gaps above the decision-bar affordability test.
  if (compareDecimal(frontier.cash, "0") < 0) refuse("NEGATIVE_CASH_AFTER_FILL");
}

function openPositions(frontier: AccountingFrontierV1) {
  return Object.entries(frontier.positions).filter(([, position]) =>
    compareDecimal(position.quantity, "0") > 0);
}

function sizingAccount(frontier: AccountingFrontierV1, runConfig: PortfolioRunConfig) {
  const positions = openPositions(frontier).map(([symbol, position]) => {
    const mark = frontier.marks[symbol];
    if (!mark || compareDecimal(mark.price, "0") <= 0) refuse("POSITION_MARK_MISSING");
    const avgCost = divideDecimal(position.netPositionBasis, position.quantity);
    const stop = resolveDefaultStopDistance({ entryPrice: avgCost, runConfig });
    const riskAtStopUsdt = multiplyDecimal(position.quantity, stop.stopDistanceUsdt);
    return Object.freeze({ symbol, quantity: position.quantity, avgCost, markPrice: mark.price,
      unrealizedPnlUsdt: multiplyDecimal(subtractDecimal(mark.price, avgCost), position.quantity),
      riskAtStopUsdt, stopDistanceUsdt: stop.stopDistanceUsdt });
  });
  return Object.freeze({ equityUsdt: frontier.equity, availableBalanceUsdt: frontier.cash,
    openRiskUsdt: positions.reduce((total, position) => addDecimal(total, position.riskAtStopUsdt), "0"),
    openPositionCount: positions.length, positions: Object.freeze(positions) });
}

type DiagnosticRow = Readonly<{
  organization_id: string; attempt_id: string; trial_index: number;
  stage_run_id: string; experiment_spec_sha256: string; scope_digest_hex: string;
  policy_digest_hex: string; trace_canonical_json: string; trace_sha256: string;
}>;
type VerifiedTrace = Readonly<Record<string, unknown> & {
  authority: "TRAINING_ENGINEERING_TRACE_ONLY"; capitalEligible: false; scientificQualified: false;
  stageRunId: string; scopeDigestHex: string; decisions: readonly unknown[];
  orders: readonly unknown[]; openPositions: readonly unknown[];
  equity: string; netUnrealizedPnl: string; strategyGuardianQualification: "UNQUALIFIED";
  accountGuardianQualification: "UNQUALIFIED";
  appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY";
  orderCount: number; fillCount: number; accountingSequence: number;
  finalAccountingDigestHex: string; ledgerDigestHex: string; traceSha256: string;
}>;

function verifyCommittedTrace(row: DiagnosticRow, expected: Readonly<{
  organizationId: string; attemptId: string; trialIndex: number; stageRunId: string;
  specSha256: string; scopeDigest: string; policyDigest: string;
}>) {
  if (row.organization_id !== expected.organizationId || row.attempt_id !== expected.attemptId ||
      row.trial_index !== expected.trialIndex || row.stage_run_id !== expected.stageRunId ||
      row.experiment_spec_sha256 !== expected.specSha256 || row.scope_digest_hex !== expected.scopeDigest ||
      row.policy_digest_hex !== expected.policyDigest) refuse("COMMITTED_SCOPE_MISMATCH");
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(row.trace_canonical_json) as Record<string, unknown>; }
  catch { return refuse("COMMITTED_TRACE_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      canonicalJsonString(parsed) !== row.trace_canonical_json ||
      computeStableJsonDigest(parsed) !== row.trace_sha256 ||
      parsed.authority !== "TRAINING_ENGINEERING_TRACE_ONLY" ||
      parsed.capitalEligible !== false || parsed.scientificQualified !== false ||
      parsed.organizationId !== expected.organizationId || parsed.attemptId !== expected.attemptId ||
      parsed.trialIndex !== expected.trialIndex || parsed.stageRunId !== expected.stageRunId ||
      parsed.scopeDigestHex !== expected.scopeDigest || parsed.policyDigestHex !== expected.policyDigest ||
      !Array.isArray(parsed.decisions) || !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.openPositions) || typeof parsed.equity !== "string" ||
      typeof parsed.netUnrealizedPnl !== "string" ||
      parsed.strategyGuardianQualification !== "UNQUALIFIED" ||
      parsed.accountGuardianQualification !== "UNQUALIFIED" ||
      parsed.appliedProtectionScope !== "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY" ||
      !Number.isSafeInteger(parsed.orderCount) || !Number.isSafeInteger(parsed.fillCount) ||
      !Number.isSafeInteger(parsed.accountingSequence) ||
      typeof parsed.finalAccountingDigestHex !== "string" ||
      typeof parsed.ledgerDigestHex !== "string") {
    refuse("COMMITTED_TRACE_INVALID");
  }
  return Object.freeze({ ...parsed, traceSha256: row.trace_sha256 }) as VerifiedTrace;
}

/** A non-qualifying diagnostic of one preregistered DEVELOPMENT trial. The
 * caller supplies no bars, results, policy, scorer, order port or authority
 * callback. All effects and the result share the locked root transaction. */
export async function runRegisteredResearchTrainingDiagnosticPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof REQUEST>,
) {
  assertResearchRootPostgresDbV1(db);
  const organizationId = requireOrgContext(context.organizationId).organizationId.toLowerCase();
  const request = REQUEST.parse(supplied);
  const captured = Object.freeze({ organizationId });
  const source = await loadRegisteredResearchTrainingExecutionInputPostgresV1(db, captured, request);
  const policy = resolveResearchTrainingPolicyV1(source.experiment.spec);
  const { scope } = source;
  const stageRunId = scope.ledgerScope.historicalRunId;
  const accountKey = scope.ledgerScope.historicalAccountKey;
  const expected = Object.freeze({ organizationId, attemptId: request.attemptId,
    trialIndex: request.trialIndex, stageRunId, specSha256: scope.identity.experimentSpecSha256,
    scopeDigest: scope.contentDigest, policyDigest: policy.guardianResolvedPolicySha256 });
  const model = createHistoricalExecutionModelV1();
  if (computeStableJsonDigest(model) !== policy.historicalExecutionModelSha256 ||
      source.bars.length > request.limits.maxBars || source.cycles.length !== source.bars.length) {
    refuse("MODEL_OR_INPUT_MISMATCH");
  }

  try {
  return await db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '180s'`);
    await tx.execute(sql`set local lock_timeout = '30s'`);
    await tx.execute(sql`set local time zone 'UTC'`);
    const [attempt] = await tx.execute<{ id: string; spec_sha256: string; source_run_id: string }>(sql`
      select id::text,spec_sha256,source_run_id from public.trader_research_attempts_v1
      where organization_id=${organizationId}::uuid and id=${request.attemptId}::uuid for update`);
    if (!attempt || attempt.spec_sha256 !== expected.specSha256 ||
        attempt.source_run_id !== source.sourceRunId) refuse("ATTEMPT_LOCK_IDENTITY");
    const [existing] = await tx.execute<DiagnosticRow>(sql`
      select organization_id::text,attempt_id::text,trial_index,stage_run_id::text,
        experiment_spec_sha256,scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
      from public.trader_research_training_diagnostics_v1
      where organization_id=${organizationId}::uuid and attempt_id=${request.attemptId}::uuid
        and trial_index=${request.trialIndex}`);
    const [ledger] = await tx.execute<{ order_count: string; fill_count: string;
      frontier_count: string; foreign_order_count: string; foreign_frontier_count: string }>(sql`
      select
        (select count(*)::text from public.trader_orders o where o.historical_run_id=${stageRunId}
          and o.organization_id=${organizationId}::uuid and o.historical_account_key=${accountKey}) as order_count,
        (select count(*)::text from public.trader_fills f join public.trader_orders o on o.id=f.order_id
          where o.historical_run_id=${stageRunId} and o.organization_id=${organizationId}::uuid
            and o.historical_account_key=${accountKey}) as fill_count,
        (select count(*)::text from public.trader_accounting_frontier a where a.run_id=${stageRunId}
          and a.organization_id=${organizationId}::uuid and a.account_key=${accountKey}) as frontier_count,
        (select count(*)::text from public.trader_orders o where o.historical_run_id=${stageRunId}
          and (o.organization_id<>${organizationId}::uuid or o.historical_account_key<>${accountKey})) as foreign_order_count,
        (select count(*)::text from public.trader_accounting_frontier a where a.run_id=${stageRunId}
          and (a.organization_id<>${organizationId}::uuid or a.account_key<>${accountKey})) as foreign_frontier_count`);
    if (!ledger || ledger.foreign_order_count !== "0" || ledger.foreign_frontier_count !== "0") {
      refuse("FOREIGN_STAGE_LEDGER");
    }
    // Exact durable material, including mutable parent state, lifecycle events,
    // fill economics and every accounting frontier. Counts alone permit a
    // same-row alteration to masquerade as the prior committed trace.
    const readLedgerDigest = async () => {
      const [value] = await tx.execute<{ digest: string }>(sql`
        select encode(sha256(convert_to(jsonb_build_object(
          'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
            from public.trader_orders o where o.organization_id=${organizationId}::uuid
              and o.historical_run_id=${stageRunId} and o.historical_account_key=${accountKey}),
          'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.order_id,e.seq), '[]'::jsonb)
            from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'fills', (select coalesce(jsonb_agg(to_jsonb(f) order by f.order_id,f.id), '[]'::jsonb)
            from public.trader_fills f join public.trader_orders o on o.id=f.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'economics', (select coalesce(jsonb_agg(to_jsonb(e) order by e.order_id,e.fill_id), '[]'::jsonb)
            from public.trader_fill_execution_economics e
            join public.trader_orders o on o.id=e.order_id
            where o.organization_id=${organizationId}::uuid and o.historical_run_id=${stageRunId}
              and o.historical_account_key=${accountKey}),
          'frontiers', (select coalesce(jsonb_agg(to_jsonb(a) order by a.accounting_sequence), '[]'::jsonb)
            from public.trader_accounting_frontier a where a.organization_id=${organizationId}::uuid
              and a.run_id=${stageRunId} and a.account_key=${accountKey})
        )::text, 'UTF8')), 'hex') as digest`);
      if (!value || !/^[a-f0-9]{64}$/.test(value.digest)) refuse("LEDGER_DIGEST_UNAVAILABLE");
      return value.digest;
    };
    if (existing) {
      const committed = verifyCommittedTrace(existing, expected);
      if (ledger.order_count !== String(committed.orderCount) ||
          ledger.fill_count !== String(committed.fillCount) ||
          ledger.frontier_count !== String(committed.accountingSequence)) {
        refuse("COMMITTED_LEDGER_DIVERGENT");
      }
      const [last] = await tx.execute<{ semantic_content_digest: string }>(sql`
        select semantic_content_digest from public.trader_accounting_frontier
        where organization_id=${organizationId}::uuid and account_key=${accountKey} and run_id=${stageRunId}
        order by accounting_sequence desc limit 1`);
      if (last?.semantic_content_digest !== committed.finalAccountingDigestHex) {
        refuse("COMMITTED_ACCOUNTING_DIVERGENT");
      }
      if (await readLedgerDigest() !== committed.ledgerDigestHex) {
        refuse("COMMITTED_LEDGER_DIVERGENT");
      }
      return committed;
    }
    if (ledger.order_count !== "0" || ledger.fill_count !== "0" || ledger.frontier_count !== "0") {
      refuse("UNCOMMITTED_STAGE_LEDGER_EXISTS");
    }

    const orders = createHistoricalMockOrderRepositoryFromExecutor(tx, scope.ledgerScope, {
      newId() { return deterministicExecutionUuidV2("report", { stageRunId, eventOrdinal: ++eventOrdinal }); },
      now() { return new Date(eventClock); },
    });
    const accountingRepository = createAccountingFrontierRepositoryPostgres(tx);
    let eventOrdinal = 0;
    let eventClock = source.bars[0]!.barOpenTime;
    let accounting = buildHistoricalAccountingInceptionV2({ organizationId, accountId: accountKey,
      runId: stageRunId, startingCash: policy.portfolio.runConfig.startingBalanceUsdt,
      frontierAsOf: eventClock });
    assertNonnegativeCash(accounting);
    accounting = await accountingRepository.append(captured, accounting);
    const exchange = createHistoricalSimulatedExchange(model);
    const registry = createHistoricalModeledExecutionRegistryV2();
    const cycleMap = new Map(source.cycles.map(cycle => [cycle.cycleId, cycle] as const));
    const decisions: Record<string, unknown>[] = [];
    const advances: Record<string, unknown>[] = [];
    const fillDetails: Record<string, unknown>[] = [];
    const advance = createAdvanceHistoricalModeledExecutionV2({ context: captured,
      accountKey, runId: stageRunId, exchange, executionRegistry: registry, model,
      persistence: createHistoricalSimulationExecutionPersistenceV2({ orders, model }),
      accountingRepository: Object.freeze({
        loadLatest: (...args: Parameters<typeof accountingRepository.loadLatest>) =>
          accountingRepository.loadLatest(...args),
        append: async (ctx: OrgContext, frontier: AccountingFrontierV1) => {
          assertNonnegativeCash(frontier);
          const persisted = await accountingRepository.append(ctx, frontier);
          accounting = persisted;
          return persisted;
        },
      }),
      resolveMarketCycle: async id => {
        const cycle = cycleMap.get(id);
        if (!cycle) refuse("CYCLE_NOT_REGISTERED");
        return cycle;
      },
      initialAccountingFrontier: async () => accounting,
      refreshAccountState: async () => ({
        positions: openPositions(accounting).map(([symbol, position]) => ({ symbol, quantity: position.quantity })),
        openOrderCount: exchange.listOpenOrders().length,
        dailyPnl: accounting.netRealizedPnl, drawdown: String(accounting.accountDrawdownBps),
        quoteExposureByCurrency: Object.freeze({}), availableBalanceUsdt: accounting.cash,
        equityUsdt: accounting.equity, openPositionCount: openPositions(accounting).length,
      }),
      reconcileOrder: async () => undefined,
      resolveLatestOrder: id => orders.getOrderById(captured, id),
      persistAdvanceEvidence: async bundle => {
        fillDetails.push(...bundle.fillDetails);
        advances.push(Object.freeze({ cycleId: bundle.cycleId,
          fillEvidence: bundle.fillEvidence, effects: bundle.effects }));
      },
    });

    const firstSourceBarIndex = source.cycles[0]!.barIndex;
    for (let index = 0; index < source.cycles.length; index += 1) {
      const cycle = source.cycles[index]!;
      const bar = source.bars[index]!;
      if (cycle.barIndex !== firstSourceBarIndex + index || cycle.closedBar.barCloseTime !== bar.barCloseTime) {
        refuse("CYCLE_INDEX_MISMATCH");
      }
      eventClock = bar.barCloseTime;
      await advance(cycle.cycleId);
      const signal = evaluateResearchLookbackV1({ parameters: scope.identity.parameters,
        bars: source.bars.slice(Math.max(0, index - 127), index + 1),
        symbol: source.experiment.spec.universe.symbol, interval: "1m", evaluatedAt: bar.barCloseTime });
      if (signal.action === "NONE") continue;
      const before = accounting;
      const held = before.positions[source.experiment.spec.universe.symbol]?.quantity ?? "0";
      const anyPending = exchange.listOpenOrders().length > 0;
      const action = signal.action === "BUY" ? "ENTER_LONG" : "CLOSE";
      const skip = anyPending ? "PENDING_ORDER" :
        signal.action === "BUY" && compareDecimal(held, "0") > 0 ? "ALREADY_LONG" :
        signal.action === "SELL" && compareDecimal(held, "0") <= 0 ? "NO_LONG_POSITION" : null;
      if (skip) {
        decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal, disposition: skip }));
        continue;
      }
      const account = sizingAccount(before, policy.portfolio.runConfig);
      if (signal.action === "BUY" && account.openPositionCount >= policy.portfolio.limits.maxConcurrentPositions) {
        decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal, disposition: "POSITION_LIMIT" }));
        continue;
      }
      const d20 = evaluateDrawdownPolicy({ equityUsdt: before.equity,
        accountPeakHwm: before.equityHwm,
        monthlyPeakHwm: before.monthlyPeakHwm ?? before.equityHwm }, policy.guardian.drawdownPolicy);
      const posture = d20.breachState === "STOP_ACCOUNT" ? "HALT" :
        d20.breachState === "CLOSE_ONLY" ? "CLOSE_ONLY" : "NORMAL";
      const sized = computeResearchStopBasedQuantity({ side: signal.action === "BUY" ? "buy" : "sell",
        symbol: source.experiment.spec.universe.symbol, entryPrice: bar.close,
        defaultQuantity: policy.declaredQuantityCap, account,
        limits: policy.portfolio.limits, runConfig: policy.portfolio.runConfig,
        costModel: policy.portfolio.costModel });
      if (!sized.ok) {
        decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal,
          disposition: sized.reason, accountD20: d20 }));
        continue;
      }
      const modeledAccounting = deriveHistoricalModeledRiskAccountingV2({ frontier: before,
        organizationId, accountId: accountKey, runId: stageRunId,
        exposureLimitNotional: before.equity, worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0" });
      const lifecycle = buildHistoricalModeledPortfolioLifecycleV2({ organizationId,
        accountId: accountKey, runId: stageRunId, cycleId: cycle.cycleId,
        symbol: source.experiment.spec.universe.symbol, action,
        quantity: sized.quantity, referencePrice: bar.close, accounting: modeledAccounting });
      const requestedReservationNotional = action === "ENTER_LONG" ?
        multiplyExecutionNotionalConservativelyV2(sized.quantity, bar.close) : "0";
      const admission = calculateRiskAdmissionV2({ accounting: modeledAccounting.accounting,
        requestedReservationNotional, posture,
        strictExposureReduction: lifecycle.strictExposureReduction, reconciliationStatus: "RECONCILED" });
      const decisionBody = Object.freeze({ schemaVersion: "waia.research.training-modeled-decision.v1",
        organizationId, attemptId: request.attemptId, trialIndex: request.trialIndex,
        stageRunId, scopeDigestHex: scope.contentDigest, cycleId: cycle.cycleId, index, sourceBarIndex: cycle.barIndex,
        signal, action, quantity: sized.quantity, stopDistanceUsdt: sized.stopDistanceUsdt,
        accountingFrontierDigestHex: before.semanticContentDigest, lifecycleDigestHex: lifecycle.contentDigestHex });
      const decisionDigest = computeSemanticSha256Hex(decisionBody);
      const decisionId = deterministicExecutionUuidV2("plan", { stageRunId, decisionDigest });
      const riskBody = Object.freeze({ schemaVersion: "waia.research.training-modeled-risk.v1",
        source: "MODELED_HISTORICAL", capitalEligible: false,
        decisionId, decisionDigest, accountingFrontierDigestHex: before.semanticContentDigest,
        lifecycleDigestHex: lifecycle.contentDigestHex, requestedReservationNotional,
        posture, accountD20: d20, admission });
      const riskDigest = computeSemanticSha256Hex(riskBody);
      if (admission.status === "REFUSED") {
        decisions.push(Object.freeze({ ...decisionBody, decisionId, decisionDigest,
          risk: riskBody, riskDigest, disposition: "RISK_VETO" }));
        continue;
      }
      const riskVerdictId = deterministicExecutionUuidV2("risk-event", { stageRunId, riskDigest });
      const modeledAllowanceId = deterministicExecutionUuidV2("risk-event", {
        kind: "research-modeled-only", stageRunId, riskVerdictId });
      const executionPlanId = deterministicExecutionUuidV2("plan", { stageRunId, decisionId, riskDigest });
      const executionAttemptId = deterministicExecutionUuidV2("attempt", { executionPlanId });
      const orderId = deterministicExecutionUuidV2("order", { executionAttemptId });
      const side = signal.action === "BUY" ? "buy" : "sell";
      const executionPlanContentDigestHex = computeSemanticSha256Hex({
        schemaVersion: "waia.research.training-modeled-plan.v1", executionPlanId,
        decisionId, decisionDigest, riskDigest, symbol: source.experiment.spec.universe.symbol,
        side, quantity: sized.quantity, modelDigest: policy.historicalExecutionModelSha256 });
      const executionAttemptContentDigestHex = computeSemanticSha256Hex({
        schemaVersion: "waia.research.training-modeled-attempt.v1", executionAttemptId,
        executionPlanId, executionPlanContentDigestHex, acceptedAtUtc: bar.barCloseTime });
      const orderContentDigestHex = computeSemanticSha256Hex({
        schemaVersion: "waia.research.training-modeled-order.v1", orderId,
        executionAttemptId, executionAttemptContentDigestHex, decisionDigest,
        symbol: source.experiment.spec.universe.symbol, side, quantity: sized.quantity });
      const executionBody = Object.freeze({ schemaVersion: HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
        source: "MODELED_HISTORICAL" as const, capitalEligible: false as const,
        executionPlanId, executionPlanContentDigestHex,
        executionAttemptId, executionAttemptContentDigestHex, orderId, orderContentDigestHex,
        decisionId, decisionContentDigestHex: decisionDigest, riskVerdictId,
        riskReceiptContentDigestHex: riskDigest,
        symbol: source.experiment.spec.universe.symbol, side, quantity: sized.quantity,
        decisionBarIndex: cycle.barIndex, acceptedAtUtc: bar.barCloseTime });
      const receipt = Object.freeze({ ...executionBody,
        contentDigestHex: computeSemanticSha256Hex(executionBody) }) satisfies HistoricalModeledExecutionReceiptV2;
      const accepted = await persistHistoricalModeledExecutionSubmissionV2({ context: captured,
        orders, organizationId, accountId: accountKey, runId: stageRunId,
        decisionId, riskAllowanceId: modeledAllowanceId, receipt });
      if (accepted.id !== orderId || accepted.state !== "ACCEPTED") refuse("ORDER_NOT_ACCEPTED");
      exchange.registerOrder(accepted, cycle.barIndex, Date.parse(bar.barCloseTime));
      registry.register(receipt);
      decisions.push(Object.freeze({ ...decisionBody, decisionId, decisionDigest,
        risk: riskBody, riskDigest, execution: receipt, disposition: "MODELED_ORDER_ACCEPTED" }));
    }
    const orderRows = await orders.listOrders(captured);
    const finalPositions = Object.entries(accounting.positions).filter(([, position]) =>
      compareDecimal(position.quantity, "0") > 0).map(([symbol, position]) => ({
      symbol, quantity: position.quantity, netPositionBasis: position.netPositionBasis,
      markPrice: accounting.marks[symbol]?.price ?? null }));
    const openOrderIds = exchange.listOpenOrders().map(entry => entry.order.id);
    const feePaid = fillDetails.reduce((sum, entry) => {
      const economics = entry.economics as { feeAmount: string };
      return addDecimal(sum, economics.feeAmount);
    }, "0");
    const remainingNetBasis = Object.values(accounting.positions).reduce((sum, position) =>
      addDecimal(sum, position.netPositionBasis), "0");
    const ledgerDigestHex = await readLedgerDigest();
    const trace = Object.freeze({ schemaVersion: RESEARCH_TRAINING_DIAGNOSTIC_V1,
      authority: "TRAINING_ENGINEERING_TRACE_ONLY" as const, capitalEligible: false as const,
      scientificQualified: false as const, strategyGuardianQualification: "UNQUALIFIED" as const,
      accountGuardianQualification: "UNQUALIFIED" as const,
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY" as const,
      sourceQualification: "NOT_ESTABLISHED" as const,
      organizationId, attemptId: request.attemptId, trialIndex: request.trialIndex,
      stageRunId, scopeDigestHex: scope.contentDigest,
      experimentSpecSha256: expected.specSha256,
      sourceRunId: source.sourceRunId, trainPartitionSha256: source.partition.contentSha256,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      historicalExecutionModelSha256: policy.historicalExecutionModelSha256,
      requestedExecutableSourceSha256: policy.requestedExecutableSourceSha256,
      requestedPointInTimeEvidenceSha256: policy.requestedPointInTimeEvidenceSha256,
      barCount: source.bars.length, orderCount: orderRows.length,
      fillCount: fillDetails.length, accountingSequence: accounting.accountingSequence,
      ledgerDigestHex,
      finalAccountingDigestHex: accounting.semanticContentDigest,
      cash: accounting.cash, grossRealizedPnl: accounting.grossRealizedPnl,
      netRealizedPnl: accounting.netRealizedPnl,
      netUnrealizedPnl: subtractDecimal(accounting.markedPositionValue, remainingNetBasis),
      markedPositionValue: accounting.markedPositionValue, equity: accounting.equity,
      accountDrawdownBps: accounting.accountDrawdownBps,
      monthlyDrawdownBps: accounting.monthlyDrawdownBps,
      feesPaid: feePaid, openPositions: Object.freeze(finalPositions),
      openOrderIds: Object.freeze(openOrderIds),
      orders: Object.freeze(orderRows.map(order => Object.freeze({ id: order.id, side: order.side,
        state: order.state, quantity: order.quantity, filledQuantity: order.filledQuantity,
        avgFillPrice: order.avgFillPrice, decisionId: order.allocationDecisionId }))),
      decisions: Object.freeze(decisions), advances: Object.freeze(advances),
      fillDetails: Object.freeze(fillDetails) });
    const traceCanonicalJson = canonicalJsonString(trace);
    if (Buffer.byteLength(traceCanonicalJson, "utf8") > 16 * 1024 * 1024) refuse("TRACE_BYTE_LIMIT");
    const traceSha256 = computeStableJsonDigest(trace);
    await tx.execute(sql`insert into public.trader_research_training_diagnostics_v1 (
      organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,
      scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    ) values (${organizationId}::uuid,${request.attemptId}::uuid,${request.trialIndex},
      ${stageRunId}::uuid,${expected.specSha256},${scope.contentDigest},
      ${policy.guardianResolvedPolicySha256},${traceCanonicalJson},${traceSha256})`);
    return Object.freeze({ ...trace, traceSha256 });
  }, { isolationLevel: "serializable" });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "40001") refuse("SERIALIZATION_RETRY_REQUIRED");
    if (code === "55P03") refuse("LOCK_TIMEOUT_RETRY_REQUIRED");
    throw error;
  }
}
