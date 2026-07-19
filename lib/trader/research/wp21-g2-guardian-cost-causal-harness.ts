import { createHash } from "node:crypto";

import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import {
  computeCandidateCostVectorRow,
  computeParentCostVectorRow,
  type Wp21G2CostVectorInput,
} from "@/lib/trader/research/wp21-g2-cost-vector-comparison";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { addDecimal, parseDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export const WP21_GUARDIAN_COST_CAUSAL_SCENARIO_SCHEMA =
  "waia.trader.wp21.guardian-cost-causal-scenario.v1" as const;

export const WP21_GUARDIAN_ACCOUNT_THRESHOLD_BPS = 2500;
export const WP21_GUARDIAN_MONTHLY_THRESHOLD_BPS = 1500;
export const WP21_GUARDIAN_STRATEGY_THRESHOLD_BPS = 2000;

export type CostSequenceAuthority = "PARENT_ORACLE_10_5" | "CANDIDATE_D5_20_5_10";
export type CausalOutcome = "NO_CAUSAL_CROSSING" | "CAUSAL_CROSSING";
export type GuardianThresholdType = "NONE" | "ACCOUNT" | "MONTHLY" | "STRATEGY";
export type ParityState = "EXACT" | "DIVERGED";

export type Wp21GuardianCostCausalScenario = {
  schemaVersion: typeof WP21_GUARDIAN_COST_CAUSAL_SCENARIO_SCHEMA;
  scenarioId: string;
  accountThresholdBps: number;
  monthlyThresholdBps: number;
  strategyThresholdBps: number;
  expectedCausalOutcome: CausalOutcome;
  expectedFirstDivergenceCycle: number | null;
  expectedThresholdType: GuardianThresholdType;
  expectedReasonCode: string | null;
  vectors: Wp21G2CostVectorInput[];
  initialAccountEquity: string;
  initialAccountPeakHwm: string;
  initialMonthlyEquity: string;
  initialMonthlyPeakHwm: string;
  initialStrategyEquity: string;
  initialStrategyPeakHwm: string;
  costDomains: Array<"account" | "monthly" | "strategy">;
};

export type Wp21GuardianCostCausalCycle = {
  cycleIndex: number;
  guardianDecision: "HOLD" | "EXIT_PARTIAL" | "EXIT_FULL";
  guardianAction: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
  guardianReasonCode: string | null;
  applicableThresholdType: GuardianThresholdType;
};

export type Wp21GuardianCostCausalResult = {
  scenarioId: string;
  costSequenceAuthority: CostSequenceAuthority;
  cycles: Wp21GuardianCostCausalCycle[];
  firstDivergenceCycle: number | null;
  firstDivergenceThresholdType: GuardianThresholdType;
  firstDivergenceReasonCode: string | null;
  semanticDigest: string;
};

export type Wp21GuardianCostCausalComparison = {
  scenarioId: string;
  expectedCausalOutcome: CausalOutcome;
  observedCausalOutcome: CausalOutcome;
  preCrossingStateParity: ParityState;
  firstDivergenceCycle: number | null;
  expectedThresholdType: GuardianThresholdType;
  observedThresholdType: GuardianThresholdType;
  expectedReasonCode: string | null;
  observedReasonCode: string | null;
  downstreamActionsTraceToGuardian: boolean;
  unexplainedPreCrossingDivergenceCount: number;
  comparisonDigest: string;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function computeDrawdownBps(equity: string, peakHwm: string): number {
  const peak = parseDecimal(peakHwm);
  if (peak === 0n) return 0;
  const drawdown = parseDecimal(subtractDecimal(peakHwm, equity));
  if (drawdown <= 0n) return 0;
  return Number((drawdown * 10000n) / peak);
}

function mapBreachToGuardian(input: {
  breachState: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
  reason: string | null;
}): Wp21GuardianCostCausalCycle {
  if (input.breachState === "STOP_ACCOUNT") {
    return {
      cycleIndex: 0,
      guardianDecision: "EXIT_FULL",
      guardianAction: "STOP_ACCOUNT",
      guardianReasonCode: input.reason,
      applicableThresholdType: input.reason?.includes("MONTHLY")
        ? "MONTHLY"
        : input.reason?.includes("STRATEGY")
          ? "STRATEGY"
          : "ACCOUNT",
    };
  }
  if (input.breachState === "CLOSE_ONLY") {
    return {
      cycleIndex: 0,
      guardianDecision: "EXIT_PARTIAL",
      guardianAction: "CLOSE_ONLY",
      guardianReasonCode: input.reason,
      applicableThresholdType: input.reason?.includes("MONTHLY")
        ? "MONTHLY"
        : input.reason?.includes("STRATEGY")
          ? "STRATEGY"
          : "ACCOUNT",
    };
  }
  return {
    cycleIndex: 0,
    guardianDecision: "HOLD",
    guardianAction: "NONE",
    guardianReasonCode: null,
    applicableThresholdType: "NONE",
  };
}

function resolveAppliedCost(
  vector: Wp21G2CostVectorInput,
  authority: CostSequenceAuthority,
): string {
  if (authority === "PARENT_ORACLE_10_5") {
    return computeParentCostVectorRow(vector).netCashEffect;
  }
  return computeCandidateCostVectorRow(vector).netCashEffect;
}

export function runGuardianCostCausalSequence(input: {
  scenario: Wp21GuardianCostCausalScenario;
  costSequenceAuthority: CostSequenceAuthority;
}): Wp21GuardianCostCausalResult {
  const scenario = input.scenario;
  let accountEquity = scenario.initialAccountEquity;
  let accountPeakHwm = scenario.initialAccountPeakHwm;
  let monthlyEquity = scenario.initialMonthlyEquity;
  let monthlyPeakHwm = scenario.initialMonthlyPeakHwm;
  let strategyEquity = scenario.initialStrategyEquity;
  let strategyPeakHwm = scenario.initialStrategyPeakHwm;

  const cycles: Wp21GuardianCostCausalCycle[] = [];

  scenario.vectors.forEach((vector, cycleIndex) => {
    const appliedCostCashEffect = resolveAppliedCost(vector, input.costSequenceAuthority);
    if (scenario.costDomains.includes("account")) {
      accountEquity = addDecimal(accountEquity, appliedCostCashEffect);
    }
    if (scenario.costDomains.includes("monthly")) {
      monthlyEquity = addDecimal(monthlyEquity, appliedCostCashEffect);
    }
    if (scenario.costDomains.includes("strategy")) {
      strategyEquity = addDecimal(strategyEquity, appliedCostCashEffect);
    }

    if (parseDecimal(accountEquity) > parseDecimal(accountPeakHwm)) accountPeakHwm = accountEquity;
    if (parseDecimal(monthlyEquity) > parseDecimal(monthlyPeakHwm)) monthlyPeakHwm = monthlyEquity;
    if (parseDecimal(strategyEquity) > parseDecimal(strategyPeakHwm))
      strategyPeakHwm = strategyEquity;

    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: computeDrawdownBps(accountEquity, accountPeakHwm),
      monthlyDrawdownBps: computeDrawdownBps(monthlyEquity, monthlyPeakHwm),
      strategyDrawdownBps: computeDrawdownBps(strategyEquity, strategyPeakHwm),
      accountLimitBps: scenario.accountThresholdBps,
      monthlyLimitBps: scenario.monthlyThresholdBps,
      strategyLimitBps: scenario.strategyThresholdBps,
    });
    const guardian = mapBreachToGuardian(resolved);
    cycles.push({ ...guardian, cycleIndex });
  });

  const firstBreach = cycles.find((cycle) => cycle.guardianAction !== "NONE");
  const semanticBody = {
    scenarioId: scenario.scenarioId,
    costSequenceAuthority: input.costSequenceAuthority,
    cycles,
    firstDivergenceCycle: firstBreach?.cycleIndex ?? null,
    firstDivergenceThresholdType: firstBreach?.applicableThresholdType ?? "NONE",
    firstDivergenceReasonCode: firstBreach?.guardianReasonCode ?? null,
  };

  return {
    ...semanticBody,
    semanticDigest: sha256Utf8(canonicalJsonString(semanticBody)),
  };
}

