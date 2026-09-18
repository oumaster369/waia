import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = process.cwd();

describe("DEE-771 migration identity", () => {
  const sql = readFileSync(
    join(REPO, "db/migrations_postgres/0211_trader_knowledge_edge_version_v2.sql"),
    "utf8",
  );
  const journal = readFileSync(join(REPO, "db/migrations_postgres/meta/_journal.json"), "utf8");

  it("owns 0211 without rewriting 0192 or 0201", () => {
    expect(journal).toContain("0211_trader_knowledge_edge_version_v2");
    expect(sql).toContain("trader_knowledge_edge_version_v2");
    expect(sql).toContain("trader_market_prediction_verification_v2");
    expect(sql).toContain("trader_knowledge_edges_immutable_all_v2");
    expect(sql).not.toContain("DROP TRIGGER trader_historical_forecast_bootstrap_immutable_v2");
    expect(sql).not.toMatch(/DROP TABLE/);
  });

  it("generalizes immutability and revocation instead of relaxing them", () => {
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.trader_knowledge_edges");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.trader_market_predictions");
    expect(sql).toContain(
      "REVOKE UPDATE, DELETE ON TABLE public.trader_knowledge_edges FROM waia_historical_runner",
    );
    expect(sql).toContain(
      "REVOKE UPDATE, DELETE ON TABLE public.trader_market_predictions FROM waia_historical_runner",
    );
    expect(sql).not.toMatch(/GRANT UPDATE/);
  });

  it("preserves Forecast V2 EVIDENCE_ONLY_ZERO_DELTA and 0108/0134 append-only files", () => {
    const confidence = readFileSync(
      join(REPO, "lib/trader/knowledge/knowledge-confidence-update.ts"),
      "utf8",
    );
    expect(confidence).toContain('machineRecommendedDelta: "0.0000"');
    expect(confidence).toContain("FORECAST_V2_EVIDENCE_ONLY_ZERO_DELTA");
    const updateRecord = readFileSync(
      join(REPO, "db/migrations_postgres/0108_trader_knowledge_confidence_update_record.sql"),
      "utf8",
    );
    expect(updateRecord).toContain("append-only");
    const checkpoint = readFileSync(
      join(REPO, "db/migrations_postgres/0134_trader_knowledge_state_checkpoint_v2.sql"),
      "utf8",
    );
    expect(checkpoint).toContain("trader_knowledge_state_checkpoint_v2_block_update");
    expect(checkpoint).toContain("trader_knowledge_state_checkpoint_v2_block_delete");
  });
});
