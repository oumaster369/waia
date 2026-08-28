import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const migration = readFileSync(
  join(REPO, "db/migrations_postgres/0173_dee633_forecast_v2_feedback_payload.sql"),
  "utf8",
);
const authorityFiles = [
  "lib/trader/intelligence/calibration/calibration-scorer.ts",
  "lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service.ts",
  "lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime.ts",
  "lib/trader/knowledge/knowledge-confidence-update.ts",
].map((path) => readFileSync(join(REPO, path), "utf8"));

describe("DEE-633 migration identity and legacy quarantine", () => {
  it("keeps the Forecast-V2 feedback migration additive and replay-complete", () => {
    for (const column of [
      "pit_measurement_identity_digest",
      "objective_evidence_json",
      "forecast_runtime_authority_content_digest",
      "knowledge_edge_id",
      "knowledge_content_digest",
      "scoring_version",
      "probability_vector_json",
      "normalized_brier_score",
      "log_loss_score",
      "calibration_payload_json",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+trader_forecast_/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+trader_forecast_/i);
  });

  it("quarantines ForecastDecisionBundle and heuristic Market Memory mutation from V2 authority", () => {
    for (const source of authorityFiles) {
      expect(source).not.toContain("ForecastDecisionBundle");
      expect(source).not.toContain("adjustEdgeConfidenceFromVerification");
      expect(source).not.toContain("updateEdgeConfidenceFromVerification");
      expect(source).not.toContain("forecast_confidence_json.confidence_value");
    }
  });
});
