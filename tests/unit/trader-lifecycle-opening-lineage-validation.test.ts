import { describe, expect, it } from "vitest";

import { assertLifecycleOpeningCausalLineage } from "@/lib/trader/lifecycle/assert-opening-causal-lineage";
import {
  buildOpeningCausalLineageV1,
  serializeOpeningCausalLineageV1,
} from "@/lib/trader/lifecycle/opening-causal-lineage-v1";

const organizationId = "00000000-0000-4000-8000-000000063501";
const symbol = "BTC/USDT";
const lineage = buildOpeningCausalLineageV1({
  organizationId,
  symbol,
  canonicalCausalLineageDigest: "1".repeat(64),
  forecastId: "forecast",
  forecastContentDigest: "2".repeat(64),
  decisionId: "decision",
  decisionContentDigest: "3".repeat(64),
  riskVerdictId: "risk",
  riskAllowanceId: "allowance",
  riskAllowanceContentDigest: "4".repeat(64),
});
const json = serializeOpeningCausalLineageV1(lineage);

describe("lifecycle opening causal lineage validation", () => {
  it("accepts canonical byte-identical lineage", () => {
    expect(() => assertLifecycleOpeningCausalLineage({
      organizationId, symbol, openingCausalLineageJson: json,
      openingCausalLineageDigest: lineage.contentDigest,
    })).not.toThrow();
  });

  it.each([
    [{ openingCausalLineageJson: json }, "INCOMPLETE"],
    [{ openingCausalLineageJson: "{}", openingCausalLineageDigest: lineage.contentDigest }, "UNSUPPORTED_VERSION"],
    [{ openingCausalLineageJson: json, openingCausalLineageDigest: "a".repeat(64) }, "DIGEST_MISMATCH"],
    [{ openingCausalLineageJson: json, openingCausalLineageDigest: lineage.contentDigest, organizationId: "other" }, "SCOPE_MISMATCH"],
    [{ openingCausalLineageJson: json, openingCausalLineageDigest: lineage.contentDigest, symbol: "ETH/USDT" }, "SCOPE_MISMATCH"],
  ])("rejects invalid lifecycle lineage %#", (override, code) => {
    expect(() => assertLifecycleOpeningCausalLineage({
      organizationId, symbol, ...override,
    })).toThrow(code);
  });
});
