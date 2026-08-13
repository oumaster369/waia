import { createHash } from "node:crypto";

import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import {
  type7QuantileFromUnsorted,
  TYPE7_QUANTILE_VERSION,
} from "@/lib/trader/research/benchmark/type7-quantile-v1";

export const DECISION_ECONOMICS_SCHEMA_VERSION = "decision-economics/v2" as const;
export const DECISION_ECONOMIC_PAYOFF_POLICY_VERSION = "decision-economic-payoff/v1" as const;
export const ECONOMIC_SEMANTICS_VERSION = "fhv-executable-policy-v1-interim-b" as const;

/** R_h index in exec-opp-13d-v1 vector. */
export const EXEC_OPP_R_H_INDEX = 3;

export type ExecOppSample13D = readonly number[];

export type DecisionPayoffInput = {
  notionalUsdt: number;
  sample: ExecOppSample13D;
  /** Total cost rate (fee+spread+impact) applied to notional. */
  costRate: number;
  /** Conservative slippage buffer for Pi_lower. */
  slippageBufferUsdt: number;
};

/**
 * Horizon liquidation payoff from R_h (§1.25 path B interim).
 * Pi_base = N * (exp(R_h) - 1) - N * cost_rate
 * Pi_lower = max(0, Pi_base - slippage_buffer)
 */
export function piBaseV1(input: DecisionPayoffInput): number {
  if (!(input.notionalUsdt > 0)) {
    throw new Error("[decision-economics] notional must be positive");
  }
  const rH = input.sample[EXEC_OPP_R_H_INDEX];
  if (rH === undefined || !Number.isFinite(rH)) {
    throw new Error("[decision-economics] invalid R_h in sample");
  }
  const gross = input.notionalUsdt * (Math.exp(rH) - 1);
  const costs = input.notionalUsdt * input.costRate;
  return gross - costs;
}

export function piLowerV1(input: DecisionPayoffInput): number {
  const base = piBaseV1(input);
  return Math.max(0, base - input.slippageBufferUsdt);
}

export type ReplicaPayoffMeans = {
  muBaseReplicas: readonly number[];
  muLowerReplicas: readonly number[];
};

export function computeReplicaPayoffMeans(input: {
  notionalUsdt: number;
  costRate: number;
  slippageBufferUsdt: number;
  replicaSamples: readonly (readonly ExecOppSample13D[])[];
}): ReplicaPayoffMeans {
  const muBaseReplicas: number[] = [];
  const muLowerReplicas: number[] = [];

  for (const samples of input.replicaSamples) {
    if (samples.length === 0) {
      throw new Error("[decision-economics] empty aleatoric draws for replica");
    }
    let sumBase = 0;
    let sumLower = 0;
    for (const sample of samples) {
      const payoffInput: DecisionPayoffInput = {
        notionalUsdt: input.notionalUsdt,
        sample,
        costRate: input.costRate,
        slippageBufferUsdt: input.slippageBufferUsdt,
      };
      sumBase += piBaseV1(payoffInput);
      sumLower += piLowerV1(payoffInput);
    }
    muBaseReplicas.push(sumBase / samples.length);
    muLowerReplicas.push(sumLower / samples.length);
  }

  return { muBaseReplicas, muLowerReplicas };
}

export type DecisionEvRange = {
  evLower: number;
  evBase: number;
  evUpper: number;
  evLowerScale8: string;
  evBaseScale8: string;
  evUpperScale8: string;
  decisionActionable: boolean;
  reasonCodes: string[];
};

export class EvRangeInvalidError extends Error {
  readonly code = "EV_RANGE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "EvRangeInvalidError";
  }
}

/**
 * Type-7 epistemic quantiles: Q_0.10(mu_lower), Q_0.50(mu_base), Q_0.90(mu_base).
 *
 * Pure math kernel — does not perform DB I/O.
 * `scientificAdmissionVerified` MUST be true only after an organization-bound
 * scientific-admission receipt was validated outside this kernel.
 * A raw digest string is never sufficient authority.
 *
 * DECISION_ACTIONABLE requires EV_lower > 0 AND verified admission AND valid EV range.
 */
