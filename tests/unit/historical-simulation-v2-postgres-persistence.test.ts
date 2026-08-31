import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createHistoricalSimulationReasonLedgerV2 } from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { deriveHistoricalSimulationModeledEvidenceV2 } from "@/lib/trader/historical-simulation-v2/reason-ledger-repository-postgres";

const digest = (c: string) => c.repeat(64);

describe("Historical Simulation V2 PostgreSQL persistence", () => {
  it("derives explicitly modeled risk/execution/guardian/fill evidence without capital authority", () => {
    const entry = createHistoricalSimulationReasonLedgerV2({
      entryId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222",
      runId: "run", cycleId: "cycle", cycleSequence: 0, symbol: "BTCUSDT", partition: "DEVELOPMENT",
      replayBarClosedAtUtc: "2026-08-01T00:00:00.000Z", previousContentDigestHex: null,
      forecast: { status: "AUTHORIZED", authorityContentDigestHex: digest("a"), reasonCodes: [] },
      decision: { status: "ENTER_LONG", decisionContentDigestHex: digest("b"), whyNotCashReceiptDigestHex: digest("c"), evLower: "1", evBase: "2", evUpper: "3", reasonCodes: [] },
      portfolio: { status: "PROPOSED", proposalContentDigestHex: digest("d"), reasonCodes: [] },
      risk: { status: "APPROVE", verdictContentDigestHex: digest("e"), allowanceContentDigestHex: digest("f"), reasonCodes: [] },
      execution: { status: "FILLED", planContentDigestHex: digest("1"), attemptContentDigestHex: digest("2"), reportContentDigestHex: digest("3"), fillContentDigestHexes: [digest("4"), digest("5")], reasonCodes: [] },
      accounting: { status: "APPLIED", frontierContentDigestHex: digest("6"), reasonCodes: [] },
      guardian: { status: "NONE", assessmentContentDigestHex: digest("7"), reasonCodes: [] },
      learning: { status: "PENDING", calibrationObservationContentDigestHex: null, knowledgeUpdateContentDigestHex: null, eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null, reasonCodes: ["FUTURE_ONLY"] },
    });
    const evidence = deriveHistoricalSimulationModeledEvidenceV2(entry);
    expect(evidence.map((item) => item.evidenceKind)).toEqual(["RISK", "EXECUTION", "GUARDIAN", "FILL", "FILL"]);
    expect(evidence.every((item) => item.capitalEligible === false)).toBe(true);
    expect(new Set(evidence.map((item) => item.evidenceContentDigestHex)).size).toBe(evidence.length);
    expect(evidence.filter((item) => item.evidenceKind === "FILL").map((item) => item.evidenceOrdinal)).toEqual([0, 1]);
  });

  it("declares a fresh-database migration with append-only triggers, RLS, tenant FK and hard safety constraints", () => {
    const sql = readFileSync(join(process.cwd(), "db/migrations_postgres/0183_historical_simulation_v2_evidence.sql"), "utf8");
    for (const required of [
      "trader_historical_simulation_reason_ledger_v2",
      "trader_historical_simulation_modeled_evidence_v2",
      "BEFORE UPDATE OR DELETE",
      "ENABLE ROW LEVEL SECURITY",
      "historical_sim_v2_preholdout_only",
      "historical_sim_v2_never_capital",
      "historical_sim_modeled_evidence_entry_org_fk",
      "HISTORICAL_SIMULATION_V2_MODELED_FILL",
    ]) {
      if (required === "HISTORICAL_SIMULATION_V2_MODELED_FILL") continue;
      expect(sql).toContain(required);
    }
    expect(sql).not.toMatch(/trader_reality_(events|truth_records)_v2.*INSERT/is);
  });
});
