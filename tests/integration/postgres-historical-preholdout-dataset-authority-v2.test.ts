import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("historical pre-holdout dataset authority V2 PostgreSQL", () => {
  it("accepts qualified membership and rejects seal/qualification substitution fail-closed", async () => {
    const sql = postgres(url!, { max: 1 });
    const userId = randomUUID();
    const organizationId = randomUUID();
    const runId = `preholdout-0191-${randomUUID()}`;
    const qualificationDigest = "a".repeat(64);
    const membershipDigest = "b".repeat(64);
    const cycleDigest = "c".repeat(64);
    const authorityDigest = "d".repeat(64);

    const sealedCycle = {
      cycleId: "cycle-0",
      contentDigestHex: cycleDigest,
    };
    const qualifiedMembership = {
      datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1",
      datasetAuthorityDigestHex: qualificationDigest,
      qualificationReceiptDigestHex: qualificationDigest,
      contentDigestHex: membershipDigest,
      sealedCycleContentDigestHex: cycleDigest,
      cycleId: sealedCycle.cycleId,
    };

    try {
      await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await sql`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, '0191 pre-holdout validation',
          ${`0191-preholdout-${userId}@invalid.local`})`;
      await sql`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal',
          '0191 pre-holdout validation')`;

      const inserted = await sql<{ dataset_authority_class: string; dataset_authority_digest_hex: string }[]>`
        INSERT INTO trader_historical_dataset_authority_v2 (
          organization_id, run_id, cycle_id, dataset_authority_class,
          dataset_authority_digest_hex, membership_content_digest_hex,
          sealed_cycle_content_digest_hex, membership_json, sealed_cycle_json,
          authority_content_digest_hex, schema_version
        ) VALUES (
          ${organizationId}::uuid, ${runId}, ${sealedCycle.cycleId},
          'PRE_HOLDOUT_QUALIFICATION_V1', ${qualificationDigest}, ${membershipDigest},
          ${cycleDigest}, ${sql.json(qualifiedMembership)}, ${sql.json(sealedCycle)},
          ${authorityDigest}, 'waia.trader.historical_dataset_authority.v2'
        ) RETURNING dataset_authority_class, dataset_authority_digest_hex
      `;
      expect(inserted).toEqual([{
        dataset_authority_class: "PRE_HOLDOUT_QUALIFICATION_V1",
        dataset_authority_digest_hex: qualificationDigest,
      }]);

      const insertInvalid = async (cycleId: string, authorityClass: string,
        membership: Record<string, unknown>) => sql`
          INSERT INTO trader_historical_dataset_authority_v2 (
            organization_id, run_id, cycle_id, dataset_authority_class,
            dataset_authority_digest_hex, membership_content_digest_hex,
            sealed_cycle_content_digest_hex, membership_json, sealed_cycle_json,
            authority_content_digest_hex, schema_version
          ) VALUES (
            ${organizationId}::uuid, ${runId}, ${cycleId}, ${authorityClass},
            ${qualificationDigest}, ${membershipDigest}, ${cycleDigest},
            ${sql.json({ ...membership, cycleId })},
            ${sql.json({ ...sealedCycle, cycleId })}, ${authorityDigest},
            'waia.trader.historical_dataset_authority.v2'
          )
        `;

      await expect(insertInvalid("cycle-seal-substitution", "PRE_HOLDOUT_QUALIFICATION_V1", {
        ...qualifiedMembership,
        qualificationReceiptDigestHex: undefined,
        sealReceiptDigestHex: qualificationDigest,
      })).rejects.toThrow(/historical_dataset_authority_v2_json_binding/);

      await expect(insertInvalid("cycle-class-mismatch", "FULL_SEALED_DATASET_V2",
        qualifiedMembership)).rejects.toThrow(/historical_dataset_authority_v2_json_binding/);

      await expect(insertInvalid("cycle-digest-substitution", "PRE_HOLDOUT_QUALIFICATION_V1", {
        ...qualifiedMembership,
        qualificationReceiptDigestHex: "e".repeat(64),
      })).rejects.toThrow(/historical_dataset_authority_v2_json_binding/);

      await expect(insertInvalid("cycle-missing-qualification", "PRE_HOLDOUT_QUALIFICATION_V1", {
        ...qualifiedMembership,
        qualificationReceiptDigestHex: undefined,
      })).rejects.toThrow(/historical_dataset_authority_v2_json_binding/);

      await expect(insertInvalid("cycle-null-qualification", "PRE_HOLDOUT_QUALIFICATION_V1", {
        ...qualifiedMembership,
        qualificationReceiptDigestHex: null,
      })).rejects.toThrow(/historical_dataset_authority_v2_json_binding/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
