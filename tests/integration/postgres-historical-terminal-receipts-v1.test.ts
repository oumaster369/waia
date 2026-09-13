import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHistoricalComparisonIdentitiesV1,
  buildHistoricalRehearsalStartedReceiptV1,
  buildHistoricalScientificAdmissionRefusalReceiptV1,
  buildRuntimeReleaseBindingReceiptDigestV1,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-receipts-v1";

const inputUrl =
  process.env.WAIA_TEST_DEE1006_PG_ADMIN_URL ?? process.env.WAIA_TEST_DEE958_PG_ADMIN_URL;
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

describe.skipIf(!inputUrl)("DEE-1006 local PostgreSQL append-only terminal receipts", () => {
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
  }, 30_000);

  afterAll(async () => {
    await owner?.end();
    await superDb?.end();
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${ownerRole}`);
      await admin.end();
    }
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
        ${JSON.stringify(refusal)}::jsonb, ${refusal.contentDigestHex}, ${refusal.schemaVersion})`;
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
        ${JSON.stringify(rehearsal)}::jsonb, ${rehearsal.contentDigestHex}, ${rehearsal.schemaVersion})`;
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
