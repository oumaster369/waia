/**
 * DEE-518 IC4 — bounded knowledge state checkpoint v2 Postgres roundtrip (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import type { KnowledgeCheckpointInput } from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";
import {
  buildKnowledgeCheckpointRecord,
  KnowledgeCheckpointCorruptionError,
  KnowledgeCheckpointPersistConflictError,
  readKnowledgeCheckpointV2,
  restoreKnowledgeCheckpointV2,
  writeKnowledgeCheckpointV2,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-service-v2";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_KNOWLEDGE_PG_USER = "00000000-0000-4000-8000-000000051806";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function checkpointInput(
  organizationId: string,
  checkpointSeq: number,
  overrides: Partial<KnowledgeCheckpointInput> = {},
): KnowledgeCheckpointInput {
  return {
    organizationId,
    checkpointSeq,
    modelVersion: "rv-state-conditional-empirical-joint/v1",
    calibrationSnapshotDigest: "a".repeat(64),
    rejectedResearchStates: ["state-b", "state-a"],
    promotedResearchStates: ["state-z"],
    forecastPackageGenerationDigest: "b".repeat(64),
    ...overrides,
  };
}

async function cleanupKnowledgeCheckpointRows(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  await sql.unsafe(
    `ALTER TABLE trader_knowledge_state_checkpoint_v2 DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete`,
  );
  await sql.unsafe(`DELETE FROM trader_knowledge_state_checkpoint_v2 WHERE organization_id = $1`, [
    organizationId,
  ]);
  await sql.unsafe(
    `ALTER TABLE trader_knowledge_state_checkpoint_v2 ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete`,
  );
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres knowledge state checkpoint v2 persistence (DEE-518 IC4)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP518_KNOWLEDGE_PG_USER);
      orgId = await seedWp13User(url!, WP518_KNOWLEDGE_PG_USER, "Knowledge State Checkpoint");
      sql = postgres(url!, { max: 1 });
    });

    beforeEach(async () => {
      await cleanupKnowledgeCheckpointRows(sql, orgId);
    });

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupKnowledgeCheckpointRows(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, WP518_KNOWLEDGE_PG_USER);
    });

    it("writes a checkpoint, reads it back, and restores it with a recomputed digest match", async () => {
      const input = checkpointInput(orgId, 1);
      const record = buildKnowledgeCheckpointRecord(input);

      const result = await writeKnowledgeCheckpointV2(sql, record);
      expect(result.insertedNew).toBe(true);

      const loaded = await readKnowledgeCheckpointV2(sql, {
        organizationId: orgId,
        checkpointSeq: 1,
      });
      expect(loaded).not.toBeNull();
      expect(loaded?.contentDigest).toBe(record.contentDigest);
      expect(loaded?.knowledgeSemanticDigest).toBe(record.knowledgeSemanticDigest);

      const restored = await restoreKnowledgeCheckpointV2(sql, {
        organizationId: orgId,
        checkpointSeq: 1,
      });
      expect(restored.knowledgeSemanticDigest).toBe(record.knowledgeSemanticDigest);
      expect(restored.contentDigest).toBe(record.contentDigest);
      expect([...restored.input.rejectedResearchStates].sort()).toEqual(
        [...input.rejectedResearchStates].sort(),
      );
      expect([...restored.input.promotedResearchStates].sort()).toEqual(
        [...input.promotedResearchStates].sort(),
      );
    });

    it("is idempotent on exact-duplicate checkpoint write", async () => {
      const record = buildKnowledgeCheckpointRecord(checkpointInput(orgId, 2));

      const first = await writeKnowledgeCheckpointV2(sql, record);
      const second = await writeKnowledgeCheckpointV2(sql, record);
      expect(first.insertedNew).toBe(true);
      expect(second.insertedNew).toBe(false);
      expect(second.id).toBe(first.id);

      const count = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_knowledge_state_checkpoint_v2
        WHERE organization_id = ${orgId}::uuid
          AND checkpoint_seq = 2
      `;
      expect(Number(count[0]?.count ?? 0)).toBe(1);
    });

    it("fails closed on natural-idempotent conflict (same checkpoint_seq, different content)", async () => {
      const recordA = buildKnowledgeCheckpointRecord(checkpointInput(orgId, 3));
      await writeKnowledgeCheckpointV2(sql, recordA);

      const recordB = buildKnowledgeCheckpointRecord(
        checkpointInput(orgId, 3, {
          modelVersion: "rv-state-conditional-empirical-joint/v2-DIFFERENT",
        }),
      );

      await expect(writeKnowledgeCheckpointV2(sql, recordB)).rejects.toThrow(
        KnowledgeCheckpointPersistConflictError,
      );
    });

    it("fails closed on restore when the persisted row has been tampered with", async () => {
      const record = buildKnowledgeCheckpointRecord(checkpointInput(orgId, 4));
      await writeKnowledgeCheckpointV2(sql, record);

      await sql.unsafe(
        `ALTER TABLE trader_knowledge_state_checkpoint_v2 DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update`,
      );
      try {
        await sql.unsafe(
          `UPDATE trader_knowledge_state_checkpoint_v2 SET promoted_research_states_json = $1 WHERE organization_id = $2 AND checkpoint_seq = $3`,
          [JSON.stringify(["tampered-state"]), orgId, 4],
        );
      } finally {
        await sql.unsafe(
          `ALTER TABLE trader_knowledge_state_checkpoint_v2 ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update`,
        );
      }

      await expect(
        restoreKnowledgeCheckpointV2(sql, { organizationId: orgId, checkpointSeq: 4 }),
      ).rejects.toThrow(KnowledgeCheckpointCorruptionError);
    });

    it("stores only bounded KnowledgeCheckpointInput fields (no forecast history arrays)", () => {
      const record = buildKnowledgeCheckpointRecord(checkpointInput(orgId, 5));
      const storedKeys = Object.keys(record).sort();
      expect(storedKeys).toEqual(
        [
          "calibrationSnapshotDigest",
          "checkpointSeq",
          "contentDigest",
          "forecastPackageGenerationDigest",
          "id",
          "knowledgeSemanticDigest",
          "modelVersion",
          "organizationId",
          "promotedResearchStatesJson",
          "rejectedResearchStatesJson",
          "schemaVersion",
        ].sort(),
      );
    });
  },
);
