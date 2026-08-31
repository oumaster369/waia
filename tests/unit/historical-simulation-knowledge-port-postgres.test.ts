import { describe, expect, it } from "vitest";

import { computeKnowledgeCheckpointContentDigest, computeKnowledgeSemanticDigest,
  type KnowledgeCheckpointInput } from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";
import { createHistoricalSimulationPostgresKnowledgePortV2,
  type HistoricalSimulationKnowledgeCheckpointStoreV2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";

const ORG = "11111111-1111-4111-8111-111111111111";
const digest = (value: string) => value.repeat(64);

type Row = {
  id: string; knowledge_edge_id: string; content_digest: string; resolved_at: string;
  pit_evidence_boundary: string; source_record_ids_json: string;
};

function row(input: { id: string; visible: string; resolved: string; digestChar: string }): Row {
  return {
    id: input.id,
    knowledge_edge_id: "22222222-2222-4222-8222-222222222222",
    content_digest: digest(input.digestChar),
    resolved_at: input.resolved,
    pit_evidence_boundary: input.resolved,
    source_record_ids_json: JSON.stringify({
      visible_from_cycle_pit_anchor: input.visible,
      forecast_runtime_authority_content_digest_hex: digest("a"),
      forecast_outcome_content_digest_hex: digest(input.digestChar),
    }),
  };
}

function fakeSql(rows: readonly Row[]) {
  return (async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const asOf = values.at(-1) as string;
    return rows.filter((item) => {
      const visible = JSON.parse(item.source_record_ids_json).visible_from_cycle_pit_anchor as string;
      return Date.parse(visible) <= Date.parse(asOf);
    });
  }) as never;
}

function memoryCheckpoints(): HistoricalSimulationKnowledgeCheckpointStoreV2 & {
  values: Map<number, KnowledgeCheckpointInput>;
} {
  const values = new Map<number, KnowledgeCheckpointInput>();
  return {
    values,
    async write(input) { values.set(input.checkpointSeq, input); },
    async restore(input) {
      const checkpoint = values.get(input.checkpointSeq);
      if (!checkpoint) throw new Error("missing checkpoint");
      return {
        input: checkpoint,
        knowledgeSemanticDigest: computeKnowledgeSemanticDigest(checkpoint),
        contentDigest: computeKnowledgeCheckpointContentDigest(checkpoint),
      };
    },
  };
}

function port(rows: readonly Row[], store = memoryCheckpoints()) {
  return createHistoricalSimulationPostgresKnowledgePortV2({
    sql: fakeSql(rows), organizationId: ORG, symbol: "BTCUSDT", checkpointStore: store,
    forecastProducer: {
      kmGlobalAnchorSetDigestHex: digest("b"), priorMachineRecommendedConfidence: "0.5000",
      provenance: {
        codeSha: digest("c"),
        datasetContentDigest: digest("d"),
        profileDigest: digest("e"),
        canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
      },
      resolveVolumeAuthorityReceipt: () => { throw new Error("not exercised"); },
    },
  });
}

describe("Historical Simulation V2 PostgreSQL knowledge port", () => {
  it("does not expose future knowledge at an earlier PIT anchor", async () => {
    const early = row({ id: "early", visible: "2026-08-01T00:02:00.000Z",
      resolved: "2026-08-01T00:01:00.000Z", digestChar: "1" });
    const future = row({ id: "future", visible: "2026-08-01T00:04:00.000Z",
      resolved: "2026-08-01T00:03:00.000Z", digestChar: "2" });
    const knowledge = port([early, future]);
    const before = await knowledge.snapshotAsOf("2026-08-01T00:03:00.000Z");
    const after = await knowledge.snapshotAsOf("2026-08-01T00:04:00.000Z");
    expect(before.contentDigestHex).not.toBe(after.contentDigestHex);
    expect(await knowledge.closeMaturedForecasts("2026-08-01T00:03:00.000Z")).toEqual([]);
    expect(await knowledge.closeMaturedForecasts("2026-08-01T00:04:00.000Z")).toEqual([
      expect.objectContaining({ outcomeContentDigestHex: digest("2") }),
    ]);
  });

  it("rejects closure injection instead of admitting unverified future evidence", async () => {
    const knowledge = port([]);
    await expect(knowledge.applyMaturedClosures({
      strictlyBefore: "2026-08-01T00:03:00.000Z",
      closures: [{ forecastAuthorityContentDigestHex: digest("a"),
        maturedAt: "2026-08-01T00:01:00.000Z", outcomeContentDigestHex: digest("9") }],
    })).rejects.toThrow(/CLOSURE_MISMATCH/);
  });

  it("restores an identical knowledge snapshot and fails on changed PIT state", async () => {
    const rows: Row[] = [row({ id: "early", visible: "2026-08-01T00:02:00.000Z",
      resolved: "2026-08-01T00:01:00.000Z", digestChar: "1" })];
    const store = memoryCheckpoints();
    const knowledge = port(rows, store);
    const written = await knowledge.checkpoint({ runId: "run-1", checkpointSeq: 7,
      pitAnchor: "2026-08-01T00:03:00.000Z", modelVersion: "forecast-v2" });
    const restored = await knowledge.restoreCheckpoint({ runId: "run-1", checkpointSeq: 7,
      pitAnchor: "2026-08-01T00:03:00.000Z", modelVersion: "forecast-v2" });
    expect(restored).toEqual(written);

    rows.push(row({ id: "late-write", visible: "2026-08-01T00:03:00.000Z",
      resolved: "2026-08-01T00:02:00.000Z", digestChar: "2" }));
    await expect(knowledge.restoreCheckpoint({ runId: "run-1", checkpointSeq: 7,
      pitAnchor: "2026-08-01T00:03:00.000Z", modelVersion: "forecast-v2" }))
      .rejects.toThrow(/RESUME_PARITY_MISMATCH/);
  });

  it("binds checkpoint restore to the exact run identity", async () => {
    const store = memoryCheckpoints();
    const knowledge = port([], store);
    await knowledge.checkpoint({ runId: "run-1", checkpointSeq: 0,
      pitAnchor: "2026-08-01T00:00:00.000Z", modelVersion: "forecast-v2" });
    await expect(knowledge.restoreCheckpoint({ runId: "run-2", checkpointSeq: 0,
      pitAnchor: "2026-08-01T00:00:00.000Z", modelVersion: "forecast-v2" }))
      .rejects.toThrow(/RESUME_IDENTITY_MISMATCH/);
  });
});
