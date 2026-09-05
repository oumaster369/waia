/**
 * DEE-920 — Historical Knowledge checkpoint namespace isolation (fresh PostgreSQL, opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import type { KnowledgeCheckpointInput } from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";
import {
  buildKnowledgeCheckpointRecord,
  KnowledgeCheckpointCorruptionError,
  KnowledgeCheckpointPersistConflictError,
  restoreHistoricalKnowledgeCheckpointV2,
  restoreKnowledgeCheckpointV2,
  writeHistoricalKnowledgeCheckpointV2,
  writeKnowledgeCheckpointV2,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-service-v2";
import { HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const USER_ID = "00000000-0000-4000-8000-000000092000";
const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

function historicalInput(
  organizationId: string,
  runId: string,
  symbol: "BTCUSDT" | "ETHUSDT",
): KnowledgeCheckpointInput {
  return {
    organizationId,
    checkpointSeq: 0,
    modelVersion: `${HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2}|${runId}|${symbol}|forecast-v2`,
    calibrationSnapshotDigest: "a".repeat(64),
    rejectedResearchStates: [],
    promotedResearchStates: [`${runId}:${symbol}`],
    forecastPackageGenerationDigest: "b".repeat(64),
  };
}

function generalInput(
  organizationId: string,
  modelVersion = "general-v1",
): KnowledgeCheckpointInput {
  return {
    organizationId,
    checkpointSeq: 0,
    modelVersion,
    calibrationSnapshotDigest: "c".repeat(64),
    rejectedResearchStates: [],
    promotedResearchStates: ["general"],
    forecastPackageGenerationDigest: "d".repeat(64),
  };
}

async function cleanup(sql: postgres.Sql, organizationId: string): Promise<void> {
  await sql.unsafe(
    "ALTER TABLE trader_knowledge_state_checkpoint_v2 DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete",
  );
  try {
    await sql.unsafe(
      "DELETE FROM trader_knowledge_state_checkpoint_v2 WHERE organization_id = $1",
      [organizationId],
    );
  } finally {
    await sql.unsafe(
      "ALTER TABLE trader_knowledge_state_checkpoint_v2 ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete",
    );
  }
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres Historical Knowledge checkpoint namespace V2",
  () => {
    let sql: postgres.Sql;
    let organizationId: string;

    beforeAll(async () => {
      await cleanupWp13Org(url!, USER_ID);
      organizationId = await seedWp13User(url!, USER_ID, "Historical namespace V2");
      sql = postgres(url!, { max: 1 });
    });

    beforeEach(async () => cleanup(sql, organizationId));

    afterAll(async () => {
      if (sql && organizationId) await cleanup(sql, organizationId);
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, USER_ID);
    });

    it("persists isolated checkpoint sequence zero for two runs across BTC and ETH surfaces", async () => {
      const scopes = [
        historicalInput(organizationId, "run-a", "BTCUSDT"),
        historicalInput(organizationId, "run-a", "ETHUSDT"),
        historicalInput(organizationId, "run-b", "BTCUSDT"),
        historicalInput(organizationId, "run-b", "ETHUSDT"),
      ];

      const writes = [];
      for (const input of scopes) {
        writes.push(
          await writeHistoricalKnowledgeCheckpointV2(
            sql,
            buildKnowledgeCheckpointRecord(input),
            input.modelVersion,
          ),
        );
      }
      expect(writes.every((write) => write.insertedNew)).toBe(true);

      const duplicate = await writeHistoricalKnowledgeCheckpointV2(
        sql,
        buildKnowledgeCheckpointRecord(scopes[0]!),
        scopes[0]!.modelVersion,
      );
      expect(duplicate).toEqual({ id: writes[0]!.id, insertedNew: false });

      const rows = await sql<{ checkpoint_namespace: string; count: string }[]>`
        SELECT checkpoint_namespace, count(*)::text AS count
        FROM trader_knowledge_state_checkpoint_v2
        WHERE organization_id = ${organizationId}::uuid
          AND checkpoint_seq = 0
        GROUP BY checkpoint_namespace
        ORDER BY checkpoint_namespace
      `;
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.count === "1")).toBe(true);

      for (const input of scopes) {
        const restored = await restoreHistoricalKnowledgeCheckpointV2(sql, {
          organizationId,
          checkpointSeq: 0,
          checkpointNamespace: input.modelVersion,
        });
        expect(restored.input.modelVersion).toBe(input.modelVersion);
      }

      await expect(
        restoreHistoricalKnowledgeCheckpointV2(sql, {
          organizationId,
          checkpointSeq: 1,
          checkpointNamespace: scopes[0]!.modelVersion,
        }),
      ).rejects.toThrow(KnowledgeCheckpointCorruptionError);
    });

    it("keeps the GENERAL live/paper identity and conflict behavior unchanged", async () => {
      const first = await writeKnowledgeCheckpointV2(
        sql,
        buildKnowledgeCheckpointRecord(generalInput(organizationId)),
      );
      const duplicate = await writeKnowledgeCheckpointV2(
        sql,
        buildKnowledgeCheckpointRecord(generalInput(organizationId)),
      );
      expect(first.insertedNew).toBe(true);
      expect(duplicate).toEqual({ id: first.id, insertedNew: false });
      await expect(
        restoreKnowledgeCheckpointV2(sql, {
          organizationId,
          checkpointSeq: 0,
        }),
      ).resolves.toMatchObject({ input: { modelVersion: "general-v1" } });

      await expect(
        writeKnowledgeCheckpointV2(
          sql,
          buildKnowledgeCheckpointRecord(generalInput(organizationId, "general-v2")),
        ),
      ).rejects.toThrow(KnowledgeCheckpointPersistConflictError);
    });
  },
);
