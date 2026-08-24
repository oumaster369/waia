import { describe, expect, it } from "vitest";

import {
  assertTopDownReconstructionV1,
  defineTopDownReconstructionV1,
  TOP_DOWN_TIMEFRAME_RELATIONS_V1,
} from "@/lib/trader/intelligence/information-inquiry";

const D = "a".repeat(64);
const E = "b".repeat(64);

const states = [
  ["1d", "STRATEGIC_CONTEXT"],
  ["4h", "STRUCTURAL_REFINEMENT"],
  ["1h", "OPERATIONAL_STATE"],
  ["15m", "SETUP_CONFIRMATION"],
  ["1m", "EXECUTION_PRECISION"],
] as const;

const relations = [
  ["1d", "4h", "CONFIRMING"],
  ["4h", "1h", "CORRECTIVE"],
  ["1h", "15m", "TRANSITIONING"],
  ["15m", "1m", "CONFLICTING"],
] as const;

function reconstructionInput() {
  return {
    symbol: "BTC/USDT",
    pitAnchor: "2026-08-24T12:00:00.000Z",
    states: states.map(([timeframe, role], index) => ({
      timeframe,
      role,
      status: index === 3 ? ("CONTRADICTORY" as const) : ("AVAILABLE" as const),
      stateContentDigest: index % 2 === 0 ? D : E,
      evidenceIds: [`e-${timeframe}`],
      reasonCodes: [`STATE_${timeframe.toUpperCase()}`],
    })),
    relations: relations.map(([higherTimeframe, lowerTimeframe, relation]) => ({
      higherTimeframe,
      lowerTimeframe,
      relation,
      relationPolicyVersion: "relation-policy-v1",
      relationPolicyContentDigest: D,
      evidenceIds: [`e-${higherTimeframe}`, `e-${lowerTimeframe}`],
      reasonCodes: [`RELATION_${relation}`],
    })),
    upwardReevaluationRequests: [
      {
        triggerTimeframe: "1m" as const,
        targetHigherTimeframe: "1h" as const,
        triggerEvidenceIds: ["e-1m"],
        reasonCodes: ["BOTTOM_UP_ANOMALY"],
        mayOverwriteHigherState: false as const,
      },
    ],
  };
}

describe("DEE-696 top-down reconstruction contract", () => {
  it("preserves exact 1d to 1m order, roles, relations, and identity", () => {
    const reconstruction = defineTopDownReconstructionV1(reconstructionInput());
    expect(reconstruction.states.map(({ timeframe }) => timeframe)).toEqual([
      "1d",
      "4h",
      "1h",
      "15m",
      "1m",
    ]);
    expect(reconstruction.relations.map(({ relation }) => relation)).toEqual([
      "CONFIRMING",
      "CORRECTIVE",
      "TRANSITIONING",
      "CONFLICTING",
    ]);
    expect(TOP_DOWN_TIMEFRAME_RELATIONS_V1).toEqual([
      "CONFIRMING",
      "CORRECTIVE",
      "TRANSITIONING",
      "CONFLICTING",
      "UNCLEAR",
    ]);
    expect(reconstruction.authority).toBe("MARKET_RECONSTRUCTION_ONLY");
    expect(Object.isFrozen(reconstruction)).toBe(true);
    expect(Object.isFrozen(reconstruction.states[0])).toBe(true);
    expect(Object.isFrozen(reconstruction.states[0]?.evidenceIds)).toBe(true);
    expect(assertTopDownReconstructionV1(reconstruction)).toBe(reconstruction);
  });

  it("allows bottom-up re-evaluation but makes higher-state overwrite unrepresentable", () => {
    const reconstruction = defineTopDownReconstructionV1(reconstructionInput());
    expect(reconstruction.upwardReevaluationRequests[0]).toMatchObject({
      triggerTimeframe: "1m",
      targetHigherTimeframe: "1h",
      mayOverwriteHigherState: false,
    });
    expect(() =>
      defineTopDownReconstructionV1({
        ...reconstructionInput(),
        upwardReevaluationRequests: [
          {
            triggerTimeframe: "1m",
            targetHigherTimeframe: "1h",
            triggerEvidenceIds: ["e-1m"],
            reasonCodes: ["BOTTOM_UP_ANOMALY"],
            mayOverwriteHigherState: true,
          },
        ],
      } as never),
    ).toThrow("upwardReevaluationDirection");
  });

  it("rejects bottom-up state ordering and non-adjacent relation shortcuts", () => {
    expect(() =>
      defineTopDownReconstructionV1({
        ...reconstructionInput(),
        states: [...reconstructionInput().states].reverse(),
      }),
    ).toThrow("stateOrder");
    expect(() =>
      defineTopDownReconstructionV1({
        ...reconstructionInput(),
        relations: reconstructionInput().relations.map((relation, index) =>
          index === 0 ? { ...relation, lowerTimeframe: "1h" as const } : relation,
        ),
      }),
    ).toThrow("relationOrder");
  });

  it("rejects unknown state vocabulary and strips caller authority fields", () => {
    expect(() =>
      defineTopDownReconstructionV1({
        ...reconstructionInput(),
        states: reconstructionInput().states.map((state, index) =>
          index === 0 ? { ...state, status: "PREDICTED" } : state,
        ),
      } as never),
    ).toThrow("reconstruction.status");
    expect(() =>
      defineTopDownReconstructionV1({
        ...reconstructionInput(),
        states: reconstructionInput().states.map((state, index) =>
          index === 3 ? { ...state, stateContentDigest: null } : state,
        ),
      }),
    ).toThrow("availableDigest");

    const input = reconstructionInput();
    const statesWithUnknown = input.states.map((state) => ({ ...state, forecastAction: "BUY" }));
    const sealed = defineTopDownReconstructionV1({ ...input, states: statesWithUnknown });
    expect("forecastAction" in sealed.states[0]!).toBe(false);
    expect(() =>
      assertTopDownReconstructionV1({ ...sealed, capitalAuthority: true } as never),
    ).toThrow("reconstructionIdentity");
  });
});