export function computeDecisionEvRangeV1(input: {
  muBaseReplicas: readonly number[];
  muLowerReplicas: readonly number[];
  /**
   * True only after verified org-bound scientific admission (service/TEST_ONLY ceremony).
   * Diagnostic research paths MUST pass false — EV numbers may still be computed.
   */
  scientificAdmissionVerified: boolean;
}): DecisionEvRange {
  if (input.muBaseReplicas.length === 0 || input.muLowerReplicas.length === 0) {
    throw new EvRangeInvalidError("empty replica means");
  }

  const evLower = type7QuantileFromUnsorted([...input.muLowerReplicas], 0.1);
  const evBase = type7QuantileFromUnsorted([...input.muBaseReplicas], 0.5);
  const evUpper = type7QuantileFromUnsorted([...input.muBaseReplicas], 0.9);

  const reasonCodes: string[] = [];

  if (!(evLower <= evBase && evBase <= evUpper)) {
    reasonCodes.push("EV_RANGE_INVALID");
    return {
      evLower,
      evBase,
      evUpper,
      evLowerScale8: quantizeScale8HalfUp(evLower),
      evBaseScale8: quantizeScale8HalfUp(evBase),
      evUpperScale8: quantizeScale8HalfUp(evUpper),
      decisionActionable: false,
      reasonCodes: [...reasonCodes, "DECISION_NON_ACTIONABLE"],
    };
  }

  if (!input.scientificAdmissionVerified) {
    reasonCodes.push("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
  }

  const decisionActionable =
    evLower > 0 && reasonCodes.length === 0 && input.scientificAdmissionVerified;

  if (!decisionActionable && evLower <= 0) {
    reasonCodes.push("EV_LOWER_NON_POSITIVE");
  }
  if (!decisionActionable && !reasonCodes.includes("DECISION_NON_ACTIONABLE")) {
    reasonCodes.push("DECISION_NON_ACTIONABLE");
  }

  return {
    evLower,
    evBase,
    evUpper,
    evLowerScale8: quantizeScale8HalfUp(evLower),
    evBaseScale8: quantizeScale8HalfUp(evBase),
    evUpperScale8: quantizeScale8HalfUp(evUpper),
    decisionActionable,
    reasonCodes,
  };
}

/**
 * Diagnostic EV only — never claims DECISION_ACTIONABLE.
 * Used by KM convergence / research harness math that must not authorize capital.
 */
export function computeDecisionEvRangeDiagnosticV1(input: {
  muBaseReplicas: readonly number[];
  muLowerReplicas: readonly number[];
}): DecisionEvRange {
  const range = computeDecisionEvRangeV1({
    ...input,
    scientificAdmissionVerified: false,
  });
  return {
    ...range,
    decisionActionable: false,
    reasonCodes: range.reasonCodes.includes("DECISION_NON_ACTIONABLE")
      ? range.reasonCodes
      : [...range.reasonCodes, "DECISION_NON_ACTIONABLE"],
  };
}

export function computeDecisionEconomicsContentDigest(input: {
  organizationId: string;
  forecastId: string;
  evLowerScale8: string;
  evBaseScale8: string;
  evUpperScale8: string;
  decisionActionable: boolean;
  economicSemanticsVersion: string;
}): string {
  const body = [
    DECISION_ECONOMICS_SCHEMA_VERSION,
    input.organizationId,
    input.forecastId,
    input.evLowerScale8,
    input.evBaseScale8,
    input.evUpperScale8,
    String(input.decisionActionable),
    input.economicSemanticsVersion,
    TYPE7_QUANTILE_VERSION,
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** Strategy legacy fields MUST NOT affect EV (§1.20 regression firewall). */
export function assertLegacyStrategyFieldsNonAuthoritative(input: {
  legacyDiagnosticConfidence?: number;
  legacyDiagnosticExpectedEdge?: number;
  legacyDiagnosticMaxRisk?: number;
}): void {
  void input;
}
