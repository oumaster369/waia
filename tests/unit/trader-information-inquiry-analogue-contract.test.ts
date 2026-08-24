import { describe, expect, it } from "vitest";

import {
  defineHistoricalAnalogueQueryV1,
  defineHistoricalAnalogueResultV1,
  HISTORICAL_ANALOGUE_RESULT_STATUSES_V1,
} from "@/lib/trader/intelligence/information-inquiry";

const D = "a".repeat(64);
const E = "b".repeat(64);
const F = "c".repeat(64);

function query() {
  return defineHistoricalAnalogueQueryV1({
    pitAnchor: "2026-08-24T12:00:00.000Z",
    stateRepresentationSpecVersion: "state-representation-v1",
    stateRepresentationSpecContentDigest: D,
    dynamicStateContentDigest: E,
    requestedPatternForms: ["TRAJECTORY", "STATIC"],
    similarityPolicyVersion: "similarity-v1",
    similarityPolicyContentDigest: F,
    timeframeFilters: ["1h", "4h"],
    regimeFilters: ["TREND", "TRANSITION"],
    contextFilterContentDigests: [F, D],
    retrievalPolicyVersion: "bounded-index-v1",
    retrievalPolicyContentDigest: D,
    samplingPolicyVersion: "balanced-outcomes-v1",
    samplingPolicyContentDigest: E,
    maxQueries: 2,
    maxResults: 4,
    maxCostUnits: 6,
    blindHoldoutAccessible: false,
    usesFutureOutcomeForSelection: false,
  });
}

function occurrence() {
  return {
    patternDefinitionId: "pattern-definition-1",
    patternDefinitionContentDigest: D,
    patternOccurrenceId: "pattern-occurrence-1",
    patternOccurrenceContentDigest: E,
    patternForm: "TRAJECTORY" as const,
    occurredAt: "2026-08-20T12:00:00.000Z",
    availableAt: "2026-08-20T12:01:00.000Z",
    timeframe: "4h" as const,
    regime: "TRANSITION",
    contextContentDigests: [F],
    matchComponents: [
      { componentId: "path", valueContentDigest: D, distanceContentDigest: E },
      { componentId: "state", valueContentDigest: E, distanceContentDigest: F },
    ],
    totalDistanceContentDigest: D,
    samplingMemberships: ["NEGATIVE", "CONTRADICTORY", "FAILURE_CASE"] as const,
  };
}

