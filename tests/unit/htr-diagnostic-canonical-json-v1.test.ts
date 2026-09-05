import { describe, expect, it } from "vitest";

import {
  canonicalizeDiagnosticJsonString,
  canonicalizeSemanticJsonString,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";

describe("HTR diagnostic canonical JSON", () => {
  it("reports nested non-finite numbers without weakening strict semantic canonicalization", () => {
    const diagnostic = {
      positive: Number.POSITIVE_INFINITY,
      nested: [Number.NaN, { negative: Number.NEGATIVE_INFINITY }],
    };

    expect(() => canonicalizeSemanticJsonString(diagnostic)).toThrow(
      "HTR_SEMANTIC_CANONICAL_JSON_V1: non-finite number prohibited",
    );
    expect(canonicalizeDiagnosticJsonString(diagnostic)).toBe(
      '{"nested":["NON_FINITE_NUMBER:NaN",{"negative":"NON_FINITE_NUMBER:-Infinity"}],"positive":"NON_FINITE_NUMBER:+Infinity"}',
    );
  });

  it("preserves the primary weak-corpus HOLM rejection when diagnostics contain non-finite values", () => {
    const diagnostic = canonicalizeDiagnosticJsonString({
      reasonCodes: ["HOLM_FWER_REJECTED"],
      meanImprovementByBaseline: {
        "climatology/v1": Number.NaN,
        "rolling-w2000/v1": 0.000001,
      },
      holmResults: [
        { baselineId: "climatology/v1", pRaw: 0.0817918208179182, rejected: false },
        { baselineId: "rolling-w2000/v1", pRaw: 0.08259174082591741, rejected: false },
      ],
    });

    expect(JSON.parse(diagnostic)).toMatchObject({
      reasonCodes: ["HOLM_FWER_REJECTED"],
      meanImprovementByBaseline: {
        "climatology/v1": "NON_FINITE_NUMBER:NaN",
      },
      holmResults: [
        { baselineId: "climatology/v1", rejected: false },
        { baselineId: "rolling-w2000/v1", rejected: false },
      ],
    });
  });
});
