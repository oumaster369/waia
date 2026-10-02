/** Synthetic PostgreSQL proof for the non-qualifying DEE-1159 training diagnostic. */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { sealHistoricalMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { Bar } from "@/lib/trader/intelligence/types";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import {
  loadResearchTrainingLedgerScopePostgresV1,
  registerResearchAttemptPostgresV1,
} from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "@/lib/trader/research/research-training-payload-postgres-v1";
import { evaluateResearchFeatureInvocationV1 } from "@/lib/trader/research/research-feature-invocation-v1";
import { runRegisteredResearchTrainingDiagnosticPostgresV1 } from "@/lib/trader/research/research-training-diagnostic-postgres-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const LIMITS = Object.freeze({ maxBars: 64, maxBytes: 2_000_000 });
const BAR_MS = 60_000;
const FIXTURE_RELEASE_SHA = "c".repeat(40);

describe.skipIf(!enabled || !url)("DEE-1159 registered training diagnostic PostgreSQL", () => {
  let ownerSql: postgres.Sql;
  let db: WaiaPostgresDb;
  const priorWaiaReleaseSha = process.env.WAIA_RELEASE_SHA;
  const priorVercelReleaseSha = process.env.VERCEL_GIT_COMMIT_SHA;

  function restoreReleaseEnvironment() {
    if (priorWaiaReleaseSha === undefined) delete process.env.WAIA_RELEASE_SHA;
    else process.env.WAIA_RELEASE_SHA = priorWaiaReleaseSha;
    if (priorVercelReleaseSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = priorVercelReleaseSha;
  }

  function setReleaseEnvironment(waia: string | undefined, vercel: string | undefined) {
    if (waia === undefined) delete process.env.WAIA_RELEASE_SHA;
    else process.env.WAIA_RELEASE_SHA = waia;
    if (vercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = vercel;
  }

  function makeBars(closes: readonly number[], volume = 10): Bar[] {
    const start = Date.parse(resolveFhvCanonicalPartitionInterval("development").startUtc);
    return closes.map((value, index) => {
      const prior = index === 0 ? value : closes[index - 1]!;
      return { symbol: "BTC/USDT", interval: "1m",
        barOpenTime: new Date(start + index * BAR_MS).toISOString(),
        barCloseTime: new Date(start + (index + 1) * BAR_MS).toISOString(),
        open: String(prior), high: String(Math.max(prior, value) + 1),
        low: String(Math.min(prior, value) - 1), close: String(value), volume: String(volume) };
    });
  }

  async function fixture(input: Readonly<{
    closes: readonly number[]; volume?: number; quantity?: string; label: string;
    trials?: readonly number[]; trainFromIndex?: number;
    executableSourceSha256?: string;
    registeredVariant?: "unsupported-guardian" | "non-null-sidecar";
  }>) {
    const userId = randomUUID();
    await ownerSql`insert into auth.users (id) values (${userId}::uuid) on conflict (id) do nothing`;
    await db.insert(pgSchema.users).values({ id: userId, identityLabel: input.label,
      email: `${userId}@waia.invalid`, passwordHash: null });
    const orgId = await ensureUserCoreSeedPostgres(db, { userId, displayName: input.label });
    const context = requireOrgContext(orgId);
    const runId = `dee1159-diagnostic-${randomUUID()}`;
    const bars = makeBars(input.closes, input.volume ?? 10);
    const trainBars = bars.slice(input.trainFromIndex ?? 0);
    const receipt = qualifyHtxKlineVolumeAuthority({ symbol: "BTCUSDT",
      qualifiedAtUtc: bars[0]!.barOpenTime,
      rows: [{ id: 1, open: 100, high: 201, low: 79, close: 100,
        amount: input.volume ?? 10, vol: 100 * (input.volume ?? 10), count: 1 }] });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    const partitionDigestHex = "4".repeat(64);
    const partitionRawSha256Hex = "5".repeat(64);
    for (const [index, bar] of bars.entries()) {
      const cycleId = `${runId}:DEVELOPMENT:BTCUSDT:${index}`;
      const cycle = sealHistoricalMarketCycleV2({ cycleId, barIndex: index,
        closedBar: bar, htxVolumeAuthorityReceipt: receipt,
        htxVolumeRaw: { amount: input.volume ?? 10, vol: 100 * (input.volume ?? 10) } });
      const body = { schemaVersion: "waia.trader.historical_dataset_membership.v2",
        organizationId: orgId, cycleId, datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1",
        datasetAuthorityDigestHex: receipt.qualificationReceiptDigest,
        qualificationReceiptDigestHex: receipt.qualificationReceiptDigest,
        partitionDigestHex, partitionRawSha256Hex, partition: "DEVELOPMENT",
        symbol: "BTCUSDT", recordIndex: index,
        barContentDigestHex: computeBarContentDigest(bar),
        sealedCycleContentDigestHex: cycle.contentDigestHex };
      const membership = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
      const authorityDigest = computeStableJsonDigest({ organizationId: orgId,
        runId, membership, sealedCycle: cycle });
      await ownerSql`insert into public.trader_historical_dataset_authority_v2 (
        organization_id,run_id,cycle_id,dataset_authority_class,
        dataset_authority_digest_hex,membership_content_digest_hex,
        sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
        authority_content_digest_hex,schema_version
      ) values (${orgId}::uuid,${runId},${cycleId},'PRE_HOLDOUT_QUALIFICATION_V1',
        ${receipt.qualificationReceiptDigest},${membership.contentDigestHex},
        ${cycle.contentDigestHex},${JSON.stringify(membership)}::text::jsonb,
        ${JSON.stringify(cycle)}::text::jsonb,${authorityDigest},
        'waia.trader.historical_dataset_authority.v2')`;
    }
    const proposal = buildResearchExperimentProposalV1(orgId, input.label);
    proposal.executable.sourceSha256 = input.executableSourceSha256 ??
      resolveCurrentResearchExecutableIdentityV1().sourceSha256;
    const policy = deriveCurrentResearchTrainingPolicyV1();
    proposal.orderedTrials = (input.trials ?? [4, 8]).map(lookbackBars => ({
      lookbackBars, buyZscore: "-1.5", sellZscore: "0" }));
    proposal.universe.datasetSourceSha256 = receipt.qualificationReceiptDigest;
    proposal.replay.volumeQualificationSha256 = receipt.qualificationReceiptDigest;
    proposal.replay.portfolio = { startingBalanceUsdt: policy.portfolio.runConfig.startingBalanceUsdt,
      maxRiskPerTradePct: policy.portfolio.limits.maxRiskPerTradePct,
      maxPortfolioRiskPct: policy.portfolio.limits.maxPortfolioRiskPct,
      maxConcurrentPositions: policy.portfolio.limits.maxConcurrentPositions,
      maxNotional: policy.portfolio.limits.maxNotional, defaultStopDistancePct: null };
    proposal.replay.guardian = { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000,
      enableExitEngine: false, htrAuthoritative: true,
      resolvedPolicySha256: policy.guardianResolvedPolicySha256 };
    proposal.replay.historicalExecutionModelSha256 = policy.historicalExecutionModelSha256;
    proposal.replay.defaultQuantity = input.quantity ?? "0.5";
    proposal.partitions.train = { contentSha256: computeBarSetDigest(trainBars),
      firstOpenMs: Date.parse(trainBars[0]!.barOpenTime),
      lastCloseMs: Date.parse(trainBars.at(-1)!.barCloseTime), barCount: trainBars.length };
    const validationStart = proposal.partitions.train.lastCloseMs;
    proposal.partitions.validation = { contentSha256: "6".repeat(64),
      firstOpenMs: validationStart, lastCloseMs: validationStart + 6 * BAR_MS, barCount: 6 };
    proposal.partitions.blind = { contentSha256: "7".repeat(64),
      firstOpenMs: validationStart + 6 * BAR_MS,
      lastCloseMs: validationStart + 12 * BAR_MS, barCount: 6 };
    proposal.partitions.walkForward = [{ contentSha256: "8".repeat(64),
      firstOpenMs: validationStart, lastCloseMs: validationStart + 6 * BAR_MS, barCount: 6 }];
    if (input.registeredVariant === "unsupported-guardian") {
      proposal.replay.guardian.maxHoldBars = 1;
    } else if (input.registeredVariant === "non-null-sidecar") {
      Object.assign(proposal.universe, { sidecarContentSha256: "9".repeat(64) });
    }
    const experiment = await registerResearchExperimentPostgresV1(db, context, proposal);
    const attempt = await registerResearchAttemptPostgresV1(db, context, {
      specSha256: experiment.specSha256, sourceRunId: runId,
      commandId: `diagnostic-${randomUUID()}` });
    return { orgId, context, bars, trainBars, experiment, attempt };
  }

  const run = (f: Awaited<ReturnType<typeof fixture>>, trialIndex: number,
    attemptId = f.attempt.id, targetDb: WaiaPostgresDb = db) =>
    runRegisteredResearchTrainingDiagnosticPostgresV1(targetDb, f.context,
      { attemptId, trialIndex, limits: LIMITS });

  async function stageWriteCounts(f: Awaited<ReturnType<typeof fixture>>) {
    const scope = await loadResearchTrainingLedgerScopePostgresV1(db, f.context,
      { attemptId: f.attempt.id, trialIndex: 0 });
    const runId = scope.ledgerScope.historicalRunId;
    const rows = await ownerSql`select
      (select count(*)::int from public.trader_research_training_diagnostics_v1
        where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid) as diagnostics,
      (select count(*)::int from public.trader_orders
        where organization_id=${f.orgId}::uuid and historical_run_id=${runId}) as orders,
      (select count(*)::int from public.trader_fills fill join public.trader_orders o on o.id=fill.order_id
        where o.organization_id=${f.orgId}::uuid and o.historical_run_id=${runId}) as fills,
      (select count(*)::int from public.trader_accounting_frontier
        where organization_id=${f.orgId}::uuid and run_id=${runId}) as frontiers`;
    return [rows[0]!.diagnostics, rows[0]!.orders, rows[0]!.fills, rows[0]!.frontiers];
  }

  beforeAll(() => {
    setReleaseEnvironment(FIXTURE_RELEASE_SHA, FIXTURE_RELEASE_SHA);
    ownerSql = postgres(url!, { max: 8, prepare: false });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
  });
  afterAll(async () => {
    try { await ownerSql?.end({ timeout: 5 }); }
    finally { restoreReleaseEnvironment(); }
  });
  afterEach(() => setReleaseEnvironment(FIXTURE_RELEASE_SHA, FIXTURE_RELEASE_SHA));

  it("canonicalizes uppercase UUID attempt IDs across the initial commit and exact retries", async () => {
    const f = await fixture({ label: "uppercase-attempt-id", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const uppercaseAttemptId = f.attempt.id.toUpperCase();
    const first = await run(f, 0, uppercaseAttemptId);
    const uppercaseRetry = await run(f, 0, uppercaseAttemptId);
    const lowercaseRetry = await run(f, 0, f.attempt.id.toLowerCase());
    const expectedExecutableIdentity = resolveCurrentResearchExecutableIdentityV1();
    const observedExecutableIdentity = first.observedExecutableIdentity as ReturnType<
      typeof resolveCurrentResearchExecutableIdentityV1>;

    expect(first).toEqual(uppercaseRetry);
    expect(first).toEqual(lowercaseRetry);
    expect(first.attemptId).toBe(f.attempt.id.toLowerCase());
    expect(observedExecutableIdentity).toEqual(expectedExecutableIdentity);
    expect(observedExecutableIdentity.sourceSha256).toBe(f.experiment.spec.executable.sourceSha256);
    const [stored] = await ownerSql`select attempt_id::text as attempt_id,trace_canonical_json
      from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
    expect(stored!.attempt_id).toBe(f.attempt.id.toLowerCase());
    expect(JSON.parse(stored!.trace_canonical_json)).toMatchObject({
      attemptId: f.attempt.id.toLowerCase(), observedExecutableIdentity: expectedExecutableIdentity,
    });
    const [counts] = await ownerSql`select
      (select count(*)::int from public.trader_research_training_diagnostics_v1
        where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0) as results,
      (select count(*)::int from public.trader_orders
        where organization_id=${f.orgId}::uuid and historical_run_id=${first.stageRunId}) as orders,
      (select count(*)::int from public.trader_fills fill join public.trader_orders o on o.id=fill.order_id
        where o.organization_id=${f.orgId}::uuid and o.historical_run_id=${first.stageRunId}) as fills`;
    expect(counts!.results).toBe(1);
    expect(counts!.orders).toBe(Number(first.orderCount));
    expect(counts!.fills).toBe(Number(first.fillCount));
  }, 120_000);

  it("rejects caller-supplied payload, stage, score and ports before any database read", async () => {
    const f = await fixture({ label: "public-request-strict", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    let queryCount = 0;
    const monitoredSql = postgres(url!, {
      max: 1, prepare: false, debug: () => { queryCount += 1; },
    });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      const request = { attemptId: f.attempt.id, trialIndex: 0, limits: LIMITS };
      const forbidden = {
        bars: f.trainBars,
        cycles: [{ cycleId: "caller-cycle" }],
        stageKind: "blind",
        score: "caller-pass",
        result: { scientificQualified: true },
        repository: { owner: "caller" },
        policy: { capitalEligible: true },
      } as const;
      for (const [key, value] of Object.entries(forbidden)) {
        await expect(runRegisteredResearchTrainingDiagnosticPostgresV1(
          monitoredDb, f.context, { ...request, [key]: value },
        )).rejects.toMatchObject({ name: "ZodError" });
        expect(queryCount).toBe(0);
      }
    } finally {
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("rejects a preregistered executable mismatch after metadata preflight but before payload or stage writes", async () => {
    const f = await fixture({ label: "registered-executable-mismatch",
      executableSourceSha256: "f".repeat(64), trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:EXECUTABLE_IDENTITY_MISMATCH");
      expect(queryTexts.some(query => query.includes("trader_research_attempts_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_research_experiments_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_historical_dataset_authority_v2"))).toBe(false);
      expect(queryTexts.some(query => /insert\s+into\s+public\.trader_(orders|fills|accounting_frontier|research_training_diagnostics_v1)/i.test(query))).toBe(false);
      expect(await stageWriteCounts(f)).toEqual([0, 0, 0, 0]);
    } finally {
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it.each([
    { variant: "unsupported-guardian", refusal: /RESEARCH_TRAINING_POLICY_REFUSED:UNSUPPORTED_GUARDIAN/ },
    { variant: "non-null-sidecar", refusal: /RESEARCH_TRAINING_POLICY_REFUSED:SIDECAR_UNSUPPORTED/ },
  ] as const)("refuses registered $variant before authority payload reads or stage effects", async ({ variant, refusal }) => {
    const f = await fixture({ label: `prepayload-${variant}`, registeredVariant: variant,
      trials: [4], closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      await expect(run(f, 0, f.attempt.id, monitoredDb)).rejects.toThrow(refusal);
      expect(queryTexts.some(query => query.includes("trader_research_attempts_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_research_experiments_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_historical_dataset_authority_v2"))).toBe(false);
      expect(queryTexts.some(query => /insert\s+into\s+public\.trader_(orders|fills|accounting_frontier|research_training_diagnostics_v1)/i.test(query))).toBe(false);
      expect(await stageWriteCounts(f)).toEqual([0, 0, 0, 0]);
    } finally {
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("refuses missing and conflicting trusted release assertions before any database read", async () => {
    const f = await fixture({ label: "runtime-release-preflight", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      setReleaseEnvironment(undefined, undefined);
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_MISSING_OR_INVALID");
      expect(queryTexts).toEqual([]);

      setReleaseEnvironment("a".repeat(40), "b".repeat(40));
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_CONFLICT");
      expect(queryTexts).toEqual([]);
      expect(await stageWriteCounts(f)).toEqual([0, 0, 0, 0]);
    } finally {
      setReleaseEnvironment(FIXTURE_RELEASE_SHA, FIXTURE_RELEASE_SHA);
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("rejects a changed observed release before source payload projection and leaves the attempt unscored", async () => {
    const f = await fixture({ label: "runtime-release-changed", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      setReleaseEnvironment("d".repeat(40), "d".repeat(40));
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:EXECUTABLE_IDENTITY_MISMATCH");
      expect(queryTexts.some(query => query.includes("trader_research_attempts_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_research_experiments_v1"))).toBe(true);
      expect(queryTexts.some(query => query.includes("trader_historical_dataset_authority_v2"))).toBe(false);
      expect(queryTexts.some(query => /insert\s+into\s+public\.trader_(orders|fills|accounting_frontier|research_training_diagnostics_v1)/i.test(query))).toBe(false);
      expect(await stageWriteCounts(f)).toEqual([0, 0, 0, 0]);
    } finally {
      setReleaseEnvironment(FIXTURE_RELEASE_SHA, FIXTURE_RELEASE_SHA);
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("refuses an exact retry after the observed deployment release changes without changing committed rows", async () => {
    const f = await fixture({ label: "runtime-release-changed-after-commit", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const committed = await run(f, 0);
    expect(committed.observedExecutableIdentity).toEqual(resolveCurrentResearchExecutableIdentityV1());
    const before = await stageWriteCounts(f);
    expect(before[0]).toBe(1);

    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      setReleaseEnvironment("e".repeat(40), "e".repeat(40));
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:EXECUTABLE_IDENTITY_MISMATCH");
      expect(queryTexts.some(query => query.includes("trader_historical_dataset_authority_v2"))).toBe(false);
      expect(queryTexts.some(query => /insert\s+into\s+public\.trader_(orders|fills|accounting_frontier|research_training_diagnostics_v1)/i.test(query))).toBe(false);
      expect(await stageWriteCounts(f)).toEqual(before);
    } finally {
      setReleaseEnvironment(FIXTURE_RELEASE_SHA, FIXTURE_RELEASE_SHA);
      await monitoredSql.end({ timeout: 5 });
    }
  }, 120_000);

  it("does not adopt an append-only legacy trace that lacks the observed executable descriptor", async () => {
    const f = await fixture({ label: "legacy-trace-without-executable", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const scope = await loadResearchTrainingLedgerScopePostgresV1(db, f.context,
      { attemptId: f.attempt.id, trialIndex: 0 });
    const policy = deriveCurrentResearchTrainingPolicyV1();
    const legacyTrace = {
      authority: "TRAINING_ENGINEERING_TRACE_ONLY",
      capitalEligible: false,
      scientificQualified: false,
      organizationId: f.orgId,
      attemptId: f.attempt.id,
      trialIndex: 0,
      stageRunId: scope.ledgerScope.historicalRunId,
      scopeDigestHex: scope.contentDigest,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      decisions: [], orders: [], openPositions: [],
      equity: "100000.00", netUnrealizedPnl: "0.00",
      strategyGuardianQualification: "UNQUALIFIED",
      accountGuardianQualification: "UNQUALIFIED",
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY",
      orderCount: 0, fillCount: 0, accountingSequence: 0,
      finalAccountingDigestHex: "0".repeat(64), ledgerDigestHex: "0".repeat(64),
    };
    const traceCanonicalJson = canonicalJsonString(legacyTrace);
    await ownerSql`insert into public.trader_research_training_diagnostics_v1 (
      organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,
      scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    ) values (${f.orgId}::uuid,${f.attempt.id}::uuid,0,
      ${scope.ledgerScope.historicalRunId}::uuid,${f.experiment.specSha256},
      ${scope.contentDigest},${policy.guardianResolvedPolicySha256},${traceCanonicalJson},
      ${computeStableJsonDigest(legacyTrace)})`;

    await expect(run(f, 0)).rejects.toThrow(/COMMITTED_TRACE_INVALID/);
    const [counts] = await ownerSql`select
      (select count(*)::int from public.trader_research_training_diagnostics_v1
        where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid) as diagnostics,
      (select count(*)::int from public.trader_orders where organization_id=${f.orgId}::uuid
        and historical_run_id=${scope.ledgerScope.historicalRunId}) as orders,
      (select count(*)::int from public.trader_accounting_frontier where organization_id=${f.orgId}::uuid
        and run_id=${scope.ledgerScope.historicalRunId}) as frontiers`;
    expect([counts!.diagnostics, counts!.orders, counts!.frontiers]).toEqual([1, 0, 0]);
  }, 120_000);

  it("preserves an append-only V1 trace with valid old identity and requires a new attempt", async () => {
    const f = await fixture({ label: "legacy-trace-without-executable", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const scope = await loadResearchTrainingLedgerScopePostgresV1(db, f.context,
      { attemptId: f.attempt.id, trialIndex: 0 });
    const policy = deriveCurrentResearchTrainingPolicyV1();
    const legacyTrace = {
      schemaVersion: "waia.research.training-diagnostic.v1",
      authority: "TRAINING_ENGINEERING_TRACE_ONLY",
      capitalEligible: false,
      scientificQualified: false,
      sourceQualification: "NOT_ESTABLISHED",
      observedExecutableIdentity: resolveCurrentResearchExecutableIdentityV1(),
      organizationId: f.orgId,
      attemptId: f.attempt.id,
      trialIndex: 0,
      stageRunId: scope.ledgerScope.historicalRunId,
      scopeDigestHex: scope.contentDigest,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      decisions: [], orders: [], openPositions: [],
      equity: "100000.00", netUnrealizedPnl: "0.00",
      strategyGuardianQualification: "UNQUALIFIED",
      accountGuardianQualification: "UNQUALIFIED",
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY",
      orderCount: 0, fillCount: 0, accountingSequence: 0,
      finalAccountingDigestHex: "0".repeat(64), ledgerDigestHex: "0".repeat(64),
    };
    const traceCanonicalJson = canonicalJsonString(legacyTrace);
    await ownerSql`insert into public.trader_research_training_diagnostics_v1 (
      organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,
      scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    ) values (${f.orgId}::uuid,${f.attempt.id}::uuid,0,
      ${scope.ledgerScope.historicalRunId}::uuid,${f.experiment.specSha256},
      ${scope.contentDigest},${policy.guardianResolvedPolicySha256},${traceCanonicalJson},
      ${computeStableJsonDigest(legacyTrace)})`;

    const queryTexts: string[] = [];
    const monitoredSql = postgres(url!, { max: 1, prepare: false,
      debug: (_connection, query) => { queryTexts.push(query); } });
    const monitoredDb = drizzle(monitoredSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    try {
      await expect(run(f, 0, f.attempt.id, monitoredDb))
        .rejects.toThrow("LEGACY_TRACE_REQUIRES_NEW_ATTEMPT");
      expect(queryTexts.some(query => query.includes("trader_historical_dataset_authority_v2"))).toBe(false);
      expect(queryTexts.some(query => /insert\s+into\s+public\.trader_(orders|fills|accounting_frontier|research_training_diagnostics_v1)/i.test(query))).toBe(false);
    } finally {
      await monitoredSql.end({ timeout: 5 });
    }
    const [retained] = await ownerSql`select trace_canonical_json,trace_sha256
      from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
    expect(retained!.trace_canonical_json).toBe(traceCanonicalJson);
    expect(retained!.trace_sha256).toBe(computeStableJsonDigest(legacyTrace));
    const [counts] = await ownerSql`select
      (select count(*)::int from public.trader_research_training_diagnostics_v1
        where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid) as diagnostics,
      (select count(*)::int from public.trader_orders where organization_id=${f.orgId}::uuid
        and historical_run_id=${scope.ledgerScope.historicalRunId}) as orders,
      (select count(*)::int from public.trader_accounting_frontier where organization_id=${f.orgId}::uuid
        and run_id=${scope.ledgerScope.historicalRunId}) as frontiers`;
    expect([counts!.diagnostics, counts!.orders, counts!.frontiers]).toEqual([1, 0, 0]);
  }, 120_000);

  it("seals every actual DEVELOPMENT feature invocation, including NONE, to causal prefixes and exact retry", async () => {
    const f = await fixture({ label: "development-input-use", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const trace = await run(f, 0);
    const receipt = trace.inputUseReceipt;
    expect(trace.schemaVersion).toBe("waia.research.training-diagnostic.v2");
    expect(trace.sourceQualification).toBe("NOT_ESTABLISHED");
    expect(receipt.schemaVersion).toBe("waia.research.development-input-use.v1");
    expect(receipt.authority).toBe("DEVELOPMENT_INPUT_USE_INTEGRITY_ONLY");
    expect(receipt.sourceQualification).toBe("NOT_ESTABLISHED");
    expect(receipt.organizationId).toBe(f.orgId);
    expect(receipt.experimentSpecSha256).toBe(f.experiment.specSha256);
    expect(receipt.attemptId).toBe(f.attempt.id);
    expect(receipt.trialIndex).toBe(0);
    expect(receipt.sourceRunId).toBe(f.attempt.sourceRunId);
    expect(receipt.observedExecutableIdentity).toEqual(resolveCurrentResearchExecutableIdentityV1());
    expect(receipt.policyDigestHex).toBe(trace.policyDigestHex);
    expect(receipt.partitionIdentity.contentSha256).toBe(computeBarSetDigest(f.trainBars));
    expect(receipt.invocationCount).toBe(f.trainBars.length);
    expect(receipt.invocations).toHaveLength(f.trainBars.length);
    const { contentDigestHex, ...body } = receipt;
    expect(contentDigestHex).toBe(computeStableJsonDigest(body));
    for (const [index, invocation] of receipt.invocations.entries()) {
      const expectedBars = f.trainBars.slice(0, index + 1);
      const expectedBar = f.trainBars[index]!;
      expect(invocation.index).toBe(index);
      expect(invocation.sourceBarIndex).toBe(index);
      expect(invocation.cycleId).toBe(`${f.attempt.sourceRunId}:DEVELOPMENT:BTCUSDT:${index}`);
      expect(invocation.rule).toBe("trailing-128-closed-bars/v1");
      expect(invocation.barCount).toBe(index + 1);
      expect(invocation.firstBarOpenTime).toBe(f.trainBars[0]!.barOpenTime);
      expect(invocation.lastBarCloseTime).toBe(expectedBar.barCloseTime);
      expect(invocation.evaluatedAt).toBe(expectedBar.barCloseTime);
      expect(invocation.barsSha256).toBe(computeStableJsonDigest(expectedBars));
      expect(invocation.parametersSha256).toBe(computeStableJsonDigest(f.experiment.spec.orderedTrials[0]));
      const { contentDigestHex: invocationDigest, ...invocationBody } = invocation;
      expect(invocationDigest).toBe(computeStableJsonDigest(invocationBody));
    }
    expect(receipt.invocations.slice(0, 3).every(invocation => invocation.signal.action === "NONE")).toBe(true);
    const before = await stageWriteCounts(f);
    expect(await run(f, 0)).toEqual(trace);
    expect(await stageWriteCounts(f)).toEqual(before);
  }, 120_000);

  it("refuses a self-resealed false input-use receipt without adopting or overwriting its append-only row", async () => {
    const f = await fixture({ label: "false-input-use-receipt", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const scope = await loadResearchTrainingLedgerScopePostgresV1(db, f.context,
      { attemptId: f.attempt.id, trialIndex: 0 });
    const policy = deriveCurrentResearchTrainingPolicyV1();
    const source = await loadRegisteredResearchTrainingExecutionInputPostgresV1(db, f.context,
      { attemptId: f.attempt.id, trialIndex: 0, limits: LIMITS });
    const authenticInvocations = source.cycles.map((cycle, index) =>
      evaluateResearchFeatureInvocationV1({ parameters: source.scope.identity.parameters,
        bars: source.bars, symbol: source.experiment.spec.universe.symbol, interval: "1m",
        index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId }).invocationReceipt);
    expect(authenticInvocations).toHaveLength(f.trainBars.length);
    const { contentDigestHex: _authenticDigest, ...authenticInvocationBody } = authenticInvocations[4]!;
    expect(_authenticDigest).toBe(computeStableJsonDigest(authenticInvocationBody));
    const falseInvocationBody = { ...authenticInvocationBody, barsSha256: "f".repeat(64) };
    expect(falseInvocationBody.barsSha256).not.toBe(authenticInvocationBody.barsSha256);
    const falseInvocations = authenticInvocations.map((invocation, index) => index === 4 ?
      { ...falseInvocationBody, contentDigestHex: computeStableJsonDigest(falseInvocationBody) } : invocation);
    const falseInputBody = { schemaVersion: "waia.research.development-input-use.v1",
      authority: "DEVELOPMENT_INPUT_USE_INTEGRITY_ONLY",
      sourceQualification: "NOT_ESTABLISHED", organizationId: f.orgId,
      experimentSpecSha256: f.experiment.specSha256, attemptId: f.attempt.id,
      trialIndex: 0, scopeDigestHex: scope.contentDigest,
      sourceRunId: source.sourceRunId, sourceClass: source.source,
      datasetAuthorityDigest: source.datasetAuthorityDigest,
      partition: "DEVELOPMENT", partitionIdentity: source.partition,
      symbol: source.experiment.spec.universe.symbol,
      interval: source.experiment.spec.universe.interval,
      executionCyclesSha256: computeStableJsonDigest(source.cycles),
      policyDigestHex: policy.guardianResolvedPolicySha256,
      observedExecutableIdentity: resolveCurrentResearchExecutableIdentityV1(),
      invocationCount: falseInvocations.length, invocations: falseInvocations };
    const falseInputReceipt = { ...falseInputBody,
      contentDigestHex: computeStableJsonDigest(falseInputBody) };
    const falseTrace = { schemaVersion: "waia.research.training-diagnostic.v2",
      inputUseReceipt: falseInputReceipt,
      authority: "TRAINING_ENGINEERING_TRACE_ONLY", capitalEligible: false,
      scientificQualified: false, sourceQualification: "NOT_ESTABLISHED",
      organizationId: f.orgId, attemptId: f.attempt.id, trialIndex: 0,
      stageRunId: scope.ledgerScope.historicalRunId, scopeDigestHex: scope.contentDigest,
      policyDigestHex: policy.guardianResolvedPolicySha256,
      observedExecutableIdentity: resolveCurrentResearchExecutableIdentityV1(),
      strategyGuardianQualification: "UNQUALIFIED",
      accountGuardianQualification: "UNQUALIFIED",
      appliedProtectionScope: "ACCOUNT_D20_SIGNAL_ADMISSION_ONLY",
      decisions: [], orders: [], openPositions: [], equity: "100000.00",
      netUnrealizedPnl: "0.00", orderCount: 0, fillCount: 0,
      accountingSequence: 0, finalAccountingDigestHex: "0".repeat(64),
      ledgerDigestHex: "0".repeat(64) };
    const traceCanonicalJson = canonicalJsonString(falseTrace);
    const traceSha256 = computeStableJsonDigest(falseTrace);
    await ownerSql`insert into public.trader_research_training_diagnostics_v1 (
      organization_id,attempt_id,trial_index,stage_run_id,experiment_spec_sha256,
      scope_digest_hex,policy_digest_hex,trace_canonical_json,trace_sha256
    ) values (${f.orgId}::uuid,${f.attempt.id}::uuid,0,
      ${scope.ledgerScope.historicalRunId}::uuid,${f.experiment.specSha256},
      ${scope.contentDigest},${policy.guardianResolvedPolicySha256},${traceCanonicalJson},
      ${traceSha256})`;

    await expect(run(f, 0)).rejects.toThrow("COMMITTED_INPUT_USE_MISMATCH");
    const [retained] = await ownerSql`select trace_canonical_json,trace_sha256
      from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
    expect(retained!.trace_canonical_json).toBe(traceCanonicalJson);
    expect(retained!.trace_sha256).toBe(traceSha256);
    expect(await stageWriteCounts(f)).toEqual([1, 0, 0, 0]);
  }, 120_000);

  it("executes two declared lookbacks with separate actual D5 decisions, fills, accounting and exact retries", async () => {
    const f = await fixture({ label: "different-lookbacks", closes: [100, 100, 100, 100, 90, 100, 100, 100, 90, 100, 100, 100] });
    const short = await run(f, 0);
    const long = await run(f, 1);
    expect(short.authority).toBe("TRAINING_ENGINEERING_TRACE_ONLY");
    expect(short.capitalEligible).toBe(false);
    expect(short.scientificQualified).toBe(false);
    expect(short.accountGuardianQualification).toBe("UNQUALIFIED");
    expect(short.appliedProtectionScope).toBe("ACCOUNT_D20_SIGNAL_ADMISSION_ONLY");
    expect(short.stageRunId).not.toBe(long.stageRunId);
    expect(short.scopeDigestHex).not.toBe(long.scopeDigestHex);
    expect(Number(short.fillCount)).toBeGreaterThan(0);
    expect(Number(long.fillCount)).toBeGreaterThan(0);
    expect(short.decisions).not.toEqual(long.decisions);
    const accepted = (trace: typeof short) =>
      (trace.decisions as Array<{ index: number; disposition: string }>).find(
        decision => decision.disposition === "MODELED_ORDER_ACCEPTED")?.index;
    expect(accepted(short)).toBe(4);
    expect(accepted(long)).toBe(8);
    const firstFillTime = (trace: typeof short) =>
      (trace.fillDetails as Array<{ event: { fillTimestamp: string } }>)[0]?.event.fillTimestamp;
    expect(firstFillTime(short)).not.toBe(firstFillTime(long));
    expect(await run(f, 0)).toEqual(short);
    expect(await run(f, 1)).toEqual(long);
    const rows = await ownerSql`select stage_run_id,trace_sha256 from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid`;
    expect(rows).toHaveLength(2);
    const orders = await ownerSql`select historical_run_id,count(*)::int as n from public.trader_orders
      where historical_run_id in (${short.stageRunId},${long.stageRunId}) group by historical_run_id`;
    expect(orders).toHaveLength(2);
    const firstOrderId = (short.orders as Array<{ id: string }>)[0]?.id;
    expect(firstOrderId).toBeTruthy();
    const [originalOrder] = await ownerSql`select quantity,updated_at from public.trader_orders
      where id=${firstOrderId}::uuid`;
    const changed = await ownerSql`update public.trader_orders set quantity='0.6'
      where id=${firstOrderId}::uuid returning id`;
    expect(changed).toHaveLength(1);
    await expect(run(f, 0)).rejects.toThrow(/COMMITTED_LEDGER_DIVERGENT/);
    await ownerSql`update public.trader_orders set quantity=${originalOrder!.quantity},
      updated_at=${originalOrder!.updated_at}::timestamptz where id=${firstOrderId}::uuid`;
    expect(await run(f, 0)).toEqual(short);
  }, 120_000);

  it("retains absolute source indices when the registered train partition begins inside DEVELOPMENT", async () => {
    const f = await fixture({ label: "nonzero-train-offset", trials: [4], trainFromIndex: 4,
      closes: [110, 110, 110, 110, 100, 100, 100, 100, 90, 100, 100, 100] });
    const trace = await run(f, 0);
    expect(trace.authority).toBe("TRAINING_ENGINEERING_TRACE_ONLY");
    expect(trace.barCount).toBe(f.trainBars.length);
    expect(trace.sourceRunId).toBe(f.attempt.sourceRunId);
    expect(trace.trainPartitionSha256).toBe(computeBarSetDigest(f.trainBars));
    const accepted = (trace.decisions as Array<{
      index: number; sourceBarIndex: number; disposition: string;
      execution?: { decisionBarIndex: number };
    }>).find(decision => decision.disposition === "MODELED_ORDER_ACCEPTED");
    expect(accepted).toMatchObject({ index: 4, sourceBarIndex: 8,
      execution: { decisionBarIndex: 8 } });
    const firstFill = (trace.fillDetails as Array<{
      event: { sourceBarIndex: number; sourceBar: { barCloseTime: string } };
    }>)[0];
    expect(firstFill?.event.sourceBarIndex).toBe(9);
    expect(firstFill?.event.sourceBar.barCloseTime).toBe(f.bars[9]!.barCloseTime);
    expect(await run(f, 0)).toEqual(trace);
  }, 120_000);

  it("preserves D5 partial fill and expiry without forcing a terminal liquidation", async () => {
    const f = await fixture({ label: "partial-expiry", quantity: "5", trials: [4],
      closes: [100, 100, 100, 100, 90, 89, 88, 87, 86, 85, 84] });
    const trace = await run(f, 0);
    expect(Number(trace.fillCount)).toBeGreaterThan(0);
    const orders = trace.orders as Array<{ state: string; quantity: string; filledQuantity: string }>;
    expect(orders.some(order => order.state === "EXPIRED")).toBe(true);
    expect(orders.some(order => order.state === "EXPIRED" &&
      Number(order.filledQuantity) > 0 && Number(order.filledQuantity) < Number(order.quantity))).toBe(true);
    expect((trace.openPositions as unknown[]).length).toBeGreaterThan(0);
    expect(trace.strategyGuardianQualification).toBe("UNQUALIFIED");
    expect(trace.accountGuardianQualification).toBe("UNQUALIFIED");
    expect(trace.equity).not.toBeNull();
    expect(trace.netUnrealizedPnl).not.toBeNull();
    expect(Number(trace.netUnrealizedPnl)).toBeLessThan(0);
  }, 120_000);

  it("refuses a next-bar buy gap that would create spot credit and rolls back all stage effects", async () => {
    const f = await fixture({ label: "cash-gap", quantity: "1200", volume: 20_000, trials: [4],
      closes: [100, 100, 100, 100, 80, 200, 200, 200] });
    await expect(run(f, 0)).rejects.toThrow(/NEGATIVE_CASH_AFTER_FILL/);
    const [rolledBack] = await ownerSql`select
      (select count(*)::int from public.trader_orders
        where historical_run_id is not null and organization_id=${f.orgId}::uuid) as orders,
      (select count(*)::int from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
        where o.historical_run_id is not null and o.organization_id=${f.orgId}::uuid) as events,
      (select count(*)::int from public.trader_fills f0 join public.trader_orders o on o.id=f0.order_id
        where o.historical_run_id is not null and o.organization_id=${f.orgId}::uuid) as fills,
      (select count(*)::int from public.trader_fill_execution_economics e
        join public.trader_orders o on o.id=e.order_id
        where o.historical_run_id is not null and o.organization_id=${f.orgId}::uuid) as economics`;
    const frontiers = await ownerSql`select count(*)::int as n from public.trader_accounting_frontier
      where organization_id=${f.orgId}::uuid and account_key like 'research-stage:%'`;
    const results = await ownerSql`select count(*)::int as n from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid`;
    expect([rolledBack!.orders, rolledBack!.events, rolledBack!.fills, rolledBack!.economics,
      frontiers[0]!.n, results[0]!.n]).toEqual([0, 0, 0, 0, 0, 0]);
  }, 120_000);

  it("serializes concurrent owners into one committed trace and refuses a poisoned pre-result ledger", async () => {
    const f = await fixture({ label: "concurrent-owners", closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const simultaneous = await Promise.allSettled([run(f, 0), run(f, 0)]);
    const results = await Promise.all(simultaneous.map(async outcome =>
      outcome.status === "fulfilled" ? outcome.value :
        /SERIALIZATION_RETRY_REQUIRED|LOCK_TIMEOUT_RETRY_REQUIRED/.test(String(outcome.reason))
          ? run(f, 0) : Promise.reject(outcome.reason)));
    const [left, right] = results;
    expect(left).toEqual(right);
    const rows = await ownerSql`select count(*)::int as n from public.trader_research_training_diagnostics_v1
      where organization_id=${f.orgId}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
    expect(rows[0]!.n).toBe(1);
    const poisoned = await fixture({ label: "orphan-ledger", closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    const stageRunId = (await import("@/lib/trader/research/research-attempt-registry-postgres-v1"))
      .loadResearchTrainingLedgerScopePostgresV1(db, poisoned.context,
        { attemptId: poisoned.attempt.id, trialIndex: 0 });
    const scope = await stageRunId;
    await ownerSql`insert into public.trader_accounting_frontier (
      id,organization_id,account_key,run_id,accounting_sequence,frontier_as_of,month_key,cash,
      position_quantity_json,gross_position_basis_json,net_position_basis_json,gross_realized_pnl,
      net_realized_pnl,marks_json,marked_position_value,equity,equity_hwm,monthly_peak_hwm,
      monthly_drawdown_bps,strategy_peak_hwm_by_key_json,strategy_drawdown_bps_by_key_json,
      account_drawdown_bps,source_economics_digest,semantic_content_digest,idempotency_key,schema_version
    ) values (${randomUUID()}::uuid,${poisoned.orgId}::uuid,
      ${scope.ledgerScope.historicalAccountKey},${scope.ledgerScope.historicalRunId},1,
      ${poisoned.bars[0]!.barOpenTime}::timestamptz,'2025-01','100000','{}'::jsonb,
      '{}'::jsonb,'{}'::jsonb,'0','0','{}'::jsonb,'0','100000','100000','100000',
      0,'{}'::jsonb,'{}'::jsonb,0,${"0".repeat(64)},${"1".repeat(64)},
      ${`poison-${randomUUID()}`},'htr-accounting-frontier/v1')`;
    await expect(run(poisoned, 0)).rejects.toThrow(/UNCOMMITTED_STAGE_LEDGER_EXISTS/);
  }, 120_000);

  it("never creates a short order when SELL signals arrive while the modeled account is flat", async () => {
    const f = await fixture({ label: "flat-sell", trials: [4],
      closes: [90, 91, 92, 93, 94, 95, 96, 97] });
    const trace = await run(f, 0);
    expect(trace.orderCount).toBe(0);
    expect(trace.fillCount).toBe(0);
    expect((trace.decisions as Array<{ disposition: string }>).some(
      decision => decision.disposition === "NO_LONG_POSITION")).toBe(true);
    expect(trace.cash).toBe("100000.00");
    expect(trace.openPositions).toEqual([]);
  }, 120_000);

  it("rolls back D5 orders, fills, frontiers and result when the result insert fails", async () => {
    const f = await fixture({ label: "terminal-insert-fault", trials: [4],
      closes: [100, 100, 100, 100, 90, 100, 100, 100] });
    await ownerSql.unsafe(`CREATE FUNCTION public.dee1159_test_diagnostic_insert_fault()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1159_SYNTHETIC_RESULT_FAULT'; END; $$`);
    await ownerSql.unsafe(`CREATE TRIGGER dee1159_test_diagnostic_insert_fault
      BEFORE INSERT ON public.trader_research_training_diagnostics_v1 FOR EACH ROW
      EXECUTE FUNCTION public.dee1159_test_diagnostic_insert_fault()`);
    try {
      await expect(run(f, 0)).rejects.toThrow(/DEE1159_SYNTHETIC_RESULT_FAULT/);
      const [ledger] = await ownerSql`select
        (select count(*)::int from public.trader_orders where organization_id=${f.orgId}::uuid
          and historical_run_id is not null) as orders,
        (select count(*)::int from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
          where o.organization_id=${f.orgId}::uuid and o.historical_run_id is not null) as events,
        (select count(*)::int from public.trader_fills f0 join public.trader_orders o on o.id=f0.order_id
          where o.organization_id=${f.orgId}::uuid and o.historical_run_id is not null) as fills,
        (select count(*)::int from public.trader_fill_execution_economics e
          join public.trader_orders o on o.id=e.order_id
          where o.organization_id=${f.orgId}::uuid and o.historical_run_id is not null) as economics,
        (select count(*)::int from public.trader_accounting_frontier where organization_id=${f.orgId}::uuid
          and account_key like 'research-stage:%') as frontiers,
        (select count(*)::int from public.trader_research_training_diagnostics_v1
          where organization_id=${f.orgId}::uuid) as results`;
      expect([ledger!.orders, ledger!.events, ledger!.fills, ledger!.economics,
        ledger!.frontiers, ledger!.results]).toEqual([0, 0, 0, 0, 0, 0]);
    } finally {
      await ownerSql.unsafe(`DROP TRIGGER IF EXISTS dee1159_test_diagnostic_insert_fault
        ON public.trader_research_training_diagnostics_v1`);
      await ownerSql.unsafe(`DROP FUNCTION IF EXISTS public.dee1159_test_diagnostic_insert_fault()`);
    }
    const recovered = await run(f, 0);
    expect(Number(recovered.fillCount)).toBeGreaterThan(0);
  }, 120_000);
});
