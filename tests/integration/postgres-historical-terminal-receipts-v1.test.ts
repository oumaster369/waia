import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHistoricalComparisonIdentitiesV1,
  buildHistoricalRehearsalStartedReceiptV1,
  buildHistoricalScientificAdmissionRefusalReceiptV1,
  buildRuntimeReleaseBindingReceiptDigestV1,
  type HistoricalRehearsalStartedReceiptV1,
  type HistoricalScientificAdmissionRefusalReceiptV1,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-receipts-v1";
import { createPostgresHistoricalTerminalReceiptRepositoryV1 } from "@/lib/trader/historical-simulation-v2/historical-terminal-receipt-repository-postgres-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const inputUrl =
  process.env.WAIA_TEST_DEE1012_PG_ADMIN_URL ??
  process.env.WAIA_TEST_DEE1006_PG_ADMIN_URL ??
  process.env.WAIA_TEST_DEE958_PG_ADMIN_URL;
const organizationId = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const otherOrg = "11111111-1111-4111-8111-111111111111";
const suffix = randomUUID().slice(0, 8);
const database = `waia_test_dee1006_${suffix}`;
const ownerRole = `waia1006_admin_${suffix}`;
const releaseSha = "a".repeat(40);
const digest = "b".repeat(64);
let admin: postgres.Sql | undefined;
let owner: postgres.Sql | undefined;
let superDb: postgres.Sql | undefined;
let runner: postgres.Sql | undefined;
let runnerConcurrent: postgres.Sql | undefined;

function scientificPayload() {
  const identities = buildHistoricalComparisonIdentitiesV1();
  return {
    statistics: identities.map((identity) => ({
      comparisonIdentityDigestHex: identity.comparisonIdentityDigestHex,
      pRaw: 0.2,
      dBar: 0.1,
      tObs: 1.5,
      extremeCount: 1,
      n: 10,
    })),
    holmComparisons: identities.map((identity) => ({
      comparisonId: identity.comparisonIdentityDigestHex,
      pValue: 0.2,
    })),
  };
}

function refusal(
  runId: string,
  reasonCode: "HOLM_FWER_FAIL" | "BRIER_GATE_FAIL" = "HOLM_FWER_FAIL",
) {
  return buildHistoricalScientificAdmissionRefusalReceiptV1({
    releaseSha,
    organizationId,
    runId,
    reasonCode,
    ...scientificPayload(),
  });
}

function rehearsal(
  runId: string,
  ids: Readonly<{ proposalId: string; ratificationId: string; authorityId: string }> = {
    proposalId: randomUUID(),
    ratificationId: randomUUID(),
    authorityId: randomUUID(),
  },
  claimantId = "consumer-1",
) {
  return buildHistoricalRehearsalStartedReceiptV1({
    releaseSha,
    runtimeReleaseBindingReceiptDigestHex: buildRuntimeReleaseBindingReceiptDigestV1(releaseSha),
    organizationId,
    accountId: "durable-account",
    runId,
    proposalId: ids.proposalId,
    proposalContentDigestHex: digest,
    ratificationId: ids.ratificationId,
    ratificationContentDigestHex: digest,
    fourSurfaceAuthorityId: ids.authorityId,
    fourSurfaceAuthorityContentDigestHex: digest,
    consumerClaim: { claimantId, accepted: true, concurrentClaimantCount: 0 },
    lease: { leaseKey: `lease:${runId}`, acquired: true },
    lifecycle: { phase: "RUNNING", contentDigestHex: digest },
    imageHealthBinding: { releaseSha, imageReleaseSha: releaseSha, runId, status: "ok" },
    adminObservationBinding: {
      organizationId,
      runId,
      lifecycleContentDigestHex: digest,
      accountId: "durable-account",
      ledgerHeadContentDigestHex: digest,
      cycleSequence: 1,
      cycleId: "cycle-1",
    },
    tenantObservationBinding: {
      organizationId,
      runId,
      accountId: "durable-account",
      lifecycleContentDigestHex: digest,
      ledgerHeadContentDigestHex: digest,
      cycleSequence: 1,
      cycleId: "cycle-1",
    },
  });
}