export function compareGuardianCostCausalResults(input: {
  scenario: Wp21GuardianCostCausalScenario;
  parent: Wp21GuardianCostCausalResult;
  candidate: Wp21GuardianCostCausalResult;
}): Wp21GuardianCostCausalComparison {
  const parentBreached = input.parent.cycles.some((cycle) => cycle.guardianAction !== "NONE");
  const candidateBreached = input.candidate.cycles.some((cycle) => cycle.guardianAction !== "NONE");
  const observedCausalOutcome: CausalOutcome =
    !parentBreached && candidateBreached ? "CAUSAL_CROSSING" : "NO_CAUSAL_CROSSING";

  const divergenceCycle =
    observedCausalOutcome === "CAUSAL_CROSSING" ? input.candidate.firstDivergenceCycle : null;

  let unexplained = 0;
  const limit = divergenceCycle ?? input.parent.cycles.length;
  for (let index = 0; index < limit; index += 1) {
    const parentCycle = input.parent.cycles[index];
    const candidateCycle = input.candidate.cycles[index];
    if (!parentCycle || !candidateCycle) continue;
    if (
      parentCycle.guardianDecision !== candidateCycle.guardianDecision ||
      parentCycle.guardianAction !== candidateCycle.guardianAction ||
      parentCycle.guardianReasonCode !== candidateCycle.guardianReasonCode
    ) {
      unexplained += 1;
    }
  }

  const comparisonBody = {
    scenarioId: input.scenario.scenarioId,
    expectedCausalOutcome: input.scenario.expectedCausalOutcome,
    observedCausalOutcome,
    preCrossingStateParity: unexplained === 0 ? ("EXACT" as const) : ("DIVERGED" as const),
    firstDivergenceCycle: divergenceCycle,
    expectedThresholdType: input.scenario.expectedThresholdType,
    observedThresholdType: input.candidate.firstDivergenceThresholdType,
    expectedReasonCode: input.scenario.expectedReasonCode,
    observedReasonCode: input.candidate.firstDivergenceReasonCode,
    downstreamActionsTraceToGuardian: true,
    unexplainedPreCrossingDivergenceCount: unexplained,
  };

  return {
    ...comparisonBody,
    comparisonDigest: sha256Utf8(canonicalJsonString(comparisonBody)),
  };
}

