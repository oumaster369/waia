import { describe, expect, it } from "vitest";

import {
  type ClaimShape,
  type HypothesisDefinition,
  MI_HYPOTHESIS_SCHEMA_VERSION,
  type MiHypothesisNullKind,
} from "@/lib/trader/mi/hypothesis.types";
import {
  buildHypothesisDefinitionDigest,
  buildLifecycleContentDigest,
  computeHypothesisKey,
  deriveMandatoryNullFloor,
  findForbiddenDefinitionKey,
  HYPOTHESIS_FORBIDDEN_DEFINITION_KEYS,
} from "@/lib/trader/mi/serialize-hypothesis";

const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000b285";
const GOLDEN_NAME = "golden_hypothesis";

function buildDefinition(overrides?: Partial<HypothesisDefinition>): HypothesisDefinition {
  return {
    claimShape: {
      relationshipType: "predictive",
      isDirectional: true,
      isTrendEdge: false,
      isTimingEdge: false,
    },
    prior: { ordinal: "moderate", band: "wide" },
    falsificationConditions: ["observed hit rate below null over evaluation window"],
    requiredNulls: ["always-flat-cash", "buy-and-hold"],
    patternRefs: [
      {
        patternKey: "abc123",
        patternDefinitionDigest: "def456",
      },
    ],
    measurementRefs: [
      {
        measurementKey: "sma20",
        measurementDefinitionDigest: "fed789",
      },
    ],
    regimeScope: { description: "BTC-USD 1h trending regimes" },
    ...overrides,
  };
}

describe("trader mi hypothesis serialize (DEE-285 / LD-5a.1a)", () => {
  it("hypothesis_key is deterministic and org-scoped", () => {
    const keyA = computeHypothesisKey({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKind: "market_claim",
      name: GOLDEN_NAME,
    });
    const keyB = computeHypothesisKey({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKind: "market_claim",
      name: GOLDEN_NAME,
    });
    expect(keyA).toBe(keyB);
    expect(
      computeHypothesisKey({
        organizationId: "00000000-0000-4000-8000-00000000c285",
        hypothesisKind: "market_claim",
        name: GOLDEN_NAME,
      }),
    ).not.toBe(keyA);
  });

  it("golden definition_digest fixture pins canonical serialization", () => {
    const hypothesisKey = computeHypothesisKey({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKind: "market_claim",
      name: GOLDEN_NAME,
    });
    const digest = buildHypothesisDefinitionDigest({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKey,
      hypothesisKind: "market_claim",
      name: GOLDEN_NAME,
      definition: buildDefinition(),
    });
    expect(digest).toMatchInlineSnapshot(
      `"0f9af018b3e9209893cf2afb42e1509c4c881e66909b739e1300392c43ac726b"`,
    );
  });

  it("definition_digest changes when claim shape changes", () => {
    const hypothesisKey = computeHypothesisKey({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKind: "market_claim",
      name: "shape_probe",
    });
    const base = buildHypothesisDefinitionDigest({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKey,
      hypothesisKind: "market_claim",
      name: "shape_probe",
      definition: buildDefinition(),
    });
    const changed = buildHypothesisDefinitionDigest({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKey,
      hypothesisKind: "market_claim",
      name: "shape_probe",
      definition: buildDefinition({
        claimShape: {
          relationshipType: "predictive",
          isDirectional: true,
          isTrendEdge: true,
          isTimingEdge: false,
        },
        requiredNulls: ["always-flat-cash", "buy-and-hold", "simple-trend-baseline"],
      }),
    });
    expect(changed).not.toBe(base);
  });

  it("deriveMandatoryNullFloor enforces the required-null contract", () => {
    const cases: Array<[ClaimShape, MiHypothesisNullKind[]]> = [
      [
        {
          relationshipType: "correlational",
          isDirectional: false,
          isTrendEdge: false,
          isTimingEdge: false,
        },
        ["always-flat-cash"],
      ],
      [
        {
          relationshipType: "predictive",
          isDirectional: true,
          isTrendEdge: false,
          isTimingEdge: false,
        },
        ["always-flat-cash", "buy-and-hold"],
      ],
      [
        {
          relationshipType: "predictive",
          isDirectional: true,
          isTrendEdge: true,
          isTimingEdge: true,
        },
        [
          "always-flat-cash",
          "buy-and-hold",
          "simple-trend-baseline",
          "random-entry-matched-exposure",
        ],
      ],
    ];
    for (const [shape, expected] of cases) {
      expect(deriveMandatoryNullFloor(shape)).toEqual(expected);
    }
  });

  it("firewall rejects forbidden keys and allows hypothesis-specific keys", () => {
    for (const key of ["forecast", "edge", "confidence", "evidence", "trial", "strategy"]) {
      expect(findForbiddenDefinitionKey({ [key]: "x" })).toBe(key);
    }
    expect(findForbiddenDefinitionKey(buildDefinition())).toBeNull();
    expect(findForbiddenDefinitionKey({ prior: 0.1 })).toBeNull();
    expect(findForbiddenDefinitionKey({ falsificationConditions: ["x"] })).toBeNull();
    expect(HYPOTHESIS_FORBIDDEN_DEFINITION_KEYS.has("prior")).toBe(false);
  });

  it("lifecycle content digest is reproducible", () => {
    const hypothesisKey = computeHypothesisKey({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKind: "market_claim",
      name: "lifecycle",
    });
    const digest = buildLifecycleContentDigest({
      organizationId: GOLDEN_ORG_ID,
      hypothesisKey,
      lifecycleState: "PROPOSED",
      seq: 1,
      rationale: "registered",
      recordedBy: "user-1",
    });
    expect(digest).toHaveLength(64);
    expect(
      buildLifecycleContentDigest({
        organizationId: GOLDEN_ORG_ID,
        hypothesisKey,
        lifecycleState: "PROPOSED",
        seq: 1,
        rationale: "registered",
        recordedBy: "user-1",
      }),
    ).toBe(digest);
  });

  it("schema version constant is locked", () => {
    expect(MI_HYPOTHESIS_SCHEMA_VERSION).toBe("mi-hypothesis-v1");
  });
});