async function seedRehearsalLineage(
  runId: string,
): Promise<{ proposalId: string; ratificationId: string; authorityId: string }> {
  const ids = {
    proposalId: randomUUID(),
    ratificationId: randomUUID(),
    authorityId: randomUUID(),
  };
  await superDb!`
    INSERT INTO trader_historical_technical_proposal_v2
      (id, organization_id, run_id, release_sha, content_digest_hex)
    VALUES (${ids.proposalId}::uuid, ${organizationId}::uuid, ${runId}, ${releaseSha}, ${digest})
  `;
  await superDb!`
    INSERT INTO trader_historical_proposal_ratification_v2
      (id, organization_id, run_id, proposal_id, proposal_content_digest_hex, release_sha,
       content_digest_hex)
    VALUES (${ids.ratificationId}::uuid, ${organizationId}::uuid, ${runId},
      ${ids.proposalId}::uuid, ${digest}, ${releaseSha}, ${digest})
  `;
  await superDb!`
    INSERT INTO trader_historical_four_surface_ratified_admission_v2
      (id, organization_id, run_id, release_sha, authority_content_digest_hex)
    VALUES (${ids.authorityId}::uuid, ${organizationId}::uuid, ${runId}, ${releaseSha}, ${digest})
  `;
  return ids;
}

