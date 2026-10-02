/** Synthetic-only proof that DEE-1222 selects only complete issued DEVELOPMENT families. */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import { createResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { registerResearchIssuedAttemptPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";
import { startCommitAckLossProxy } from "@/tests/helpers/postgres-commit-ack-loss-proxy";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import { runResearchIssuedTrainingDiagnosticPostgresV2, selectResearchIssuedTrainingFamilyPostgresV1 } from
  "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";

const url = process.env.WAIA_DEE1222_POSTGRES_TEST_DATABASE_URL?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const LIMITS = Object.freeze({ maxBars: 64, maxBytes: 2_000_000, maxTraceBytes: 2_000_000 });
const FLAT_CLOSES = Array.from({ length: 11 }, () => 100);
const FAMILY = [
  { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" },
  { lookbackBars: 5, buyZscore: "-1.5", sellZscore: "0" },
] as const;

function compareExactDecimals(left: string, right: string): -1 | 0 | 1 {
  const parse = (value: string) => {
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new Error("DEE1222_TEST_DECIMAL_INVALID");
    const scale = match[3]?.length ?? 0;
    const magnitude = BigInt(`${match[2]}${match[3] ?? ""}`);
    return { scale, value: match[1] === "-" ? -magnitude : magnitude };
  };
  const a = parse(left);
  const b = parse(right);
  const scale = Math.max(a.scale, b.scale);
  const av = a.value * 10n ** BigInt(scale - a.scale);
  const bv = b.value * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/** The upstream qualification material is synthetic scaffolding, not provenance or scientific evidence. */
describe.skipIf(!enabled)("DEE-1222 complete issued DEVELOPMENT training family PostgreSQL", () => {
  let admin: postgres.Sql;
  const priorDbUrl = process.env.DATABASE_URL_POSTGRES;
  const priorWaiaRelease = process.env.WAIA_RELEASE_SHA;
  const priorVercelRelease = process.env.VERCEL_GIT_COMMIT_SHA;

  function sourceFixtureEnv(fixture: ReturnType<typeof createResearchDevelopmentSourceFixtureV1>) {
    const sourceUrl = new URL(url!);
    sourceUrl.username = "waia_research_source_writer_login";
    sourceUrl.password = "";
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", sourceUrl.toString());
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATASET_ROOT", fixture.datasetRoot);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH", fixture.qualificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH", fixture.runtimeRequalificationReceipt
      ? fixture.runtimeRequalificationReceiptPath : "");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_VOLUME_PATH", fixture.htxVolumeQualificationReceiptPath);
    vi.stubEnv("WAIA_RELEASE_SHA", fixture.releaseSha);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  }

  async function familyFixture(label: string, options: Readonly<{
    closes?: readonly number[];
    trials?: readonly { lookbackBars: number; buyZscore: string; sellZscore: string }[];
  }> = {}) {
    const source = createResearchDevelopmentSourceFixtureV1({ closes: options.closes ?? FLAT_CLOSES });
    sourceFixtureEnv(source);
    const prepared = await prepareResearchDevelopmentSourcePostgresV1({
      organizationId: ORG, commandId: `dee1222-${randomUUID()}`, symbol: "BTCUSDT",
      initialRecordIndex: 0, observationBarCount: 2, gapBarCount: 1, trainingBarCount: 8,
    });
    if (prepared.status !== "COMMITTED" || !prepared.issuance) {
      source.cleanup();
      throw new Error("DEE1222_SYNTHETIC_SOURCE_ISSUANCE_FAILED");
    }
    const issuance = prepared.issuance;
    const proposal = buildResearchExperimentProposalV1(ORG, label);
    const policy = deriveCurrentResearchTrainingPolicyV1();
    proposal.executable.sourceSha256 = resolveCurrentResearchExecutableIdentityV1().sourceSha256;
    proposal.hypothesis.observationEvidenceSha256 = [issuance.observation.contentSha256];
    proposal.hypothesis.observationCutoffMs = issuance.observation.lastCloseMs;
    proposal.universe.datasetSourceSha256 = issuance.qualificationReceiptDigest;
    proposal.universe.knownAtMs = issuance.observation.firstOpenMs;
    proposal.replay.volumeQualificationSha256 = issuance.volumeQualificationDigest;
    proposal.replay.portfolio = {
      startingBalanceUsdt: policy.portfolio.runConfig.startingBalanceUsdt,
      maxRiskPerTradePct: policy.portfolio.limits.maxRiskPerTradePct,
      maxPortfolioRiskPct: policy.portfolio.limits.maxPortfolioRiskPct,
      maxConcurrentPositions: policy.portfolio.limits.maxConcurrentPositions,
      maxNotional: policy.portfolio.limits.maxNotional, defaultStopDistancePct: null,
    };
    proposal.replay.guardian = { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000,
      enableExitEngine: false, htrAuthoritative: true,
      resolvedPolicySha256: policy.guardianResolvedPolicySha256 };
    proposal.replay.historicalExecutionModelSha256 = policy.historicalExecutionModelSha256;
    proposal.replay.defaultQuantity = "0.5";
    proposal.orderedTrials = [...(options.trials ?? FAMILY)];
    proposal.partitions.train = { contentSha256: issuance.training.contentSha256,
      firstOpenMs: issuance.training.firstOpenMs, lastCloseMs: issuance.training.lastCloseMs,
      barCount: issuance.training.barCount };
    const trainEnd = issuance.training.lastCloseMs;
    proposal.partitions.validation = { contentSha256: "2".repeat(64), firstOpenMs: trainEnd,
      lastCloseMs: trainEnd + 10 * 60_000, barCount: 10 };
    proposal.partitions.blind = { contentSha256: "3".repeat(64), firstOpenMs: trainEnd + 10 * 60_000,
      lastCloseMs: trainEnd + 20 * 60_000, barCount: 10 };
    proposal.partitions.walkForward = [{ contentSha256: "4".repeat(64), firstOpenMs: trainEnd,
      lastCloseMs: trainEnd + 10 * 60_000, barCount: 10 }];
    const experiment = await registerResearchExperimentPostgresV1(
      drizzle(admin, { schema: pgSchema }) as never, { organizationId: ORG }, proposal);
    const attempt = await registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
      specSha256: experiment.specSha256, sourceRunId: issuance.sourceRunId,
      commandId: `dee1222-attempt-${randomUUID()}` });
    return { source, issuance, experiment, attempt };
  }

  const runTrial = (f: Awaited<ReturnType<typeof familyFixture>>, trialIndex: number, targetUrl?: string) => {
    vi.stubEnv("DATABASE_URL_POSTGRES", targetUrl ?? url!);
    return runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
      attemptId: f.attempt.id, trialIndex, limits: { maxBars: LIMITS.maxBars, maxBytes: LIMITS.maxBytes } });
  };
  const selectFamily = (f: Awaited<ReturnType<typeof familyFixture>>, targetUrl?: string) => {
    vi.stubEnv("DATABASE_URL_POSTGRES", targetUrl ?? url!);
    return selectResearchIssuedTrainingFamilyPostgresV1({ organizationId: ORG,
      attemptId: f.attempt.id, limits: LIMITS });
  };

  async function resultCount(attemptId: string) {
    const [row] = await admin`select count(*)::int as count
      from public.trader_research_issued_training_diagnostics_v2
      where organization_id=${ORG}::uuid and attempt_id=${attemptId}::uuid`;
    return row!.count as number;
  }

  async function selectionCount(attemptId: string) {
    const [row] = await admin`select count(*)::int as count
      from public.trader_research_training_family_selections_v1
      where organization_id=${ORG}::uuid and attempt_id=${attemptId}::uuid`;
    return row!.count as number;
  }

  async function executionCounts() {
    const [row] = await admin`select
      (select count(*)::int from public.trader_orders where organization_id=${ORG}::uuid
        and historical_run_id is not null) as orders,
      (select count(*)::int from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as events,
      (select count(*)::int from public.trader_fills f join public.trader_orders o on o.id=f.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as fills,
      (select count(*)::int from public.trader_fill_execution_economics e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as economics,
      (select count(*)::int from public.trader_accounting_frontier where organization_id=${ORG}::uuid) as frontiers`;
    return [row!.orders, row!.events, row!.fills, row!.economics, row!.frontiers] as const;
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/waia_hsv2_it_dee1222_complete_training_family_v1") {
      throw new Error("DEE1222_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED");
    }
    admin = postgres(url!, { max: 8, prepare: false });
    const userId = randomUUID();
    await admin`insert into auth.users(id) values (${userId}::uuid) on conflict(id) do nothing`;
    await admin`insert into public.users(id,identity_label,email) values (${userId}::uuid,'DEE1222 synthetic',${`${userId}@waia.invalid`}) on conflict(id) do nothing`;
    await admin`insert into public.organizations(id,owner_user_id,kind,name)
      values (${ORG}::uuid,${userId}::uuid,'business','DEE1222 synthetic Org0') on conflict(id) do nothing`;
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
  }, 20_000);
  afterAll(async () => {
    try { await admin?.end({ timeout: 5 }); }
    finally {
      if (priorDbUrl === undefined) delete process.env.DATABASE_URL_POSTGRES;
      else process.env.DATABASE_URL_POSTGRES = priorDbUrl;
      if (priorWaiaRelease === undefined) delete process.env.WAIA_RELEASE_SHA;
      else process.env.WAIA_RELEASE_SHA = priorWaiaRelease;
      if (priorVercelRelease === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = priorVercelRelease;
      vi.unstubAllEnvs();
    }
  }, 20_000);
  beforeEach(() => vi.stubEnv("DATABASE_URL_POSTGRES", url!));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("WAIA_RELEASE_SHA", "d".repeat(40));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
  });

  it("selects a complete zero-trade family and replays the exact immutable receipt", async () => {
    const f = await familyFixture("complete-flat-family");
    try {
      const before = await executionCounts();
      for (const index of [0, 1]) {
        const diagnostic = await runTrial(f, index);
        expect(diagnostic.status).toBe("COMMITTED");
        expect(diagnostic.trace).toMatchObject({ orderCount: 0, fillCount: 0,
          scientificQualified: false, capitalEligible: false });
      }
      expect(await resultCount(f.attempt.id)).toBe(2);
      const afterDiagnostics = await executionCounts();
      expect(afterDiagnostics[0]).toBe(before[0]);
      expect(afterDiagnostics[2]).toBe(before[2]);
      const first = await selectFamily(f);
      const replay = await selectFamily(f);
      expect(first.status).toBe("COMMITTED");
      expect(replay.status).toBe("REPLAYED");
      expect(first.receipt).toBeTruthy();
      expect(first.receipt).toMatchObject({ schemaVersion: "waia.research.training-family-selection.v1",
        authority: "DEVELOPMENT_NONQUALIFYING_SELECTION_ONLY",
        scientificQualified: false, capitalEligible: false, selectedIndex: 0,
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        trials: [{ trialIndex: 0, parameters: FAMILY[0] }, { trialIndex: 1, parameters: FAMILY[1] }] });
      expect(replay.receipt).toEqual(first.receipt);
      const [stored] = await admin`select receipt_canonical_json,receipt_sha256
        from public.trader_research_training_family_selections_v1
        where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid`;
      if (!stored || !first.receipt) throw new Error("DEE1222_FAMILY_RECEIPT_ROW_MISSING");
      const { contentDigest, ...canonicalBody } = first.receipt;
      expect(stored.receipt_canonical_json).toBe(canonicalJsonString(canonicalBody));
      expect(stored.receipt_sha256).toBe(contentDigest);
      expect(await selectionCount(f.attempt.id)).toBe(1);
      expect(await executionCounts()).toEqual(afterDiagnostics);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("preserves exact metrics and selects the declared best complete trading trial", async () => {
    const tradingFamily = [
      { lookbackBars: 2, buyZscore: "-1.5", sellZscore: "0" },
      { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" },
    ] as const;
    const f = await familyFixture("complete-trading-family", {
      closes: [100, 100, 100, 100, 100, 100, 80, 90, 120, 121, 122],
      trials: tradingFamily,
    });
    try {
      const diagnostics = [];
      for (const index of [0, 1]) {
        const result = await runTrial(f, index);
        expect(result.status).toBe("COMMITTED");
        if (!result.trace) throw new Error("DEE1222_TRADING_DIAGNOSTIC_TRACE_MISSING");
        diagnostics.push(result.trace);
      }
      expect(diagnostics.some(trace => trace.fillCount > 0)).toBe(true);
      const diagnosticPnls = diagnostics.map(trace => trace.netRealizedPnl);
      if (typeof diagnosticPnls[0] !== "string" || typeof diagnosticPnls[1] !== "string") {
        throw new Error("DEE1222_TRADING_PNL_METRIC_MISSING");
      }
      expect(compareExactDecimals(diagnosticPnls[0]!, diagnosticPnls[1]!)).toBe(-1);
      const selected = await selectFamily(f);
      expect(selected.status).toBe("COMMITTED");
      if (!selected.receipt) throw new Error("DEE1222_TRADING_FAMILY_RECEIPT_MISSING");
      expect(selected.receipt.trials).toHaveLength(2);
      for (const [index, trace] of diagnostics.entries()) {
        expect(selected.receipt.trials[index]).toMatchObject({
          trialIndex: index, stageRunId: trace.stageRunId, traceSha256: trace.traceSha256,
          scopeDigestHex: trace.scopeDigestHex, ledgerDigestHex: trace.ledgerDigestHex,
          finalAccountingDigestHex: trace.finalAccountingDigestHex,
          netRealizedPnl: trace.netRealizedPnl, orderCount: trace.orderCount, fillCount: trace.fillCount,
          parameters: tradingFamily[index],
        });
      }
      const pnl = selected.receipt.trials.map(trial => trial.netRealizedPnl);
      const expectedIndex = compareExactDecimals(pnl[1]!, pnl[0]!) > 0 ? 1 : 0;
      expect(selected.receipt.selectedIndex).toBe(expectedIndex);
      expect(expectedIndex).toBe(1);
      expect(selected.receipt.selectedParameters).toEqual(tradingFamily[expectedIndex]);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses a missing declared trial without running it or selecting a partial family", async () => {
    const f = await familyFixture("missing-family-member");
    try {
      await runTrial(f, 0);
      const effects = await executionCounts();
      await expect(selectFamily(f)).rejects.toThrow("RESEARCH_FAMILY_SELECTION_REFUSED:COMPLETE_ISSUED_FAMILY_REQUIRED");
      expect(await resultCount(f.attempt.id)).toBe(1);
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(effects);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses the whole family when an actual diagnostic ends with an open position", async () => {
    const f = await familyFixture("open-position-family", {
      closes: [100, 100, 100, 100, 100, 100, 80, 80, 80, 80, 80],
      trials: [
        { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" },
        { lookbackBars: 5, buyZscore: "-1.5", sellZscore: "0" },
      ],
    });
    try {
      const traces = [];
      for (const index of [0, 1]) traces.push((await runTrial(f, index)).trace);
      const openTrace = traces.find(trace => (trace?.openPositions?.length ?? 0) > 0);
      expect(openTrace).toBeTruthy();
      const stageRunIds = traces.map(trace => trace?.stageRunId).filter((id): id is string => !!id);
      expect(stageRunIds).toHaveLength(2);
      const scopedOrders = [];
      for (const stageRunId of stageRunIds) {
        scopedOrders.push(...await admin`select state from public.trader_orders
          where organization_id=${ORG}::uuid and historical_run_id=${stageRunId}
            and historical_account_key=${`research-issued-stage:${stageRunId}`}`);
      }
      expect(scopedOrders.length).toBeGreaterThan(0);
      expect(scopedOrders.some(order => order.state === "FILLED")).toBe(true);
      expect(scopedOrders.every(order => ["FILLED", "CANCELLED", "REJECTED", "EXPIRED", "FAILED"]
        .includes(order.state))).toBe(true);
      const [residual] = await admin`select position_quantity_json,gross_position_basis_json,net_position_basis_json
        from public.trader_accounting_frontier where organization_id=${ORG}::uuid
          and account_key=${`research-issued-stage:${openTrace!.stageRunId}`} and run_id=${openTrace!.stageRunId}
        order by accounting_sequence desc limit 1`;
      expect(residual).toBeTruthy();
      expect(Object.values(residual!.position_quantity_json as Record<string, string>)
        .some(value => value !== "0")).toBe(true);
      expect(Object.values(residual!.gross_position_basis_json as Record<string, string>)
        .some(value => value !== "0")).toBe(true);
      expect(Object.values(residual!.net_position_basis_json as Record<string, string>)
        .some(value => value !== "0")).toBe(true);
      const before = await executionCounts();
      await expect(selectFamily(f)).rejects.toThrow("RESEARCH_FAMILY_SELECTION_REFUSED:FAMILY_TRIAL_NOT_TERMINAL_FLAT");
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(before);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("rejects a foreign-organization attempt before any modeled or selection effects", async () => {
    const f = await familyFixture("foreign-organization-family");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const before = await executionCounts();
      await expect(selectResearchIssuedTrainingFamilyPostgresV1({
        organizationId: randomUUID(), attemptId: f.attempt.id, limits: LIMITS,
      })).rejects.toThrow();
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(before);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses selection when current release identity differs from issued diagnostics", async () => {
    const f = await familyFixture("changed-current-release-family");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const before = await executionCounts();
      vi.stubEnv("WAIA_RELEASE_SHA", "e".repeat(40));
      await expect(selectFamily(f)).rejects.toThrow("RESEARCH_ISSUED_EXPERIMENT_SOURCE_BINDING_MISMATCH");
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(before);
    } finally {
      vi.stubEnv("WAIA_RELEASE_SHA", "d".repeat(40));
      f.source.cleanup();
    }
  }, 180_000);

  it("refuses selection after current accounting frontier corruption", async () => {
    const f = await familyFixture("corrupt-current-family-frontier");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const [diagnostic] = await admin`select trace_canonical_json::jsonb as trace
        from public.trader_research_issued_training_diagnostics_v2
        where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
      expect(diagnostic).toBeTruthy();
      const stageRunId = (diagnostic!.trace as Record<string, unknown>).stageRunId as string;
      const accountKey = `research-issued-stage:${stageRunId}`;
      const [frontier] = await admin`select id::text,cash from public.trader_accounting_frontier
        where organization_id=${ORG}::uuid and account_key=${accountKey} and run_id=${stageRunId}
        order by accounting_sequence desc limit 1`;
      expect(frontier).toBeTruthy();
      await admin`alter table public.trader_accounting_frontier
        disable trigger trader_accounting_frontier_block_update`;
      let frontierMutated = false;
      try {
        await admin`update public.trader_accounting_frontier set cash='999999'
          where id=${frontier!.id}::uuid`;
        frontierMutated = true;
        const before = await executionCounts();
        await expect(selectFamily(f)).rejects.toThrow("RESEARCH_ISSUED_TRAINING_REFUSED:COMMITTED_LEDGER_DIVERGENT");
        expect(await selectionCount(f.attempt.id)).toBe(0);
        expect(await executionCounts()).toEqual(before);
      } finally {
        if (frontierMutated) {
          await admin`update public.trader_accounting_frontier set cash=${frontier!.cash}
            where id=${frontier!.id}::uuid`;
        }
        await admin`alter table public.trader_accounting_frontier
          enable trigger trader_accounting_frontier_block_update`;
      }
      await expect(selectFamily(f)).resolves.toMatchObject({ status: "COMMITTED" });
      expect(await selectionCount(f.attempt.id)).toBe(1);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses the whole family when an actual diagnostic leaves a pending order", async () => {
    const f = await familyFixture("pending-order-family", {
      closes: [120, 121, 122, 100, 100, 100, 100, 100, 100, 100, 90],
      trials: [
        { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" },
        { lookbackBars: 5, buyZscore: "-1.5", sellZscore: "0" },
      ],
    });
    try {
      const diagnostics = [];
      for (const index of [0, 1]) diagnostics.push((await runTrial(f, index)).trace);
      const stageRunIds = diagnostics.map(trace => trace?.stageRunId).filter((id): id is string => !!id);
      expect(stageRunIds).toHaveLength(2);
      const [pending] = await admin`select id::text,state from public.trader_orders
        where organization_id=${ORG}::uuid and
          (historical_run_id=${stageRunIds[0]} or historical_run_id=${stageRunIds[1]})
          and state not in ('FILLED','CANCELLED','REJECTED','EXPIRED','FAILED') limit 1`;
      expect(pending).toBeTruthy();
      const before = await executionCounts();
      await expect(selectFamily(f)).rejects.toThrow("RESEARCH_FAMILY_SELECTION_REFUSED:FAMILY_TRIAL_NOT_TERMINAL_FLAT");
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(before);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses a self-resealed trace metric that no longer matches terminal accounting", async () => {
    const f = await familyFixture("resealed-family-metric");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const [stored] = await admin`select trial_index,trace_canonical_json,trace_sha256
        from public.trader_research_issued_training_diagnostics_v2
        where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
      expect(stored).toBeTruthy();
      const originalJson = stored!.trace_canonical_json;
      const originalDigest = stored!.trace_sha256;
      const original = JSON.parse(originalJson) as Record<string, unknown>;
      const forged = { ...original, netRealizedPnl: "1" };
      const canonical = canonicalJsonString(forged);
      await admin`alter table public.trader_research_issued_training_diagnostics_v2
        disable trigger research_issued_training_diagnostic_append_only`;
      try {
        await admin`update public.trader_research_issued_training_diagnostics_v2
          set trace_canonical_json=${canonical},trace_sha256=${computeStableJsonDigest(forged)}
          where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
        await expect(selectFamily(f)).rejects.toThrow("RESEARCH_FAMILY_SELECTION_REFUSED:METRIC_MISMATCH");
      } finally {
        await admin`update public.trader_research_issued_training_diagnostics_v2
          set trace_canonical_json=${originalJson},trace_sha256=${originalDigest}
          where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
        await admin`alter table public.trader_research_issued_training_diagnostics_v2
          enable trigger research_issued_training_diagnostic_append_only`;
      }
      expect(await selectionCount(f.attempt.id)).toBe(0);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("commits one identical family receipt for concurrent selection calls", async () => {
    const f = await familyFixture("concurrent-family-selection");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const results = await Promise.all([selectFamily(f), selectFamily(f)]);
      expect(results.map(result => result.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
      expect(results[0]!.receipt).toEqual(results[1]!.receipt);
      expect(await selectionCount(f.attempt.id)).toBe(1);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("rolls back the family receipt when its insert fails", async () => {
    const f = await familyFixture("family-insert-rollback");
    const trigger = `dee1222_family_fault_${randomUUID().replaceAll("-", "")}`;
    const fn = `${trigger}_fn`;
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      await admin.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'DEE1222_SYNTHETIC_FAMILY_INSERT_FAULT'; END; $$`);
      await admin.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.trader_research_training_family_selections_v1
        FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      const before = await executionCounts();
      await expect(selectFamily(f)).rejects.toThrow("DEE1222_SYNTHETIC_FAMILY_INSERT_FAULT");
      expect(await selectionCount(f.attempt.id)).toBe(0);
      expect(await executionCounts()).toEqual(before);
    } finally {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_training_family_selections_v1`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      f.source.cleanup();
    }
  }, 180_000);

  it("confirms a committed receipt after a real COMMIT acknowledgment is withheld", async () => {
    const f = await familyFixture("family-commit-ack-loss");
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(direct.port) });
    direct.port = String(proxy.port);
    direct.searchParams.set("sslmode", "disable");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const committed = await selectFamily(f, direct.toString());
      expect(committed.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(committed.receipt).toBeTruthy();
      expect(proxy.stats()).toMatchObject({ commitResponsesWithheld: 1, protocolErrors: 0 });
      expect(await selectionCount(f.attempt.id)).toBe(1);
    } finally { await proxy.close(); f.source.cleanup(); }
  }, 180_000);

  it("returns no receipt when confirmation is unavailable, then explicit retry replays", async () => {
    const f = await familyFixture("family-commit-ack-unavailable");
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(direct.port),
      refuseReconnectAfterCommitLoss: true, cleanEofOnRefusedReconnect: true });
    direct.port = String(proxy.port);
    direct.searchParams.set("sslmode", "disable");
    try {
      for (const index of [0, 1]) await runTrial(f, index);
      const uncertain = await selectFamily(f, direct.toString());
      expect(uncertain).toMatchObject({ status: "COMMIT_UNCERTAIN", receipt: null });
      expect(await selectionCount(f.attempt.id)).toBe(1);
      const replay = await selectFamily(f);
      expect(replay.status).toBe("REPLAYED");
      expect(replay.receipt).toBeTruthy();
      expect(await selectionCount(f.attempt.id)).toBe(1);
    } finally { await proxy.close(); f.source.cleanup(); }
  }, 210_000);
});