describe("DEE-696 historical analogue contract", () => {
  it("pins static/trajectory policy identities and forbids holdout/future selection", () => {
    const sealed = query();
    expect(sealed.requestedPatternForms).toEqual(["STATIC", "TRAJECTORY"]);
    expect(sealed.timeframeFilters).toEqual(["4h", "1h"]);
    expect(sealed.blindHoldoutAccessible).toBe(false);
    expect(sealed.usesFutureOutcomeForSelection).toBe(false);
    expect(sealed.authority).toBe("HISTORICAL_EVIDENCE_QUERY_ONLY");
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.requestedPatternForms)).toBe(true);
    expect(() =>
      defineHistoricalAnalogueQueryV1({
        ...sealed,
        blindHoldoutAccessible: true,
      } as never),
    ).toThrow("analogueForbiddenAuthority");
  });

  it("seals exact occurrence, match/distance, sampling, and qualified Knowledge refs", () => {
    const sealedQuery = query();
    const result = defineHistoricalAnalogueResultV1({
      query: sealedQuery,
      status: "MATCHED_QUALIFIED_KNOWLEDGE",
      occurrences: [occurrence()],
      knowledgeRefs: [
        {
          knowledgeId: "knowledge-1",
          knowledgeContentDigest: F,
          status: "QUALIFIED",
          failureBoundaryContentDigest: D,
        },
      ],
      reasonCodes: ["QUALIFIED_MATCH"],
    });
    expect(result.occurrences[0]).toMatchObject({
      patternDefinitionId: "pattern-definition-1",
      patternOccurrenceId: "pattern-occurrence-1",
      totalDistanceContentDigest: D,
      samplingMemberships: ["NEGATIVE", "CONTRADICTORY", "FAILURE_CASE"],
    });
    expect(result.occurrences[0]?.matchComponents.map(({ componentId }) => componentId)).toEqual([
      "path",
      "state",
    ]);
    expect(result.createsForecastOrCapitalAuthority).toBe(false);
    expect(Object.isFrozen(result.occurrences[0])).toBe(true);
    expect(Object.isFrozen(result.occurrences[0]?.matchComponents)).toBe(true);
  });

  it("distinguishes all four no-result/unavailable outcomes without synthesis", () => {
    expect(HISTORICAL_ANALOGUE_RESULT_STATUSES_V1).toEqual([
      "MATCHED_QUALIFIED_KNOWLEDGE",
      "NO_MATCHING_OCCURRENCE",
      "NO_QUALIFIED_RELATION_KNOWLEDGE",
      "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE",
      "HISTORY_UNAVAILABLE_OR_UNQUALIFIED",
    ]);
    const sealedQuery = query();
    const base = {
      query: sealedQuery,
      reasonCodes: ["EXPLICIT_TERMINAL"],
    };
    expect(
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "NO_MATCHING_OCCURRENCE",
        occurrences: [],
        knowledgeRefs: [],
      }).status,
    ).toBe("NO_MATCHING_OCCURRENCE");
    expect(
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "NO_QUALIFIED_RELATION_KNOWLEDGE",
        occurrences: [occurrence()],
        knowledgeRefs: [],
      }).status,
    ).toBe("NO_QUALIFIED_RELATION_KNOWLEDGE");
    expect(
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE",
        occurrences: [occurrence()],
        knowledgeRefs: [
          {
            knowledgeId: "knowledge-1",
            knowledgeContentDigest: D,
            status: "CONTESTED",
            failureBoundaryContentDigest: E,
          },
        ],
      }).status,
    ).toBe("QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE");
    expect(
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "HISTORY_UNAVAILABLE_OR_UNQUALIFIED",
        occurrences: [],
        knowledgeRefs: [],
      }).status,
    ).toBe("HISTORY_UNAVAILABLE_OR_UNQUALIFIED");
  });

  it("enforces query identity and point-in-time occurrence lineage", () => {
    const sealedQuery = query();
    const base = {
      query: sealedQuery,
      status: "NO_QUALIFIED_RELATION_KNOWLEDGE" as const,
      occurrences: [occurrence()],
      knowledgeRefs: [],
      reasonCodes: ["EXPLICIT_TERMINAL"],
    };
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        query: { ...sealedQuery, pitAnchor: "2026-08-26T12:00:00.000Z" },
      }),
    ).toThrow("analogueQueryIdentity");
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        occurrences: [
          {
            ...occurrence(),
            occurredAt: "2026-08-24T12:01:00.000Z",
            availableAt: "2026-08-24T12:02:00.000Z",
          },
        ],
      }),
    ).toThrow("occurrencePitLineage");
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        occurrences: [
          {
            ...occurrence(),
            occurredAt: "2026-08-20T12:02:00.000Z",
            availableAt: "2026-08-20T12:01:00.000Z",
          },
        ],
      }),
    ).toThrow("occurrencePitLineage");
  });

  it("keeps analogue terminal outcomes mutually exclusive and Knowledge status closed", () => {
    const sealedQuery = query();
    const base = {
      query: sealedQuery,
      reasonCodes: ["EXPLICIT_TERMINAL"],
    };
    const qualified = {
      knowledgeId: "knowledge-1",
      knowledgeContentDigest: D,
      status: "QUALIFIED" as const,
      failureBoundaryContentDigest: E,
    };
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "NO_MATCHING_OCCURRENCE",
        occurrences: [],
        knowledgeRefs: [qualified],
      }),
    ).toThrow("noMatchHasOccurrences");
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "NO_QUALIFIED_RELATION_KNOWLEDGE",
        occurrences: [occurrence()],
        knowledgeRefs: [{ ...qualified, status: "CONTESTED" as const }],
      }),
    ).toThrow("noQualifiedKnowledgeInvalid");
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "QUALIFIED_KNOWLEDGE_STALE_CONTESTED_OR_OUT_OF_SCOPE",
        occurrences: [occurrence()],
        knowledgeRefs: [qualified, { ...qualified, knowledgeId: "knowledge-2", status: "STALE" }],
      }),
    ).toThrow("qualifiedKnowledgeScopeStatus");
    expect(() =>
      defineHistoricalAnalogueResultV1({
        ...base,
        status: "MATCHED_QUALIFIED_KNOWLEDGE",
        occurrences: [occurrence()],
        knowledgeRefs: [{ ...qualified, status: "UNREVIEWED" }],
      } as never),
    ).toThrow("knowledgeStatus");
  });

  it("strips unknown occurrence and Knowledge fields from the sealed identity", () => {
    const sealedQuery = query();
    const result = defineHistoricalAnalogueResultV1({
      query: sealedQuery,
      status: "MATCHED_QUALIFIED_KNOWLEDGE",
      occurrences: [{ ...occurrence(), futurePnl: 42 }],
      knowledgeRefs: [
        {
          knowledgeId: "knowledge-1",
          knowledgeContentDigest: F,
          status: "QUALIFIED",
          failureBoundaryContentDigest: D,
          forecastAction: "BUY",
        },
      ],
      reasonCodes: ["QUALIFIED_MATCH"],
    } as never);
    expect("futurePnl" in result.occurrences[0]!).toBe(false);
    expect("forecastAction" in result.knowledgeRefs[0]!).toBe(false);
  });
});
