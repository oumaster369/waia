/** Synthetic-only proof that validation reservation consumes the frozen candidate before disclosure. */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
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
import { reserveResearchDevelopmentEvaluationPostgresV1, runResearchDevelopmentEvaluationPostgresV1,
  runResearchIssuedTrainingDiagnosticPostgresV2,
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

  async function readyFixture(label: string, options: { select?: boolean; incomplete?: boolean; evaluationDip?: boolean } = {}) {
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
    const source = createResearchDevelopmentSourceFixtureV1({
      barCount: 20, sourceReleaseSha: "a".repeat(40), releaseSha: "b".repeat(40),
      ...(options.evaluationDip ? { closes: [...Array<number>(11).fill(100), 100, 100, 100, 100, 90, 100, 100, 100, 100] } : {}),
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
  async function evaluationCounts(claimId?: string) {
    const [row] = await admin`SELECT
      (SELECT count(*)::int FROM public.trader_research_development_evaluation_scopes_v1
        WHERE ${claimId ?? null}::uuid IS NULL OR claim_id=${claimId ?? null}::uuid) AS scopes,
      (SELECT count(*)::int FROM public.trader_research_development_evaluation_results_v1
        WHERE ${claimId ?? null}::uuid IS NULL OR claim_id=${claimId ?? null}::uuid) AS results,
      (SELECT count(*)::int FROM public.trader_orders WHERE historical_account_key LIKE 'research-evaluation-stage:%') AS orders,
      (SELECT count(*)::int FROM public.trader_fills f JOIN public.trader_orders o ON o.id=f.order_id
        WHERE o.historical_account_key LIKE 'research-evaluation-stage:%') AS fills,
      (SELECT count(*)::int FROM public.trader_accounting_frontier WHERE account_key LIKE 'research-evaluation-stage:%') AS frontiers`;
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
      await expect(admin`TRUNCATE public.trader_research_development_evaluation_claims_v1 CASCADE`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    } finally { f.source.cleanup(); }
  }, 240_000);

  it("requires a committed claim before reading the evaluation payload", async () => {
    const f = await readyFixture("evaluation-requires-claim");
    try {
      const before = await evaluationCounts();
      const [datasetRow] = await admin`SELECT run_id,organization_id,
        (membership_json->>'recordIndex')::int AS record_index
        FROM public.trader_historical_dataset_authority_v2
        WHERE organization_id=${ORG}::uuid AND run_id=${f.request.evaluationSourceId} LIMIT 1`;
      expect(datasetRow).toBeTruthy();
      await admin.unsafe("ALTER TABLE public.trader_historical_dataset_authority_v2 DISABLE TRIGGER ALL");
      try {
        await admin`UPDATE public.trader_historical_dataset_authority_v2 SET run_id=${`research-evaluation-source-v1:${"f".repeat(64)}`}
          WHERE organization_id=${ORG}::uuid AND run_id=${f.request.evaluationSourceId}
            AND (membership_json->>'recordIndex')::int=${datasetRow!.record_index}`;
      } finally {
        await admin.unsafe("ALTER TABLE public.trader_historical_dataset_authority_v2 ENABLE TRIGGER ALL");
      }
      await expect(runResearchDevelopmentEvaluationPostgresV1(f.request))
        .rejects.toThrow("RESEARCH_EVALUATION_CLAIM_REFUSED:COMMITTED_CLAIM_REQUIRED");
      expect(await evaluationCounts()).toEqual(before);
    } finally { f.source.cleanup(); }
  }, 240_000);

  it("commits validation and every walk-forward stage, then verifies an effect-free replay", async () => {
    const f = await readyFixture("evaluation-batch-commit-replay", { evaluationDip: true });
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      const before = await evaluationCounts();
      const first = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(first.status).toBe("COMMITTED");
      if (!first.receipt) throw new Error("DEE1159_EVALUATION_RECEIPT_REQUIRED");
      expect(first.receipt).toMatchObject({ schemaVersion: "waia.research.development-evaluation.v1",
        claimId: claim.receipt.claimId, claimDigest: claim.receipt.contentDigest,
        scientificQualified: false, capitalEligible: false,
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(first.receipt.stages).toHaveLength(3);
      expect(first.receipt.stages.map(stage => [stage.stageOrdinal, stage.stageKind, stage.windowIndex])).toEqual([
        [0, "VALIDATION", 0], [1, "WALK_FORWARD", 0], [2, "WALK_FORWARD", 1],
      ]);
      expect(new Set(first.receipt.stages.map(stage => stage.stageRunId)).size).toBe(3);
      expect(new Set(first.receipt.stages.map(stage => stage.historicalAccountKey)).size).toBe(3);
      for (const stage of first.receipt.stages) {
        expect(stage.selectedParameters).toEqual(claim.receipt.selectedParameters);
        expect(stage.trialIndex).toBe(claim.receipt.selectedIndex);
        expect(stage.authority).toBe("EVALUATION_ENGINEERING_TRACE_ONLY");
        expect(stage.evaluationPartitionSha256).toMatch(/^[a-f0-9]{64}$/);
        const expectedFirstRecord = stage.stageOrdinal === 0 ? 11 : stage.stageOrdinal === 1 ? 11 : 14;
        const expectedBarCount = stage.stageOrdinal === 0 ? 6 : 3;
        expect(stage.inputUseReceipt.invocations.map(invocation => invocation.sourceBarIndex))
          .toEqual(Array.from({ length: expectedBarCount }, (_, offset) => expectedFirstRecord + offset));
        expect(stage).not.toHaveProperty("trainPartitionSha256");
      }
      expect(first.receipt.stages.map(stage => stage.evaluationPartitionSha256)).toEqual([
        f.evaluation.issuance!.metadata.validation.contentSha256,
        ...f.evaluation.issuance!.metadata.walkForward.map(part => part.contentSha256),
      ]);
      const afterFirst = await evaluationCounts(claim.receipt.claimId);
      expect(afterFirst).toMatchObject({ scopes: 3, results: 3 });
      expect(afterFirst.orders + afterFirst.fills + afterFirst.frontiers).toBeGreaterThan(0);
      // The validation dip must reach actual modeled submission and filling;
      // an all-NONE warmup run is not sufficient execution-path acceptance.
      expect(first.receipt.stages[0]!.orderCount).toBeGreaterThan(0);
      expect(first.receipt.stages[0]!.fillCount).toBeGreaterThan(0);
      const frontierRows = await admin`SELECT s.stage_ordinal,count(f.account_key)::int AS frontier_count
        FROM public.trader_research_development_evaluation_scopes_v1 s
        LEFT JOIN public.trader_accounting_frontier f ON f.organization_id=s.organization_id
          AND f.account_key=s.account_key AND f.run_id=s.stage_run_id::text
        WHERE s.organization_id=${ORG}::uuid AND s.claim_id=${claim.receipt.claimId}::uuid
        GROUP BY s.stage_ordinal ORDER BY s.stage_ordinal`;
      expect(frontierRows.map(row => row.stage_ordinal)).toEqual([0, 1, 2]);
      expect(frontierRows.every(row => row.frontier_count > 0)).toBe(true);

      const replay = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(replay.status).toBe("REPLAYED");
      expect(replay.receipt).toEqual(first.receipt);
      expect(await evaluationCounts(claim.receipt.claimId)).toEqual(afterFirst);
      expect((await evaluationCounts()).scopes).toBe(before.scopes + 3);
    } finally { f.source.cleanup(); }
  }, 360_000);

  it("rolls back every stage when a later result insert fails while retaining the prior claim", async () => {
    const f = await readyFixture("evaluation-batch-rollback");
    const trigger = `dee1159_eval_result_fail_${randomUUID().replaceAll("-", "")}`;
    const fn = `${trigger}_fn`;
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      const claimRowsBefore = await rowCounts();
      const countsBefore = await evaluationCounts(claim.receipt.claimId);
      await admin.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.stage_ordinal=1 THEN RAISE EXCEPTION 'DEE1159_INJECTED_LATE_STAGE_FAILURE'; END IF; RETURN NEW; END $$`);
      await admin.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.trader_research_development_evaluation_results_v1
        FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      await expect(runResearchDevelopmentEvaluationPostgresV1(f.request)).rejects.toThrow("DEE1159_INJECTED_LATE_STAGE_FAILURE");
      expect(await evaluationCounts(claim.receipt.claimId)).toEqual(countsBefore);
      const claimRowsAfter = await rowCounts();
      expect(claimRowsAfter.claims).toBe(claimRowsBefore.claims);
      expect(claimRowsAfter.consumes).toBe(claimRowsBefore.consumes);
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_development_evaluation_results_v1`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      const retry = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(retry.status).toBe("COMMITTED");
      expect(retry.receipt?.stages).toHaveLength(3);
      expect(await evaluationCounts(claim.receipt.claimId)).toMatchObject({ scopes: 3, results: 3 });
    } finally {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_development_evaluation_results_v1`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      f.source.cleanup();
    }
  }, 360_000);

  it("confirms the whole evaluation batch after a lost COMMIT acknowledgement", async () => {
    const f = await readyFixture("evaluation-batch-ack-loss");
    const parsed = new URL(url!);
    const proxyDatabaseUrl = (port: number) => { const p = new URL(url!); p.port = String(port); return p.toString(); };
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(parsed.port || 5432) });
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      vi.stubEnv("DATABASE_URL_POSTGRES", proxyDatabaseUrl(proxy.port));
      const result = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(result.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(result.receipt?.claimId).toBe(claim.receipt.claimId);
      expect(result.receipt?.stages).toHaveLength(3);
      expect(proxy.stats().commitResponsesWithheld).toBe(1);
      expect(proxy.stats().protocolErrors).toBe(0);
      vi.stubEnv("DATABASE_URL_POSTGRES", url!);
      expect(await evaluationCounts(claim.receipt.claimId)).toMatchObject({ scopes: 3, results: 3 });
    } finally { await proxy.close(); f.source.cleanup(); }
  }, 360_000);

  it("serializes concurrent evaluation calls for one committed claim into one batch and one replay", async () => {
    const f = await readyFixture("evaluation-batch-concurrent-replay");
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      const outcomes = await Promise.all([
        runResearchDevelopmentEvaluationPostgresV1(f.request),
        runResearchDevelopmentEvaluationPostgresV1(f.request),
      ]);
      expect(outcomes.map(result => result.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
      const firstReceipt = outcomes[0]!.receipt;
      const secondReceipt = outcomes[1]!.receipt;
      if (!firstReceipt || !secondReceipt) throw new Error("DEE1159_CONCURRENT_EVALUATION_RECEIPT_REQUIRED");
      expect(firstReceipt).toEqual(secondReceipt);
      expect(firstReceipt.stages).toHaveLength(3);
      expect(await evaluationCounts(claim.receipt.claimId)).toMatchObject({ scopes: 3, results: 3 });
      const [scopeAccounts] = await admin`SELECT count(DISTINCT account_key)::int AS n
        FROM public.trader_research_development_evaluation_scopes_v1
        WHERE organization_id=${ORG}::uuid AND claim_id=${claim.receipt.claimId}::uuid`;
      expect(scopeAccounts!.n).toBe(3);
    } finally { f.source.cleanup(); }
  }, 360_000);

  it("uses separate operator child processes for reservation and evaluation without duplicate effects", async () => {
    const f = await readyFixture("evaluation-cli-child-sequence", { evaluationDip: true });
    const requestFile = `${f.source.rootDir}/evaluation-claim-request.json`;
    writeFileSync(requestFile, JSON.stringify(f.request), { mode: 0o600 });
    const stageCounts = async () => ({ rows: await rowCounts(), effects: await modelEffects(), stages: await evaluationCounts() });
    const before = await stageCounts();
    const invoke = async (action: "RESERVE" | "EVALUATE", cliEnabled = true) => {
      const mode = action === "RESERVE" ? "--reserve-development-evaluation=1" : "--run-development-evaluation=1";
      try {
        const result = await promisify(execFile)(process.execPath,
          ["--import", "tsx", "--conditions=react-server", "scripts/trader/discovery-run.ts", mode,
            `--org-id=${ORG}`, `--request-file=${requestFile}`],
          { cwd: process.cwd(), env: { ...process.env, ...(cliEnabled ? { WAIA_TRADER_CLI: "1" } : { WAIA_TRADER_CLI: "" }) },
            timeout: 120_000, maxBuffer: 256 * 1024 });
        const line = result.stdout.trim().split("\n").find(value => value.startsWith(
          "[trader:discovery:run] development-evaluation "));
        if (!line) throw new Error("DEE1159_EVALUATION_CLI_SUMMARY_REQUIRED");
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr,
          summary: JSON.parse(line.slice("[trader:discovery:run] development-evaluation ".length)) };
      } catch (error) {
        const child = error as { code?: number | string; stdout?: string; stderr?: string };
        return { exitCode: Number(child.code ?? 1), stdout: String(child.stdout ?? ""), stderr: String(child.stderr ?? ""), summary: null };
      }
    };
    try {
      const missingCli = await invoke("EVALUATE", false);
      expect(missingCli.exitCode).toBe(1);
      expect(missingCli.stderr).toContain("WAIA_TRADER_CLI=1 is required");
      expect(await stageCounts()).toEqual(before);

      const premature = await invoke("EVALUATE");
      expect(premature.exitCode).toBe(1);
      expect(premature.summary).toBeNull();
      expect(await stageCounts()).toEqual(before);

      const reserve = await invoke("RESERVE");
      expect(reserve.exitCode).toBe(0);
      expect(reserve.summary).toMatchObject({ action: "RESERVE", status: "COMMITTED", stageCount: 0,
        scientificQualified: false, capitalEligible: false });
      expect(reserve.summary.claimId).toMatch(/^[a-f0-9-]{36}$/);
      expect(reserve.summary.claimDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(reserve.summary.receiptDigest).toBe(reserve.summary.claimDigest);
      const reservedCounts = await stageCounts();
      expect(reservedCounts.stages).toEqual(before.stages);
      expect(reservedCounts.effects).toEqual(before.effects);

      const reserveReplay = await invoke("RESERVE");
      expect(reserveReplay.exitCode).toBe(0);
      expect(reserveReplay.summary).toEqual({ ...reserve.summary, status: "REPLAYED" });
      expect(await stageCounts()).toEqual(reservedCounts);

      const evaluated = await invoke("EVALUATE");
      expect(evaluated.exitCode).toBe(0);
      expect(evaluated.summary).toMatchObject({ action: "EVALUATE", status: "COMMITTED",
        claimId: reserve.summary.claimId, claimDigest: reserve.summary.claimDigest, stageCount: 3,
        scientificQualified: false, capitalEligible: false });
      expect(evaluated.summary.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
      const evaluationCommittedCounts = await stageCounts();
      const evaluationReplay = await invoke("EVALUATE");
      expect(evaluationReplay.exitCode).toBe(0);
      expect(evaluationReplay.summary).toEqual({ ...evaluated.summary, status: "REPLAYED" });
      expect(await stageCounts()).toEqual(evaluationCommittedCounts);

      const [claimRow] = await admin`SELECT receipt_canonical_json FROM public.trader_research_development_evaluation_claims_v1
        WHERE organization_id=${ORG}::uuid AND claim_id=${reserve.summary.claimId}::uuid`;
      expect(claimRow).toBeTruthy();
      const claimReceipt = JSON.parse(claimRow!.receipt_canonical_json);
      const traces = await admin`SELECT trace_canonical_json FROM public.trader_research_development_evaluation_results_v1
        WHERE organization_id=${ORG}::uuid AND claim_id=${reserve.summary.claimId}::uuid ORDER BY stage_ordinal`;
      const parsedTraces = traces.map(row => JSON.parse(row.trace_canonical_json));
      expect(parsedTraces).toHaveLength(3);
      expect(parsedTraces.every(trace => trace.trialIndex === claimReceipt.selectedIndex &&
        JSON.stringify(trace.selectedParameters) === JSON.stringify(claimReceipt.selectedParameters))).toBe(true);
      expect(parsedTraces.some(trace => trace.orders.length > 0)).toBe(true);
      expect(parsedTraces.some(trace => trace.fillDetails.length > 0)).toBe(true);
      const finalCounts = await stageCounts();
      expect(finalCounts.stages).toMatchObject({ scopes: before.stages.scopes + 3, results: before.stages.results + 3 });
      expect(finalCounts.effects.orders).toBeGreaterThan(before.effects.orders);
      expect(finalCounts.effects.fills).toBeGreaterThan(before.effects.fills);
      expect(finalCounts.effects.diagnostics).toBe(before.effects.diagnostics);
    } finally { f.source.cleanup(); }
  }, 600_000);

  it("refuses a tampered committed stage trace on replay", async () => {
    const f = await readyFixture("evaluation-batch-tampered-result");
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      const result = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(result.status).toBe("COMMITTED");
      await admin.unsafe("ALTER TABLE public.trader_research_development_evaluation_results_v1 DISABLE TRIGGER ALL");
      try {
        await admin`UPDATE public.trader_research_development_evaluation_results_v1 SET
          trace_canonical_json=replace(trace_canonical_json,'"barCount":6','"barCount":5'),
          trace_sha256=encode(sha256(convert_to(replace(trace_canonical_json,'"barCount":6','"barCount":5'),'UTF8')),'hex')
          WHERE organization_id=${ORG}::uuid AND claim_id=${claim.receipt.claimId}::uuid AND stage_ordinal=0`;
      } finally {
        await admin.unsafe("ALTER TABLE public.trader_research_development_evaluation_results_v1 ENABLE TRIGGER ALL");
      }
      await expect(runResearchDevelopmentEvaluationPostgresV1(f.request))
        .rejects.toThrow("RESEARCH_DEVELOPMENT_EVALUATION_REFUSED:COMMITTED_RESULT_CHANGED");
    } finally { f.source.cleanup(); }
  }, 360_000);

  it("enforces evaluation stage immutability and denies browser roles", async () => {
    const f = await readyFixture("evaluation-batch-grants-appendonly");
    try {
      const claim = await reserveResearchDevelopmentEvaluationPostgresV1(f.request);
      if (!claim.receipt) throw new Error("DEE1159_EVALUATION_CLAIM_REQUIRED");
      const result = await runResearchDevelopmentEvaluationPostgresV1(f.request);
      expect(result.status).toBe("COMMITTED");
      const [grants] = await admin`SELECT
        has_table_privilege('anon','public.trader_research_development_evaluation_scopes_v1','SELECT') AS anon_scope_select,
        has_table_privilege('authenticated','public.trader_research_development_evaluation_results_v1','SELECT') AS auth_result_select,
        has_table_privilege('anon','public.trader_research_development_evaluation_scopes_v1','INSERT') AS anon_scope_insert,
        has_table_privilege('authenticated','public.trader_research_development_evaluation_results_v1','INSERT') AS auth_result_insert`;
      expect(grants).toEqual({ anon_scope_select: false, auth_result_select: false,
        anon_scope_insert: false, auth_result_insert: false });
      await expect(admin`UPDATE public.trader_research_development_evaluation_scopes_v1 SET account_key='mutated'
        WHERE organization_id=${ORG}::uuid AND claim_id=${claim.receipt.claimId}::uuid`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
      await expect(admin`DELETE FROM public.trader_research_development_evaluation_results_v1
        WHERE organization_id=${ORG}::uuid AND claim_id=${claim.receipt.claimId}::uuid`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
      await expect(admin`TRUNCATE public.trader_research_development_evaluation_scopes_v1 CASCADE`)
        .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    } finally { f.source.cleanup(); }
  }, 360_000);
});