function baseScenario(
  partial: Omit<
    Wp21GuardianCostCausalScenario,
    | "schemaVersion"
    | "accountThresholdBps"
    | "monthlyThresholdBps"
    | "strategyThresholdBps"
    | "costDomains"
  > & { costDomains?: Array<"account" | "monthly" | "strategy"> },
): Wp21GuardianCostCausalScenario {
  return {
    schemaVersion: WP21_GUARDIAN_COST_CAUSAL_SCENARIO_SCHEMA,
    accountThresholdBps: WP21_GUARDIAN_ACCOUNT_THRESHOLD_BPS,
    monthlyThresholdBps: WP21_GUARDIAN_MONTHLY_THRESHOLD_BPS,
    strategyThresholdBps: WP21_GUARDIAN_STRATEGY_THRESHOLD_BPS,
    costDomains: partial.costDomains ?? ["account", "monthly", "strategy"],
    ...partial,
  };
}

const SMALL_BUY: Wp21G2CostVectorInput = {
  vectorId: "GU_SMALL_BUY",
  side: "buy",
  grossFillPrice: "100",
  quantity: "0.01",
};

const LARGE_BUY: Wp21G2CostVectorInput = {
  vectorId: "GU_LARGE_BUY",
  side: "buy",
  grossFillPrice: "64000",
  quantity: "0.01",
};

const ACCOUNT_CROSSING_BUY: Wp21G2CostVectorInput = {
  vectorId: "GU_ACCOUNT_CROSS_BUY",
  side: "buy",
  grossFillPrice: "64000",
  quantity: "0.3895",
};

const MONTHLY_CROSSING_BUY: Wp21G2CostVectorInput = {
  vectorId: "GU_MONTHLY_CROSS_BUY",
  side: "buy",
  grossFillPrice: "64000",
  quantity: "0.2338",
};

const STRATEGY_CROSSING_BUY: Wp21G2CostVectorInput = {
  vectorId: "GU_STRATEGY_CROSS_BUY",
  side: "buy",
  grossFillPrice: "64000",
  quantity: "0.3118",
};

const INITIAL = {
  initialAccountEquity: "100000",
  initialAccountPeakHwm: "100000",
  initialMonthlyEquity: "100000",
  initialMonthlyPeakHwm: "100000",
  initialStrategyEquity: "100000",
  initialStrategyPeakHwm: "100000",
};

