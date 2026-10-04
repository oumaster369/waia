/** Synthetic-only end-to-end proof for the actual issued-source DEE-1212 diagnostic. */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import { createResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { registerResearchIssuedAttemptPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";
import { registerResearchAttemptPostgresV1 } from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";
import { startCommitAckLossProxy } from "@/tests/helpers/postgres-commit-ack-loss-proxy";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { deterministicUuidV8 } from "@/lib/trader/execution/deterministic-execution-id";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import { runResearchIssuedTrainingDiagnosticPostgresV2 } from "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { readResearchDevelopmentSourceRowsV1 } from "@/lib/trader/research/research-development-source-read-v1";
import {
  readResearchExperimentProposalFile,
  runDiscoveryExperimentRegistrationBranch,
  runDiscoveryIssuedAttemptRegistrationBranch,
} from "@/scripts/trader/discovery-registration";

const url = process.env.WAIA_DEE1212_POSTGRES_TEST_DATABASE_URL?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const LIMITS = Object.freeze({ maxBars: 64, maxBytes: 2_000_000 });
const FIXTURE_RELEASE_SHA = "d".repeat(40);
const POSITIVE_CLOSES = [120, 121, 122, 100, 100, 100, 100, 90, 100, 100, 100] as const;

/** Synthetic bars and signed fixture receipts are test scaffolding only. */
describe.skipIf(!enabled)("DEE-1212 issued DEVELOPMENT diagnostic PostgreSQL", () => {
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

  async function unregisteredFixture(label: string, options: Readonly<{ unsupportedGuardian?: boolean }> = {}) {
    const source = createResearchDevelopmentSourceFixtureV1({ closes: POSITIVE_CLOSES });
    sourceFixtureEnv(source);
    const commandId = `dee1212-${randomUUID()}`;
    const prepared = await prepareResearchDevelopmentSourcePostgresV1({
      organizationId: ORG, commandId, symbol: "BTCUSDT", initialRecordIndex: 0,
      observationBarCount: 2, gapBarCount: 1, trainingBarCount: 8,
    });
    if (prepared.status !== "COMMITTED" || !prepared.issuance) {
      source.cleanup();
      throw new Error("DEE1212_SYNTHETIC_SOURCE_ISSUANCE_FAILED");
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
    proposal.replay.portfolio = { startingBalanceUsdt: policy.portfolio.runConfig.startingBalanceUsdt,
      maxRiskPerTradePct: policy.portfolio.limits.maxRiskPerTradePct,
      maxPortfolioRiskPct: policy.portfolio.limits.maxPortfolioRiskPct,
      maxConcurrentPositions: policy.portfolio.limits.maxConcurrentPositions,
      maxNotional: policy.portfolio.limits.maxNotional, defaultStopDistancePct: null };
    proposal.replay.guardian = { enabled: true, maxHoldBars: 0, barIntervalMs: 60_000,
      enableExitEngine: false, htrAuthoritative: true,
      resolvedPolicySha256: policy.guardianResolvedPolicySha256 };
    if (options.unsupportedGuardian) proposal.replay.guardian.maxHoldBars = 1;
    proposal.replay.historicalExecutionModelSha256 = policy.historicalExecutionModelSha256;
    proposal.replay.defaultQuantity = "0.5";
    proposal.orderedTrials = [{ lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" }];
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
    return { source, issuance, proposal };
  }

  async function fixture(label: string, options: Readonly<{ unsupportedGuardian?: boolean }> = {}) {
    const { source, issuance, proposal } = await unregisteredFixture(label, options);
    const experiment = await registerResearchExperimentPostgresV1(
      drizzle(admin, { schema: pgSchema }) as never, { organizationId: ORG }, proposal);
    const attempt = await registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
      specSha256: experiment.specSha256, sourceRunId: issuance.sourceRunId,
      commandId: `dee1212-attempt-${randomUUID()}` });
    return { source, issuance, experiment, attempt };
  }

  const run = (f: Awaited<ReturnType<typeof fixture>>, targetUrl?: string) => {
    if (targetUrl) vi.stubEnv("DATABASE_URL_POSTGRES", targetUrl);
    else vi.stubEnv("DATABASE_URL_POSTGRES", url!);
    return runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
      attemptId: f.attempt.id, trialIndex: 0, limits: LIMITS });
  };

  async function stageCounts(attemptId: string, stageRunId?: string) {
    const rows = await admin`select
      (select count(*)::int from public.trader_research_issued_training_diagnostics_v2
        where organization_id=${ORG}::uuid and attempt_id=${attemptId}::uuid) as results,
      (select count(*)::int from public.trader_orders where organization_id=${ORG}::uuid
        and historical_run_id=${stageRunId ?? ""}) as orders,
      (select count(*)::int from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id=${stageRunId ?? ""}) as events,
      (select count(*)::int from public.trader_fills f join public.trader_orders o on o.id=f.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id=${stageRunId ?? ""}) as fills,
      (select count(*)::int from public.trader_fill_execution_economics e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id=${stageRunId ?? ""}) as economics,
      (select count(*)::int from public.trader_accounting_frontier
        where organization_id=${ORG}::uuid and run_id=${stageRunId ?? ""}) as frontiers`;
    return [rows[0]!.results, rows[0]!.orders, rows[0]!.events, rows[0]!.fills,
      rows[0]!.economics, rows[0]!.frontiers];
  }

  async function orgStageCounts() {
    const rows = await admin`select
      (select count(*)::int from public.trader_orders where organization_id=${ORG}::uuid
        and historical_run_id is not null) as orders,
      (select count(*)::int from public.trader_order_events e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as events,
      (select count(*)::int from public.trader_fills f join public.trader_orders o on o.id=f.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as fills,
      (select count(*)::int from public.trader_fill_execution_economics e join public.trader_orders o on o.id=e.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id is not null) as economics,
      (select count(*)::int from public.trader_accounting_frontier
        where organization_id=${ORG}::uuid) as frontiers`;
    return [rows[0]!.orders, rows[0]!.events, rows[0]!.fills, rows[0]!.economics, rows[0]!.frontiers];
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/waia_hsv2_it_dee1212_issued_training_v2") {
      throw new Error("DEE1212_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED");
    }
    admin = postgres(url!, { max: 8, prepare: false });
    const userId = randomUUID();
    await admin`insert into auth.users(id) values (${userId}::uuid) on conflict(id) do nothing`;
    await admin`insert into public.users(id,identity_label,email) values (${userId}::uuid,'DEE1212 synthetic',${`${userId}@waia.invalid`}) on conflict(id) do nothing`;
    await admin`insert into public.organizations(id,owner_user_id,kind,name)
      values (${ORG}::uuid,${userId}::uuid,'business','DEE1212 synthetic Org0') on conflict(id) do nothing`;
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
    vi.stubEnv("WAIA_RELEASE_SHA", FIXTURE_RELEASE_SHA);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("DATABASE_URL_POSTGRES", url!);
  });

  it("preserves the pre-existing default fixture bytes when no close override is supplied", () => {
    const defaultFixture = createResearchDevelopmentSourceFixtureV1();
    try {
      expect(createHash("sha256").update(defaultFixture.rawBytes).digest("hex"))
        .toBe("d1b9c6cfb549d860b5b9ea5f4230ff90fbe0b3c701b377ab49af5842e8fdc760");
    } finally { defaultFixture.cleanup(); }
  });

  it("registers experiment and issued attempt through explicit CLI branches with durable retry and no scoring", async () => {
    const f = await unregisteredFixture(`registration-cli-${randomUUID()}`);
    const directory = mkdtempSync(join(tmpdir(), "waia-dee1212-registration-"));
    try {
      const proposalFile = join(directory, "proposal.json");
      writeFileSync(proposalFile, JSON.stringify(f.proposal), { mode: 0o600 });
      const beforeStages = await orgStageCounts();
      const db = drizzle(admin, { schema: pgSchema });
      const authorize = vi.fn(); // Operator policy is tested separately; these callbacks use real DB owners.
      const experimentPrint = vi.fn();
      const experimentArgs = ["--register-experiment=1", `--org-id=${ORG}`, `--proposal-file=${proposalFile}`];
      const experimentInput = {
        cliEnabled: true, authorize, readProposal: readResearchExperimentProposalFile,
        register: (organizationId: string, proposal: unknown) =>
          registerResearchExperimentPostgresV1(db as never, { organizationId }, proposal),
        print: experimentPrint,
      };
      expect(await runDiscoveryExperimentRegistrationBranch(experimentArgs, experimentInput))
        .toEqual({ handled: true, exitCode: 0 });
      expect(await runDiscoveryExperimentRegistrationBranch(experimentArgs, experimentInput))
        .toEqual({ handled: true, exitCode: 0 });
      const experimentSummary = experimentPrint.mock.calls[0]![0];
      expect(experimentPrint.mock.calls[1]![0]).toEqual(experimentSummary);
      expect(experimentSummary).toMatchObject({ authority: "REGISTRATION_ONLY",
        registrationOnly: true, scientificQualified: false, capitalEligible: false });
      const experiments = await admin`select spec_sha256 from public.trader_research_experiments_v1
        where organization_id=${ORG}::uuid and spec_sha256=${experimentSummary.specSha256}`;
      expect(experiments).toHaveLength(1);

      const attemptPrint = vi.fn();
      const commandId = `registration-cli-${randomUUID()}`;
      const attemptArgs = ["--register-issued-attempt=1", `--org-id=${ORG}`,
        `--spec-sha256=${experimentSummary.specSha256}`, `--source-run-id=${f.issuance.sourceRunId}`,
        `--command-id=${commandId}`];
      const attemptInput = { cliEnabled: true, authorize,
        register: registerResearchIssuedAttemptPostgresV2, print: attemptPrint };
      expect(await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, attemptInput))
        .toEqual({ handled: true, exitCode: 0 });
      expect(await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, attemptInput))
        .toEqual({ handled: true, exitCode: 0 });
      const attemptSummary = attemptPrint.mock.calls[0]![0];
      expect(attemptPrint.mock.calls[1]![0]).toEqual(attemptSummary);
      expect(attemptSummary).toMatchObject({ authority: "REGISTRATION_ONLY",
        specSha256: experimentSummary.specSha256, sourceRunId: f.issuance.sourceRunId,
        sourceIssuanceDigest: f.issuance.contentDigest, scientificQualified: false, capitalEligible: false });
      const attempts = await admin`select id from public.trader_research_issued_attempts_v2
        where organization_id=${ORG}::uuid and command_id=${commandId}`;
      expect(attempts.map(row => row.id)).toEqual([attemptSummary.attemptId]);
      expect(await stageCounts(attemptSummary.attemptId)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(await orgStageCounts()).toEqual(beforeStages);
      // A syntactically valid but absent immutable source cannot become an issued attempt.
      const wrongSource = attemptArgs.map(arg => arg.startsWith("--source-run-id=")
        ? `--source-run-id=research-source-v1:${"a".repeat(64)}` : arg);
      expect(await runDiscoveryIssuedAttemptRegistrationBranch(wrongSource, attemptInput))
        .toEqual({ handled: true, exitCode: 1, error: "ISSUED_ATTEMPT_REGISTRATION_FAILED" });
      expect(attemptPrint).toHaveBeenCalledTimes(2);
      expect(authorize).toHaveBeenCalledTimes(5);
      expect(await orgStageCounts()).toEqual(beforeStages);
    } finally {
      f.source.cleanup();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it("refuses invalid declared DEVELOPMENT evaluation ranges before issued registration or modeled effects", async () => {
    const changes = [
      (proposal: ReturnType<typeof buildResearchExperimentProposalV1>) => { proposal.partitions.validation.barCount += 1; },
      (proposal: ReturnType<typeof buildResearchExperimentProposalV1>) => { proposal.partitions.walkForward[0]!.barCount += 1; },
      (proposal: ReturnType<typeof buildResearchExperimentProposalV1>) => {
        proposal.partitions.validation.firstOpenMs += 1;
        proposal.partitions.walkForward[0]!.firstOpenMs += 1;
      },
      (proposal: ReturnType<typeof buildResearchExperimentProposalV1>) => {
        const end = Date.parse(resolveFhvCanonicalPartitionInterval("development").endUtc);
        proposal.partitions.validation.firstOpenMs = end;
        proposal.partitions.validation.lastCloseMs = end + 10 * 60_000;
        proposal.partitions.walkForward[0]!.firstOpenMs = end;
        proposal.partitions.walkForward[0]!.lastCloseMs = end + 10 * 60_000;
        proposal.partitions.blind.firstOpenMs = end + 10 * 60_000;
        proposal.partitions.blind.lastCloseMs = end + 20 * 60_000;
      },
    ];
    for (const [index, change] of changes.entries()) {
      const f = await unregisteredFixture(`evaluation-range-${index}-${randomUUID()}`);
      try {
        change(f.proposal);
        // Generic experiment storage remains separate from this closed DEVELOPMENT lane.
        const experiment = await registerResearchExperimentPostgresV1(
          drizzle(admin, { schema: pgSchema }) as never, { organizationId: ORG }, f.proposal);
        if (index === 1) {
          // Deliberately corrupt this isolated fixture to prove metadata refusal
          // precedes the source-row check (which now fails for a different reason).
          await admin`alter table public.trader_historical_dataset_authority_v2
            disable trigger historical_dataset_authority_v2_append_only`;
          try {
            await admin`update public.trader_historical_dataset_authority_v2
              set authority_content_digest_hex=${"f".repeat(64)}
              where organization_id=${ORG}::uuid and run_id=${f.issuance.sourceRunId}`;
          } finally {
            await admin`alter table public.trader_historical_dataset_authority_v2
              enable trigger historical_dataset_authority_v2_append_only`;
          }
          await expect(readResearchDevelopmentSourceRowsV1(admin, f.issuance)).rejects.toThrow();
        }
        const commandId = `invalid-evaluation-${randomUUID()}`;
        const before = await orgStageCounts();
        await expect(registerResearchIssuedAttemptPostgresV2({ organizationId: ORG,
          specSha256: experiment.specSha256, sourceRunId: f.issuance.sourceRunId, commandId }))
          .rejects.toThrow("RESEARCH_DEVELOPMENT_EVALUATION_RANGE_INVALID");
        const attempts = await admin`select id from public.trader_research_issued_attempts_v2
          where organization_id=${ORG}::uuid and command_id=${commandId}`;
        expect(attempts).toHaveLength(0);
        expect(await orgStageCounts()).toEqual(before);
      } finally { f.source.cleanup(); }
    }
  }, 180_000);

  it("runs an actual issued DEVELOPMENT attempt and exact retry commits one nonqualifying ledger", async () => {
    const f = await fixture("issued-positive");
    try {
      const first = await run(f);
      const retry = await run(f);
      expect(first.status).toBe("COMMITTED");
      expect(retry.status).toBe("REPLAYED");
      if (!first.trace || !retry.trace) throw new Error("DEE1212_POSITIVE_TRACE_MISSING");
      expect(retry.trace).toEqual(first.trace);
      const trace = first.trace;
      expect(trace).toMatchObject({ authority: "TRAINING_ENGINEERING_TRACE_ONLY",
        sourceQualification: "NOT_ESTABLISHED", capitalEligible: false, scientificQualified: false,
        attemptId: f.attempt.id, sourceRunId: f.issuance.sourceRunId,
        sourceIssuanceDigest: f.issuance.contentDigest, orderCount: expect.any(Number), fillCount: expect.any(Number) });
      expect(trace.orderCount).toBeGreaterThan(0);
      expect(trace.fillCount).toBeGreaterThan(0);
      expect(await stageCounts(f.attempt.id, trace.stageRunId)).toEqual([
        1, trace.orderCount, expect.any(Number), trace.fillCount,
        expect.any(Number), expect.any(Number),
      ]);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses unknown and V1-shadow attempts without stage effects", async () => {
    const f = await fixture("v1-shadow-refusal");
    try {
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: randomUUID(), trialIndex: 0, limits: LIMITS })).rejects.toThrow();
      const legacy = await registerResearchAttemptPostgresV1(
        drizzle(admin, { schema: pgSchema }) as never, { organizationId: ORG }, {
          specSha256: f.experiment.specSha256, sourceRunId: f.issuance.sourceRunId,
          commandId: `dee1212-v1-shadow-${randomUUID()}` });
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: legacy.id, trialIndex: 0, limits: LIMITS })).rejects.toThrow();
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses cross-org, wrong-trial, changed-runtime, and unsupported-policy requests before effects", async () => {
    const f = await fixture("issued-preflight-refusals");
    try {
      const before = await orgStageCounts();
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: randomUUID(),
        attemptId: f.attempt.id, trialIndex: 0, limits: LIMITS })).rejects.toThrow();
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: f.attempt.id, trialIndex: 1, limits: LIMITS })).rejects.toThrow();
      vi.stubEnv("WAIA_RELEASE_SHA", "e".repeat(40));
      await expect(run(f)).rejects.toThrow("RESEARCH_ISSUED_EXPERIMENT_SOURCE_BINDING_MISMATCH");
      vi.stubEnv("WAIA_RELEASE_SHA", f.source.releaseSha);
      expect(await orgStageCounts()).toEqual(before);
    } finally { f.source.cleanup(); }

    const unsupported = await fixture("issued-unsupported-policy", { unsupportedGuardian: true });
    try {
      const before = await orgStageCounts();
      await expect(run(unsupported)).rejects.toThrow(/UNSUPPORTED_GUARDIAN|POLICY/);
      expect(await orgStageCounts()).toEqual(before);
      expect((await stageCounts(unsupported.attempt.id))[0]).toBe(0);
    } finally { unsupported.source.cleanup(); }
  }, 180_000);

  it("captures the strict request synchronously before caller mutation", async () => {
    const f = await fixture("issued-captured-request");
    try {
      const request: { organizationId: string; attemptId: string; trialIndex: number;
        limits: { maxBars: number; maxBytes: number } } = {
        organizationId: ORG, attemptId: f.attempt.id, trialIndex: 0, limits: { ...LIMITS },
      };
      const pending = runResearchIssuedTrainingDiagnosticPostgresV2(request);
      request.organizationId = randomUUID();
      request.trialIndex = 1;
      request.limits.maxBars = 1;
      const committed = await pending;
      expect(committed.status).toBe("COMMITTED");
      expect(committed.trace?.attemptId).toBe(f.attempt.id);
      expect(committed.trace?.trialIndex).toBe(0);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses runtime, trial, and policy before revoked market payload access", async () => {
    const supported = await fixture("issued-payload-denied");
    const unsupported = await fixture("issued-policy-payload-denied", { unsupportedGuardian: true });
    const role = `dee1212_metadata_${randomUUID().replaceAll("-", "")}`;
    const restrictedUrl = new URL(url!);
    restrictedUrl.username = role;
    restrictedUrl.password = "";
    // A test-only metadata principal cannot SELECT historical authority at all.
    // BYPASSRLS isolates projection permissions from unrelated tenant policies.
    await admin.unsafe(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER BYPASSRLS`);
    try {
      await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await admin.unsafe(`GRANT SELECT ON public.trader_research_experiments_v1,
        public.trader_strategy_admission_family,
        public.trader_research_development_source_runs_v1,
        public.trader_research_issued_training_diagnostics_v2 TO ${role}`);
      await admin.unsafe(`GRANT SELECT,UPDATE ON public.trader_research_issued_attempts_v2 TO ${role}`);
      const before = await orgStageCounts();
      // Prove the denial is effective for the otherwise valid path.
      await expect(run(supported, restrictedUrl.toString())).rejects.toThrow(/permission denied.*trader_historical_dataset_authority_v2/);
      vi.stubEnv("WAIA_RELEASE_SHA", "e".repeat(40));
      await expect(run(supported, restrictedUrl.toString())).rejects.toThrow("RESEARCH_ISSUED_EXPERIMENT_SOURCE_BINDING_MISMATCH");
      vi.stubEnv("WAIA_RELEASE_SHA", supported.source.releaseSha);
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: supported.attempt.id, trialIndex: 1, limits: LIMITS })).rejects.toThrow("TRIAL_NOT_DECLARED");
      await expect(run(unsupported, restrictedUrl.toString())).rejects.toThrow("UNSUPPORTED_GUARDIAN");
      expect(await orgStageCounts()).toEqual(before);
    } finally {
      await admin.unsafe(`DROP OWNED BY ${role}`);
      await admin.unsafe(`DROP ROLE ${role}`);
      supported.source.cleanup(); unsupported.source.cleanup();
    }
  }, 180_000);

  it("enforces the byte budget for observation, gap, and training before materialization", async () => {
    const f = await fixture("issued-total-byte-cap");
    try {
      const [sizes] = await admin`SELECT sum(octet_length(to_jsonb(d)::text))::integer AS total,
        sum(octet_length(to_jsonb(d)::text)) FILTER (WHERE (membership_json->>'recordIndex')::int >= 3)::integer AS training
        FROM public.trader_historical_dataset_authority_v2 d
        WHERE organization_id=${ORG}::uuid AND run_id=${f.issuance.sourceRunId}`;
      expect(sizes!.total).toBeGreaterThan(sizes!.training);
      const before = await orgStageCounts();
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: f.attempt.id, trialIndex: 0, limits: { maxBars: 64, maxBytes: sizes!.training } }))
        .rejects.toThrow("RESEARCH_DEVELOPMENT_SOURCE_ROW_BUDGET_OR_COUNT_MISMATCH");
      await expect(runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: f.attempt.id, trialIndex: 0, limits: { maxBars: 7, maxBytes: LIMITS.maxBytes } }))
        .rejects.toThrow("BAR_LIMIT");
      expect(await orgStageCounts()).toEqual(before);
      expect((await stageCounts(f.attempt.id))[0]).toBe(0);
      const result = await runResearchIssuedTrainingDiagnosticPostgresV2({ organizationId: ORG,
        attemptId: f.attempt.id, trialIndex: 0, limits: { maxBars: 8, maxBytes: sizes!.total } });
      expect(result.status).toBe("COMMITTED");
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("serializes simultaneous requests into one result and one actual execution ledger", async () => {
    const fixtures = [await fixture("issued-concurrency-0")];
    for (let index = 1; index < 4; index += 1) fixtures.push(await fixture(`issued-concurrency-${index}`));
    try {
      for (const f of fixtures) {
        const group = await Promise.allSettled([run(f), run(f)]);
        const statuses = group.map(outcome => outcome.status);
        const reasons = group.flatMap(outcome => outcome.status === "rejected" ? [String(outcome.reason)] : []);
        expect(statuses, reasons.join(" | ")).toEqual(["fulfilled", "fulfilled"]);
        const values = group.map(outcome => outcome.status === "fulfilled" ? outcome.value : null);
        const firstTrace = values[0]?.trace ?? null;
        const secondTrace = values[1]?.trace ?? null;
        if (!firstTrace || !secondTrace) throw new Error("DEE1212_CONCURRENT_TRACE_MISSING");
        expect(firstTrace).toEqual(secondTrace);
        expect(values.map(value => value?.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
        expect((await stageCounts(f.attempt.id, firstTrace.stageRunId))[0]).toBe(1);
      }
    } finally { for (const f of fixtures) f.source.cleanup(); }
  }, 180_000);

  it("preserves exact ledgers after bounded cross-attempt serialization refusals", async () => {
    const fixtures = [await fixture("issued-cross-attempt-0")];
    for (let index = 1; index < 4; index += 1) fixtures.push(await fixture(`issued-cross-attempt-${index}`));
    try {
      const simultaneous = await Promise.all(fixtures.map(f => Promise.allSettled([run(f), run(f)])));
      const refusals = simultaneous.flatMap(group => group.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"));
      for (const refusal of refusals) {
        expect(refusal.reason).toMatchObject({ code: "40001" });
      }

      for (const [index, group] of simultaneous.entries()) {
        const f = fixtures[index]!;
        const recovered = await run(f);
        const replay = await run(f);
        const anotherReplay = await run(f);
        if (!recovered.trace || !replay.trace || !anotherReplay.trace) {
          throw new Error("DEE1212_SERIALIZATION_RECOVERY_TRACE_MISSING");
        }
        expect([recovered.status, replay.status, anotherReplay.status]).toEqual([
          expect.stringMatching(/^(COMMITTED|REPLAYED)$/), "REPLAYED", "REPLAYED",
        ]);
        expect(replay.trace).toEqual(recovered.trace);
        expect(anotherReplay.trace).toEqual(recovered.trace);
        for (const outcome of group) {
          if (outcome.status === "fulfilled") expect(outcome.value.trace).toEqual(recovered.trace);
        }
        const ledgerCounts = await stageCounts(f.attempt.id, recovered.trace.stageRunId);
        expect(ledgerCounts).toEqual([
          1, recovered.trace.orderCount, expect.any(Number), recovered.trace.fillCount,
          expect.any(Number), expect.any(Number),
        ]);
        expect(await stageCounts(f.attempt.id, recovered.trace.stageRunId)).toEqual(ledgerCounts);
      }
    } finally { for (const f of fixtures) f.source.cleanup(); }
  }, 240_000);

  it("refuses a corrupted source row before any diagnostic result or execution effect", async () => {
    const f = await fixture("issued-source-corruption");
    try {
      const before = await orgStageCounts();
      await admin`alter table public.trader_historical_dataset_authority_v2
        disable trigger historical_dataset_authority_v2_append_only`;
      try {
        await admin`update public.trader_historical_dataset_authority_v2
          set authority_content_digest_hex=${"f".repeat(64)}
          where organization_id=${ORG}::uuid and run_id=${f.issuance.sourceRunId}
            and cycle_id like '%:DEVELOPMENT:BTCUSDT:3'`;
      } finally {
        await admin`alter table public.trader_historical_dataset_authority_v2
          enable trigger historical_dataset_authority_v2_append_only`;
      }
      await expect(run(f)).rejects.toThrow();
      expect((await stageCounts(f.attempt.id))[0]).toBe(0);
      expect(await orgStageCounts()).toEqual(before);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("revalidates and refuses same-count order, fill, economics, or frontier changes", async () => {
    const f = await fixture("issued-ledger-corruption");
    try {
      const committed = await run(f);
      if (!committed.trace) throw new Error("DEE1212_LEDGER_TRACE_MISSING");
      expect(committed.trace.fillCount).toBeGreaterThan(0);
      const [order] = await admin`select id::text,quantity,updated_at from public.trader_orders
        where organization_id=${ORG}::uuid and historical_run_id=${committed.trace.stageRunId} limit 1`;
      expect(order).toBeTruthy();
      await admin`update public.trader_orders set quantity='0.6' where id=${order!.id}::uuid`;
      await expect(run(f)).rejects.toThrow(/COMMITTED_LEDGER_DIVERGENT|LEDGER/);
      await admin`update public.trader_orders set quantity=${order!.quantity},updated_at=${order!.updated_at}::timestamptz
        where id=${order!.id}::uuid`;

      const [fill] = await admin`select f.id::text,f.quantity,f.created_at from public.trader_fills f
        join public.trader_orders o on o.id=f.order_id
        where o.organization_id=${ORG}::uuid and o.historical_run_id=${committed.trace.stageRunId} limit 1`;
      expect(fill).toBeTruthy();
      await admin`update public.trader_fills set quantity='0.0001' where id=${fill!.id}::uuid`;
      await expect(run(f)).rejects.toThrow(/COMMITTED_LEDGER_DIVERGENT|LEDGER/);
      await admin`update public.trader_fills set quantity=${fill!.quantity},created_at=${fill!.created_at}::timestamptz
        where id=${fill!.id}::uuid`;

      const [economics] = await admin`select id::text,total_execution_cost from public.trader_fill_execution_economics
        where organization_id=${ORG}::uuid and fill_id=${fill!.id}::uuid`;
      expect(economics).toBeTruthy();
      await admin`alter table public.trader_fill_execution_economics
        disable trigger waia_trader_fill_execution_economics_block_update`;
      try {
        await admin`update public.trader_fill_execution_economics set total_execution_cost='999999'
          where id=${economics!.id}::uuid`;
        await expect(run(f)).rejects.toThrow(/COMMITTED_LEDGER_DIVERGENT|LEDGER/);
        await admin`update public.trader_fill_execution_economics
          set total_execution_cost=${economics!.total_execution_cost} where id=${economics!.id}::uuid`;
      } finally {
        await admin`alter table public.trader_fill_execution_economics
          enable trigger waia_trader_fill_execution_economics_block_update`;
      }

      const [frontier] = await admin`select id::text,cash from public.trader_accounting_frontier
        where organization_id=${ORG}::uuid and run_id=${committed.trace.stageRunId}
        order by accounting_sequence limit 1`;
      expect(frontier).toBeTruthy();
      await admin`alter table public.trader_accounting_frontier
        disable trigger trader_accounting_frontier_block_update`;
      try {
        await admin`update public.trader_accounting_frontier set cash='999999'
          where id=${frontier!.id}::uuid`;
        await expect(run(f)).rejects.toThrow(/COMMITTED_LEDGER_DIVERGENT|LEDGER/);
        await admin`update public.trader_accounting_frontier set cash=${frontier!.cash}
          where id=${frontier!.id}::uuid`;
      } finally {
        await admin`alter table public.trader_accounting_frontier
          enable trigger trader_accounting_frontier_block_update`;
      }
      expect((await run(f)).trace).toEqual(committed.trace);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("refuses self-resealed top-level source, spec, or train identity changes", async () => {
    const f = await fixture("issued-trace-top-level-mutation");
    try {
      const committed = await run(f);
      if (!committed.trace) throw new Error("DEE1212_TRACE_MUTATION_FIXTURE_MISSING");
      const [stored] = await admin`select trace_canonical_json,trace_sha256
        from public.trader_research_issued_training_diagnostics_v2
        where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
      expect(stored).toBeTruthy();
      const originalJson = stored!.trace_canonical_json;
      const originalDigest = stored!.trace_sha256;
      const original = JSON.parse(originalJson) as Record<string, unknown>;
      const changes: ReadonlyArray<readonly [string, unknown]> = [
        ["sourceRunId", `research-source-v1:${"0".repeat(64)}`],
        ["experimentSpecSha256", "f".repeat(64)],
        ["trainPartitionSha256", "e".repeat(64)],
        ["historicalExecutionModelSha256", "f".repeat(64)],
        ["requestedExecutableSourceSha256", "e".repeat(64)],
        ["requestedPointInTimeEvidenceSha256", "f".repeat(64)],
        ["barCount", 7],
      ];
      await admin`alter table public.trader_research_issued_training_diagnostics_v2
        disable trigger research_issued_training_diagnostic_append_only`;
      try {
        for (const [field, replacement] of changes) {
          const forged = { ...original, [field]: replacement };
          const canonical = canonicalJsonString(forged);
          await admin`update public.trader_research_issued_training_diagnostics_v2
            set trace_canonical_json=${canonical},trace_sha256=${computeStableJsonDigest(forged)}
            where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
          await expect(run(f)).rejects.toThrow("COMMITTED_TRACE_LINEAGE_MISMATCH");
          await admin`update public.trader_research_issued_training_diagnostics_v2
            set trace_canonical_json=${originalJson},trace_sha256=${originalDigest}
            where organization_id=${ORG}::uuid and attempt_id=${f.attempt.id}::uuid and trial_index=0`;
        }
      } finally {
        await admin`alter table public.trader_research_issued_training_diagnostics_v2
          enable trigger research_issued_training_diagnostic_append_only`;
      }
      expect((await run(f)).trace).toEqual(committed.trace);
    } finally { f.source.cleanup(); }
  }, 180_000);

  it("rolls back all stage rows when the V2 result insert fails", async () => {
    const f = await fixture("issued-result-insert-fault");
    const before = await orgStageCounts();
    const trigger = `dee1212_result_fault_${randomUUID().replaceAll("-", "")}`;
    const fn = `${trigger}_fn`;
    await admin.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'DEE1212_SYNTHETIC_RESULT_FAULT'; END; $$`);
    await admin.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.trader_research_issued_training_diagnostics_v2
      FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
    try {
      await expect(run(f)).rejects.toThrow("DEE1212_SYNTHETIC_RESULT_FAULT");
      expect(await orgStageCounts()).toEqual(before);
      expect((await stageCounts(f.attempt.id))[0]).toBe(0);
    } finally {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_research_issued_training_diagnostics_v2`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
    }
    try { expect((await run(f)).trace?.fillCount).toBeGreaterThan(0); }
    finally { f.source.cleanup(); }
  }, 180_000);

  it("reports committed execution after a real COMMIT acknowledgment is withheld", async () => {
    const f = await fixture("issued-commit-ack-loss");
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(direct.port) });
    direct.port = String(proxy.port);
    direct.searchParams.set("sslmode", "disable");
    try {
      const result = await run(f, direct.toString());
      expect(result.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      if (!result.trace) throw new Error("DEE1212_ACK_LOSS_TRACE_MISSING");
      expect(result.trace.fillCount).toBeGreaterThan(0);
      expect(proxy.stats()).toEqual({ connections: expect.any(Number), commitResponsesWithheld: 1, protocolErrors: 0 });
      expect((await stageCounts(f.attempt.id, result.trace.stageRunId))[0]).toBe(1);
    } finally { await proxy.close(); f.source.cleanup(); }
  }, 180_000);

  it("returns no trace when commit confirmation is unavailable, then explicit retry replays persisted rows", async () => {
    const f = await fixture("issued-commit-ack-no-reconnect");
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(direct.port),
      refuseReconnectAfterCommitLoss: true, cleanEofOnRefusedReconnect: true });
    direct.port = String(proxy.port);
    direct.searchParams.set("sslmode", "disable");
    try {
      const startedAt = performance.now();
      const uncertain = await run(f, direct.toString());
      expect(performance.now() - startedAt).toBeLessThan(190_000);
      expect(uncertain).toMatchObject({ status: "COMMIT_UNCERTAIN", trace: null });
      expect(proxy.stats().commitResponsesWithheld).toBe(1);
      const settledConnections = proxy.stats().connections;
      expect(settledConnections).toBeLessThanOrEqual(6);
      await new Promise(resolve => setTimeout(resolve, 1_000));
      expect(proxy.stats().connections).toBe(settledConnections);
      expect(proxy.stats().protocolErrors).toBe(0);
      const replay = await run(f);
      expect(replay.status).toBe("REPLAYED");
      if (!replay.trace) throw new Error("DEE1212_RETRY_TRACE_MISSING");
      expect(replay.trace.fillCount).toBeGreaterThan(0);
      expect((await stageCounts(f.attempt.id, replay.trace.stageRunId))[0]).toBe(1);
    } finally { await proxy.close(); f.source.cleanup(); }
  }, 210_000);

  it("refuses an exact frontier primary-key 23505 when no committed V2 result exists", async () => {
    const f = await fixture("issued-frontier-pkey-conflict");
    const parameters = f.experiment.spec.orderedTrials[0]!;
    const stageScopeDigest = computeStableJsonDigest({ schemaVersion: "waia.research.issued_training_ledger_scope.v2",
      organizationId: ORG, attemptId: f.attempt.id, experimentSpecSha256: f.experiment.specSha256,
      sourceRunId: f.attempt.sourceRunId, sourceIssuanceDigest: f.attempt.sourceIssuanceDigest,
      trialIndex: 0, parameters, partitionSha256: f.experiment.spec.partitions.train.contentSha256 });
    const stageRunId = deterministicUuidV8(stageScopeDigest);
    const before = await orgStageCounts();
    const token = randomUUID().replaceAll("-", "");
    const sequence = `d12v2_${token}`;
    const fn = `${sequence}_fn`;
    const trigger = `${sequence}_trg`;
    try {
      await admin.unsafe(`CREATE SEQUENCE public.${sequence}`);
      await admin.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM nextval('public.${sequence}');
          RAISE unique_violation USING MESSAGE='DEE1212_SYNTHETIC_FRONTIER_PRIMARY_KEY',
            SCHEMA='public',TABLE='trader_accounting_frontier',
            CONSTRAINT='trader_accounting_frontier_pkey';
        END; $$`);
      await admin.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.trader_accounting_frontier
        FOR EACH ROW WHEN (NEW.organization_id='${ORG}'::uuid AND NEW.run_id='${stageRunId}')
        EXECUTE FUNCTION public.${fn}()`);
      let caught: unknown;
      try { await run(f); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ code: "23505", schema_name: "public",
        table_name: "trader_accounting_frontier", constraint_name: "trader_accounting_frontier_pkey" });
      expect(await orgStageCounts()).toEqual(before);
      expect(await stageCounts(f.attempt.id)).toEqual([0, 0, 0, 0, 0, 0]);
      const [sequenceState] = await admin.unsafe(`select last_value,is_called from public.${sequence}`);
      expect(sequenceState).toMatchObject({ last_value: "1", is_called: true });
    } finally {
      await admin.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.trader_accounting_frontier`);
      await admin.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
      await admin.unsafe(`DROP SEQUENCE IF EXISTS public.${sequence}`);
      f.source.cleanup();
    }
  }, 180_000);
});
