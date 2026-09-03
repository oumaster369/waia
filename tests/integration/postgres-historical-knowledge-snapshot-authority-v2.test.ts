import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { loadHistoricalKnowledgeSnapshotAuthorityV2 } from
  "@/lib/trader/historical-simulation-v2/knowledge-snapshot-binding-v2";
import {
  computeKnowledgeConfidenceUpdateContentDigest,
  KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
  type KnowledgeConfidenceUpdateRecord,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_ID = "00000000-0000-4000-8000-000000091902";
const RUN_ID = "dee-919-knowledge-snapshot";
const PIT = "2026-08-01T00:03:00.000Z";
const digest = (value: string) => value.repeat(64);

describe.skipIf(!enabled || !url)("historical knowledge snapshot authority PostgreSQL", () => {
  const sql = url ? postgres(url, { max: 2 }) : null!;
  let organizationId = "";

  beforeAll(async () => {
    await cleanupWp13Org(url!, USER_ID);
    organizationId = await seedWp13User(url!, USER_ID, "DEE-919 knowledge snapshot");
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await cleanupWp13Org(url!, USER_ID);
  });

  it("derives a nonempty authority only from exact run-scoped durable rows", async () => {
    const source = {
      visible_from_cycle_pit_anchor: "2026-08-01T00:02:00.000Z",
      forecast_runtime_authority_content_digest_hex: digest("a"),
      forecast_content_digest_hex: digest("f"),
      forecast_outcome_content_digest_hex: digest("b"),
      calibration_observation_content_digest: digest("6"),
      predictive_package_content_digest_hex: digest("7"),
      terminal_target_definition_digest_hex: digest("8"),
      pit_measurement_identity_digest_hex: digest("9"),
      knowledge_edge_id: "00000000-0000-4000-8000-000000091904",
      knowledge_content_digest_hex: digest("0"),
      feedback_policy: "EVIDENCE_ONLY_ZERO_DELTA",
      confidence_value_class: "MACHINE_RECOMMENDED_BOUNDED_DELTA",
      authority_class: "EVIDENCE_ONLY",
      operator_disposition: "PENDING",
      capital_authority: "NONE",
      strategy_authority: "NONE",
      trade_eligibility_authority: "NONE",
      guardian_authority: "NONE",
    };
    const canonical = {
      id: "00000000-0000-4000-8000-000000091903",
      organizationId,
      runId: RUN_ID,
      cycleId: "cycle-1",
      symbol: "BTCUSDT",
      knowledgeEdgeId: "00000000-0000-4000-8000-000000091904",
      updateKind: "UPDATE",
      updateModelVersion: "waia.trader.knowledge_confidence_update_model.v1.forecast-v2-evidence-only",
      priorMachineRecommendedConfidence: "0.5000",
      machineRecommendedConfidence: "0.5000",
      machineRecommendedDelta: "0.0000",
      confidenceValueClass: source.confidence_value_class,
      authorityClass: source.authority_class,
      operatorDisposition: source.operator_disposition,
      capitalAuthority: source.capital_authority,
      strategyAuthority: source.strategy_authority,
      tradeEligibilityAuthority: source.trade_eligibility_authority,
      guardianAuthority: source.guardian_authority,
      issuedAt: "2026-08-01T00:01:00.000Z",
      eligibleResolutionAt: "2026-08-01T00:01:00.000Z",
      resolvedAt: "2026-08-01T00:01:00.000Z",
      pitEvidenceBoundary: "2026-08-01T00:01:00.000Z",
      outcomeClass: "FORECAST_V2_EVIDENCE_ONLY",
      score: "0.125",
      sourceRecordIdsJson: JSON.stringify(source),
      contentDigest: "",
      idempotencyKey: "dee-919-knowledge-snapshot-row",
      provenance: {
        codeSha: digest("c"), datasetContentDigest: digest("d"),
        profileDigest: digest("e"), canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
      },
      terminalReason: "FORECAST_V2_EVIDENCE_ONLY_ZERO_DELTA",
      schemaVersion: KNOWLEDGE_CONFIDENCE_UPDATE_SCHEMA_VERSION,
    } as unknown as KnowledgeConfidenceUpdateRecord;
    const contentDigest = computeKnowledgeConfidenceUpdateContentDigest(canonical);

    const rollback = new Error("DEE919_EXPECTED_ROLLBACK");
    await expect(sql.begin("isolation level serializable", async (tx) => {
      await tx`
        INSERT INTO trader_knowledge_confidence_update_record (
          id, organization_id, run_id, cycle_id, symbol, knowledge_edge_id, update_kind,
          update_model_version, prior_confidence, posterior_confidence, delta, issued_at,
          eligible_resolution_at, resolved_at, pit_evidence_boundary, outcome_class, score,
          source_record_ids_json, content_digest, idempotency_key, provenance_json,
          terminal_reason, schema_version
        ) VALUES (
          ${canonical.id}::uuid, ${organizationId}::uuid, ${RUN_ID}, ${canonical.cycleId},
          ${canonical.symbol}, ${canonical.knowledgeEdgeId}::uuid, ${canonical.updateKind},
          ${canonical.updateModelVersion}, ${canonical.priorMachineRecommendedConfidence},
          ${canonical.machineRecommendedConfidence}, ${canonical.machineRecommendedDelta},
          ${canonical.issuedAt}::timestamptz, ${canonical.eligibleResolutionAt}::timestamptz,
          ${canonical.resolvedAt}::timestamptz, ${canonical.pitEvidenceBoundary}::timestamptz,
          ${canonical.outcomeClass}, ${canonical.score}, ${canonical.sourceRecordIdsJson},
          ${contentDigest}, ${canonical.idempotencyKey}, ${JSON.stringify(canonical.provenance)},
          ${canonical.terminalReason}, ${canonical.schemaVersion}
        )
      `;
      const authority = await loadHistoricalKnowledgeSnapshotAuthorityV2(tx as never, {
        organizationId, runId: RUN_ID, symbol: "BTCUSDT", pitAnchor: PIT,
      });
      expect(authority).toMatchObject({
        organizationId, runId: RUN_ID, symbol: "BTCUSDT", pitAnchor: PIT,
        visibleEvidenceCount: 1,
      });
      const otherRun = await loadHistoricalKnowledgeSnapshotAuthorityV2(tx as never, {
        organizationId, runId: "other-run", symbol: "BTCUSDT", pitAnchor: PIT,
      });
      expect(otherRun.visibleEvidenceCount).toBe(0);
      expect(otherRun.knowledgeContentDigestHex).not.toBe(authority.knowledgeContentDigestHex);
      throw rollback;
    })).rejects.toBe(rollback);

    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_knowledge_confidence_update_record
      WHERE organization_id=${organizationId}::uuid AND run_id=${RUN_ID}
    `;
    expect(rows[0]?.count).toBe("0");
  });
});
