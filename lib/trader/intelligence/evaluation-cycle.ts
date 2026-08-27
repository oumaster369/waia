import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { assembleDecisionChain } from "@/lib/trader/intelligence/decision-chain";
import { emitMsvDecisionCounters } from "@/lib/trader/intelligence/decision-telemetry";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { HYPOTHESIS_SET_SCHEMA_VERSION } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { isMiCoreEnabled } from "@/lib/trader/intelligence/mi-core-flag";
import { isHistoricalProfileActive } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { buildForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import { issueForecastRuntimeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { evaluateInformationSufficiencyRuntimeAdmissionV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import {
  finalizeMarketStateSnapshot,
  resolveTerminalReasonCode,
} from "@/lib/trader/intelligence/market-state-finalization";
import {
  buildExactMarketUnderstandingArtifactV1,
  buildMarketUnderstandingBridge,
} from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { recordFullHistoryRescan } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  evaluateRegisteredStrategies,
  selectPrimaryStrategySignal,
} from "@/lib/trader/intelligence/strategies/registry";
import { emitStrategySignalCounters } from "@/lib/trader/intelligence/strategy-telemetry";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import type { EvaluationCycleInput, EvaluationCycleResult } from "@/lib/trader/intelligence/types";

/**
 * Runs one intelligence evaluation: Feature Engine → Context Fusion hook → Understanding Bridge → CDE → strategies.
 * PR-2 MI Core (flag ON): Reconstruction → Understanding → Hypothesis → CDE conviction → Market State Finalization → Decision Chain.
 */
export function runEvaluationCycle(input: EvaluationCycleInput): EvaluationCycleResult {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const profileActive = input.historicalProfile
    ? isHistoricalProfileActive(input.historicalProfile)
    : false;
  const miCore = profileActive
    ? true
    : (input.miCoreEnabled ?? isMiCoreEnabled(undefined, input.historicalProfile));
  const evaluatedAt = input.evaluatedAt ?? input.bars.at(-1)?.barCloseTime;
  if (!evaluatedAt) {
    throw new Error(
      "[trader/intelligence] runEvaluationCycle requires evaluatedAt or at least one bar with barCloseTime",
    );
  }
  const forecastRuntimeOutcome = issueForecastRuntimeV2(
    input.forecastRuntimeInput ?? {
      predictiveAdmissionReceipt: null,
      marketStateSnapshot: null,
      forecastContractBinding: null,
      predictivePackage: null,
      executionHorizonMinutes: 0,
      normalizationVersionDigestHex: "",
    },
  );

  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt,
    newId,
  });

  if (!miCore) {
    const understanding = input.fusedContext
      ? buildMarketUnderstandingBridge({
          fusedContext: input.fusedContext,
          features,
        })
      : undefined;
    const understandingArtifact =
      understanding && input.informationSufficiencyAuthority?.kind === "PROFILE_RECEIPT"
        ? buildExactMarketUnderstandingArtifactV1({
            authority: input.informationSufficiencyAuthority,
            organizationId: input.organizationId,
            accountId: input.accountId ?? null,
            symbol: input.symbol ?? input.bars[0]?.symbol ?? "",
            analyticalTimeframe: input.bars[0]?.interval ?? "",
            evaluatedAt,
            features,
            questionEvaluations: understanding.questionEvaluations,
          })
        : undefined;

    const msv = buildMsvEnvelope({
      features,
      fusedContext: input.fusedContext,
      understanding,
      newId,
    });
    emitMsvDecisionCounters(msv, input.organizationId, input.telemetrySink);

    const signals = evaluateRegisteredStrategies(msv, features, {
      organizationId: input.organizationId,
      bars: input.bars,
      newId,
    });

    for (const signal of signals) {
      emitStrategySignalCounters(signal, input.telemetrySink);
    }

    const signal = selectPrimaryStrategySignal(signals);

    return {
      features,
      msv,
      signals,
      signal,
      fusedContext: input.fusedContext,
      understanding,
      understandingArtifact,
      forecastRuntimeOutcome,
    };
  }

  const reconstruction: ReconstructionSnapshot =
    input.reconstruction ??
    (() => {
      recordFullHistoryRescan("buildReconstructionSnapshot");
      return buildReconstructionSnapshot({
        bars1m: input.bars,
        evaluatedAt,
        fusedContext: input.fusedContext,
      });
    })();

  const understanding = input.fusedContext
    ? buildMarketUnderstandingBridge({
        fusedContext: input.fusedContext,
        features,
        reconstruction,
      })
    : undefined;
  const understandingArtifact =
    understanding && input.informationSufficiencyAuthority?.kind === "PROFILE_RECEIPT"
      ? buildExactMarketUnderstandingArtifactV1({
          authority: input.informationSufficiencyAuthority,
          organizationId: input.organizationId,
          accountId: input.accountId ?? null,
          symbol: input.symbol ?? input.bars[0]?.symbol ?? "",
          analyticalTimeframe: input.bars[0]?.interval ?? "",
          evaluatedAt,
          features,
          reconstruction,
          questionEvaluations: understanding.questionEvaluations,
        })
      : undefined;

  const sessionState = input.hypothesisSessionState ?? createEmptyHypothesisSessionState();
  // STREAM_ONLY + fusedContext off: CDE returns ALLOW_TRADING before opportunity/conviction.
  // Skip hypothesis allocation (8 hypotheses + sort + session maps) on the IDHPS hot path.
  const skipHypothesis = input.omitIntelligenceArtifacts === true && input.fusedContext == null;
  const { hypothesisSet, sessionState: nextSessionState } = skipHypothesis
    ? {
        hypothesisSet: {
          schemaVersion: HYPOTHESIS_SET_SCHEMA_VERSION,
          evaluatedAt,
          hypotheses: [],
          activeHypothesis: null,
          opportunity: null,
        },
        sessionState,
      }
    : buildHypothesisSet({
        reconstruction,
        understanding,
        evaluatedAt,
        sessionState,
        organizationId: input.organizationId,
        symbol: input.symbol ?? input.bars[0]?.symbol ?? "",
        canonicalRuntimeIntelligenceState: input.canonicalRuntimeIntelligenceState,
      });

  const msv = buildMsvEnvelope({
    features,
    fusedContext: input.fusedContext,
    understanding,
    opportunity: hypothesisSet.opportunity ?? undefined,
    miCoreEnabled: true,
    newId,
  });
  if (input.telemetrySink) {
    emitMsvDecisionCounters(msv, input.organizationId, input.telemetrySink);
  }

  const signals = evaluateRegisteredStrategies(
    msv,
    features,
    {
      organizationId: input.organizationId,
      bars: input.bars,
      newId,
      historicalProfile: profileActive ? input.historicalProfile : undefined,
    },
    input.strategySignalIds?.length
      ? (input.strategySignalIds as Parameters<typeof evaluateRegisteredStrategies>[3])
      : undefined,
  );

  if (input.telemetrySink) {
    for (const signal of signals) {
      emitStrategySignalCounters(signal, input.telemetrySink);
    }
  }

  const signal = selectPrimaryStrategySignal(signals, {
    historicalProfile: profileActive ? input.historicalProfile : undefined,
  });

  // IDHPS: STREAM_ONLY scale omits WP13/WP14 artifact assembly when no sinks consume them.
  // Signals/MSV/hypothesis economics above are unchanged.
  if (input.omitIntelligenceArtifacts) {
    return {
      features,
      msv,
      signals,
      signal,
      fusedContext: input.fusedContext,
      understanding,
      understandingArtifact,
      reconstruction,
      hypothesisSet,
      hypothesisSessionState: nextSessionState,
      forecastRuntimeOutcome,
    };
  }

  const terminalReasonCode = resolveTerminalReasonCode({
    opportunityAuthorized: hypothesisSet.opportunity?.authorized ?? false,
    tradingPermission: msv.derived.tradingPermission,
    conviction: hypothesisSet.opportunity?.conviction ?? 0,
    activeHypothesisType: hypothesisSet.activeHypothesis?.hypothesisType ?? null,
    sourceReasonCodes: msv.derived.reasonCodes,
    insufficientBars: features.inputs.barCount < 20,
  });

  const marketStateSnapshot = finalizeMarketStateSnapshot({
    reconstruction,
    understanding,
    hypothesisSet,
    tradingPermission: msv.derived.tradingPermission,
    terminalReasonCode,
  });

  const decisionChain = assembleDecisionChain({
    evaluatedAt,
    reconstruction,
    hypothesisSet,
    marketStateSnapshot,
    tradingPermission: msv.derived.tradingPermission,
    reasonCodes: msv.derived.reasonCodes,
  });

  const intelligenceCycleBundle =
    profileActive && input.runId && input.cycleId
      ? buildIntelligenceCycleBundle({
          organizationId: input.organizationId,
          runId: input.runId,
          cycleId: input.cycleId,
          symbol: input.symbol ?? input.bars[0]?.symbol ?? "BTC/USDT",
          accountId: input.accountId ?? null,
          analyticalTimeframe: input.bars[0]?.interval ?? "",
          marketStateSnapshot,
          understandingArtifact,
          decisionChain,
          profile: input.historicalProfile,
        })
      : undefined;

  const informationSufficiencyAdmission = evaluateInformationSufficiencyRuntimeAdmissionV2({
    authority: input.informationSufficiencyAuthority,
    organizationId: input.organizationId,
    requiredPurpose: "NEW_OPPORTUNITY",
    allowResearchNonCapital: true,
    syntheticResearchBinding: input.informationSufficiencySyntheticBinding,
    expectedScope: {
      accountId: input.accountId ?? null,
      symbol: input.symbol ?? input.bars[0]?.symbol,
      analyticalTimeframe: input.bars[0]?.interval,
      pitAnchor: evaluatedAt,
    },
  });

  const forecastDecisionBundle =
    profileActive &&
    intelligenceCycleBundle &&
    hypothesisSet &&
    decisionChain &&
    informationSufficiencyAdmission.status === "ADMITTED" &&
    input.informationSufficiencyAuthority &&
    input.forecastRuntimeInput == null
      ? buildForecastDecisionBundle({
          intelligenceCycleBundle,
          hypothesisSet,
          decisionChain,
          msv,
          signal,
          costModel: input.costModel,
          informationSufficiencyAuthority: input.informationSufficiencyAuthority,
          informationSufficiencySyntheticBinding:
            input.informationSufficiencySyntheticBinding,
        })
      : undefined;

  return {
    features,
    msv,
    signals,
    signal,
    fusedContext: input.fusedContext,
    understanding,
    understandingArtifact,
    reconstruction,
    hypothesisSet,
    marketStateSnapshot,
    decisionChain,
    hypothesisSessionState: nextSessionState,
    intelligenceCycleBundle,
    forecastDecisionBundle,
    forecastRuntimeOutcome,
  };
}