describe.skipIf(!inputUrl)("DEE-1006/DEE-1012 local PostgreSQL terminal receipts", () => {
  beforeAll(async () => {
    const url = new URL(inputUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("LOCAL_DATABASE_ONLY");
    }
    admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(
      `CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await admin.unsafe(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    superDb = postgres(url.toString(), { max: 1 });
    owner = postgres(url.toString(), { max: 1 });
    await owner.unsafe(
      `GRANT USAGE,CREATE ON SCHEMA public TO ${ownerRole}; SET ROLE ${ownerRole}`,
    );
    await owner.unsafe(`
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE trader_historical_technical_proposal_v2(
        id uuid NOT NULL, organization_id uuid NOT NULL, run_id text NOT NULL,
        release_sha text NOT NULL, content_digest_hex text NOT NULL,
        UNIQUE(id, organization_id, run_id, content_digest_hex));
      CREATE TABLE trader_historical_proposal_ratification_v2(
        id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id text NOT NULL,
        proposal_id uuid NOT NULL, proposal_content_digest_hex text NOT NULL,
        release_sha text NOT NULL, content_digest_hex text NOT NULL);
      CREATE TABLE trader_historical_four_surface_ratified_admission_v2(
        id uuid NOT NULL, organization_id uuid NOT NULL, run_id text NOT NULL,
        release_sha text NOT NULL, authority_content_digest_hex text NOT NULL,
        UNIQUE(id, organization_id, run_id, authority_content_digest_hex));
      CREATE OR REPLACE FUNCTION public.waia_canonical_jsonb_v1(value jsonb)
      RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
      DECLARE result text;
      BEGIN
        CASE jsonb_typeof(value)
          WHEN 'object' THEN
            SELECT '{' || COALESCE(string_agg(to_jsonb(entry.key)::text || ':' ||
              public.waia_canonical_jsonb_v1(entry.value), ',' ORDER BY entry.key COLLATE "C"), '')
              || '}' INTO result FROM jsonb_each(value) AS entry;
            RETURN result;
          WHEN 'array' THEN
            SELECT '[' || COALESCE(string_agg(public.waia_canonical_jsonb_v1(entry.value), ','
              ORDER BY entry.ordinality), '') || ']' INTO result
              FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(value, ordinality);
            RETURN result;
          ELSE RETURN value::text;
        END CASE;
      END $$;
      CREATE OR REPLACE FUNCTION public.waia_historical_ratification_split_v2_block_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'check_violation';
      END $$;
    `);
    await owner`INSERT INTO organizations VALUES (${organizationId}::uuid), (${otherOrg}::uuid)`;
    for (const role of ["anon", "authenticated", "waia_historical_runner"]) {
      await owner.unsafe(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
          CREATE ROLE ${role} NOLOGIN;
        END IF;
      END $$`);
    }
    const migration = await readFile(
      "db/migrations_postgres/0208_historical_terminal_receipts_v1.sql",
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      await owner.unsafe(statement);
    }
    await owner.unsafe(`
      GRANT SELECT ON trader_historical_technical_proposal_v2,
        trader_historical_proposal_ratification_v2,
        trader_historical_four_surface_ratified_admission_v2
      TO waia_historical_runner
    `);
    runner = postgres(url.toString(), { max: 1 });
    runnerConcurrent = postgres(url.toString(), { max: 1 });
    await runner.unsafe("SET ROLE waia_historical_runner");
    await runnerConcurrent.unsafe("SET ROLE waia_historical_runner");
    expect((await runner`SELECT current_user AS role`)[0]?.role).toBe("waia_historical_runner");
    expect((await runnerConcurrent`SELECT current_user AS role`)[0]?.role).toBe(
      "waia_historical_runner",
    );
  }, 30_000);

  afterAll(async () => {
    await runner?.end();
    await runnerConcurrent?.end();
    await owner?.end();
    await superDb?.end();
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${ownerRole}`);
      await admin.end();
    }
  });

  it("inserts each exact terminal receipt and makes exact duplicates idempotent", async () => {
    const refusalRunId = "dee1012-exact-refusal";
    const refusalReceipt = refusal(refusalRunId);
    const refusalRepository = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: refusalRunId },
    });
    await expect(
      refusalRepository.persistScientificAdmissionRefusal(refusalReceipt),
    ).resolves.toEqual({
      inserted: true,
      kind: "SCIENTIFIC_ADMISSION_REFUSED",
      contentDigestHex: refusalReceipt.contentDigestHex,
    });
    await expect(
      refusalRepository.persistScientificAdmissionRefusal(refusalReceipt),
    ).resolves.toEqual({
      inserted: false,
      kind: "SCIENTIFIC_ADMISSION_REFUSED",
      contentDigestHex: refusalReceipt.contentDigestHex,
    });

    const rehearsalRunId = "dee1012-exact-rehearsal";
    const ids = await seedRehearsalLineage(rehearsalRunId);
    const rehearsalReceipt = rehearsal(rehearsalRunId, ids);
    const rehearsalRepository = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: rehearsalRunId },
    });
    await expect(
      rehearsalRepository.persistHistoricalRehearsalStarted(rehearsalReceipt),
    ).resolves.toEqual({
      inserted: true,
      kind: "HISTORICAL_REHEARSAL_STARTED",
      contentDigestHex: rehearsalReceipt.contentDigestHex,
    });
    await expect(
      rehearsalRepository.persistHistoricalRehearsalStarted(rehearsalReceipt),
    ).resolves.toEqual({
      inserted: false,
      kind: "HISTORICAL_REHEARSAL_STARTED",
      contentDigestHex: rehearsalReceipt.contentDigestHex,
    });
    await expect(
      rehearsalRepository.persistHistoricalRehearsalStarted(
        rehearsal(rehearsalRunId, ids, "consumer-2"),
      ),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
  });

  it("refuses digest mismatch, conflicting content, cross-org, and wrong-kind calls", async () => {
    const runId = "dee1012-content-conflict";
    const repository = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId },
    });
    const first = refusal(runId);
    await repository.persistScientificAdmissionRefusal(first);
    await expect(
      repository.persistScientificAdmissionRefusal(refusal(runId, "BRIER_GATE_FAIL")),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    await expect(
      repository.persistScientificAdmissionRefusal({
        ...first,
        contentDigestHex: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_DIGEST" });
    const { contentDigestHex: _originalDigest, ...bindingBody } = first;
    void _originalDigest;
    const forgedBindingBody = {
      ...bindingBody,
      runtimeReleaseBindingReceiptDigestHex: "e".repeat(64),
    };
    await expect(
      repository.persistScientificAdmissionRefusal({
        ...forgedBindingBody,
        contentDigestHex: computeSemanticSha256Hex(forgedBindingBody),
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_DIGEST" });
    const rehearsalRunId = "dee1012-forged-release-binding";
    const rehearsalIds = await seedRehearsalLineage(rehearsalRunId);
    const canonicalRehearsal = rehearsal(rehearsalRunId, rehearsalIds);
    const { contentDigestHex: _rehearsalDigest, ...rehearsalBody } = canonicalRehearsal;
    void _rehearsalDigest;
    const forgedRehearsalBody = {
      ...rehearsalBody,
      runtimeReleaseBindingReceiptDigestHex: "e".repeat(64),
    };
    const rehearsalRepository = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: rehearsalRunId },
    });
    await expect(
      rehearsalRepository.persistHistoricalRehearsalStarted({
        ...forgedRehearsalBody,
        contentDigestHex: computeSemanticSha256Hex(forgedRehearsalBody),
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_DIGEST" });
    await expect(
      repository.persistScientificAdmissionRefusal(
        buildHistoricalScientificAdmissionRefusalReceiptV1({
          releaseSha,
          organizationId: otherOrg,
          runId,
          reasonCode: "HOLM_FWER_FAIL",
          ...scientificPayload(),
        }),
      ),
    ).rejects.toMatchObject({ code: "SCOPE" });
    await expect(
      repository.persistScientificAdmissionRefusal(
        rehearsal(runId) as unknown as HistoricalScientificAdmissionRefusalReceiptV1,
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_SCHEMA" });
    await expect(
      repository.persistHistoricalRehearsalStarted(
        first as unknown as HistoricalRehearsalStartedReceiptV1,
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_SCHEMA" });
  });

  it("refuses either terminal kind after the other kind is durable", async () => {
    const refusalFirstRun = "dee1012-kind-refusal-first";
    const refusalFirst = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: refusalFirstRun },
    });
    await refusalFirst.persistScientificAdmissionRefusal(refusal(refusalFirstRun));
    await expect(
      refusalFirst.persistHistoricalRehearsalStarted(rehearsal(refusalFirstRun)),
    ).rejects.toMatchObject({ code: "TERMINAL_KIND_CONFLICT" });

    const rehearsalFirstRun = "dee1012-kind-rehearsal-first";
    const ids = await seedRehearsalLineage(rehearsalFirstRun);
    const rehearsalFirst = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: rehearsalFirstRun },
    });
    await rehearsalFirst.persistHistoricalRehearsalStarted(rehearsal(rehearsalFirstRun, ids));
    await expect(
      rehearsalFirst.persistScientificAdmissionRefusal(refusal(rehearsalFirstRun)),
    ).rejects.toMatchObject({ code: "TERMINAL_KIND_CONFLICT" });
  });

  it("serializes concurrent exact duplicates and competing terminal kinds", async () => {
    const duplicateRunId = "dee1012-concurrent-duplicate";
    const duplicateReceipt = refusal(duplicateRunId);
    const duplicateA = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: duplicateRunId },
    });
    const duplicateB = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runnerConcurrent!,
      scope: { organizationId, runId: duplicateRunId },
    });
    const duplicates = await Promise.all([
      duplicateA.persistScientificAdmissionRefusal(duplicateReceipt),
      duplicateB.persistScientificAdmissionRefusal(duplicateReceipt),
    ]);
    expect(duplicates.map((result) => result.inserted).sort()).toEqual([false, true]);

    const competingRunId = "dee1012-concurrent-kind";
    const ids = await seedRehearsalLineage(competingRunId);
    const competingA = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId: competingRunId },
    });
    const competingB = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runnerConcurrent!,
      scope: { organizationId, runId: competingRunId },
    });
    const competing = await Promise.allSettled([
      competingA.persistScientificAdmissionRefusal(refusal(competingRunId)),
      competingB.persistHistoricalRehearsalStarted(rehearsal(competingRunId, ids)),
    ]);
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = competing.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "TERMINAL_KIND_CONFLICT" });
    const counts = await superDb!<{ refusals: number; rehearsals: number }[]>`SELECT
      (SELECT count(*)::integer FROM trader_historical_scientific_admission_refusal_v1
        WHERE organization_id=${organizationId}::uuid AND run_id=${competingRunId}) AS refusals,
      (SELECT count(*)::integer FROM trader_historical_rehearsal_started_v1
        WHERE organization_id=${organizationId}::uuid AND run_id=${competingRunId}) AS rehearsals`;
    expect((counts[0]?.refusals ?? 0) + (counts[0]?.rehearsals ?? 0)).toBe(1);
  });

  it("rolls back a failed rehearsal write without leaving a terminal row", async () => {
    const runId = "dee1012-rollback";
    const repository = createPostgresHistoricalTerminalReceiptRepositoryV1({
      sql: runner!,
      scope: { organizationId, runId },
    });
    await expect(
      repository.persistHistoricalRehearsalStarted(rehearsal(runId)),
    ).rejects.toMatchObject({ code: "42501" });
    const rows = await superDb!<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM trader_historical_rehearsal_started_v1
      WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
    `;
    expect(rows[0]?.count).toBe("0");
  });

  it("raises on UPDATE and DELETE of both terminal tables", async () => {
    const identities = buildHistoricalComparisonIdentitiesV1();
    const statistics = identities.map((identity) => ({
      comparisonIdentityDigestHex: identity.comparisonIdentityDigestHex,
      pRaw: 0.2,
      dBar: 0.1,
      tObs: 1.5,
      extremeCount: 1,
      n: 10,
    }));
    const holmComparisons = identities.map((identity) => ({
      comparisonId: identity.comparisonIdentityDigestHex,
      pValue: 0.2,
    }));
    const refusal = buildHistoricalScientificAdmissionRefusalReceiptV1({
      releaseSha,
      organizationId,
      runId: "run-refusal",
      reasonCode: "HOLM_FWER_FAIL",
      statistics,
      holmComparisons,
    });
    await superDb!`
      INSERT INTO trader_historical_scientific_admission_refusal_v1 (
        organization_id, run_id, release_sha, runtime_release_binding_receipt_digest_hex,
        reason_code, coverage_digest_hex, holm_family_pass, receipt_json, content_digest_hex,
        schema_version)
      VALUES (
        ${organizationId}::uuid, ${refusal.runId}, ${refusal.releaseSha},
        ${refusal.runtimeReleaseBindingReceiptDigestHex}, ${refusal.reasonCode},
        ${refusal.coverage.coverageDigestHex}, ${refusal.holmFwer.familyPass},
        ${JSON.stringify(refusal)}::text::jsonb, ${refusal.contentDigestHex},
        ${refusal.schemaVersion})`;
    const proposalId = randomUUID();
    const ratificationId = randomUUID();
    const authorityId = randomUUID();
    await superDb!`
      INSERT INTO trader_historical_technical_proposal_v2
        (id, organization_id, run_id, release_sha, content_digest_hex)
      VALUES (${proposalId}::uuid, ${organizationId}::uuid, 'run-rehearsal', ${releaseSha}, ${digest})`;
    await superDb!`
      INSERT INTO trader_historical_proposal_ratification_v2
        (id, organization_id, run_id, proposal_id, proposal_content_digest_hex, release_sha, content_digest_hex)
      VALUES (${ratificationId}::uuid, ${organizationId}::uuid, 'run-rehearsal', ${proposalId}::uuid,
        ${digest}, ${releaseSha}, ${digest})`;
    await superDb!`
      INSERT INTO trader_historical_four_surface_ratified_admission_v2
        (id, organization_id, run_id, release_sha, authority_content_digest_hex)
      VALUES (${authorityId}::uuid, ${organizationId}::uuid, 'run-rehearsal', ${releaseSha}, ${digest})`;
    const rehearsal = buildHistoricalRehearsalStartedReceiptV1({
      releaseSha,
      runtimeReleaseBindingReceiptDigestHex: buildRuntimeReleaseBindingReceiptDigestV1(releaseSha),
      organizationId,
      accountId: "durable-account",
      runId: "run-rehearsal",
      proposalId,
      proposalContentDigestHex: digest,
      ratificationId,
      ratificationContentDigestHex: digest,
      fourSurfaceAuthorityId: authorityId,
      fourSurfaceAuthorityContentDigestHex: digest,
      consumerClaim: { claimantId: "consumer-1", accepted: true, concurrentClaimantCount: 0 },
      lease: { leaseKey: "lease", acquired: true },
      lifecycle: { phase: "RUNNING", contentDigestHex: digest },
      imageHealthBinding: {
        releaseSha,
        imageReleaseSha: releaseSha,
        runId: "run-rehearsal",
        status: "ok",
      },
      adminObservationBinding: {
        organizationId,
        runId: "run-rehearsal",
        lifecycleContentDigestHex: digest,
        accountId: "durable-account",
        ledgerHeadContentDigestHex: digest,
        cycleSequence: 1,
        cycleId: "cycle-1",
      },
      tenantObservationBinding: {
        organizationId,
        runId: "run-rehearsal",
        accountId: "durable-account",
        lifecycleContentDigestHex: digest,
        ledgerHeadContentDigestHex: digest,
        cycleSequence: 1,
        cycleId: "cycle-1",
      },
    });
    await superDb!`
      INSERT INTO trader_historical_rehearsal_started_v1 (
        organization_id, account_id, run_id, release_sha, runtime_release_binding_receipt_digest_hex,
        proposal_id, proposal_content_digest_hex, ratification_id, ratification_content_digest_hex,
        four_surface_authority_id, four_surface_authority_content_digest_hex,
        consumer_claim_digest_hex, lease_digest_hex, lifecycle_content_digest_hex,
        image_health_binding_digest_hex, admin_observation_binding_digest_hex,
        tenant_observation_binding_digest_hex, receipt_json, content_digest_hex, schema_version)
      VALUES (
        ${organizationId}::uuid, ${rehearsal.accountId}, ${rehearsal.runId}, ${rehearsal.releaseSha},
        ${rehearsal.runtimeReleaseBindingReceiptDigestHex}, ${rehearsal.proposalId}::uuid,
        ${rehearsal.proposalContentDigestHex}, ${rehearsal.ratificationId}::uuid,
        ${rehearsal.ratificationContentDigestHex}, ${rehearsal.fourSurfaceAuthorityId}::uuid,
        ${rehearsal.fourSurfaceAuthorityContentDigestHex}, ${rehearsal.consumerClaim.contentDigestHex},
        ${rehearsal.lease.contentDigestHex}, ${rehearsal.lifecycle.contentDigestHex},
        ${rehearsal.imageHealthBinding.contentDigestHex},
        ${rehearsal.adminObservationBinding.contentDigestHex},
        ${rehearsal.tenantObservationBinding.contentDigestHex},
        ${JSON.stringify(rehearsal)}::text::jsonb, ${rehearsal.contentDigestHex},
        ${rehearsal.schemaVersion})`;
    await expect(
      superDb!`UPDATE trader_historical_scientific_admission_refusal_v1 SET run_id='x'`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      superDb!`DELETE FROM trader_historical_scientific_admission_refusal_v1`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      superDb!`UPDATE trader_historical_rehearsal_started_v1 SET run_id='x'`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      superDb!`DELETE FROM trader_historical_rehearsal_started_v1`,
    ).rejects.toMatchObject({
      code: "23514",
    });
  });
});
