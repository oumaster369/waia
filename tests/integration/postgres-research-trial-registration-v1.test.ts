/**
 * DEE-518 IC4 — research trial registration Postgres roundtrip (opt-in).
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  assertResearchTrialRegistrationNonCapitalAuthority,
  buildResearchTrialRegistrationRecord,
  readResearchTrialRegistrationV1,
  registerResearchTrialV1,
  ResearchTrialRegistrationConflictError,
} from "@/lib/trader/research/benchmark/research-trial-registration-service-v1";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_TRIAL_PG_USER = "00000000-0000-4000-8000-000000051803";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function hex64(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

async function cleanupResearchTrialRegistration(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  await sql.unsafe(
    `ALTER TABLE trader_research_trial_registration_v1 DISABLE TRIGGER trader_research_trial_registration_v1_block_delete`,
  );
  await sql.unsafe(`DELETE FROM trader_research_trial_registration_v1 WHERE organization_id = $1`, [
    organizationId,
  ]);
  await sql.unsafe(
    `ALTER TABLE trader_research_trial_registration_v1 ENABLE TRIGGER trader_research_trial_registration_v1_block_delete`,
  );
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres research trial registration v1 persistence (DEE-518 IC4)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP518_TRIAL_PG_USER);
      orgId = await seedWp13User(url!, WP518_TRIAL_PG_USER, "Research Trial Registration");
      sql = postgres(url!, { max: 1 });
    });

    beforeEach(async () => {
      await cleanupResearchTrialRegistration(sql, orgId);
    });

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupResearchTrialRegistration(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, WP518_TRIAL_PG_USER);
    });

    it("persists a trial registration and reads it back by trial identity digest", async () => {
      const record = buildResearchTrialRegistrationRecord({
        organizationId: orgId,
        trialIdentityDigestHex: hex64("trial-a"),
        modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
        comparisonFamilyId: "family-a",
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        partitionReceiptDigestHex: hex64("partition-a"),
      });

      const result = await registerResearchTrialV1(sql, record);
      expect(result.insertedNew).toBe(true);

      const loaded = await readResearchTrialRegistrationV1(sql, {
        organizationId: orgId,
        trialIdentityDigestHex: record.trialIdentityDigest,
      });
      expect(loaded).not.toBeNull();
      expect(loaded?.contentDigest).toBe(record.contentDigest);
      expect(loaded?.authorityStatus).toBe("RESEARCH_ONLY");

      expect(() =>
        assertResearchTrialRegistrationNonCapitalAuthority({
          authorityStatus: loaded!.authorityStatus,
        }),
      ).not.toThrow();
    });

    it("is idempotent on exact-duplicate re-registration", async () => {
      const record = buildResearchTrialRegistrationRecord({
        organizationId: orgId,
        trialIdentityDigestHex: hex64("trial-b"),
        modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
        comparisonFamilyId: "family-b",
        symbol: "ETHUSDT",
        primaryHorizonMinutes: 60,
        partitionReceiptDigestHex: hex64("partition-b"),
      });

      const first = await registerResearchTrialV1(sql, record);
      const second = await registerResearchTrialV1(sql, record);
      expect(first.insertedNew).toBe(true);
      expect(second.insertedNew).toBe(false);
      expect(second.id).toBe(first.id);

      const count = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_research_trial_registration_v1
        WHERE organization_id = ${orgId}::uuid
          AND trial_identity_digest = ${record.trialIdentityDigest}
      `;
      expect(Number(count[0]?.count ?? 0)).toBe(1);
    });

    it("fails closed on natural-idempotent conflict (same trial identity, different content)", async () => {
      const trialIdentityDigestHex = hex64("trial-c");
      const recordA = buildResearchTrialRegistrationRecord({
        organizationId: orgId,
        trialIdentityDigestHex,
        modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
        comparisonFamilyId: "family-c",
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        partitionReceiptDigestHex: hex64("partition-c"),
      });
      await registerResearchTrialV1(sql, recordA);

      const recordB = buildResearchTrialRegistrationRecord({
        organizationId: orgId,
        trialIdentityDigestHex,
        modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
        comparisonFamilyId: "family-c-DIFFERENT",
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        partitionReceiptDigestHex: hex64("partition-c"),
      });

      await expect(registerResearchTrialV1(sql, recordB)).rejects.toThrow(
        ResearchTrialRegistrationConflictError,
      );
    });

    it("rejects capital-authority claims regardless of authority_status", () => {
      expect(() =>
        assertResearchTrialRegistrationNonCapitalAuthority({
          authorityStatus: "RESEARCH_ONLY",
          claimsCapitalAuthority: true,
        }),
      ).toThrow(/cannot claim capital authority/);
      expect(() =>
        assertResearchTrialRegistrationNonCapitalAuthority({ authorityStatus: "CAPITAL_LIVE" }),
      ).toThrow(/capital authority forbidden/);
    });
  },
);
