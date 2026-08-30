import { describe, expect, it } from "vitest";

import { buildGuardianAssessmentFromCanonicalInputsV2 } from "@/lib/trader/guardian/v2";
import { buildOpeningCausalLineageV1, serializeOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { createRealityProjectionV2 } from "@/lib/trader/reality/v2/contracts";

const ORG = "3ca6ea6d-a049-4c1d-a694-77a417536f52";
const hex = (character: string) => character.repeat(64);

const lineage = buildOpeningCausalLineageV1({
  organizationId: ORG,
  symbol: "BTCUSDT",
  canonicalCausalLineageDigest: hex("1"),
  forecastId: "forecast-a",
  forecastContentDigest: hex("2"),
  decisionId: "decision-a",
  decisionContentDigest: hex("3"),
  riskVerdictId: "verdict-a",
  riskAllowanceId: "allowance-a",
  riskAllowanceContentDigest: hex("4"),
});

const now = new Date("2026-08-30T00:00:00.000Z");
const lot = (overrides: Partial<PositionLotRow> = {}): PositionLotRow => ({
  id: "lot-a",
  organizationId: ORG,
  symbol: "BTCUSDT",
  venue: "HTX",
  accountKey: "account-a",
  positionSide: "LONG",
  instrumentKind: "SPOT",
  strategySignalId: "signal-a",
  openingCausalLineageJson: serializeOpeningCausalLineageV1(lineage),
  openingCausalLineageDigest: lineage.contentDigest,
  state: "OPEN",
  openQty: "1",
  remainingQty: "0.5",
  avgCost: "60000",
  openedAt: now,
  closedAt: null,
  tradeId: "trade-a",
  hedgeGroupId: null,
  targetLotId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeReality = (accountId = "account-a") => createRealityProjectionV2({
  organizationId: ORG,
  accountId,
  knowledgeAsOfUtc: "2026-08-30T00:00:00.000Z",
  frontierSequence: "0",
  frontierEventDigestHex: null,
  stableEntries: [],
  uncertainties: [],
});
const reality = makeReality();

const evidence = {
  organizationId: ORG,
  symbol: "BTCUSDT",
  evidenceBundleId: "evidence-a",
  evidenceContentDigest: hex("5"),
  profile: "OPEN_POSITION_REASSESSMENT",
  openPositionSufficiency: "SUFFICIENT",
  newOpportunitySufficiency: "INSUFFICIENT",
} as const;

const build = (overrides: Partial<Parameters<typeof buildGuardianAssessmentFromCanonicalInputsV2>[0]> = {}) =>
  buildGuardianAssessmentFromCanonicalInputsV2({
    organizationId: ORG,
    lot: lot(),
    reality,
    evidence,
    recommendation: "HOLD",
    targetReductionBps: 0,
    reasonCodes: ["THESIS_INTACT"],
    ...overrides,
  });

describe("Guardian V2 canonical input binding", () => {
  it("binds an open lot to exact opening lineage, Reality and qualified evidence", () => {
    const assessment = build();
    expect(assessment.positionId).toBe("trade-a");
    expect(assessment.lotId).toBe("lot-a");
    expect(assessment.openingCausalLineageDigest).toBe(lineage.contentDigest);
    expect(assessment.realityFrontierId).toBe(reality.projectionId);
    expect(assessment.newOpportunitySufficiency).toBe("INSUFFICIENT");
  });

  it.each([
    ["closed lot", { lot: lot({ state: "CLOSED", remainingQty: "0", closedAt: now }) }, "GUARDIAN_V2_LOT_NOT_CANONICALLY_OPEN"],
    ["status-open zero lot", { lot: lot({ remainingQty: "0" }) }, "GUARDIAN_V2_LOT_NOT_CANONICALLY_OPEN"],
    ["cross-tenant lot", { lot: lot({ organizationId: "other" }) }, "GUARDIAN_V2_LOT_TENANT_MISMATCH"],
    ["wrong Reality account", { reality: makeReality("account-b") }, "GUARDIAN_V2_REALITY_ACCOUNT_MISMATCH"],
    ["cross-symbol evidence", { evidence: { ...evidence, symbol: "ETHUSDT" } }, "GUARDIAN_V2_EVIDENCE_SCOPE_MISMATCH"],
    ["missing opening lineage", { lot: lot({ openingCausalLineageJson: null, openingCausalLineageDigest: null }) }, "GUARDIAN_V2_OPENING_LINEAGE_MISSING"],
    ["mismatched opening lineage", { lot: lot({ openingCausalLineageDigest: hex("a") }) }, "GUARDIAN_V2_OPENING_LINEAGE_MISMATCH"],
  ] as const)("fails closed for %s", (_label, overrides, error) => {
    expect(() => build(overrides as never)).toThrow(error);
  });
});
