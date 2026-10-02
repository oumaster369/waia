import { costModelV1FromAuthority, createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/cost-model";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { DEFAULT_GUARDIAN_RUN_CONFIG } from "@/lib/trader/guardian/guardian-run-config.types";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { DEFAULT_D20_DRAWDOWN_POLICY, D20_DRAWDOWN_POLICY_VERSION } from "@/lib/trader/risk/drawdown-policy.types";
import {
  computeHtrInitialPortfolioSemanticDigest,
  HTR_DEFAULT_PORTFOLIO_RUN_CONFIG,
  HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { parseResearchExperimentSpecV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import {
  buildResearchV2PortfolioContext,
  resolveResearchPortfolioConfig,
} from "@/lib/trader/research/research-portfolio-config";

export const RESEARCH_TRAINING_POLICY_V1 = "waia.research.training-policy.v1" as const;

/** A resolved configuration comparison, never an issuer, order allowance, score,
 * capital grant, or proof that the requested executable/source digest is genuine. */
export type ResearchTrainingPolicyV1 = ReturnType<typeof deriveCurrentResearchTrainingPolicyV1>;

function refuse(reason: string): never {
  throw new Error(`RESEARCH_TRAINING_POLICY_REFUSED:${reason}`);
}

/** Derived solely from current canonical runtime constants. No caller-supplied
 * policy, code hash, expected digest, sizing input or callback enters this path. */
export function deriveCurrentResearchTrainingPolicyV1() {
  const costAuthority = Object.freeze(createHtrHistoricalCostModelAuthorityV1());
  const model = createHistoricalExecutionModelV1();
  const historicalExecutionModelSha256 = computeStableJsonDigest(model);
  const researchDefaults = resolveResearchPortfolioConfig();
  const expectedPortfolioDefaults = {
    startingBalanceUsdt: HTR_DEFAULT_PORTFOLIO_RUN_CONFIG.startingBalanceUsdt,
    maxRiskPerTradePct: HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS.maxRiskPerTradePct,
    maxPortfolioRiskPct: HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS.maxPortfolioRiskPct,
    maxConcurrentPositions: HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS.maxConcurrentPositions,
    maxNotional: HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS.maxNotional,
  };
  if (canonicalJsonString(researchDefaults) !== canonicalJsonString(expectedPortfolioDefaults) ||
      HTR_DEFAULT_PORTFOLIO_RUN_CONFIG.defaultStopDistancePct !==
        DEFAULT_PORTFOLIO_RUN_CONFIG.defaultStopDistancePct) {
    refuse("RESEARCH_HTR_PORTFOLIO_DEFAULTS_DRIFT");
  }
  const portfolio = buildResearchV2PortfolioContext(costModelV1FromAuthority(costAuthority));
  const runConfig = Object.freeze({ ...portfolio.runConfig });
  const limits = Object.freeze({ ...portfolio.limits });
  const costModel = Object.freeze({ ...portfolio.costModel });
  if (canonicalJsonString(runConfig) !== canonicalJsonString(HTR_DEFAULT_PORTFOLIO_RUN_CONFIG) ||
      canonicalJsonString(limits) !== canonicalJsonString(HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS)) {
    refuse("RESEARCH_PORTFOLIO_RESOLUTION_DRIFT");
  }
  const guardianRunConfig = Object.freeze({ ...DEFAULT_GUARDIAN_RUN_CONFIG });
  if (guardianRunConfig.enabled !== true || guardianRunConfig.maxHoldBars !== 0 ||
      guardianRunConfig.barIntervalMs !== 60_000) {
    refuse("RESEARCH_GUARDIAN_DEFAULTS_DRIFT");
  }
  const d20 = Object.freeze({ ...DEFAULT_D20_DRAWDOWN_POLICY });
  const resolvedIdentity = Object.freeze({
    schemaVersion: RESEARCH_TRAINING_POLICY_V1,
    portfolio: Object.freeze({
      initialPortfolioSemanticDigest: computeHtrInitialPortfolioSemanticDigest(),
      runConfig,
      limits,
      costModel,
      stopDistancePolicy: "RUN_DEFAULT_PCT" as const,
    }),
    guardian: Object.freeze({
      runConfig: guardianRunConfig,
      enableExitEngine: false as const,
      htrAuthoritative: true as const,
      drawdownPolicyVersion: D20_DRAWDOWN_POLICY_VERSION,
      drawdownPolicy: d20,
    }),
    historicalExecutionModelSha256,
    costAuthority,
  });
  return Object.freeze({
    authority: "POLICY_CONSISTENCY_ONLY" as const,
    capitalEligible: false as const,
    scientificQualified: false as const,
    ...resolvedIdentity,
    guardianResolvedPolicySha256: computeStableJsonDigest(resolvedIdentity),
  });
}

/** Closed initial research profile. Proposal fields are compared with the
 * effective HTR/D5/D20 configuration; parsing or matching grants no execution
 * authority. The declared quantity is only a cap for later Risk sizing. */
export function resolveResearchTrainingPolicyV1(proposal: unknown) {
  const spec = parseResearchExperimentSpecV1(proposal);
  const current = deriveCurrentResearchTrainingPolicyV1();
  const requested = spec.replay;
  const portfolio = requested.portfolio;
  if (spec.universe.sidecarContentSha256 !== null) refuse("SIDECAR_UNSUPPORTED");
  if (requested.enableReplayFusedContext || requested.intelligenceProfileSha256 !== null) {
    refuse("UNSUPPORTED_INTELLIGENCE_PROFILE");
  }
  if (portfolio.startingBalanceUsdt !== current.portfolio.runConfig.startingBalanceUsdt ||
      portfolio.maxRiskPerTradePct !== current.portfolio.limits.maxRiskPerTradePct ||
      portfolio.maxPortfolioRiskPct !== current.portfolio.limits.maxPortfolioRiskPct ||
      portfolio.maxConcurrentPositions !== current.portfolio.limits.maxConcurrentPositions ||
      portfolio.maxNotional !== current.portfolio.limits.maxNotional ||
      (portfolio.defaultStopDistancePct !== null &&
        portfolio.defaultStopDistancePct !== current.portfolio.runConfig.defaultStopDistancePct)) {
    refuse("UNSUPPORTED_PORTFOLIO");
  }
  const guardian = requested.guardian;
  if (guardian.enabled !== true || guardian.maxHoldBars !== 0 || guardian.barIntervalMs !== 60_000 ||
      guardian.enableExitEngine !== false || guardian.htrAuthoritative !== true) {
    refuse("UNSUPPORTED_GUARDIAN");
  }
  if (requested.historicalExecutionModelSha256 !== current.historicalExecutionModelSha256) {
    refuse("HISTORICAL_MODEL_MISMATCH");
  }
  if (canonicalJsonString(spec.costs) !== canonicalJsonString(current.costAuthority)) {
    refuse("COST_MODEL_MISMATCH");
  }
  if (guardian.resolvedPolicySha256 !== current.guardianResolvedPolicySha256) {
    refuse("GUARDIAN_POLICY_MISMATCH");
  }
  return Object.freeze({
    ...current,
    declaredQuantityCap: requested.defaultQuantity,
    requestedExecutableSourceSha256: spec.executable.sourceSha256,
    requestedPointInTimeEvidenceSha256: spec.universe.pointInTimeEvidenceSha256,
  });
}
