/** Synthetic-only proof that validation reservation consumes the frozen candidate before disclosure. */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema.postgres";
import { createResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { researchDevelopmentEvaluationSourceIdV1 } from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { registerResearchIssuedAttemptPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";
import { startCommitAckLossProxy } from "@/tests/helpers/postgres-commit-ack-loss-proxy";
import { loadStrategyAdmissionJournal } from "@/lib/trader/research/strategy-admission-journal-postgres";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import { RESEARCH_EVALUATION_SOURCE_LOGIN_V1 } from "@/lib/trader/research/research-development-evaluation-source-issuance-v1";
import { prepareResearchDevelopmentEvaluationSourcePostgresV1 } from "@/lib/trader/research/research-development-evaluation-source-owner-postgres-v1";
import { reserveResearchDevelopmentEvaluationPostgresV1, runResearchIssuedTrainingDiagnosticPostgresV2,
  selectResearchIssuedTrainingFamilyPostgresV1 } from "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const LIMITS = Object.freeze({ maxBars: 64, maxBytes: 2_000_000, maxTraceBytes: 2_000_000 });
const FAMILY = [
  { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" },
  { lookbackBars: 5, buyZscore: "-1.5", sellZscore: "0" },
] as const;

describe.skipIf(!enabled)("DEE-1159 DEVELOPMENT evaluation claim PostgreSQL", () => {
  let admin: postgres.Sql;
  const priorDbUrl = process.env.DATABASE_URL_POSTGRES;
  const priorWaiaRelease = process.env.WAIA_RELEASE_SHA;
  const priorVercelRelease = process.env.VERCEL_GIT_COMMIT_SHA;
  const trainingUrl = () => {
    const parsed = new URL(url!); parsed.username = "waia_research_source_writer_login"; parsed.password = "";
    return parsed.toString();
  };
  const evaluationUrl = () => {
    const parsed = new URL(url!); parsed.username = RESEARCH_EVALUATION_SOURCE_LOGIN_V1; parsed.password = "";
    return parsed.toString();
  };

  async function readyFixture(label: string, options: { select?: boolean; incomplete?: boolean } = {}) {
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
    const source = createResearchDevelopmentSourceFixtureV1({
      barCount: 20, sourceReleaseSha: "a".repeat(40), releaseSha: "b".repeat(40),
    });
    vi.stubEnv("WAIA_RELEASE_SHA", source.releaseSha);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", trainingUrl());
    vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", evaluationUrl());
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATASET_ROOT", source.datasetRoot);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH", source.qualificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH", source.runtimeRequalificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_VOLUME_PATH", source.htxVolumeQualificationReceiptPath);
    const prepared = await prepareResearchDevelopmentSourcePostgresV1({
      organizationId: ORG, commandId: `dee1159-claim-train-${randomUUID()}`, symbol: "BTCUSDT",
      initialRecordIndex: 0, observationBarCount: 2, gapBarCount: 1, trainingBarCount: 8,
    });
    if (!prepared.issuance || !["COMMITTED", "REPLAYED", "CONFIRMED_AFTER_UNCERTAINTY"].includes(prepared.status)) {
      source.cleanup(); throw new Error("DEE1159_CLAIM_TRAINING_SOURCE_REQUIRED");
    }
    const training = prepared.issuance;
    const evalRequest = {
      organizationId: ORG, commandId: `dee1159-claim-eval-${randomUUID()}`,
      trainingSourceRunId: training.sourceRunId, trainingSourceIssuanceDigest: training.contentDigest,
      symbol: "BTCUSDT" as const, validation: { firstRecordIndex: 11, barCount: 6 },
      walkForward: [{ firstRecordIndex: 11, barCount: 3 }, { firstRecordIndex: 14, barCount: 3 }],
    };
    const evaluation = await prepareResearchDevelopmentEvaluationSourcePostgresV1(evalRequest);
    if (!evaluation.issuance || !["COMMITTED", "REPLAYED", "CONFIRMED_AFTER_UNCERTAINTY"].includes(evaluation.status)) {
      source.cleanup(); throw new Error("DEE1159_CLAIM_EVALUATION_SOURCE_REQUIRED");
    }
    const proposal = buildResearchExperimentProposalV1(ORG, label);
    const policy = deriveCurrentResearchTrainingPolicyV1();
    proposal.executable.sourceSha256 = resolveCurrentResearchExecutableIdentityV1().sourceSha256;
    proposal.hypothesis.observationEvidenceSha256 = [training.observation.contentSha256];
    proposal.hypothesis.observationCutoffMs = training.observation.lastCloseMs;
    proposal.universe.datasetSourceSha256 = training.qualificationReceiptDigest;
    proposal.universe.knownAtMs = training.observation.firstOpenMs;
    proposal.replay.volumeQualificationSha256 = training.volumeQualificationDigest;
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
    proposal.orderedTrials = [...FAMILY];
    proposal.partitions.train = { contentSha256: training.training.contentSha256,
      firstOpenMs: training.training.firstOpenMs, lastCloseMs: training.training.lastCloseMs,
      barCount: training.training.barCount };
    const validation = evaluation.issuance.metadata.validation;
    const walkForward = evaluation.issuance.metadata.walkForward;
    proposal.partitions.validation = { contentSha256: validation.contentSha256,
      firstOpenMs: validation.firstOpenMs, lastCloseMs: validation.lastCloseMs, barCount: validation.barCount };
    proposal.partitions.walkForward = walkForward.map(part => ({ contentSha256: part.contentSha256,
      firstOpenMs: part.firstOpenMs, lastCloseMs: part.lastCloseMs, barCount: part.barCount }));
    proposal.partitions.blind = { contentSha256: "3".repeat(64), firstOpenMs: validation.lastCloseMs,
      lastCloseMs: validation.lastCloseMs + 10 * 60_000, barCount: 10 };
    const experiment = await registerResearchExperimentPostgresV1(
      drizzle(admin, { schema }) as never, { organizationId: ORG }, proposal);
    const attempt = await registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
      specSha256: experiment.specSha256, sourceRunId: training.sourceRunId,
      commandId: `dee1159-claim-attempt-${randomUUID()}` });
    const f = { source, training, evaluation, experiment, attempt };
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
    const trialCount = options.incomplete ? 1 : FAMILY.length;
    for (let trialIndex = 0; trialIndex < trialCount; trialIndex++) {
      const result = await runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: attempt.id, trialIndex, limits: { maxBars: LIMITS.maxBars, maxBytes: LIMITS.maxBytes } });
      if (result.status !== "COMMITTED" && result.status !== "REPLAYED") {
        source.cleanup(); throw new Error("DEE1159_CLAIM_DIAGNOSTIC_REQUIRED");
      }
    }
    if (!options.incomplete && options.select !== false) {
      const selected = await selectResearchIssuedTrainingFamilyPostgresV1({
        organizationId: ORG, attemptId: attempt.id, limits: LIMITS,
      });
      if (!selected.receipt) { source.cleanup(); throw new Error("DEE1159_CLAIM_FAMILY_SELECTION_REQUIRED"); }
    }
    return { ...f, request: {
      organizationId: ORG, attemptId: attempt.id,
      evaluationSourceId: researchDevelopmentEvaluationSourceIdV1(evalRequest),
      commandId: `dee1159-claim-${randomUUID()}`, limits: LIMITS,
    } };
  }

  async function rowCounts() {
    const [row] = await admin`SELECT
      (SELECT count(*)::int FROM public.trader_research_development_evaluation_claims_v1) AS claims,
      (SELECT count(*)::int FROM public.trader_strategy_admission_split_consume) AS consumes,
      (SELECT count(*)::int FROM public.trader_strategy_admission_journal) AS metrics`;
    return row!;
  }
  async function modelEffects() {
    const [row] = await admin`SELECT
      (SELECT count(*)::int FROM public.trader_orders WHERE organization_id=${ORG}::uuid AND historical_run_id IS NOT NULL) AS orders,
      (SELECT count(*)::int FROM public.trader_fills f JOIN public.trader_orders o ON o.id=f.order_id
        WHERE o.organization_id=${ORG}::uuid AND o.historical_run_id IS NOT NULL) AS fills,
      (SELECT count(*)::int FROM public.trader_research_issued_training_diagnostics_v2
        WHERE organization_id=${ORG}::uuid) AS diagnostics`;
    return row!;
  }
  async function consumeCount(specSha256: string, hypothesisId: string) {
    const [row] = await admin`SELECT count(*)::int AS n FROM public.trader_strategy_admission_split_consume
      WHERE spec_sha256=${specSha256} AND hypothesis_id=${hypothesisId} AND split='validation'`;
    return row!.n as number;
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/waia_hsv2_it_dee1159_eval_source_v1") {
      throw new Error("DEE1159_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED");
    }
    admin = postgres(url!, { max: 8, prepare: false, onnotice: () => {} });
    const userId = randomUUID();
    await admin`INSERT INTO auth.users(id) VALUES (${userId}::uuid) ON CONFLICT(id) DO NOTHING`;
    await admin`INSERT INTO public.users(id,identity_label,email) VALUES (${userId}::uuid,'DEE1159 synthetic',${`${userId}@waia.invalid`}) ON CONFLICT(id) DO NOTHING`;
    await admin`INSERT INTO public.organizations(id,owner_user_id,kind,name) VALUES (${ORG}::uuid,${userId}::uuid,'business','DEE1159 synthetic Org0') ON CONFLICT(id) DO NOTHING`;
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
  }, 20_000);
  afterAll(async () => {
    try { await admin?.end({ timeout: 3 }); }
    finally {
      for (const [key, value] of [["DATABASE_URL_POSTGRES", priorDbUrl], ["WAIA_RELEASE_SHA", priorWaiaRelease],
        ["VERCEL_GIT_COMMIT_SHA", priorVercelRelease]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      vi.unstubAllEnvs();
    }
  }, 20_000);
  beforeEach(() => vi.stubEnv("DATABASE_URL_POSTGRES", url!));
  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv("DATABASE_URL_POSTGRES", url!); });

  it("commits and replays the immutable reservation without evaluation metrics or model effects", async () => {
    const f = await readyFixture("claim-commit-replay");
    try {
      const before = await rowCounts();
      const effectsBefore = await modelEffects();
      const first = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(first.status).toBe("COMMITTED");
      if (!first.receipt) throw new Error("DEE1159_CLAIM_RECEIPT_REQUIRED");
      expect(first.receipt).toMatchObject({ authority: "PRE_DISCLOSURE_VALIDATION_RESERVATION_ONLY",
        split: "validation", scientificQualified: false, capitalEligible: false,
        evaluationSourceId: f.request.evaluationSourceId, attemptId: f.attempt.id,
        trainingSourceRunId: f.training.sourceRunId,
        trainingSourceIssuanceDigest: f.training.contentDigest,
        evaluationSourceIssuanceDigest: f.evaluation.issuance!.contentDigest,
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const retry = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(retry.status).toBe("REPLAYED");
      expect(retry.receipt).toEqual(first.receipt);
      const after = await rowCounts();
      expect(after.claims).toBe(before.claims + 1);
      expect(after.consumes).toBe(before.consumes + 1);
      expect(after.metrics).toBe(before.metrics);
      expect(await modelEffects()).toEqual(effectsBefore);
      const fresh = postgres(url!, { max: 1, prepare: false });
      try {
        const { journal, baseline } = await loadStrategyAdmissionJournal(drizzle(fresh, { schema }));
        const key = { specSha256: first.receipt.experimentSpecSha256,
          hypothesisId: first.receipt.hypothesisId, split: "validation" as const };
        expect(journal.splitUseCount(key)).toBe(1);
        expect(() => journal.assertSplitAvailable(key)).toThrow(/split_already_used/);
        expect(journal.list()).toEqual([]);
        expect(baseline.rowCount).toBe(0);
      } finally { await fresh.end({ timeout: 2 }); }
    } finally { f.source.cleanup(); }
  }, 240_000);

  it("refuses absent family selection, changed release, foreign organization, and unregistered evaluation source", async () => {
    const f = await readyFixture("claim-refusal", { select: false, incomplete: true });
    try {
      const claimsBefore = (await rowCounts()).claims;
      await expect(reserveResearchDevelopmentEvaluationPostgresV1(f.request)).rejects.toThrow(/FAMILY|SELECTION/);
      await expect(registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
        specSha256: f.experiment.specSha256, sourceRunId: `research-source-v1:${"f".repeat(64)}`,
        commandId: `dee1159-claim-missing-training-${randomUUID()}` })).rejects.toThrow();
      const secondTrial = await runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: f.attempt.id, trialIndex: 1, limits: { maxBars: LIMITS.maxBars, maxBytes: LIMITS.maxBytes } });
      expect(secondTrial.status).toBe("COMMITTED");
      const selected = await selectResearchIssuedTrainingFamilyPostgresV1({ organizationId: ORG,
        attemptId: f.attempt.id, limits: LIMITS });
      expect(selected.status).toBe("COMMITTED");
      const changed = { ...f.request, commandId: `${f.request.commandId}:changed`,
        evaluationSourceId: `research-evaluation-source-v1:${"f".repeat(64)}` };
      await expect(reserveResearchDevelopmentEvaluationPostgresV1(changed)).rejects.toThrow();
      await expect(reserveResearchDevelopmentEvaluationPostgresV1({ ...f.request,
        organizationId: randomUUID() })).rejects.toThrow();
      vi.stubEnv("WAIA_RELEASE_SHA", "c".repeat(40));
      await expect(reserveResearchDevelopmentEvaluationPostgresV1({ ...f.request,
        commandId: `${f.request.commandId}:release` })).rejects.toThrow();
      expect((await rowCounts()).claims).toBe(claimsBefore);
    } finally { f.source.cleanup(); }
  }, 240_000);

  it("lets only one concurrent command consume a frozen validation key, including across attempts", async () => {
    const sameCommandFixture = await readyFixture("claim-concurrent-same-command");
    const distinctCommandFixture = await readyFixture("claim-concurrent-distinct-command");
    try {
      const sameCommand = await Promise.all([
        reserveResearchDevelopmentEvaluationPostgresV1(sameCommandFixture.request),
        reserveResearchDevelopmentEvaluationPostgresV1(sameCommandFixture.request),
      ]);
      expect(sameCommand.map(item => item.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
      expect(sameCommand[0]!.receipt).toEqual(sameCommand[1]!.receipt);

      const distinctClaimsBefore = (await rowCounts()).claims;
      const outcomes = await Promise.allSettled([
        reserveResearchDevelopmentEvaluationPostgresV1(distinctCommandFixture.request),
        reserveResearchDevelopmentEvaluationPostgresV1({ ...distinctCommandFixture.request,
          commandId: `${distinctCommandFixture.request.commandId}:other` }),
      ]);
      const fulfilled = outcomes.filter(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveResearchDevelopmentEvaluationPostgresV1>>>[];
      const rejected = outcomes.filter(result => result.status === "rejected");
      const committed = fulfilled.find(result => result.value.status === "COMMITTED");
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]!.value.status).toBe("COMMITTED");
      expect(rejected).toHaveLength(1);
      if (!committed?.value.receipt) throw new Error("DEE1159_CONCURRENT_COMMITTED_RECEIPT_REQUIRED");
      expect(await consumeCount(distinctCommandFixture.experiment.specSha256, committed.value.receipt.hypothesisId)).toBe(1);
      const secondAttempt = await registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
        specSha256: distinctCommandFixture.experiment.specSha256, sourceRunId: distinctCommandFixture.training.sourceRunId,
        commandId: `dee1159-claim-second-attempt-${randomUUID()}` });
      for (let trialIndex = 0; trialIndex < FAMILY.length; trialIndex++) {
        const diagnostic = await runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
          attemptId: secondAttempt.id, trialIndex, limits: { maxBars: LIMITS.maxBars, maxBytes: LIMITS.maxBytes } });
        expect(["COMMITTED", "REPLAYED"]).toContain(diagnostic.status);
      }
      const secondSelection = await selectResearchIssuedTrainingFamilyPostgresV1({ organizationId: ORG,
        attemptId: secondAttempt.id, limits: LIMITS });
      expect(secondSelection.receipt?.selectedParameters).toEqual(committed.value.receipt.selectedParameters);
      await expect(reserveResearchDevelopmentEvaluationPostgresV1({ ...distinctCommandFixture.request,
        commandId: `${distinctCommandFixture.request.commandId}:new-attempt`, attemptId: secondAttempt.id })).rejects.toThrow(/ALREADY_CONSUMED|SPLIT|VALIDATION/);
      expect((await rowCounts()).claims).toBe(distinctClaimsBefore + 1);
    } finally {
      sameCommandFixture.source.cleanup();
      distinctCommandFixture.source.cleanup();
    }
  }, 420_000);

  it("rolls back the global consume when immutable claim insertion fails", async () => {
    const f = await readyFixture("claim-rollback");
    const trigger = `dee1159_claim_fail_${randomUUID().replaceAll("-", "")}`;
    const fn = `${trigger}_fn`;
    try {
      const before = await rowCounts();
      await admin.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1159_INJECTED_CLAIM_INSERT_FAILURE'; END $$`);
      await admin.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.trader_research_development_evaluation_claims_v1 FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      await expect(reserveResearchDevelopmentEvaluationPostgresV1(f.request)).rejects.toThrow("DEE1159_INJECTED_CLAIM_INSERT_FAILURE");
      const after = await rowCounts();
      expect(after.claims).toBe(before.claims);
      expect(after.consumes).toBe(before.consumes);
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_development_evaluation_claims_v1`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      const retry = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(retry.status).toBe("COMMITTED");
      const afterRetry = await rowCounts();
      expect(afterRetry.claims).toBe(before.claims + 1);
      expect(afterRetry.consumes).toBe(before.consumes + 1);
    } finally {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_development_evaluation_claims_v1`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      f.source.cleanup();
    }
  }, 240_000);

  it("confirms lost COMMIT acknowledgement and leaves unavailable recovery for an explicit retry", async () => {
    const f = await readyFixture("claim-ack-loss");
    const parsed = new URL(url!);
    const proxyDatabaseUrl = (port: number) => { const p = new URL(url!); p.port = String(port); return p.toString(); };
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(parsed.port || 5432) });
    try {
      vi.stubEnv("DATABASE_URL_POSTGRES", proxyDatabaseUrl(proxy.port));
      const recovered = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(recovered.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(recovered.receipt).not.toBeNull();
      expect(proxy.stats().commitResponsesWithheld).toBe(1);
      expect(proxy.stats().protocolErrors).toBe(0);
    } finally { await proxy.close(); f.source.cleanup(); }

    const uncertainFixture = await readyFixture("claim-ack-unavailable");
    const unavailableProxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1",
      targetPort: Number(parsed.port || 5432), refuseReconnectAfterCommitLoss: true,
      cleanEofOnRefusedReconnect: true });
    try {
      vi.stubEnv("DATABASE_URL_POSTGRES", proxyDatabaseUrl(unavailableProxy.port));
      const uncertain = await reserveResearchDevelopmentEvaluationPostgresV1(uncertainFixture.request);
      expect(uncertain.status).toBe("COMMIT_UNCERTAIN");
      expect(uncertain.receipt).toBeNull();
      expect(unavailableProxy.stats().commitResponsesWithheld).toBe(1);
      expect(unavailableProxy.stats().protocolErrors).toBe(0);
      vi.stubEnv("DATABASE_URL_POSTGRES", url!);
      const retry = await reserveResearchDevelopmentEvaluationPostgresV1(uncertainFixture.request);
      expect(retry.status).toBe("REPLAYED");
      expect(retry.receipt).not.toBeNull();
    } finally { await unavailableProxy.close(); uncertainFixture.source.cleanup(); }
  }, 360_000);

  it("enforces claim immutability and denies browser roles", async () => {
    const f = await readyFixture("claim-grants-appendonly");
    try {
      const [grants] = await admin`SELECT
        has_table_privilege('anon','public.trader_research_development_evaluation_claims_v1','SELECT') AS anon_select,
        has_table_privilege('authenticated','public.trader_research_development_evaluation_claims_v1','SELECT') AS auth_select,
        has_table_privilege('anon','public.trader_research_development_evaluation_claims_v1','INSERT') AS anon_insert,
        has_table_privilege('authenticated','public.trader_research_development_evaluation_claims_v1','INSERT') AS auth_insert`;
      expect(grants).toEqual({ anon_select: false, auth_select: false, anon_insert: false, auth_insert: false });
      const result = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(result.status).toBe("COMMITTED");
      await expect(admin`UPDATE public.trader_research_development_evaluation_claims_v1 SET command_id='mutated'
        WHERE organization_id=${ORG}::uuid AND command_id=${f.request.commandId}`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
      await expect(admin`DELETE FROM public.trader_research_development_evaluation_claims_v1
        WHERE organization_id=${ORG}::uuid AND command_id=${f.request.commandId}`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
      await expect(admin`TRUNCATE public.trader_research_development_evaluation_claims_v1`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    } finally { f.source.cleanup(); }
  }, 240_000);
});
