import { describe, expect, it } from "vitest";

import { computeKnowledgeCheckpointContentDigest, computeKnowledgeSemanticDigest,
  type KnowledgeCheckpointInput } from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";
import { createHistoricalSimulationPostgresKnowledgePortV2,
  createHistoricalSimulationPostgresKnowledgeReadPortV2,
  type HistoricalSimulationKnowledgeCheckpointStoreV2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";
import { computeKnowledgeConfidenceUpdateContentDigest, KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  type KnowledgeConfidenceUpdateRecord } from "@/lib/trader/knowledge/knowledge-confidence-update";
import type { HistoricalForecastPitKnowledgeRowV2 } from
  "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";

const ORG = "11111111-1111-4111-8111-111111111111";
const digest = (value: string) => value.repeat(64);

type Row = HistoricalForecastPitKnowledgeRowV2;

function row(input: { id: string; visible: string; resolved: string; digestChar: string }): Row {
  const source = {
    visible_from_cycle_pit_anchor: input.visible,
    forecast_runtime_authority_content_digest_hex: digest("a"),
    forecast_outcome_content_digest_hex: digest(input.digestChar),
    confidence_value_class: "MACHINE_RECOMMENDED_BOUNDED_DELTA",
    authority_class: "EPISTEMIC_EVIDENCE_ONLY", operator_disposition: "OBSERVE_ONLY",
    capital_authority: "NONE", strategy_authority: "NONE", trade_eligibility_authority: "NONE",
    guardian_authority: "NONE",
  };
  const id = `00000000-0000-4000-8000-${input.digestChar.repeat(12)}`;
  const canonical = { id, organizationId: ORG, runId: "run", cycleId: "cycle", symbol: "BTCUSDT",
    knowledgeEdgeId: "22222222-2222-4222-8222-222222222222", updateKind: "FORECAST_V2_EVIDENCE_ONLY",
    updateModelVersion: "waia.knowledge.forecast-v2-evidence-only", priorMachineRecommendedConfidence: "0.5000",
    machineRecommendedConfidence: "0.5000", machineRecommendedDelta: "0.0000",
    confidenceValueClass: source.confidence_value_class, authorityClass: source.authority_class,
    operatorDisposition: source.operator_disposition, capitalAuthority: source.capital_authority,
    strategyAuthority: source.strategy_authority, tradeEligibilityAuthority: source.trade_eligibility_authority,
    guardianAuthority: source.guardian_authority, issuedAt: input.resolved,
    eligibleResolutionAt: input.resolved, resolvedAt: input.resolved, pitEvidenceBoundary: input.resolved,
    outcomeClass: "FLAT", score: null, sourceRecordIdsJson: JSON.stringify(source),
    contentDigest: "", idempotencyKey: `knowledge-${input.digestChar}`,
    provenance: { codeSha: digest("c"), datasetContentDigest: digest("d"), profileDigest: digest("e"),
      canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1" }, terminalReason: "FORECAST_V2_EVIDENCE_ONLY",
    schemaVersion: KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION } as unknown as KnowledgeConfidenceUpdateRecord;
  const contentDigest = computeKnowledgeConfidenceUpdateContentDigest(canonical);
  return {
    id,
    organization_id: ORG, run_id: "run", cycle_id: "cycle", symbol: "BTCUSDT",
    knowledge_edge_id: "22222222-2222-4222-8222-222222222222",
    update_kind: canonical.updateKind, update_model_version: canonical.updateModelVersion,
    prior_confidence: canonical.priorMachineRecommendedConfidence,
    posterior_confidence: canonical.machineRecommendedConfidence, delta: canonical.machineRecommendedDelta,
    issued_at: input.resolved, eligible_resolution_at: input.resolved,
    content_digest: contentDigest,
    resolved_at: input.resolved,
    pit_evidence_boundary: input.resolved,
    outcome_class: canonical.outcomeClass, score: null, source_record_ids_json: canonical.sourceRecordIdsJson,
    idempotency_key: canonical.idempotencyKey, provenance_json: JSON.stringify(canonical.provenance),
    terminal_reason: canonical.terminalReason, schema_version: canonical.schemaVersion,
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
  it("provides a replay-only PIT port without any Forecast issuance capability", async () => {
    const read = createHistoricalSimulationPostgresKnowledgeReadPortV2({ sql: fakeSql([]),
      organizationId: ORG, symbol: "BTCUSDT", checkpointStore: memoryCheckpoints() });
    expect("processForecastCycle" in read).toBe(false);
    await expect(read.snapshotAsOf("2026-08-01T00:00:00.000Z")).resolves.toMatchObject({
      asOf: "2026-08-01T00:00:00.000Z",
    });
  });
  it("seeds closure visibility from the restored learning watermark", async () => {
    const prior = row({ id: "prior", visible: "2026-08-01T00:02:00.000Z",
      resolved: "2026-08-01T00:01:00.000Z", digestChar: "4" });
    const read = createHistoricalSimulationPostgresKnowledgeReadPortV2({ sql: fakeSql([prior]),
      organizationId: ORG, symbol: "BTCUSDT", checkpointStore: memoryCheckpoints(),
      appliedClosureWatermarkUtc: "2026-08-01T00:02:00.000Z" });
    await expect(read.closeMaturedForecasts("2026-08-01T00:03:00.000Z")).resolves.toEqual([]);
  });

  it("rejects a row whose resolution or evidence boundary is in the future", async () => {
    const future = row({ id: "future", visible: "2026-08-01T00:02:00.000Z",
      resolved: "2026-08-01T00:04:00.000Z", digestChar: "5" });
    const read = createHistoricalSimulationPostgresKnowledgeReadPortV2({ sql: fakeSql([future]),
      organizationId: ORG, symbol: "BTCUSDT", checkpointStore: memoryCheckpoints() });
    await expect(read.snapshotAsOf("2026-08-01T00:03:00.000Z")).rejects.toThrow("PIT_LEAKAGE");
  });
  it("does not expose future knowledge at an earlier PIT anchor", async () => {
    const early = row({ id: "early", visible: "2026-08-01T00:02:00.000Z",
      resolved: "2026-08-01T00:01:00.000Z", digestChar: "1" });
    const future = row({ id: "future", visible: "2026-08-01T00:04:00.000Z",
      resolved: "2026-08-01T00:03:00.000Z", digestChar: "2" });
    const knowledge = port([early, future]);
    const before = await knowledge.snapshotAsOf("2026-08-01T00:03:00.000Z");
    const after = await knowledge.snapshotAsOf("2026-08-01T00:04:00.000Z");
    expect(before.contentDigestHex).not.toBe(after.contentDigestHex);
    const earlyClosures = await knowledge.closeMaturedForecasts("2026-08-01T00:03:00.000Z");
    expect(earlyClosures).toEqual([
      expect.objectContaining({ outcomeContentDigestHex: digest("1") }),
    ]);
    await knowledge.applyMaturedClosures({
      strictlyBefore: "2026-08-01T00:03:00.000Z", closures: earlyClosures,
    });
    expect(await knowledge.closeMaturedForecasts("2026-08-01T00:04:00.000Z")).toEqual([
      expect.objectContaining({ outcomeContentDigestHex: digest("2") }),
    ]);
  });

  it("emits every newly visible closure once across skipped anchors and resume", async () => {
    const rows = [
      row({ id: "one", visible: "2026-08-01T00:02:00.000Z", resolved: "2026-08-01T00:01:00.000Z", digestChar: "1" }),
      row({ id: "two", visible: "2026-08-01T00:04:00.000Z", resolved: "2026-08-01T00:03:00.000Z", digestChar: "2" }),
    ];
    const knowledge = port(rows);
    const skipped = await knowledge.closeMaturedForecasts("2026-08-01T00:05:00.000Z");
    expect(skipped.map((value) => value.outcomeContentDigestHex).sort()).toEqual([digest("1"), digest("2")]);
    await knowledge.applyMaturedClosures({ strictlyBefore: "2026-08-01T00:05:00.000Z", closures: skipped });
    expect(await knowledge.closeMaturedForecasts("2026-08-01T00:06:00.000Z")).toEqual([]);
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
