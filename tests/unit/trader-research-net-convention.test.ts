import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assessStrategyAdmissionReadOnly,
  AppendOnlyStrategyAdmissionJournal,
  STRATEGY_ADMISSION_NET_CONVENTION_V2,
  type StrategyAdmissionSide,
} from "@/lib/trader/research/strategy-admission-v1";
import { buildClosedTradeOutcomeEvidencePackageV2 } from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import { appendResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import {
  qualifyFutureCycleEpistemicEffectV2,
  type KnowledgeNavigatorCandidateV2,
  type SelectKnowledgeForQuestionV2Input,
} from "@/lib/trader/knowledge/navigator";
import {
  buildFalsifiableHypothesisV2,
  buildResearchQuestionV2,
} from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import {
  assertQualificationPairForCandidateV2,
  recordQualificationV2,
  type QualificationRecordV2,
} from "@/lib/trader/research-v2/qualification-records-v2";
import {
  generateStrategyEvolutionCandidateV2,
  type StrategyEvolutionCandidateV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { runStrategyEvolutionResearchPassV2 } from "@/lib/trader/research-v2/strategy-evolution-loop-v2";
import { admissionDateNets, countsForDateNets, passingIsDateNets, STRATEGY_ADMISSION_SPEC_SHA256 } from "./strategy-admission-date-nets";
import legacyFundedLongFixture from "../fixtures/trader-research-net-convention-legacy-long.json";

const CONVENTION = "signed-net-after-all-costs/v2" as const;
const SPEC_SHA = "ab".repeat(32);
const DIGEST = { a: "a".repeat(64), b: "b".repeat(64), c: "c".repeat(64), d: "d".repeat(64), e: "e".repeat(64) };
const CUTOFF = "2026-02-01T11:00:00.000Z";
const PIT = "2026-02-01T12:00:00.000Z";
const PRIOR_PIT = "2026-01-31T12:00:00.000Z";

function strategyEvolutionPass() {
  const candidate: KnowledgeNavigatorCandidateV2 = {
    knowledgeEdgeId: "net-edge", version: 1, contentDigestHex: DIGEST.c,
    organizationId: "net-convention-org", symbol: "BTCUSDT", questionId: "WHAT_HAPPENING",
    pitEventAt: "2026-01-31T11:00:00.000Z", lifecycleState: "ACTIVE", verified: true,
    fromRef: "btc-regime", toRef: "btc-move", relationKind: "EXPLAINS",
  };
  const navigatorSelect = (overrides: Partial<SelectKnowledgeForQuestionV2Input> = {}): SelectKnowledgeForQuestionV2Input => ({
    organizationId: "net-convention-org", runId: "net-run", symbol: "BTCUSDT",
    purpose: "strategy-evolution-research", questionId: "WHAT_HAPPENING", pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST.a, evidenceBudget: 2, maxStalenessMs: 48 * 60 * 60 * 1000,
    candidates: [candidate], ...overrides,
  });
  const futureCycleEffect = qualifyFutureCycleEpistemicEffectV2({
    evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION", effectKind: "SUPPORT",
    producedByReceiptDigestHex: DIGEST.d,
    prior: navigatorSelect({ pitAnchor: PRIOR_PIT, runId: "net-prior" }),
    future: navigatorSelect({ pitAnchor: PIT, runId: "net-future" }),
  });
  const validationNets = admissionDateNets(2024, "0.02", 5);
  return runStrategyEvolutionResearchPassV2({
    organizationId: "net-convention-org", campaignId: "net-campaign", symbol: "BTCUSDT",
    evidenceCutoffUtc: CUTOFF, researchCodeIdentity: "net-research-code", costModelIdentity: "net-cost-model",
    outcomes: [
      { outcomeId: "net-win", closedTradeRef: "net-win", observedAtUtc: CUTOFF, netEconomicResult: "12.5", causalContextDigestHex: DIGEST.a },
      { outcomeId: "net-loss", closedTradeRef: "net-loss", observedAtUtc: CUTOFF, netEconomicResult: "-8.25", causalContextDigestHex: DIGEST.b },
    ],
    navigatorSelect: navigatorSelect(), predictiveAdmissionVerdict: "ADMITTED", futureCycleEffect,
    generation: {
      kind: "PARAMETER_MUTATION", candidateId: "net-loop-candidate", strategyId: "net-loop-research",
      strategyVersion: "1", parents: [{ strategyId: "net-loop-research", strategyVersion: "0",
        params: { lookbackBars: "20", holdBars: "4" }, artifactDigestHex: DIGEST.e }],
      params: { lookbackBars: "24", holdBars: "4" },
    },
    development: {
      netEconomicResult: "2.5", maxDrawdown: "-1", tailEventCount: 1,
      ...countsForDateNets(passingIsDateNets(2022)), incumbentComparisonDigestHex: DIGEST.b,
    },
    walkForward: {
      netEconomicResult: "1.25", maxDrawdown: "-1.5", tailEventCount: 2,
      ...countsForDateNets(validationNets), incumbentComparisonDigestHex: DIGEST.a,
    },
    specSha256: STRATEGY_ADMISSION_SPEC_SHA256, declaredFamilySize: 1,
    journal: AppendOnlyStrategyAdmissionJournal.openDurableMemory(), usedForDiscovery: false,
  });
}

function calculate(input: Readonly<{
  sideDeclared: StrategyAdmissionSide;
  net: string;
  symbol?: string;
  fundingMean?: string | null;
  observationConvention?: typeof STRATEGY_ADMISSION_NET_CONVENTION_V2;
}>) {
  return assessStrategyAdmissionReadOnly({
    specSha256: SPEC_SHA,
    declaredFamilySize: 1,
    kind: "continuous",
    intraday: false,
    sideDeclared: input.sideDeclared,
    horizonBars: 1,
    split: "is",
    trials: [{
      hypothesisId: "net-convention-trial",
      observations: [
        { utcDate: "2022-01-10", net: input.net },
        { utcDate: "2022-04-10", net: input.net },
      ],
    }],
    confirmatoryIndex: 0,
    symbol: input.symbol,
    fundingMean: input.fundingMean,
    usedForDiscovery: false,
    signalBarCloseUtc: "2026-01-01T00:00:00.000Z",
    entryTimeUtc: "2026-01-01T00:01:00.000Z",
    ...(input.observationConvention === undefined
      ? {}
      : { observationConvention: input.observationConvention }),
  });
}

function qualificationPair(sideDeclared: "long" | "short") {
  const cutoff = "2026-02-01T11:00:00.000Z";
  const memory = appendResearchMemoryV2(buildClosedTradeOutcomeEvidencePackageV2({
    organizationId: "net-convention-org",
    campaignId: "net-convention-campaign",
    symbol: "BTCUSDT",
    evidenceCutoffUtc: cutoff,
    outcomes: [{
      outcomeId: "seed",
      closedTradeRef: "seed",
      observedAtUtc: cutoff,
      netEconomicResult: "-0.01",
      causalContextDigestHex: "a".repeat(64),
    }],
  }));
  const question = buildResearchQuestionV2({ questionId: "net-question", memory, symbol: "BTCUSDT" });
  const hypothesis = buildFalsifiableHypothesisV2({
    hypothesisId: "net-hypothesis",
    question,
    generationKind: "PARAMETER_MUTATION",
  });
  const candidate = generateStrategyEvolutionCandidateV2({
    candidateId: `net-${sideDeclared}`,
    strategyId: "net-convention-research",
    strategyVersion: "1",
    kind: "PARAMETER_MUTATION",
    parents: [{
      strategyId: "net-convention-research",
      strategyVersion: "0",
      params: { lookback: "10" },
      artifactDigestHex: "b".repeat(64),
    }],
    params: { lookback: "11" },
    hypothesis,
    evidenceCutoffUtc: cutoff,
    researchCodeIdentity: "net-convention-test-only",
    costModelIdentity: "net-convention-test-only",
  });
  const journal = AppendOnlyStrategyAdmissionJournal.openDurableMemory();
  journal.registerFamily(SPEC_SHA, 1);

  function record(partition: "DEVELOPMENT" | "WALK_FORWARD", year: number): QualificationRecordV2 {
    const dateNets = passingIsDateNets(year).map((row) => ({ ...row, net: "-0.007" }));
    const evaluation = {
      netEconomicResult: "-0.224",
      maxDrawdown: "-0.2",
      tailEventCount: 0,
      ...countsForDateNets(dateNets),
      incumbentComparisonDigestHex: "c".repeat(64),
    };
    return recordQualificationV2({
      candidate,
      partition,
      evaluation,
      specSha256: SPEC_SHA,
      declaredFamilySize: 1,
      sideDeclared,
      journal,
      usedForDiscovery: false,
      signalBarCloseUtc: cutoff,
      entryTimeUtc: "2026-02-01T11:01:00.000Z",
      symbol: "BTCUSDT",
    });
  }

  return {
    candidate,
    development: record("DEVELOPMENT", 2022),
    walkForward: record("WALK_FORWARD", 2023),
    journal,
  };
}

function resealRecord(record: QualificationRecordV2, admission: QualificationRecordV2["admission"]): QualificationRecordV2 {
  const { contentDigestHex: _ignored, ...body } = { ...record, admission };
  void _ignored;
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) } as QualificationRecordV2;
}

