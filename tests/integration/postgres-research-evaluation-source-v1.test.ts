/** Synthetic-only proof of the restricted DEVELOPMENT evaluation-source issuer. */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { loadStrategyAdmissionJournal } from "@/lib/trader/research/strategy-admission-journal-postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { prepareResearchDevelopmentEvaluationSourcePostgresV1 } from "@/lib/trader/research/research-development-evaluation-source-owner-postgres-v1";
import { researchDevelopmentEvaluationSourceIdV1 } from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import { RESEARCH_EVALUATION_SOURCE_LOGIN_V1, RESEARCH_EVALUATION_SOURCE_ROLE_V1 } from "@/lib/trader/research/research-development-evaluation-source-issuance-v1";
import { requireResearchEvaluationSourceLoginV1 } from "@/lib/trader/research/research-development-evaluation-source-role-v1";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import { createResearchDevelopmentSourceFixtureV1, type ResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";
import { startCommitAckLossProxy } from "@/tests/helpers/postgres-commit-ack-loss-proxy";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const TRAINING_LOGIN = "waia_research_source_writer_login";

describe.skipIf(!enabled)("DEE-1159 DEVELOPMENT evaluation-source PostgreSQL", () => {
  let admin: postgres.Sql;
  let fixture: ResearchDevelopmentSourceFixtureV1;
  let trainingUrl: string;
  let evaluationUrl: string;

  const trainingRequest = () => ({ organizationId: ORG, commandId: `dee1159-train-${randomUUID()}`,
    symbol: "BTCUSDT" as const, initialRecordIndex: 0, observationBarCount: 2,
    gapBarCount: 1, trainingBarCount: 3 });
  const evaluationRequest = (training: Readonly<{ sourceRunId: string; contentDigest: string }>,
    commandId = `dee1159-eval-${randomUUID()}`) => ({
    organizationId: ORG, commandId,
    trainingSourceRunId: training.sourceRunId,
    trainingSourceIssuanceDigest: training.contentDigest,
    symbol: "BTCUSDT" as const,
    validation: { firstRecordIndex: 6, barCount: 6 },
    walkForward: [{ firstRecordIndex: 6, barCount: 2 }, { firstRecordIndex: 10, barCount: 2 }],
  });
  const datasetRows = async (runId: string, organizationId = ORG) => admin<{
    id: string; cycle_id: string; authority_content_digest_hex: string; record_index: number;
    membership_json: Record<string, unknown>; sealed_cycle_json: Record<string, unknown>;
  }[]>`
    SELECT id::text,cycle_id,authority_content_digest_hex,
      (membership_json->>'recordIndex')::integer AS record_index,membership_json,sealed_cycle_json
    FROM public.trader_historical_dataset_authority_v2
    WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
    ORDER BY (membership_json->>'recordIndex')::integer`;
  const issuanceCount = async (commandId: string, organizationId: string = ORG) =>
    (await admin`SELECT count(*)::int AS n FROM public.trader_research_evaluation_source_runs_v1
      WHERE organization_id=${organizationId}::uuid AND command_id=${commandId}`)[0]!.n;
  const evaluationRows = async (commandId: string, organizationId = ORG) => {
    const id = `research-evaluation-source-v1:${computeStableJsonDigest({ organizationId, commandId })}`;
    return datasetRows(id, organizationId);
  };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/waia_hsv2_it_dee1159_eval_source_v1") {
      throw new Error("DEE1159_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED");
    }
    admin = postgres(url!, { max: 3, prepare: false, onnotice: () => {} });
    const ownerId = randomUUID();
    await admin`INSERT INTO auth.users(id) VALUES (${ownerId}::uuid)`;
    await admin`INSERT INTO public.users(id,identity_label,email)
      VALUES (${ownerId}::uuid,'DEE-1159 synthetic',${`${ownerId}@waia.invalid`})`;
    await admin`INSERT INTO public.organizations(id,owner_user_id,kind,name)
      VALUES (${ORG}::uuid,${ownerId}::uuid,'business','DEE-1159 synthetic Org0') ON CONFLICT(id) DO NOTHING`;
    await admin`CREATE TABLE IF NOT EXISTS public.dee1159_eval_acl_probe(id integer)`;
    const training = new URL(url!);
    training.username = TRAINING_LOGIN; training.password = "";
    trainingUrl = training.toString();
    const evaluation = new URL(url!);
    evaluation.username = RESEARCH_EVALUATION_SOURCE_LOGIN_V1; evaluation.password = "";
    evaluationUrl = evaluation.toString();
  });

  beforeEach(() => {
    fixture = createResearchDevelopmentSourceFixtureV1({
      barCount: 14, sourceReleaseSha: "a".repeat(40), releaseSha: "b".repeat(40),
    });
    vi.stubEnv("WAIA_RELEASE_SHA", fixture.releaseSha);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", trainingUrl);
    vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", evaluationUrl);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATASET_ROOT", fixture.datasetRoot);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH", fixture.qualificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH", fixture.runtimeRequalificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_VOLUME_PATH", fixture.htxVolumeQualificationReceiptPath);
  });

  afterEach(() => { fixture?.cleanup(); vi.unstubAllEnvs(); });
  afterAll(async () => { await admin?.end({ timeout: 2 }); });

  async function issueTrainingSource() {
    const result = await prepareResearchDevelopmentSourcePostgresV1(trainingRequest());
    if (!result.issuance || !["COMMITTED", "REPLAYED", "CONFIRMED_AFTER_UNCERTAINTY"].includes(result.status)) {
      throw new Error("DEE1159_SYNTHETIC_TRAINING_SOURCE_ISSUANCE_FAILED");
    }
    return result.issuance;
  }

  it("reloads committed consumption without a score and preserves rolled-back availability", async () => {
    const specSha256 = computeStableJsonDigest({ test: "consume-before-result", nonce: randomUUID() });
    const use = { specSha256, hypothesisId: "frozen-candidate", split: "validation" as const };
    await admin.begin(async tx => {
      await tx`INSERT INTO public.trader_strategy_admission_family(spec_sha256,family_size) VALUES (${specSha256},1)`;
      await tx`INSERT INTO public.trader_strategy_admission_split_consume(spec_sha256,hypothesis_id,split)
        VALUES (${specSha256},${use.hypothesisId},'validation')`;
    });
    await expect(admin.begin(async tx => {
      await tx`INSERT INTO public.trader_strategy_admission_split_consume(spec_sha256,hypothesis_id,split)
        VALUES (${specSha256},'rolled-back-candidate','validation')`;
      throw new Error("synthetic rollback before disclosure");
    })).rejects.toThrow("synthetic rollback before disclosure");
    const fresh = postgres(url!, { max: 1, prepare: false });
    try {
      const { journal, baseline } = await loadStrategyAdmissionJournal(drizzle(fresh, { schema }));
      expect(journal.registeredFamilySize(specSha256)).toBe(1);
      expect(journal.splitUseCount(use)).toBe(1);
      expect(() => journal.assertSplitAvailable(use)).toThrow(/split_already_used/);
      expect(() => journal.assertSplitAvailable({ ...use, hypothesisId: "rolled-back-candidate" })).not.toThrow();
      expect(() => journal.assertSplitAvailable({ ...use, split: "holdout" })).not.toThrow();
      expect(journal.list()).toEqual([]);
      expect(baseline.rowCount).toBe(0);
      const [counts] = await fresh`SELECT
        (SELECT count(*)::int FROM public.trader_strategy_admission_split_consume WHERE spec_sha256=${specSha256}) AS consumes,
        (SELECT count(*)::int FROM public.trader_strategy_admission_journal WHERE spec_sha256=${specSha256}) AS metrics`;
      expect(counts).toEqual({ consumes: 1, metrics: 0 });
    } finally { await fresh.end({ timeout: 2 }); }
  });

  it("commits exact indexed rows and metadata, then returns the immutable retry without payload", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const first = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    expect(first.status).toBe("COMMITTED");
    const firstIssuance = first.issuance;
    if (!firstIssuance) throw new Error("DEE1159_COMMITTED_ISSUANCE_REQUIRED");
    expect(firstIssuance).toMatchObject({
      schemaVersion: "waia.research.development-evaluation-source-issuance.v1",
      authority: "RESTRICTED_EVALUATION_SOURCE_WRITER_V1",
      issuerRole: "waia_research_eval_source_writer",
      metadata: {
        authority: "PREPARATION_METADATA_ONLY",
        sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
        scientificQualified: false,
        capitalEligible: false,
        validation: { firstRecordIndex: 6, barCount: 6,
          contentSha256: expect.any(String), firstOpenMs: Date.parse(fixture.bars[6]!.barOpenTime),
          lastCloseMs: Date.parse(fixture.bars[11]!.barCloseTime) },
        walkForward: [
          { firstRecordIndex: 6, barCount: 2, contentSha256: expect.any(String) },
          { firstRecordIndex: 10, barCount: 2, contentSha256: expect.any(String) },
        ],
      },
    });
    expect(firstIssuance.metadata.validation.contentSha256)
      .toBe(computeBarSetDigest(fixture.bars.slice(6, 12)));
    expect(firstIssuance.metadata.walkForward.map(window => window.contentSha256)).toEqual([
      computeBarSetDigest(fixture.bars.slice(6, 8)), computeBarSetDigest(fixture.bars.slice(10, 12)),
    ]);
    expect(firstIssuance).not.toHaveProperty("bars");
    expect(firstIssuance).not.toHaveProperty("cycles");
    expect(firstIssuance.metadata).not.toHaveProperty("bars");
    expect(firstIssuance.metadata).not.toHaveProperty("cycles");
    expect(JSON.stringify(firstIssuance)).not.toContain('"close"');
    expect(JSON.stringify(firstIssuance)).not.toContain('"open"');

    const rows = await evaluationRows(request.commandId);
    expect(rows.map(row => row.record_index)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(rows.every(row => row.cycle_id.startsWith(`${researchDevelopmentEvaluationSourceIdV1(request)}:DEVELOPMENT:BTCUSDT:`))).toBe(true);
    expect(firstIssuance.rowSetSha256).toBe(computeStableJsonDigest(rows.map(row => ({
      id: row.id, cycleId: row.cycle_id, authorityDigest: row.authority_content_digest_hex,
    }))));
    expect(await issuanceCount(request.commandId)).toBe(1);

    const retry = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    expect(retry.status).toBe("REPLAYED");
    expect(retry.issuance).toEqual(firstIssuance);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
    expect(await issuanceCount(request.commandId)).toBe(1);
  });

  it("prepares and replays through the real operator CLI without payload or scoring effects", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const requestFile = join(fixture.rootDir, "evaluation-selection.json");
    writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
    const stageCounts = async () => (await admin`SELECT
      (SELECT count(*)::int FROM public.trader_orders WHERE organization_id=${ORG}::uuid) AS orders,
      (SELECT count(*)::int FROM public.trader_fills f JOIN public.trader_orders o ON o.id=f.order_id
        WHERE o.organization_id=${ORG}::uuid) AS fills,
      (SELECT count(*)::int FROM public.trader_accounting_frontier WHERE organization_id=${ORG}::uuid) AS frontiers,
      (SELECT count(*)::int FROM public.trader_research_training_diagnostics_v1 WHERE organization_id=${ORG}::uuid) AS diagnostics,
      (SELECT count(*)::int FROM public.trader_research_issued_attempts_v2 WHERE organization_id=${ORG}::uuid) AS attempts`)[0];
    const beforeStages = await stageCounts();
    const invoke = async () => {
      const { stdout, stderr } = await promisify(execFile)(process.execPath,
        ["--import", "tsx", "--conditions=react-server", "scripts/trader/discovery-run.ts",
          "--prepare-evaluation-source=1", `--org-id=${ORG}`, `--request-file=${requestFile}`],
        { cwd: process.cwd(), env: { ...process.env, WAIA_TRADER_CLI: "1" }, timeout: 30_000, maxBuffer: 256 * 1024 });
      expect(stderr).toBe("");
      const lines = stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[trader:discovery:run\] evaluation-source /);
      return JSON.parse(lines[0]!.replace("[trader:discovery:run] evaluation-source ", ""));
    };
    const first = await invoke();
    expect(first).toMatchObject({ status: "COMMITTED", preparationOnly: true,
      evaluationSourceId: researchDevelopmentEvaluationSourceIdV1(request),
      trainingSourceRunId: training.sourceRunId, trainingSourceIssuanceDigest: training.contentDigest,
      scientificQualified: false, capitalEligible: false });
    expect(first.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.rowSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(first).sort()).toEqual(["status", "preparationOnly", "evaluationSourceId", "trainingSourceRunId",
      "trainingSourceIssuanceDigest", "contentDigest", "rowSetSha256", "scientificQualified", "capitalEligible"].sort());
    expect(await invoke()).toEqual({ ...first, status: "REPLAYED" });
    expect(await issuanceCount(request.commandId)).toBe(1);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
    expect(await stageCounts()).toEqual(beforeStages);
  }, 60_000);

  it("refuses missing and forged training issuance bindings without partial writes", async () => {
    const training = await issueTrainingSource();
    const missing = evaluationRequest({ sourceRunId: `research-source-v1:${"0".repeat(64)}`,
      contentDigest: "1".repeat(64) });
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(missing))
      .rejects.toThrow(/TRAINING|SOURCE_REQUIRED/);
    const forged = evaluationRequest({ sourceRunId: training.sourceRunId,
      contentDigest: "2".repeat(64) });
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(forged))
      .rejects.toThrow(/TRAINING|SOURCE|DIGEST/);
    expect(await issuanceCount(missing.commandId)).toBe(0);
    expect(await evaluationRows(missing.commandId)).toHaveLength(0);
    expect(await issuanceCount(forged.commandId)).toBe(0);
    expect(await evaluationRows(forged.commandId)).toHaveLength(0);
  });

  it("refuses changed selection under the same command and corrupt source without partial rows", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    const changed = evaluationRequest(training, request.commandId);
    changed.validation = { firstRecordIndex: 7, barCount: 6 };
    changed.walkForward = [{ firstRecordIndex: 7, barCount: 2 }, { firstRecordIndex: 11, barCount: 2 }];
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(changed))
      .rejects.toThrow(/COMMAND_CONFLICT/);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
    expect(await issuanceCount(request.commandId)).toBe(1);

    const corrupt = evaluationRequest(training);
    writeFileSync(`${fixture.datasetRoot}/partitions/development/BTCUSDT/bars.v2.ndjson`,
      Buffer.concat([fixture.rawBytes, Buffer.from("\n")]));
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(corrupt)).rejects.toThrow();
    expect(await evaluationRows(corrupt.commandId)).toHaveLength(0);
    expect(await issuanceCount(corrupt.commandId)).toBe(0);
  });

  it("refuses a saved evaluation row moved out of its committed run on retry", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const first = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    if (!first.issuance) throw new Error("DEE1159_COMMITTED_ISSUANCE_REQUIRED");
    const escapedRun = `research-evaluation-source-v1:${"f".repeat(64)}`;
    await admin`ALTER TABLE public.trader_historical_dataset_authority_v2 DISABLE TRIGGER ALL`;
    try {
      const [moved] = await admin<{ id: string }[]>`SELECT id::text FROM public.trader_historical_dataset_authority_v2
        WHERE organization_id=${ORG}::uuid AND run_id=${first.issuance.metadata.evaluationSourceId}
        ORDER BY (membership_json->>'recordIndex')::integer LIMIT 1`;
      if (!moved) throw new Error("DEE1159_EVALUATION_ROWS_REQUIRED_FOR_CORRUPTION_TEST");
      await admin`UPDATE public.trader_historical_dataset_authority_v2 SET run_id=${escapedRun}
        WHERE organization_id=${ORG}::uuid AND id=${moved.id}::uuid`;
    } finally {
      await admin`ALTER TABLE public.trader_historical_dataset_authority_v2 ENABLE TRIGGER ALL`;
    }
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(request))
      .rejects.toThrow(/EXISTING_ROW_SCOPE|ROW_COUNT|ROWSET|BINDING/);
    expect(await evaluationRows(request.commandId)).toHaveLength(5);
    expect(await issuanceCount(request.commandId)).toBe(1);
  });

  it("serializes concurrent callers into one committed evaluation and one replay", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const results = await Promise.all([
      prepareResearchDevelopmentEvaluationSourcePostgresV1(request),
      prepareResearchDevelopmentEvaluationSourcePostgresV1(request),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
    expect(results[0]!.issuance).toEqual(results[1]!.issuance);
    expect(await issuanceCount(request.commandId)).toBe(1);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
  });

  it("enforces fixed-org RLS against DB-shaped foreign rows and prevents training-source inserts", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    const foreignOrg = randomUUID();
    const foreignOwner = randomUUID();
    await admin`INSERT INTO auth.users(id) VALUES (${foreignOwner}::uuid)`;
    await admin`INSERT INTO public.users(id,identity_label,email)
      VALUES (${foreignOwner}::uuid,'DEE-1159 foreign synthetic',${`${foreignOwner}@waia.invalid`})`;
    await admin`INSERT INTO public.organizations(id,owner_user_id,kind,name)
      VALUES (${foreignOrg}::uuid,${foreignOwner}::uuid,'business','DEE-1159 foreign synthetic Org')`;

    // Admin-seed DB-shape-consistent foreign-row fixtures so RLS is tested
    // against rows that exist. These altered-org packets are test data only; app readers
    // intentionally reject them because the internal research Org0 is fixed.
    const [trainingDbRow] = await admin<{ packet: string }[]>`SELECT issuance_json::text AS packet
      FROM public.trader_research_development_source_runs_v1
      WHERE organization_id=${ORG}::uuid AND source_run_id=${training.sourceRunId}`;
    if (!trainingDbRow) throw new Error("DEE1159_TRAINING_RECEIPT_REQUIRED_FOR_RLS_TEST");
    const foreignTrainingCommand = `dee1159-foreign-train-${randomUUID()}`;
    const foreignTrainingRun = `research-source-v1:${computeStableJsonDigest({
      organizationId: foreignOrg, commandId: foreignTrainingCommand,
    })}`;
    const foreignTrainingPacket = JSON.parse(trainingDbRow.packet) as Record<string, unknown>;
    const foreignTrainingRequest = foreignTrainingPacket.request as Record<string, unknown>;
    foreignTrainingPacket.request = { ...foreignTrainingRequest,
      organizationId: foreignOrg, commandId: foreignTrainingCommand };
    foreignTrainingPacket.sourceRunId = foreignTrainingRun;
    delete foreignTrainingPacket.contentDigest;
    const foreignTrainingDigest = computeStableJsonDigest(foreignTrainingPacket);
    foreignTrainingPacket.contentDigest = foreignTrainingDigest;
    await admin`INSERT INTO public.trader_research_development_source_runs_v1
      (organization_id,source_run_id,command_id,content_digest,issuance_json,issued_at)
      VALUES (${foreignOrg}::uuid,${foreignTrainingRun},${foreignTrainingCommand},${foreignTrainingDigest},
        ${JSON.stringify(foreignTrainingPacket)}::text::jsonb,${String(foreignTrainingPacket.issuedAt)}::timestamptz)`;

    const [evaluationDbRow] = await admin<{ packet: string }[]>`SELECT issuance_json::text AS packet
      FROM public.trader_research_evaluation_source_runs_v1
      WHERE organization_id=${ORG}::uuid AND command_id=${request.commandId}`;
    if (!evaluationDbRow) throw new Error("DEE1159_EVALUATION_RECEIPT_REQUIRED_FOR_RLS_TEST");
    const foreignCommand = `dee1159-foreign-eval-${randomUUID()}`;
    const foreignEvaluationId = `research-evaluation-source-v1:${computeStableJsonDigest({
      organizationId: foreignOrg, commandId: foreignCommand,
    })}`;
    const foreignEvaluationPacket = JSON.parse(evaluationDbRow.packet) as Record<string, unknown>;
    const foreignMetadata = foreignEvaluationPacket.metadata as Record<string, unknown>;
    const foreignEvaluationRequest = foreignMetadata.request as Record<string, unknown>;
    foreignEvaluationPacket.metadata = { ...foreignMetadata, evaluationSourceId: foreignEvaluationId,
      request: { ...foreignEvaluationRequest, organizationId: foreignOrg, commandId: foreignCommand,
        trainingSourceRunId: foreignTrainingRun, trainingSourceIssuanceDigest: foreignTrainingDigest } };
    delete foreignEvaluationPacket.contentDigest;
    const foreignEvaluationDigest = computeStableJsonDigest(foreignEvaluationPacket);
    foreignEvaluationPacket.contentDigest = foreignEvaluationDigest;
    await admin`INSERT INTO public.trader_research_evaluation_source_runs_v1
      (organization_id,evaluation_source_id,command_id,training_source_run_id,training_source_issuance_digest,
       content_digest,issuance_json,issued_at)
      VALUES (${foreignOrg}::uuid,${foreignEvaluationId},${foreignCommand},${foreignTrainingRun},${foreignTrainingDigest},
        ${foreignEvaluationDigest},${JSON.stringify(foreignEvaluationPacket)}::text::jsonb,
        ${String(foreignEvaluationPacket.issuedAt)}::timestamptz)`;
    expect(await issuanceCount(foreignCommand, foreignOrg)).toBe(1);
    expect((await admin`SELECT count(*)::int AS n FROM public.trader_research_development_source_runs_v1
      WHERE organization_id=${foreignOrg}::uuid AND source_run_id=${foreignTrainingRun}`)[0]!.n).toBe(1);

    const evalSql = postgres(evaluationUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const visibleTrainingRow = await evalSql.begin(async tx => {
        await tx`SET LOCAL ROLE waia_research_eval_source_writer`;
        const foreignRows = await tx`SELECT count(*)::int AS n
          FROM public.trader_research_evaluation_source_runs_v1
          WHERE organization_id=${foreignOrg}::uuid`;
        const foreignTraining = await tx`SELECT count(*)::int AS n
          FROM public.trader_research_development_source_runs_v1
          WHERE organization_id=${foreignOrg}::uuid`;
        expect(foreignRows[0]!.n).toBe(0);
        expect(foreignTraining[0]!.n).toBe(0);

        const [trainingRow] = await tx<{
          id: string; organization_id: string; run_id: string; cycle_id: string;
          dataset_authority_class: string; dataset_authority_digest_hex: string;
          membership_content_digest_hex: string; sealed_cycle_content_digest_hex: string;
          membership_json: Record<string, unknown>; sealed_cycle_json: Record<string, unknown>;
          authority_content_digest_hex: string; schema_version: string;
        }[]>`SELECT id::text,organization_id::text,run_id,cycle_id,
          dataset_authority_class,dataset_authority_digest_hex,membership_content_digest_hex,
          sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,authority_content_digest_hex,schema_version
          FROM public.trader_historical_dataset_authority_v2
          WHERE organization_id=${ORG}::uuid AND run_id=${training.sourceRunId} LIMIT 1`;
        if (!trainingRow) throw new Error("DEE1159_TRAINING_ROW_NOT_VISIBLE_TO_EVALUATION_ROLE");
        return trainingRow;
      });
      if (!visibleTrainingRow) throw new Error("DEE1159_TRAINING_ROW_NOT_VISIBLE_TO_EVALUATION_ROLE");
      const membership = visibleTrainingRow.membership_json;
      const cycle = visibleTrainingRow.sealed_cycle_json;
      const deniedCycleId = `${training.sourceRunId}:DEVELOPMENT:BTCUSDT:999999`;
      const deniedMembership = { ...membership, cycleId: deniedCycleId, contentDigestHex: "a".repeat(64) };
      const deniedCycle = { ...cycle, cycleId: deniedCycleId };
      await expect(evalSql.begin(async tx => {
        await tx`SET LOCAL ROLE waia_research_eval_source_writer`;
        await tx`INSERT INTO public.trader_historical_dataset_authority_v2
          (id,organization_id,run_id,cycle_id,dataset_authority_class,dataset_authority_digest_hex,
           membership_content_digest_hex,sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
           authority_content_digest_hex,schema_version)
          VALUES (gen_random_uuid(),${ORG}::uuid,${training.sourceRunId},${deniedCycleId},
            ${visibleTrainingRow.dataset_authority_class},${visibleTrainingRow.dataset_authority_digest_hex},
            ${"a".repeat(64)},${visibleTrainingRow.sealed_cycle_content_digest_hex},
            ${JSON.stringify(deniedMembership)}::text::jsonb,${JSON.stringify(deniedCycle)}::text::jsonb,
            ${"b".repeat(64)},${visibleTrainingRow.schema_version})`;
      })).rejects.toThrow(/row-level security|policy/i);
      await expect(evalSql.begin(async tx => {
        await tx`SET LOCAL ROLE waia_research_eval_source_writer`;
        await tx`INSERT INTO public.trader_research_development_source_runs_v1
          (organization_id,source_run_id,command_id,content_digest,issuance_json,issued_at)
          VALUES (${ORG}::uuid,${training.sourceRunId},${`denied-${randomUUID()}`},${"c".repeat(64)},
            ${"{}"}::text::jsonb,clock_timestamp())`;
      })).rejects.toThrow(/permission denied|privilege/i);
    } finally { await evalSql.end({ timeout: 2 }); }
    expect(await datasetRows(training.sourceRunId)).toHaveLength(6);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
  });

  it("protects committed evaluation receipts against update, delete and truncate", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
    await expect(admin`UPDATE public.trader_research_evaluation_source_runs_v1 SET command_id='mutated'
      WHERE organization_id=${ORG}::uuid AND command_id=${request.commandId}`)
      .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    await expect(admin`DELETE FROM public.trader_research_evaluation_source_runs_v1
      WHERE organization_id=${ORG}::uuid AND command_id=${request.commandId}`)
      .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    await expect(admin`TRUNCATE TABLE public.trader_research_evaluation_source_runs_v1 CASCADE`)
      .rejects.toThrow("RESEARCH_SOURCE_APPEND_ONLY");
    expect(await issuanceCount(request.commandId)).toBe(1);
    expect(await evaluationRows(request.commandId)).toHaveLength(6);
  });

  it("rolls back all evaluation rows when issuance insertion fails", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    await admin.unsafe(`CREATE FUNCTION public.dee1159_eval_fail_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1159_INJECTED'; END; $$`);
    await admin.unsafe(`CREATE TRIGGER dee1159_eval_fail_insert
      BEFORE INSERT ON public.trader_research_evaluation_source_runs_v1
      FOR EACH ROW EXECUTE FUNCTION public.dee1159_eval_fail_insert()`);
    try {
      await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(request)).rejects.toThrow("DEE1159_INJECTED");
      expect(await issuanceCount(request.commandId)).toBe(0);
      expect(await evaluationRows(request.commandId)).toHaveLength(0);
    } finally {
      await admin.unsafe(`DROP TRIGGER dee1159_eval_fail_insert ON public.trader_research_evaluation_source_runs_v1`);
      await admin.unsafe(`DROP FUNCTION public.dee1159_eval_fail_insert()`);
    }
  });

  it.each(["table grant", "table owner", "role admin option", "disabled RLS", "public definer"])(
    "rejects a poisoned evaluation writer capability: %s", async poison => {
      const training = await issueTrainingSource();
      const request = evaluationRequest(training);
      try {
        if (poison === "table grant") await admin.unsafe(`GRANT SELECT ON public.dee1159_eval_acl_probe TO ${RESEARCH_EVALUATION_SOURCE_ROLE_V1}`);
        if (poison === "table owner") await admin.unsafe(`ALTER TABLE public.dee1159_eval_acl_probe OWNER TO ${RESEARCH_EVALUATION_SOURCE_ROLE_V1}`);
        if (poison === "role admin option") await admin.unsafe(`GRANT ${RESEARCH_EVALUATION_SOURCE_ROLE_V1} TO ${RESEARCH_EVALUATION_SOURCE_LOGIN_V1} WITH ADMIN OPTION`);
        if (poison === "disabled RLS") await admin`ALTER TABLE public.trader_research_evaluation_source_runs_v1 DISABLE ROW LEVEL SECURITY`;
        if (poison === "public definer") await admin.unsafe(`CREATE FUNCTION public.dee1159_eval_acl_definer() RETURNS integer
          LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`);
        await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(request))
          .rejects.toThrow("RESEARCH_EVALUATION_SOURCE_WRITER_LOGIN_REFUSED");
        expect(await issuanceCount(request.commandId)).toBe(0);
        expect(await evaluationRows(request.commandId)).toHaveLength(0);
      } finally {
        if (poison === "table owner") await admin.unsafe(`ALTER TABLE public.dee1159_eval_acl_probe OWNER TO ${admin.options.user}`);
        await admin.unsafe(`REVOKE ALL ON public.dee1159_eval_acl_probe FROM ${RESEARCH_EVALUATION_SOURCE_ROLE_V1}`);
        await admin.unsafe(`REVOKE ADMIN OPTION FOR ${RESEARCH_EVALUATION_SOURCE_ROLE_V1} FROM ${RESEARCH_EVALUATION_SOURCE_LOGIN_V1}`);
        await admin`ALTER TABLE public.trader_research_evaluation_source_runs_v1 ENABLE ROW LEVEL SECURITY`;
        if (poison === "public definer") await admin`DROP FUNCTION public.dee1159_eval_acl_definer()`;
      }
    });

  it("refuses generic sessions and a training login for evaluation-source writes", async () => {
    await expect(requireResearchEvaluationSourceLoginV1(admin as unknown as postgres.TransactionSql))
      .rejects.toThrow("RESEARCH_EVALUATION_SOURCE_TRANSACTION_SESSION_REQUIRED");
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", trainingUrl);
    await expect(prepareResearchDevelopmentEvaluationSourcePostgresV1(request))
      .rejects.toThrow(/DEDICATED_LOGIN_REQUIRED|WRITER_LOGIN_REFUSED/);
    expect(await issuanceCount(request.commandId)).toBe(0);
    expect(await evaluationRows(request.commandId)).toHaveLength(0);
  });

  it("confirms a committed issuance after its COMMIT response is lost", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const parsed = new URL(evaluationUrl);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(parsed.port || 5432) });
    parsed.port = String(proxy.port);
    vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", parsed.toString());
    try {
      const result = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
      expect(result.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(result.issuance).not.toBeNull();
      expect(proxy.stats().commitResponsesWithheld).toBe(1);
      expect(proxy.stats().protocolErrors).toBe(0);
      expect(await issuanceCount(request.commandId)).toBe(1);
      expect(await evaluationRows(request.commandId)).toHaveLength(6);
    } finally { await proxy.close(); }
  }, 40_000);

  it("returns no issuance when commit recovery cannot reconnect and does not leak sessions", async () => {
    const training = await issueTrainingSource();
    const request = evaluationRequest(training);
    const parsed = new URL(evaluationUrl);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1",
      targetPort: Number(parsed.port || 5432), refuseReconnectAfterCommitLoss: true,
      cleanEofOnRefusedReconnect: true });
    parsed.port = String(proxy.port);
    vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", parsed.toString());
    try {
      const started = performance.now();
      const uncertain = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
      expect(performance.now() - started).toBeLessThan(70_000);
      expect(uncertain.status).toBe("COMMIT_UNCERTAIN");
      expect(uncertain.issuance).toBeNull();
      expect(proxy.stats().commitResponsesWithheld).toBe(1);
      expect(proxy.stats().protocolErrors).toBe(0);
      const settledConnections = proxy.stats().connections;
      await new Promise(resolve => setTimeout(resolve, 1_000));
      expect(proxy.stats().connections).toBe(settledConnections);
      expect(await issuanceCount(request.commandId)).toBe(1);
      expect(await evaluationRows(request.commandId)).toHaveLength(6);

      vi.stubEnv("WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL", evaluationUrl);
      const later = await prepareResearchDevelopmentEvaluationSourcePostgresV1(request);
      expect(later.status).toBe("REPLAYED");
      expect(later.issuance).not.toBeNull();
      expect(await issuanceCount(request.commandId)).toBe(1);
      expect(await evaluationRows(request.commandId)).toHaveLength(6);
    } finally { await proxy.close(); }
  }, 90_000);
});
