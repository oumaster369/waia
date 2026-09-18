import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { AuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type { RuntimePostureV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-assessment-v2";
import {
  LIVE_EDGE_DRIFT_POSTURE_RANK_V2,
  type LiveEdgeDriftPostureV2,
} from "@/lib/trader/restriction/live-edge-drift-restriction-v2";

export const EXECUTION_ADMISSION_PROOF_SCHEMA_V2 =
  "waia.trader.execution_admission_proof.v2" as const;

const HEX64 = /^[0-9a-f]{64}$/;

const RUNTIME_POSTURE_RANK: Readonly<Record<RuntimePostureV2, number>> = {
  FULL_ANALYSIS_AND_NEW_RISK: 0,
  NO_NEW_RISK: 1,
  CLOSE_ONLY: 2,
  HALT: 3,
};

export type ExecutionAdmissionProvenanceV2 = "ORDINARY" | "PROTECTIVE";

export type ExecutionAdmissionIdentityV2 = Readonly<{
  organizationId: string;
  accountId: string;
  symbol: string;
  action: "ENTER_LONG" | "REDUCE" | "CLOSE";
  direction: "BUY" | "SELL";
  quantity: string;
  externalEffectId: string;
}>;

export type ExecutionAdmissionProofV2 = Readonly<{
  schemaVersion: typeof EXECUTION_ADMISSION_PROOF_SCHEMA_V2;
  authority: "PROOF_ONLY";
  capitalAuthority: "NONE";
  provenance: ExecutionAdmissionProvenanceV2;
  runtimeContextDigestHex: string;
  decisionDigestHex: string | null;
  protectiveMandateDigestHex: string | null;
  protectiveTriggerDigestHex: string | null;
  riskAllowanceDigestHex: string;
  executionPlanDigestHex: string;
  identity: ExecutionAdmissionIdentityV2;
  admittedAt: string;
  contentDigestHex: string;
}>;

export type ProveOrdinaryExecutionAdmissionV2Input = Readonly<{
  emergency?: boolean;
  context: AuthoritativeRuntimeContextV2;
  currentRuntimePosture: RuntimePostureV2;
  currentDriftPosture: LiveEdgeDriftPostureV2;
  navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT" | "INSUFFICIENT_EVIDENCE" | "UNKNOWN_UNRESOLVED";
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  decision: Readonly<{
    contentDigestHex: string;
    organizationId: string;
    accountId: string;
    symbol: string;
    action: "ENTER_LONG";
    quantity: string;
  }>;
  riskAllowance: Readonly<{
    contentDigestHex: string;
    organizationId: string;
    accountId: string;
    symbol: string;
    quantity: string;
    state: "ACTIVE" | "CONSUMED" | "REVOKED";
    postureAtIssuance: RuntimePostureV2;
  }>;
  executionPlan: Readonly<{
    contentDigestHex: string;
    organizationId: string;
    accountId: string;
    symbol: string;
    action: "ENTER_LONG";
    direction: "BUY";
    quantity: string;
    expanding: boolean;
  }>;
  identity: ExecutionAdmissionIdentityV2;
  admittedAt: string;
}>;

export type ProveProtectiveExecutionAdmissionV2Input = Readonly<{
  emergency?: boolean;
  context: AuthoritativeRuntimeContextV2;
  currentRuntimePosture: RuntimePostureV2;
  currentDriftPosture: LiveEdgeDriftPostureV2;
  mandate: Readonly<{
    contentDigest: string;
    organizationId: string;
    symbol: string;
    decisionContentDigest: string;
  }>;
  triggerProofDigestHex: string;
  riskAllowance: ProveOrdinaryExecutionAdmissionV2Input["riskAllowance"];
  executionPlan: Readonly<{
    contentDigestHex: string;
    organizationId: string;
    accountId: string;
    symbol: string;
    action: "REDUCE" | "CLOSE";
    direction: "SELL";
    quantity: string;
    expanding: boolean;
  }>;
  identity: ExecutionAdmissionIdentityV2;
  admittedAt: string;
}>;

export type ExecutionAdmissionResultV2 =
  | { ok: true; proof: ExecutionAdmissionProofV2 }
  | { ok: false; code: string };

function requireHex(value: string): boolean {
  return HEX64.test(value);
}

function freezeProof(
  body: Omit<ExecutionAdmissionProofV2, "contentDigestHex">,
): ExecutionAdmissionProofV2 {
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

function identityMismatch(
  left: { organizationId: string; accountId?: string; symbol: string },
  right: { organizationId: string; accountId?: string; symbol: string },
): boolean {
  if (left.organizationId !== right.organizationId || left.symbol !== right.symbol) return true;
  if (left.accountId && right.accountId && left.accountId !== right.accountId) return true;
  return false;
}

export function assertOrdinaryCapitalAdmissionGateV2(
  input: Omit<ProveOrdinaryExecutionAdmissionV2Input, "executionPlan">,
): ExecutionAdmissionResultV2 {
  return proveOrdinaryExecutionAdmissionV2({
    ...input,
    executionPlan: {
      contentDigestHex: input.riskAllowance.contentDigestHex,
      organizationId: input.identity.organizationId,
      accountId: input.identity.accountId,
      symbol: input.identity.symbol,
      action: "ENTER_LONG",
      direction: "BUY",
      quantity: input.identity.quantity,
      expanding: true,
    },
  });
}

export function proveOrdinaryExecutionAdmissionV2(
  input: ProveOrdinaryExecutionAdmissionV2Input,
): ExecutionAdmissionResultV2 {
  if (input.emergency) return { ok: false, code: "EMERGENCY_FLAG_NOT_AUTHORITY" };
  if (input.navigatorOutcome !== "SELECTED_MINIMAL_SUFFICIENT") {
    return { ok: false, code: "NAVIGATOR_RECEIPT_MISSING_OR_INSUFFICIENT" };
  }
  if (input.predictiveAdmissionVerdict !== "ADMITTED") {
    return { ok: false, code: "PREDICTIVE_ADMISSION_NOT_CAPITAL_ELIGIBLE" };
  }
  if (input.context.runtimePosture === "HALT" || input.currentRuntimePosture === "HALT") {
    return { ok: false, code: "RUNTIME_HALTED" };
  }
  if (
    input.currentDriftPosture === "SUPERVISED_STOP" ||
    input.context.driftPosture === "SUPERVISED_STOP"
  ) {
    return { ok: false, code: "DRIFT_SUPERVISED_STOP" };
  }
  if (
    input.currentRuntimePosture === "NO_NEW_RISK" ||
    input.currentRuntimePosture === "CLOSE_ONLY" ||
    input.context.runtimePosture === "NO_NEW_RISK" ||
    input.context.runtimePosture === "CLOSE_ONLY" ||
    input.currentDriftPosture === "NO_NEW_RISK" ||
    input.currentDriftPosture === "CLOSE_ONLY"
  ) {
    return { ok: false, code: "NEW_EXPOSURE_NOT_PERMITTED" };
  }
  if (
    RUNTIME_POSTURE_RANK[input.currentRuntimePosture] >
    RUNTIME_POSTURE_RANK[input.riskAllowance.postureAtIssuance]
  ) {
    return { ok: false, code: "STALE_ALLOWANCE_AFTER_RUNTIME_DOWNGRADE" };
  }
  if (input.riskAllowance.state !== "ACTIVE") return { ok: false, code: "RISK_ALLOWANCE_UNUSABLE" };
  if (input.executionPlan.expanding !== true) {
    return { ok: false, code: "ORDINARY_PLAN_MUST_BE_FRESH_EXPOSURE" };
  }
  if (
    identityMismatch(input.context, input.decision) ||
    identityMismatch(input.decision, input.riskAllowance) ||
    identityMismatch(input.riskAllowance, input.executionPlan) ||
    identityMismatch(input.executionPlan, input.identity)
  ) {
    return { ok: false, code: "IDENTITY_MISMATCH" };
  }
  if (
    !requireHex(input.decision.contentDigestHex) ||
    !requireHex(input.riskAllowance.contentDigestHex) ||
    !requireHex(input.executionPlan.contentDigestHex) ||
    !requireHex(input.context.contentDigestHex)
  ) {
    return { ok: false, code: "DIGEST_INVALID" };
  }
  if (
    compareDecimal(input.executionPlan.quantity, input.riskAllowance.quantity) > 0 ||
    compareDecimal(input.riskAllowance.quantity, input.decision.quantity) > 0 ||
    compareDecimal(input.identity.quantity, input.executionPlan.quantity) > 0
  ) {
    return { ok: false, code: "QUANTITY_AMPLIFICATION_FORBIDDEN" };
  }
  if (input.identity.action !== "ENTER_LONG" || input.identity.direction !== "BUY") {
    return { ok: false, code: "ORDINARY_ACTION_INVALID" };
  }

  return {
    ok: true,
    proof: freezeProof({
      schemaVersion: EXECUTION_ADMISSION_PROOF_SCHEMA_V2,
      authority: "PROOF_ONLY",
      capitalAuthority: "NONE",
      provenance: "ORDINARY",
      runtimeContextDigestHex: input.context.contentDigestHex,
      decisionDigestHex: input.decision.contentDigestHex,
      protectiveMandateDigestHex: null,
      protectiveTriggerDigestHex: null,
      riskAllowanceDigestHex: input.riskAllowance.contentDigestHex,
      executionPlanDigestHex: input.executionPlan.contentDigestHex,
      identity: input.identity,
      admittedAt: input.admittedAt,
    }),
  };
}

export function proveProtectiveExecutionAdmissionV2(
  input: ProveProtectiveExecutionAdmissionV2Input,
): ExecutionAdmissionResultV2 {
  if (input.emergency) return { ok: false, code: "EMERGENCY_FLAG_NOT_AUTHORITY" };
  if (!requireHex(input.mandate.contentDigest) || !requireHex(input.triggerProofDigestHex)) {
    return { ok: false, code: "PROTECTIVE_PROOF_UNRESOLVABLE" };
  }
  if (input.executionPlan.expanding) return { ok: false, code: "PROTECTIVE_PLAN_MUST_REDUCE" };
  if (input.identity.direction !== "SELL")
    return { ok: false, code: "PROTECTIVE_DIRECTION_INVALID" };
  if (input.riskAllowance.state !== "ACTIVE") return { ok: false, code: "RISK_ALLOWANCE_UNUSABLE" };
  if (input.currentRuntimePosture === "HALT" || input.context.runtimePosture === "HALT") {
    return { ok: false, code: "RUNTIME_HALTED" };
  }
  if (
    RUNTIME_POSTURE_RANK[input.currentRuntimePosture] >
    RUNTIME_POSTURE_RANK[input.riskAllowance.postureAtIssuance]
  ) {
    return { ok: false, code: "STALE_ALLOWANCE_AFTER_RUNTIME_DOWNGRADE" };
  }
  if (
    input.mandate.organizationId !== input.context.organizationId ||
    input.mandate.symbol !== input.context.symbol ||
    identityMismatch(input.context, input.executionPlan) ||
    identityMismatch(input.executionPlan, input.identity)
  ) {
    return { ok: false, code: "IDENTITY_MISMATCH" };
  }
  if (LIVE_EDGE_DRIFT_POSTURE_RANK_V2[input.currentDriftPosture] < 0) {
    return { ok: false, code: "DRIFT_POSTURE_INVALID" };
  }

  return {
    ok: true,
    proof: freezeProof({
      schemaVersion: EXECUTION_ADMISSION_PROOF_SCHEMA_V2,
      authority: "PROOF_ONLY",
      capitalAuthority: "NONE",
      provenance: "PROTECTIVE",
      runtimeContextDigestHex: input.context.contentDigestHex,
      decisionDigestHex: input.mandate.decisionContentDigest,
      protectiveMandateDigestHex: input.mandate.contentDigest,
      protectiveTriggerDigestHex: input.triggerProofDigestHex,
      riskAllowanceDigestHex: input.riskAllowance.contentDigestHex,
      executionPlanDigestHex: input.executionPlan.contentDigestHex,
      identity: input.identity,
      admittedAt: input.admittedAt,
    }),
  };
}