function withoutConvention(record: QualificationRecordV2): QualificationRecordV2 {
  const { observationConvention: _ignored, ...admission } = record.admission as QualificationRecordV2["admission"] & {
    observationConvention?: string;
  };
  void _ignored;
  return resealRecord(record, admission);
}

describe("DEE-1206 signed net convention", () => {
  it("exports the exact v2 convention and refuses an unmarked short calculator input", async () => {
    const admissionModule = await import("@/lib/trader/research/strategy-admission-v1");
    expect((admissionModule as unknown as Record<string, unknown>).STRATEGY_ADMISSION_NET_CONVENTION_V2)
      .toBe(CONVENTION);
    expect(STRATEGY_ADMISSION_NET_CONVENTION_V2).toBe(CONVENTION);
    expect(() => calculate({ sideDeclared: "short", net: "-0.007" })).toThrow();
  });

  it.each(["0.007", "-0.007"])("preserves already signed short net %s under explicit v2", (net) => {
    const result = calculate({
      sideDeclared: "short",
      net,
      symbol: "BTC-PERP",
      fundingMean: "0.001",
      observationConvention: CONVENTION,
    });
    expect(result.netMeanDate).toBe(`${Number(net).toFixed(8)}`);
  });

  it("refuses an unknown net convention instead of guessing", () => {
    expect(() => calculate({
      sideDeclared: "short", net: "-0.007",
      observationConvention: "some-other-convention/v1" as never,
    })).toThrow();
  });

  it("does not deduct positive or negative funding a second time under v2", () => {
    const positiveFunding = calculate({
      sideDeclared: "short", net: "0.007", symbol: "BTC-PERP", fundingMean: "0.001",
      observationConvention: CONVENTION,
    });
    const negativeFunding = calculate({
      sideDeclared: "short", net: "0.007", symbol: "BTC-PERP", fundingMean: "-0.001",
      observationConvention: CONVENTION,
    });
    expect(positiveFunding.netMeanDate).toBe("0.00700000");
    expect(negativeFunding.netMeanDate).toBe("0.00700000");
  });

  it("keeps unmarked long funding subtraction and requires v2 for unmarked two-sided input", () => {
    expect(calculate({ sideDeclared: "long", net: "0.007", symbol: "BTC-PERP", fundingMean: "0.001" }).netMeanDate)
      .toBe("0.00600000");
    expect(calculate({
      sideDeclared: "long", net: "0.007", symbol: "BTC-PERP", fundingMean: "0.001",
      observationConvention: STRATEGY_ADMISSION_NET_CONVENTION_V2,
    }).netMeanDate).toBe("0.00700000");
    expect(() => calculate({
      sideDeclared: "two_sided", net: "0.007", symbol: "BTC-PERP", fundingMean: "0.001",
    })).toThrow();
    expect(calculate({
      sideDeclared: "two_sided", net: "-0.007", symbol: "BTC-PERP", fundingMean: "0.001",
      observationConvention: CONVENTION,
    }).netMeanDate).toBe("-0.00700000");
  });

  it.each([null, "not-a-number"] as const)("still requires valid perpetual funding metadata: %s", (fundingMean) => {
    expect(() => calculate({
      sideDeclared: "short", net: "0.007", symbol: "BTC-PERP", fundingMean,
      observationConvention: STRATEGY_ADMISSION_NET_CONVENTION_V2,
    })).toThrow();
  });

  it("marks every new qualification with v2 and its consumer preserves the corrected signed series", () => {
    const pair = qualificationPair("short");
    const convention = (pair.development.admission as QualificationRecordV2["admission"] & {
      observationConvention?: string;
    }).observationConvention;
    expect(convention).toBe(CONVENTION);
    expect(pair.development.evaluation.dateNets?.every((row) => row.net === "-0.007")).toBe(true);
    expect((pair.development.admission.assessment.netMeanDate)).toBe("-0.00700000");
    expect(() => assertQualificationPairForCandidateV2(pair)).not.toThrow();
    const validationRows = pair.journal.list().filter((row) => row.split === "validation");
    expect(validationRows).toHaveLength(1);
    expect(validationRows[0]?.observationConvention).toBe(CONVENTION);
    const { observationConvention: _legacyAbsent, ...legacyValidationRow } = validationRows[0]!;
    void _legacyAbsent;
    const historicalJournal = AppendOnlyStrategyAdmissionJournal.fromSnapshot({
      families: [{ specSha256: SPEC_SHA, familySize: 1 }],
      rows: [legacyValidationRow],
    });
    expect(historicalJournal.list()[0]).not.toHaveProperty("observationConvention");
  });

  it("writes the v2 marker from the real research-pass development journal path", () => {
    const result = strategyEvolutionPass();
    expect(result.journalRows.find((row) => row.split === "is")?.observationConvention).toBe(CONVENTION);
    expect(result.journalRows.find((row) => row.split === "validation")?.observationConvention).toBe(CONVENTION);
  });

  it("does not let the qualification caller select the private legacy calculation mode", () => {
    const pair = qualificationPair("long");
    expect(() => recordQualificationV2({
      candidate: pair.candidate,
      partition: "DEVELOPMENT",
      evaluation: pair.development.evaluation,
      specSha256: SPEC_SHA,
      declaredFamilySize: 1,
      sideDeclared: "long",
      usedForDiscovery: false,
      signalBarCloseUtc: "2026-02-01T11:00:00.000Z",
      entryTimeUtc: "2026-02-01T11:01:00.000Z",
      observationConvention: undefined,
    } as never)).toThrow("QUALIFICATION_NET_CONVENTION_NOT_CALLER_CONTROLLED");
  });

  it("replays unmarked legacy long records but refuses unmarked short records", () => {
    const longPair = qualificationPair("long");
    const legacyLong = {
      ...longPair,
      development: withoutConvention(longPair.development),
      walkForward: withoutConvention(longPair.walkForward),
    };
    expect(() => assertQualificationPairForCandidateV2(legacyLong)).not.toThrow();

    const shortPair = qualificationPair("short");
    const legacyShort = {
      ...shortPair,
      development: withoutConvention(shortPair.development),
      walkForward: withoutConvention(shortPair.walkForward),
    };
    expect(() => assertQualificationPairForCandidateV2(legacyShort)).toThrow();
  });

  it("replays genuine baseline-writer perpetual LONG pairs with positive and negative funding", () => {
    expect(legacyFundedLongFixture.provenance.baselineCommit)
      .toBe("fcf4c19c8953dd7a57716c45c8b8f8635d226bac");
    for (const persisted of [legacyFundedLongFixture.positiveFunding, legacyFundedLongFixture.negativeFunding]) {
      expect(persisted.development.admission.sideDeclared).toBe("long");
      expect(persisted.development.admission.symbol).toBe("BTC-PERP");
      expect(persisted.development.admission).not.toHaveProperty("observationConvention");
      expect(() => assertQualificationPairForCandidateV2({
        candidate: legacyFundedLongFixture.candidate as unknown as StrategyEvolutionCandidateV2,
        development: persisted.development as unknown as QualificationRecordV2,
        walkForward: persisted.walkForward as unknown as QualificationRecordV2,
      })).not.toThrow();
    }
    expect(legacyFundedLongFixture.positiveFunding.development.admission.assessment.netMeanDate)
      .toBe("0.00450000");
    expect(legacyFundedLongFixture.negativeFunding.development.admission.assessment.netMeanDate)
      .toBe("0.00650000");
  });

  it.each(["legacy-development", "legacy-walk-forward"] as const)(
    "refuses a mixed legacy/v2 pair when %s is unmarked",
    (legacyPartition) => {
      const pair = qualificationPair("long");
      const mixed = legacyPartition === "legacy-development"
        ? { ...pair, development: withoutConvention(pair.development) }
        : { ...pair, walkForward: withoutConvention(pair.walkForward) };
      expect(() => assertQualificationPairForCandidateV2(mixed))
        .toThrow("QUALIFICATION_NET_CONVENTION_MISMATCH");
    },
  );

  it("refuses an unknown convention even when the record content digest is resealed", () => {
    const pair = qualificationPair("short");
    const corruptAdmission = {
      ...pair.development.admission,
      observationConvention: "signed-net-after-all-costs/v99",
    } as unknown as QualificationRecordV2["admission"];
    const corruptDevelopment = resealRecord(pair.development, corruptAdmission);
    expect(() => assertQualificationPairForCandidateV2({
      ...pair,
      development: corruptDevelopment,
    })).toThrow("QUALIFICATION_NET_CONVENTION_UNVERIFIED");
  });
});
