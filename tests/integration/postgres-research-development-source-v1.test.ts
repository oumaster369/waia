/** Synthetic-only proof of the actual restricted source owner and issued reader. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { registerResearchIssuedAttemptPostgresV2, loadResearchIssuedTrainingInputPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { researchDevelopmentSourceRunIdV1, RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import { requireResearchDevelopmentSourceLoginV1 } from "@/lib/trader/research/research-development-source-role-v1";
import { createResearchDevelopmentSourceFixtureV1, type ResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";
import { startCommitAckLossProxy } from "@/tests/helpers/postgres-commit-ack-loss-proxy";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const LOGIN = "waia_research_source_writer_login";
const ROLE = "waia_research_source_writer";

describe.skipIf(!enabled)("DEE-1211 observed research source PostgreSQL", () => {
  let admin: postgres.Sql;
  let fixture: ResearchDevelopmentSourceFixtureV1;
  let sourceUrl: string;
  const request = () => ({ organizationId: ORG, commandId: randomUUID(), symbol: "BTCUSDT" as const,
    initialRecordIndex: 0, observationBarCount: 2, gapBarCount: 1, trainingBarCount: 3 });
  const rows = async (runId: string) => (await admin`SELECT count(*)::int AS n
    FROM public.trader_historical_dataset_authority_v2 WHERE organization_id=${ORG}::uuid AND run_id=${runId}`)[0]!.n;
  const receipts = async (commandId: string) => (await admin`SELECT count(*)::int AS n
    FROM public.trader_research_development_source_runs_v1 WHERE organization_id=${ORG}::uuid AND command_id=${commandId}`)[0]!.n;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || !/^\/waia_dee1211_[a-z0-9_]+$/.test(parsed.pathname)) {
      throw new Error("DEE1211_DISPOSABLE_LOOPBACK_DATABASE_REQUIRED");
    }
    admin = postgres(url!, { max: 2, prepare: false, onnotice: () => {} });
    const ownerId = randomUUID();
    await admin`INSERT INTO auth.users(id) VALUES (${ownerId}::uuid)`;
    await admin`INSERT INTO public.users(id,identity_label,email) VALUES (${ownerId}::uuid,'DEE1211 synthetic',${`${ownerId}@waia.invalid`})`;
    await admin`INSERT INTO public.organizations(id,owner_user_id,kind,name)
      VALUES (${ORG}::uuid,${ownerId}::uuid,'internal','DEE1211 synthetic Org0') ON CONFLICT(id) DO NOTHING`;
    parsed.username = LOGIN; parsed.password = "";
    sourceUrl = parsed.toString();
    await admin`CREATE TABLE public.dee1211_acl_probe(id integer)`;
  });
  beforeEach(() => {
    // Different source/runtime versions exercise the actual receipt read and
    // requalification binding, without treating synthetic upstream data as proof.
    fixture = createResearchDevelopmentSourceFixtureV1({ sourceReleaseSha: "a".repeat(40), releaseSha: "b".repeat(40) });
    vi.stubEnv("WAIA_RELEASE_SHA", fixture.releaseSha); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", sourceUrl);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATASET_ROOT", fixture.datasetRoot);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH", fixture.qualificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH", fixture.runtimeRequalificationReceiptPath);
    vi.stubEnv("WAIA_RESEARCH_SOURCE_VOLUME_PATH", fixture.htxVolumeQualificationReceiptPath);
  });
  afterEach(() => { fixture?.cleanup(); vi.unstubAllEnvs(); });
  afterAll(async () => { await admin?.end({ timeout: 2 }); });

  it("issues from loaded bytes, commits exact rows and returns the same result on retry", async () => {
    const command = request();
    const first = await prepareResearchDevelopmentSourcePostgresV1(command);
    expect(first.status).toBe("COMMITTED"); expect(first.issuance).not.toBeNull();
    expect(first.observation).toEqual(fixture.bars.slice(0, 2));
    expect(first.issuance!.partitionRawSha256).toBe(fixture.qualificationReceipt.partitions[0]!.rawSha256);
    expect(first.issuance!.scientificallyQualified).toBe(false);
    expect(first.issuance!.sourceAvailability).toBe("PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED");
    const retry = await prepareResearchDevelopmentSourcePostgresV1(command);
    expect(retry.status).toBe("REPLAYED"); expect(retry.issuance).toEqual(first.issuance);
    expect(await rows(first.issuance!.sourceRunId)).toBe(6); expect(await receipts(command.commandId)).toBe(1);
  });

  it("refuses generic owner login, wrong Org0 and a pool masquerading as a reserved backend before issuance", async () => {
    const command = request();
    await expect(requireResearchDevelopmentSourceLoginV1(admin as unknown as postgres.ReservedSql))
      .rejects.toThrow("RESERVED_SESSION_REQUIRED");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", url!);
    await expect(prepareResearchDevelopmentSourcePostgresV1(command)).rejects.toThrow("DEDICATED_LOGIN_REQUIRED");
    vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", sourceUrl);
    await expect(prepareResearchDevelopmentSourcePostgresV1({ ...command, organizationId: randomUUID() })).rejects.toThrow();
    expect(await receipts(command.commandId)).toBe(0);
  });

  it.each(["table grant", "table owner", "schema grant option", "role admin option"])(
    "rejects a poisoned writer capability: %s", async poison => {
      const command = request();
      try {
        if (poison === "table grant") await admin.unsafe(`GRANT SELECT ON public.dee1211_acl_probe TO ${ROLE}`);
        if (poison === "table owner") await admin.unsafe(`ALTER TABLE public.dee1211_acl_probe OWNER TO ${ROLE}`);
        if (poison === "schema grant option") await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE} WITH GRANT OPTION`);
        if (poison === "role admin option") await admin.unsafe(`GRANT ${ROLE} TO ${LOGIN} WITH ADMIN OPTION`);
        await expect(prepareResearchDevelopmentSourcePostgresV1(command)).rejects.toThrow("WRITER_LOGIN_REFUSED");
        expect(await receipts(command.commandId)).toBe(0); expect(await rows(researchDevelopmentSourceRunIdV1(command))).toBe(0);
      } finally {
        if (poison === "table owner") await admin.unsafe(`ALTER TABLE public.dee1211_acl_probe OWNER TO ${admin.options.user}`);
        await admin.unsafe(`REVOKE ALL ON public.dee1211_acl_probe FROM ${ROLE}`);
        await admin.unsafe(`REVOKE GRANT OPTION FOR USAGE ON SCHEMA public FROM ${ROLE}`);
        await admin.unsafe(`REVOKE ADMIN OPTION FOR ${ROLE} FROM ${LOGIN}`);
      }
    });

  it("serializes two real connections to one committed source and one replay", async () => {
    const command = request();
    const results = await Promise.all([prepareResearchDevelopmentSourcePostgresV1(command), prepareResearchDevelopmentSourcePostgresV1(command)]);
    expect(results.map(result => result.status).sort()).toEqual(["COMMITTED", "REPLAYED"]);
    expect(results[0]!.issuance).toEqual(results[1]!.issuance);
    expect(await receipts(command.commandId)).toBe(1);
    expect(await rows(researchDevelopmentSourceRunIdV1(command))).toBe(6);
  });

  it("rolls back nested dataset writes when issuance insertion fails", async () => {
    const command = request();
    await admin.unsafe(`CREATE FUNCTION public.dee1211_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1211_INJECTED'; END; $$`);
    await admin.unsafe(`CREATE TRIGGER dee1211_fail_insert BEFORE INSERT ON public.trader_research_development_source_runs_v1 FOR EACH ROW EXECUTE FUNCTION public.dee1211_fail_insert()`);
    try {
      await expect(prepareResearchDevelopmentSourcePostgresV1(command)).rejects.toThrow("DEE1211_INJECTED");
      expect(await receipts(command.commandId)).toBe(0); expect(await rows(researchDevelopmentSourceRunIdV1(command))).toBe(0);
    } finally {
      await admin.unsafe(`DROP TRIGGER dee1211_fail_insert ON public.trader_research_development_source_runs_v1`);
      await admin.unsafe(`DROP FUNCTION public.dee1211_fail_insert()`);
    }
  });

  it("confirms a real committed source after its COMMIT response is lost", async () => {
    const parsed = new URL(sourceUrl);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(parsed.port || 5432) });
    parsed.port = String(proxy.port); vi.stubEnv("WAIA_RESEARCH_SOURCE_DATABASE_URL", parsed.toString());
    const command = request();
    try {
      const result = await prepareResearchDevelopmentSourcePostgresV1(command);
      expect(result.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(proxy.stats().commitResponsesWithheld).toBe(1); expect(proxy.stats().protocolErrors).toBe(0);
      expect(await receipts(command.commandId)).toBe(1); expect(await rows(researchDevelopmentSourceRunIdV1(command))).toBe(6);
    } finally { await proxy.close(); }
  });

  it("refuses changed selection, deployment and raw source bytes without adding a source", async () => {
    const command = request();
    await prepareResearchDevelopmentSourcePostgresV1(command);
    await expect(prepareResearchDevelopmentSourcePostgresV1({ ...command, trainingBarCount: 4 })).rejects.toThrow("COMMAND_CONFLICT");
    vi.stubEnv("WAIA_RELEASE_SHA", "c".repeat(40));
    await expect(prepareResearchDevelopmentSourcePostgresV1(command)).rejects.toThrow("COMMAND_CONFLICT");
    vi.stubEnv("WAIA_RELEASE_SHA", fixture.releaseSha);
    writeFileSync(`${fixture.datasetRoot}/partitions/development/BTCUSDT/bars.v2.ndjson`, Buffer.concat([fixture.rawBytes, Buffer.from("\n")]));
    await expect(prepareResearchDevelopmentSourcePostgresV1(command)).rejects.toThrow();
    expect(await receipts(command.commandId)).toBe(1); expect(await rows(researchDevelopmentSourceRunIdV1(command))).toBe(6);
  });

  it("registers only an exact source-bound experiment and rereads its issued training snapshot", async () => {
    const prepared = await prepareResearchDevelopmentSourcePostgresV1(request());
    const issuance = prepared.issuance!;
    const proposal = buildResearchExperimentProposalV1(ORG, randomUUID());
    proposal.executable.sourceSha256 = resolveCurrentResearchExecutableIdentityV1().sourceSha256;
    proposal.hypothesis.observationEvidenceSha256 = [issuance.observation.contentSha256];
    proposal.hypothesis.observationCutoffMs = issuance.observation.lastCloseMs;
    proposal.universe.datasetSourceSha256 = issuance.qualificationReceiptDigest;
    proposal.universe.knownAtMs = issuance.observation.firstOpenMs;
    proposal.replay.volumeQualificationSha256 = issuance.volumeQualificationDigest;
    proposal.partitions.train = { contentSha256: issuance.training.contentSha256,
      firstOpenMs: issuance.training.firstOpenMs,lastCloseMs: issuance.training.lastCloseMs,barCount: issuance.training.barCount };
    const after = issuance.training.lastCloseMs;
    proposal.partitions.validation = { contentSha256: "2".repeat(64),firstOpenMs: after,lastCloseMs: after+600000,barCount: 10 };
    proposal.partitions.blind = { contentSha256: "3".repeat(64),firstOpenMs: after+600000,lastCloseMs: after+1200000,barCount: 10 };
    proposal.partitions.walkForward = [{ contentSha256: "4".repeat(64),firstOpenMs: after,lastCloseMs: after+600000,barCount: 10 }];
    const experiment = await registerResearchExperimentPostgresV1(drizzle(admin, { schema }), { organizationId: ORG }, proposal);
    const command = { organizationId: ORG,specSha256: experiment.specSha256,sourceRunId: issuance.sourceRunId,commandId: randomUUID() };
    const attempt = await registerResearchIssuedAttemptPostgresV2(command);
    expect(await registerResearchIssuedAttemptPostgresV2(command)).toEqual(attempt);
    const input = await loadResearchIssuedTrainingInputPostgresV2({ organizationId: ORG,attemptId: attempt.id });
    expect(input.bars).toEqual(fixture.bars.slice(3, 6));
    expect(input.issuance).toEqual(issuance); expect(input.attempt.capitalEligible).toBe(false);
    await expect(loadResearchIssuedTrainingInputPostgresV2({ organizationId: ORG,attemptId: randomUUID() })).rejects.toThrow("ATTEMPT_REQUIRED");
    await expect(registerResearchIssuedAttemptPostgresV2({ ...command, sourceRunId: `research-source-v1:${"0".repeat(64)}` })).rejects.toThrow("ISSUED_SOURCE_REQUIRED");
  });
});
