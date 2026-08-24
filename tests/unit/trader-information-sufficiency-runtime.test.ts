import { describe, expect, it, vi } from "vitest";

import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import { assertSyntheticResearchNonCapitalBacktestScopeV2 } from "@/lib/trader/backtest/backtest-runner";
import { assertSyntheticResearchNonCapitalFhvScopeV2 } from "@/lib/trader/observability/fhv-full-historical-engine";
import { buildFhvSyntheticScaleAuthority } from "@/lib/trader/observability/fhv-synthetic-scale-authority";
import {
  buildForecastDecisionBundle,
  persistForecastDecisionBundleForCycle,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { buildDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/build-decision-record";
import {
  admitForecastDecisionConstruction,
  admitForecastDecisionPersistence,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import { createDecisionRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-record-repository-postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  bindInformationSufficiencyReceiptAuthorityV2,
  declareResearchNonCapitalInformationAuthorityV2,
  declareSyntheticResearchNonCapitalInformationAuthorityV2,
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyRuntimeAdmissionV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationSufficiencyRuntimeAuthorityV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { runWp14EvaluationCycle, wp14Bars } from "@/tests/unit/wp14-test-helpers";

const ORG = "00000000-0000-4000-8000-000000068800";
const PIT = "2026-08-23T12:00:00.000Z";

function buildProfile() {
  return defineRequiredInformationProfileV2({
    organizationId: ORG,
    accountId: "paper-account",
    profileVersion: "runtime-test-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements: [
      {
        id: "price-state",
        questionId: "Q_WHAT_HAPPENING",
        classification: "MANDATORY",
        contextTriggerKey: null,
        satisfiers: [{ evidenceFamily: "price", providerIds: [], substitutionRuleId: null }],
        allowedObservationKinds: ["msv_envelope"],
        allowedObservationSchemaVersions: ["waia.trader.msv.v1"],
        allowedMeasurementDefinitionDigests: [],
        maxStalenessMs: 60_000,
        minimumTrustScore: 0.5,
        minimumIndependentGroups: 1,
        contradictionPolicy: "FAIL_UNRESOLVED",
        requirePitQualified: true,
        requireReplayEligible: true,
        inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 1 },
      },
    ],
    aggregateQualityContract: null,
  });
}

function evidence(overrides: Partial<InformationEvidenceV2> = {}): InformationEvidenceV2 {
  return {
    evidenceId: "msv-runtime-1",
    evidenceFamily: "price",
    providerId: "internal-msv",
    sourceId: "source-runtime-1",
    observationId: "observation-runtime-1",
    observationKind: "msv_envelope",
    observationSchemaVersion: "waia.trader.msv.v1",
    observationContentDigest: "a".repeat(64),
    trustAsOfReceiptId: null,
    trustRevisionId: null,
    trustRevisionContentDigest: null,
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: "2026-08-23T11:59:30.000Z",
    trust: "TRUSTED",
    trustScore: 0.9,
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: "internal-msv",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
    ...overrides,
  };
}

function bindAuthority(selectedEvidence: readonly InformationEvidenceV2[]) {
  const profile = buildProfile();
  const receipt = evaluateInformationSufficiencyV2({
    profile,
    organizationId: ORG,
    accountId: profile.accountId,
    purpose: profile.purpose,
    symbol: profile.symbol,
    venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: selectedEvidence,
  });
  return {
    profile,
    receipt,
    authority: bindInformationSufficiencyReceiptAuthorityV2(profile, receipt),
  };
}

function admission(authority?: InformationSufficiencyRuntimeAuthorityV2) {
  return evaluateInformationSufficiencyRuntimeAdmissionV2({
    authority,
    organizationId: ORG,
    requiredPurpose: "NEW_OPPORTUNITY",
    allowResearchNonCapital: true,
  });
}

function actionableEvaluation(): EvaluationCycleResult {
  const base = runWp14EvaluationCycle({ organizationId: ORG });
  const signal = {
    ...base.signal,
    organizationId: ORG,
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
  };
  return {
    ...base,
    signal,
    signals: [signal],
    msv: {
      ...base.msv,
      derived: {
        ...base.msv.derived,
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: [signal.strategyId],
      },
    },
  };
}

function paperDeps() {
  const submitOrder = vi.fn(async () => ({
    status: "execution_v2_required" as const,
    order: null,
    reason: "LEGACY_ORDER_SUBMISSION_DISABLED" as const,
  }));
  const deps: PaperCycleDeps = {
    execution: { submitOrder },
    reconciliation: {
      reconcile: vi.fn(async () => {
        throw new Error("reconciliation must not run for a blocked legacy submission");
      }),
    },
  };
  return { deps, submitOrder };
}

describe("DEE-688 Information Sufficiency runtime authority", () => {
  it("admits only exact sufficient NEW_OPPORTUNITY receipts or explicit non-capital research", () => {
    const sufficient = bindAuthority([evidence()]);
    const insufficient = bindAuthority([evidence({ pitQualified: false })]);
    const unavailable = bindAuthority([]);
    const research = declareResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      reason: "DEE_688_RUNTIME_TEST",
    });

    expect(admission()).toMatchObject({ status: "BLOCKED", reasonCode: "MISSING_AUTHORITY" });
    expect(admission(sufficient.authority)).toMatchObject({
      status: "ADMITTED",
      purpose: "NEW_OPPORTUNITY",
      createsCapitalAuthority: false,
    });
    expect(admission(insufficient.authority)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "INSUFFICIENT",
    });
    expect(admission(unavailable.authority)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "UNAVAILABLE",
    });
    expect(admission(research)).toMatchObject({
      status: "ADMITTED",
      purpose: "RESEARCH_NON_CAPITAL",
      createsCapitalAuthority: false,
    });
    expect(
      evaluateInformationSufficiencyRuntimeAdmissionV2({
        authority: sufficient.authority,
        organizationId: ORG,
        requiredPurpose: "NEW_OPPORTUNITY",
        allowResearchNonCapital: true,
        expectedScope: { symbol: "ETH/USDT" },
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "SCOPE_MISMATCH" });
    expect(
      evaluateInformationSufficiencyRuntimeAdmissionV2({
        authority: sufficient.authority,
        organizationId: ORG,
        requiredPurpose: "NEW_OPPORTUNITY",
        allowResearchNonCapital: true,
        expectedScope: { pitAnchor: "2026-08-23T12:01:00.000Z" },
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "PIT_MISMATCH" });
    expect(
      evaluateInformationSufficiencyRuntimeAdmissionV2({
        authority: research,
        organizationId: ORG,
        requiredPurpose: "NEW_OPPORTUNITY",
        allowResearchNonCapital: false,
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "RESEARCH_NON_CAPITAL_NOT_ALLOWED" });
  });

  it("binds synthetic research authority to exact provenance and rejects every excluded scope", () => {
    const allowed = {
      organizationId: ORG,
      harness: "CAPITAL_TRACE_SYNTHETIC" as const,
      runId: "trace-synthetic-proof",
      provenanceDigest: "a".repeat(64),
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    };
    const synthetic = declareSyntheticResearchNonCapitalInformationAuthorityV2(allowed);

    expect(admission(synthetic.authority)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "RESEARCH_NON_CAPITAL_SCOPE_MISMATCH",
    });
    expect(
      evaluateInformationSufficiencyRuntimeAdmissionV2({
        authority: synthetic.authority,
        organizationId: ORG,
        requiredPurpose: "NEW_OPPORTUNITY",
        allowResearchNonCapital: true,
        syntheticResearchBinding: synthetic.binding,
      }),
    ).toMatchObject({
      status: "ADMITTED",
      purpose: "RESEARCH_NON_CAPITAL",
      createsCapitalAuthority: false,
    });
    expect(
      evaluateInformationSufficiencyRuntimeAdmissionV2({
        authority: synthetic.authority,
        organizationId: ORG,
        requiredPurpose: "NEW_OPPORTUNITY",
        allowResearchNonCapital: true,
        syntheticResearchBinding: { ...synthetic.binding, runId: "different-run" },
      }),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "RESEARCH_NON_CAPITAL_SCOPE_MISMATCH",
    });

    for (const excluded of [
      "officialBlindHoldout",
      "production",
      "live",
      "capitalEligible",
      "capitalUse",
    ] as const) {
      expect(() =>
        declareSyntheticResearchNonCapitalInformationAuthorityV2({
          ...allowed,
          [excluded]: true,
        }),
      ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    }
  });

  it("rejects synthetic authority reuse across public backtest run, blind, and harness scopes", () => {
    const synthetic = declareSyntheticResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      harness: "CAPITAL_TRACE_SYNTHETIC",
      runId: "trace-synthetic-proof",
      provenanceDigest: "b".repeat(64),
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    });
    const exact = {
      context: requireOrgContext(ORG),
      datasetId: "dataset-trace-synthetic-proof",
      runId: "trace-synthetic-proof",
      split: "validation" as const,
      informationSufficiencyAuthority: synthetic.authority,
      informationSufficiencySyntheticBinding: synthetic.binding,
    };

    expect(() => assertSyntheticResearchNonCapitalBacktestScopeV2(exact)).not.toThrow();
    expect(() =>
      assertSyntheticResearchNonCapitalBacktestScopeV2({ ...exact, runId: "trace-other-run" }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    expect(() =>
      assertSyntheticResearchNonCapitalBacktestScopeV2({ ...exact, split: "blind" }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    expect(() =>
      assertSyntheticResearchNonCapitalBacktestScopeV2({
        ...exact,
        datasetId: "fhv-full-historical-official",
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");

    const syntheticScaleAuthority = buildFhvSyntheticScaleAuthority({
      runId: "fhv-synthetic-proof",
      organizationId: ORG,
      releaseSha: "f".repeat(40),
      datasetContentDigest: "1".repeat(64),
      manifestSemanticDigest: "2".repeat(64),
      maxCycles: 4_509,
      targetCycleCount: 4_509,
      checkpointEveryCycles: 1_000,
      issuedAtUtc: "2026-08-24T00:00:00.000Z",
    });
    const fhvSynthetic = declareSyntheticResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      harness: "FHV_SYNTHETIC_WP7B",
      runId: "fhv-synthetic-proof",
      provenanceDigest: syntheticScaleAuthority.contentDigest,
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    });
    const exactFhvScope = {
      includeHoldout: false,
      runId: "fhv-synthetic-proof",
      organizationId: ORG,
      releaseSha: "f".repeat(40),
      datasetRoot: "/synthetic-scale-corpus",
      configurationFreeze: {
        datasetDigest: "1".repeat(64),
        manifestDigest: "2".repeat(64),
      } as never,
      qualificationMode: "OFFICIAL_MULTI_YEAR" as const,
      maxCycles: 4_509,
      syntheticScaleAuthority,
      informationSufficiencySyntheticResearch: fhvSynthetic,
    };
    expect(() => assertSyntheticResearchNonCapitalFhvScopeV2(exactFhvScope)).not.toThrow();
    expect(() =>
      assertSyntheticResearchNonCapitalFhvScopeV2({
        ...exactFhvScope,
        includeHoldout: true,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    expect(() =>
      assertSyntheticResearchNonCapitalFhvScopeV2({
        ...exactFhvScope,
        syntheticScaleAuthority: undefined,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    expect(() =>
      assertSyntheticResearchNonCapitalFhvScopeV2({
        ...exactFhvScope,
        informationSufficiencySyntheticResearch: synthetic,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
    const technicalScaleAuthority = buildFhvSyntheticScaleAuthority({
      runId: "fhv-synthetic-proof",
      organizationId: ORG,
      releaseSha: "f".repeat(40),
      datasetContentDigest: "1".repeat(64),
      manifestSemanticDigest: "2".repeat(64),
      maxCycles: 1_000,
      targetCycleCount: 4_509,
      checkpointEveryCycles: 1_000,
      technicalObservationMode: true,
      issuedAtUtc: "2026-08-24T00:00:00.000Z",
    });
    const technicalResearch = declareSyntheticResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      harness: "FHV_SYNTHETIC_WP7B",
      runId: "fhv-synthetic-proof",
      provenanceDigest: technicalScaleAuthority.contentDigest,
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    });
    expect(() =>
      assertSyntheticResearchNonCapitalFhvScopeV2({
        ...exactFhvScope,
        maxCycles: 1_000,
        syntheticScaleAuthority: technicalScaleAuthority,
        informationSufficiencySyntheticResearch: technicalResearch,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_SYNTHETIC_RESEARCH_SCOPE_FORBIDDEN");
  });

  it("preserves exact synthetic binding through Forecast/Decision persistence", async () => {
    const admittedCycle = runWp14EvaluationCycle({ organizationId: ORG });
    const synthetic = declareSyntheticResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      harness: "CAPITAL_TRACE_SYNTHETIC",
      runId: admittedCycle.intelligenceCycleBundle!.envelope.runId,
      provenanceDigest: "c".repeat(64),
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    });
    const input = {
      intelligenceCycleBundle: admittedCycle.intelligenceCycleBundle!,
      hypothesisSet: admittedCycle.hypothesisSet!,
      decisionChain: admittedCycle.decisionChain!,
      msv: admittedCycle.msv,
      signal: admittedCycle.signal,
      informationSufficiencyAuthority: synthetic.authority,
      informationSufficiencySyntheticBinding: synthetic.binding,
    };
    const bundle = buildForecastDecisionBundle(input);

    expect(() =>
      admitForecastDecisionPersistence({
        authority: synthetic.authority,
        organizationId: ORG,
        bundle,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:SYNTHETIC_BINDING_MISMATCH");

    const substituted = declareSyntheticResearchNonCapitalInformationAuthorityV2({
      organizationId: ORG,
      harness: "CAPITAL_TRACE_SYNTHETIC",
      runId: "different-trace-run",
      provenanceDigest: "e".repeat(64),
      officialBlindHoldout: false,
      production: false,
      live: false,
      capitalEligible: false,
      capitalUse: false,
    });
    expect(() =>
      admitForecastDecisionPersistence({
        authority: substituted.authority,
        organizationId: ORG,
        bundle,
        syntheticResearchBinding: substituted.binding,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:SYNTHETIC_BINDING_MISMATCH");
    const persisted = await persistForecastDecisionBundleForCycle(requireOrgContext(ORG), input, {
      bundleRepository: {
        async persist(context, sealedBundle, authorization) {
          expect(authorization.syntheticResearchBinding).toEqual(synthetic.binding);
          expect(() =>
            admitForecastDecisionPersistence({
              authority: authorization.authority,
              organizationId: context.organizationId,
              bundle: sealedBundle,
              syntheticResearchBinding: authorization.syntheticResearchBinding,
            }),
          ).not.toThrow();
          return sealedBundle;
        },
      },
    });
    expect(persisted).toStrictEqual(bundle);
  });

  it("blocks Forecast/Decision construction when authority is missing", () => {
    const blockedCycle = runWp14EvaluationCycle({
      organizationId: ORG,
      informationSufficiencyAuthority: undefined,
    });
    const admittedCycle = runWp14EvaluationCycle({ organizationId: ORG });

    expect(blockedCycle.forecastDecisionBundle).toBeUndefined();
    expect(admittedCycle.forecastDecisionBundle).toBeDefined();
    expect(() =>
      buildForecastDecisionBundle({
        intelligenceCycleBundle: admittedCycle.intelligenceCycleBundle!,
        hypothesisSet: admittedCycle.hypothesisSet!,
        decisionChain: admittedCycle.decisionChain!,
        msv: admittedCycle.msv,
        signal: admittedCycle.signal,
        informationSufficiencyAuthority:
          undefined as unknown as InformationSufficiencyRuntimeAuthorityV2,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:MISSING_AUTHORITY");
  });

  it("authenticates account and analytical timeframe at direct construction and persistence", async () => {
    const sufficient = bindAuthority([evidence()]);
    const admittedCycle = runWp14EvaluationCycle({
      organizationId: ORG,
      accountId: sufficient.profile.accountId,
      evaluatedAt: PIT,
      informationSufficiencyAuthority: sufficient.authority,
    });
    const bundleInput = {
      intelligenceCycleBundle: admittedCycle.intelligenceCycleBundle!,
      hypothesisSet: admittedCycle.hypothesisSet!,
      decisionChain: admittedCycle.decisionChain!,
      msv: admittedCycle.msv,
      signal: admittedCycle.signal,
      informationSufficiencyAuthority: sufficient.authority,
    };
    const exactSourceBundle = admittedCycle.intelligenceCycleBundle!;
    const wrongAccountBundle = {
      ...exactSourceBundle,
      informationSufficiencyProvenance: {
        ...exactSourceBundle.informationSufficiencyProvenance,
        accountId: "wrong-account",
      },
    };
    const wrongTimeframeBundle = {
      ...exactSourceBundle,
      informationSufficiencyProvenance: {
        ...exactSourceBundle.informationSufficiencyProvenance,
        analyticalTimeframe: "5m",
      },
    };

    expect(() =>
      buildForecastDecisionBundle({
        ...bundleInput,
        intelligenceCycleBundle: wrongAccountBundle,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:SCOPE_MISMATCH");
    expect(() =>
      buildForecastDecisionBundle({
        ...bundleInput,
        intelligenceCycleBundle: wrongTimeframeBundle,
      }),
    ).toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:SCOPE_MISMATCH");

    const bundle = buildForecastDecisionBundle(bundleInput);
    expect(Object.isFrozen(exactSourceBundle)).toBe(true);
    expect(Object.isFrozen(exactSourceBundle.envelope)).toBe(true);
    expect(Object.isFrozen(exactSourceBundle.informationSufficiencyProvenance)).toBe(true);
    expect(
      Reflect.set(exactSourceBundle.informationSufficiencyProvenance, "accountId", "wrong-account"),
    ).toBe(false);
    expect(exactSourceBundle.informationSufficiencyProvenance.accountId).toBe("paper-account");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.decision)).toBe(true);
    expect(
      Reflect.set(bundle, "decision", { ...bundle.decision, organizationId: "wrong-org" }),
    ).toBe(false);
    expect(Reflect.set(bundle.decision, "organizationId", "wrong-org")).toBe(false);
    expect(bundle.decision.organizationId).toBe(ORG);
    expect(() =>
      buildDecisionRecord(
        {
          intelligenceCycleBundle: admittedCycle.intelligenceCycleBundle!,
          decisionChain: admittedCycle.decisionChain!,
          msv: admittedCycle.msv,
          signal: admittedCycle.signal,
        },
        undefined as never,
        exactSourceBundle,
      ),
    ).toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:INVALID_CONSTRUCTION_PERMIT");

    const exactPermit = admitForecastDecisionConstruction({
      authority: sufficient.authority,
      sourceBundle: exactSourceBundle,
    });
    expect(() =>
      buildDecisionRecord(
        {
          intelligenceCycleBundle: wrongAccountBundle,
          decisionChain: admittedCycle.decisionChain!,
          msv: admittedCycle.msv,
          signal: admittedCycle.signal,
        },
        exactPermit,
        wrongAccountBundle,
      ),
    ).toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:INVALID_CONSTRUCTION_PERMIT");
    await expect(
      persistForecastDecisionBundle({ organizationId: ORG }, bundle, {} as WaiaPostgresDb, {
        authority: undefined as unknown as InformationSufficiencyRuntimeAuthorityV2,
      }),
    ).rejects.toThrow("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:MISSING_AUTHORITY");
    await expect(
      persistForecastDecisionBundle({ organizationId: ORG }, { ...bundle }, {} as WaiaPostgresDb, {
        authority: sufficient.authority,
      }),
    ).rejects.toThrow("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:UNSEALED_BUNDLE");
    await expect(
      createDecisionRecordRepositoryPostgres({} as never).insert(
        { organizationId: ORG },
        bundle.decision,
        undefined as never,
      ),
    ).rejects.toThrow("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:INVALID_PERSISTENCE_PERMIT");
  });

  it("blocks new-entry dispatch on omission and permits only explicit research simulation", async () => {
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(actionableEvaluation());
    const bars = wp14Bars();
    const snapshot = {
      bars,
      quote: {
        symbol: "BTC/USDT",
        bid: "100",
        ask: "101",
        last: "100.5",
        timestamp: bars.at(-1)!.barCloseTime,
      },
      evaluatedAt: bars.at(-1)!.barCloseTime,
      cycleIndex: 0,
      cycleId: "dee-688-runtime",
    };

    const blocked = paperDeps();
    const blockedResult = await runPaperCycleOnce(blocked.deps, {
      context: requireOrgContext(ORG),
      snapshot,
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
    });
    expect(blockedResult.skipReason).toBe("information_sufficiency_blocked");
    expect(blockedResult.strategyExecutions).toEqual([
      expect.objectContaining({
        submitBlocked: true,
        skipReason: "information_sufficiency_blocked",
      }),
    ]);
    expect(blocked.submitOrder).not.toHaveBeenCalled();

    const admitted = paperDeps();
    await runPaperCycleOnce(admitted.deps, {
      context: requireOrgContext(ORG),
      snapshot,
      accountKey: "paper",
      defaultQuantity: "0.01",
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
      informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
        organizationId: ORG,
        reason: "DEE_688_PAPER_SIMULATION_TEST",
      }),
    });
    expect(admitted.submitOrder).toHaveBeenCalledTimes(1);
  });
});
