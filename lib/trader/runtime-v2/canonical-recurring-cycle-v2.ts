import { composeCanonicalEpistemicSpineV2 } from "@/lib/trader/runtime-v2/canonical-epistemic-compose-v2";
import type { ComposeCanonicalEpistemicSpineV2Input } from "@/lib/trader/runtime-v2/canonical-epistemic-compose-v2";
import {
  proveProtectiveExecutionAdmissionV2,
  assertOrdinaryCapitalAdmissionGateV2,
  type ProveOrdinaryExecutionAdmissionV2Input,
  type ProveProtectiveExecutionAdmissionV2Input,
} from "@/lib/trader/execution/v2/execution-admission-proof-v2";
import {
  runDecisionCapitalAuthorityV2,
  type CanonicalDecisionCapitalAuthorityV2Deps,
  type DecisionCapitalAuthorityV2Result,
  type DecisionCapitalRequestV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

export type CanonicalRecurringCycleV2Result =
  | Readonly<{
      status: "NO_TRADE";
      stage: "EPISTEMIC" | "ADMISSION" | "FORECAST" | "DECISION" | "RISK";
      reasonCodes: readonly string[];
    }>
  | Readonly<{
      status: "EXECUTION_BOUND";
      admissionProofDigestHex: string;
      capital: Extract<DecisionCapitalAuthorityV2Result, { status: "EXECUTION_BOUND" }>;
    }>;

export async function runCanonicalOrdinaryCapitalCycleV2(input: {
  epistemic: ComposeCanonicalEpistemicSpineV2Input;
  admissionTemplate: Omit<
    ProveOrdinaryExecutionAdmissionV2Input,
    "decision" | "riskAllowance" | "executionPlan" | "identity"
  > &
    Pick<ProveOrdinaryExecutionAdmissionV2Input, "identity">;
  capitalDeps: CanonicalDecisionCapitalAuthorityV2Deps;
  capitalRequest: DecisionCapitalRequestV2;
}): Promise<CanonicalRecurringCycleV2Result> {
  const compose = composeCanonicalEpistemicSpineV2(input.epistemic);
  if (compose.status !== "ADMITTED") {
    return { status: "NO_TRADE", stage: "EPISTEMIC", reasonCodes: compose.reasonCodes };
  }

  const boundContext = input.epistemic.context;
  const navigatorOutcome = input.epistemic.navigatorReceipt?.outcome ?? "UNKNOWN_UNRESOLVED";
  if (
    input.admissionTemplate.context.contentDigestHex !== boundContext.contentDigestHex ||
    input.admissionTemplate.currentRuntimePosture !== boundContext.runtimePosture ||
    input.admissionTemplate.currentDriftPosture !== boundContext.driftPosture ||
    input.admissionTemplate.predictiveAdmissionVerdict !==
      input.epistemic.predictiveAdmissionVerdict ||
    input.admissionTemplate.navigatorOutcome !== navigatorOutcome
  ) {
    return {
      status: "NO_TRADE",
      stage: "ADMISSION",
      reasonCodes: ["ADMISSION_INPUT_MISMATCH"],
    };
  }

  const boundAdmission = {
    ...input.admissionTemplate,
    context: boundContext,
    currentRuntimePosture: boundContext.runtimePosture,
    currentDriftPosture: boundContext.driftPosture,
    navigatorOutcome,
    predictiveAdmissionVerdict: input.epistemic.predictiveAdmissionVerdict,
  };

  let admissionProofDigestHex: string | null = null;
  const execute = input.capitalDeps.execute;
  const gated: CanonicalDecisionCapitalAuthorityV2Deps = {
    ...input.capitalDeps,
    execute: async (stage) => {
      const admission = assertOrdinaryCapitalAdmissionGateV2({
        ...boundAdmission,
        decision: {
          contentDigestHex: stage.decision.contentDigestHex,
          organizationId: stage.request.organizationId,
          accountId: stage.request.accountId,
          symbol: stage.request.symbol,
          action: "ENTER_LONG",
          quantity: stage.decision.qualifiedQuantity,
        },
        riskAllowance: {
          contentDigestHex: stage.permission.riskAllowanceContentDigestHex,
          organizationId: stage.request.organizationId,
          accountId: stage.request.accountId,
          symbol: stage.request.symbol,
          quantity: stage.permission.approvedQualifiedQuantity,
          state: "ACTIVE",
          postureAtIssuance: boundContext.runtimePosture,
        },
        identity: {
          ...input.admissionTemplate.identity,
          quantity: stage.permission.approvedQualifiedQuantity,
        },
      });
      if (!admission.ok) {
        throw new Error(`EXECUTION_ADMISSION_REFUSED:${admission.code}`);
      }
      admissionProofDigestHex = admission.gate.contentDigestHex;
      return execute(stage);
    },
  };

  let capital: DecisionCapitalAuthorityV2Result;
  try {
    capital = await runDecisionCapitalAuthorityV2(gated, input.capitalRequest);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EXECUTION_ADMISSION_REFUSED:")) {
      return {
        status: "NO_TRADE",
        stage: "ADMISSION",
        reasonCodes: [error.message.slice("EXECUTION_ADMISSION_REFUSED:".length)],
      };
    }
    throw error;
  }
  if (capital.status === "NO_TRADE") {
    return {
      status: "NO_TRADE",
      stage: capital.stage,
      reasonCodes: capital.reasonCodes,
    };
  }
  if (!admissionProofDigestHex) {
    return {
      status: "NO_TRADE",
      stage: "ADMISSION",
      reasonCodes: ["EXECUTION_ADMISSION_PROOF_MISSING"],
    };
  }
  return {
    status: "EXECUTION_BOUND",
    admissionProofDigestHex,
    capital,
  };
}

export function refuseProtectiveEmergency(input: ProveProtectiveExecutionAdmissionV2Input) {
  return proveProtectiveExecutionAdmissionV2(input);
}