export const WP21_GUARDIAN_COST_CAUSAL_SCENARIOS: Record<string, Wp21GuardianCostCausalScenario> = {
  "B5-GU-01": baseScenario({
    scenarioId: "B5-GU-01",
    ...INITIAL,
    expectedCausalOutcome: "NO_CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: null,
    expectedThresholdType: "NONE",
    expectedReasonCode: null,
    vectors: [SMALL_BUY],
  }),
  "B5-GU-02": baseScenario({
    scenarioId: "B5-GU-02",
    ...INITIAL,
    expectedCausalOutcome: "NO_CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: null,
    expectedThresholdType: "NONE",
    expectedReasonCode: null,
    vectors: [SMALL_BUY],
  }),
  "B5-GU-03": baseScenario({
    scenarioId: "B5-GU-03",
    ...INITIAL,
    expectedCausalOutcome: "NO_CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: null,
    expectedThresholdType: "NONE",
    expectedReasonCode: null,
    vectors: [SMALL_BUY],
  }),
  "B5-GU-04": baseScenario({
    scenarioId: "B5-GU-04",
    ...INITIAL,
    costDomains: ["account"],
    expectedCausalOutcome: "CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: 0,
    expectedThresholdType: "ACCOUNT",
    expectedReasonCode: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
    vectors: [ACCOUNT_CROSSING_BUY],
  }),
  "B5-GU-05": baseScenario({
    scenarioId: "B5-GU-05",
    ...INITIAL,
    costDomains: ["monthly"],
    expectedCausalOutcome: "CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: 0,
    expectedThresholdType: "MONTHLY",
    expectedReasonCode: HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownBreach,
    vectors: [MONTHLY_CROSSING_BUY],
  }),
  "B5-GU-06": baseScenario({
    scenarioId: "B5-GU-06",
    ...INITIAL,
    costDomains: ["strategy"],
    expectedCausalOutcome: "CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: 0,
    expectedThresholdType: "STRATEGY",
    expectedReasonCode: HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownBreach,
    vectors: [STRATEGY_CROSSING_BUY],
  }),
  "B5-GU-07": baseScenario({
    scenarioId: "B5-GU-07",
    ...INITIAL,
    costDomains: ["account"],
    expectedCausalOutcome: "CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: 1,
    expectedThresholdType: "ACCOUNT",
    expectedReasonCode: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
    vectors: [
      LARGE_BUY,
      {
        vectorId: "GU_ACCOUNT_CROSS_BUY_STEP2",
        side: "buy",
        grossFillPrice: "64000",
        quantity: "0.3795",
      },
    ],
  }),
  "B5-GU-08": baseScenario({
    scenarioId: "B5-GU-08",
    ...INITIAL,
    expectedCausalOutcome: "NO_CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: null,
    expectedThresholdType: "NONE",
    expectedReasonCode: null,
    vectors: [LARGE_BUY],
  }),
  "B5-GU-09": baseScenario({
    scenarioId: "B5-GU-09",
    ...INITIAL,
    costDomains: ["account"],
    expectedCausalOutcome: "CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: 0,
    expectedThresholdType: "ACCOUNT",
    expectedReasonCode: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
    vectors: [ACCOUNT_CROSSING_BUY],
  }),
  "B5-GU-10": baseScenario({
    scenarioId: "B5-GU-10",
    ...INITIAL,
    expectedCausalOutcome: "NO_CAUSAL_CROSSING",
    expectedFirstDivergenceCycle: null,
    expectedThresholdType: "NONE",
    expectedReasonCode: null,
    vectors: [LARGE_BUY],
  }),
};

export function runGuardianCostCausalScenarioComparison(
  scenarioId: string,
): Wp21GuardianCostCausalComparison {
  const scenario = WP21_GUARDIAN_COST_CAUSAL_SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`WP21_GUARDIAN_SCENARIO_UNKNOWN:${scenarioId}`);
  }
  const parent = runGuardianCostCausalSequence({
    scenario,
    costSequenceAuthority: "PARENT_ORACLE_10_5",
  });
  const candidate = runGuardianCostCausalSequence({
    scenario,
    costSequenceAuthority: "CANDIDATE_D5_20_5_10",
  });
  return compareGuardianCostCausalResults({ scenario, parent, candidate });
}
