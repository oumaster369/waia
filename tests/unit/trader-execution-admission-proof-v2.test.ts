import { describe, expect, it } from "vitest";

import {
  proveOrdinaryExecutionAdmissionV2,
  proveProtectiveExecutionAdmissionV2,
  type ProveOrdinaryExecutionAdmissionV2Input,
  type ProveProtectiveExecutionAdmissionV2Input,
} from "@/lib/trader/execution/v2/execution-admission-proof-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const ORG = "org-1";
const ACCOUNT = "account-1";
const SYMBOL = "BTCUSDT";

function context() {
  return buildAuthoritativeRuntimeContextV2({
    organizationId: ORG,
    accountId: ACCOUNT,
    symbol: SYMBOL,
    pitAnchor: "2026-02-01T12:00:00.000Z",
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    runtimeAssessmentDigestHex: DIGEST_A,
    driftPosture: "NORMAL",
    driftRestrictionDigestHex: DIGEST_A,
    qualificationTupleDigestHex: DIGEST_A,
    packageDigestHex: DIGEST_A,
    informationContractDigestHex: DIGEST_A,
    informationNeedPlanDigestHex: DIGEST_A,
    releaseDigestHex: DIGEST_A,
  });
}

function ordinary(
  patch: Partial<ProveOrdinaryExecutionAdmissionV2Input> = {},
): ProveOrdinaryExecutionAdmissionV2Input {
  return {
    context: context(),
    currentRuntimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    currentDriftPosture: "NORMAL",
    navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT",
    predictiveAdmissionVerdict: "ADMITTED",
    decision: {
      contentDigestHex: DIGEST_B,
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      action: "ENTER_LONG",
      quantity: "0.02",
    },
    riskAllowance: {
      contentDigestHex: DIGEST_C,
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      quantity: "0.01",
      state: "ACTIVE",
      postureAtIssuance: "FULL_ANALYSIS_AND_NEW_RISK",
    },
    executionPlan: {
      contentDigestHex: DIGEST_D,
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      action: "ENTER_LONG",
      direction: "BUY",
      quantity: "0.01",
      expanding: true,
    },
    identity: {
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      action: "ENTER_LONG",
      direction: "BUY",
      quantity: "0.01",
      externalEffectId: "effect-1",
    },
    admittedAt: "2026-02-01T12:00:00.000Z",
    ...patch,
  };
}

function protective(
  patch: Partial<ProveProtectiveExecutionAdmissionV2Input> = {},
): ProveProtectiveExecutionAdmissionV2Input {
  return {
    context: context(),
    currentRuntimePosture: "CLOSE_ONLY",
    currentDriftPosture: "CLOSE_ONLY",
    mandate: {
      contentDigest: DIGEST_B,
      organizationId: ORG,
      symbol: SYMBOL,
      decisionContentDigest: DIGEST_A,
    },
    triggerProofDigestHex: DIGEST_C,
    riskAllowance: {
      contentDigestHex: DIGEST_C,
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      quantity: "0.01",
      state: "ACTIVE",
      postureAtIssuance: "CLOSE_ONLY",
    },
    executionPlan: {
      contentDigestHex: DIGEST_D,
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      action: "REDUCE",
      direction: "SELL",
      quantity: "0.01",
      expanding: false,
    },
    identity: {
      organizationId: ORG,
      accountId: ACCOUNT,
      symbol: SYMBOL,
      action: "REDUCE",
      direction: "SELL",
      quantity: "0.01",
      externalEffectId: "protect-1",
    },
    admittedAt: "2026-02-01T12:00:00.000Z",
    ...patch,
  };
}

describe("DEE-639 ExecutionAdmissionProofV2", () => {
  it("admits the ordinary Decision → Risk → Execution chain and pins digests", () => {
    const result = proveOrdinaryExecutionAdmissionV2(ordinary());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected proof");
    expect(result.proof.authority).toBe("PROOF_ONLY");
    expect(result.proof.capitalAuthority).toBe("NONE");
    expect(result.proof.provenance).toBe("ORDINARY");
    expect(result.proof.decisionDigestHex).toBe(DIGEST_B);
    expect(result.proof.riskAllowanceDigestHex).toBe(DIGEST_C);
    expect(result.proof.executionPlanDigestHex).toBe(DIGEST_D);
    const replay = proveOrdinaryExecutionAdmissionV2(ordinary());
    if (!replay.ok) throw new Error("expected replay");
    expect(replay.proof.contentDigestHex).toBe(result.proof.contentDigestHex);
  });

  it("refuses emergency, StrategySignal-ineligible PA, halt, restriction, consumed allowance, mismatch and amplification", () => {
    expect(proveOrdinaryExecutionAdmissionV2(ordinary({ emergency: true }))).toEqual({
      ok: false,
      code: "EMERGENCY_FLAG_NOT_AUTHORITY",
    });
    expect(
      proveOrdinaryExecutionAdmissionV2(ordinary({ predictiveAdmissionVerdict: "RESEARCH_ONLY" })),
    ).toEqual({ ok: false, code: "PREDICTIVE_ADMISSION_NOT_CAPITAL_ELIGIBLE" });
    expect(
      proveOrdinaryExecutionAdmissionV2(ordinary({ navigatorOutcome: "INSUFFICIENT_EVIDENCE" })),
    ).toEqual({ ok: false, code: "NAVIGATOR_RECEIPT_MISSING_OR_INSUFFICIENT" });
    expect(proveOrdinaryExecutionAdmissionV2(ordinary({ currentRuntimePosture: "HALT" }))).toEqual({
      ok: false,
      code: "RUNTIME_HALTED",
    });
    expect(
      proveOrdinaryExecutionAdmissionV2(ordinary({ currentDriftPosture: "SUPERVISED_STOP" })),
    ).toEqual({ ok: false, code: "DRIFT_SUPERVISED_STOP" });
    expect(
      proveOrdinaryExecutionAdmissionV2(ordinary({ currentRuntimePosture: "NO_NEW_RISK" })),
    ).toEqual({ ok: false, code: "NEW_EXPOSURE_NOT_PERMITTED" });
    expect(
      proveOrdinaryExecutionAdmissionV2(
        ordinary({
          riskAllowance: {
            ...ordinary().riskAllowance,
            state: "CONSUMED",
          },
        }),
      ),
    ).toEqual({ ok: false, code: "RISK_ALLOWANCE_UNUSABLE" });
    expect(
      proveOrdinaryExecutionAdmissionV2(
        ordinary({
          identity: { ...ordinary().identity, symbol: "ETHUSDT" },
        }),
      ),
    ).toEqual({ ok: false, code: "IDENTITY_MISMATCH" });
    expect(
      proveOrdinaryExecutionAdmissionV2(
        ordinary({
          identity: { ...ordinary().identity, quantity: "0.02" },
        }),
      ),
    ).toEqual({ ok: false, code: "QUANTITY_AMPLIFICATION_FORBIDDEN" });
  });

  it("admits the protective mandate+trigger path and refuses emergency, expanding, and stale allowance", () => {
    const admitted = proveProtectiveExecutionAdmissionV2(protective());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error("expected protective proof");
    expect(admitted.proof.provenance).toBe("PROTECTIVE");
    expect(admitted.proof.protectiveMandateDigestHex).toBe(DIGEST_B);
    expect(proveProtectiveExecutionAdmissionV2(protective({ emergency: true }))).toEqual({
      ok: false,
      code: "EMERGENCY_FLAG_NOT_AUTHORITY",
    });
    expect(
      proveProtectiveExecutionAdmissionV2(
        protective({
          executionPlan: { ...protective().executionPlan, expanding: true },
        }),
      ),
    ).toEqual({ ok: false, code: "PROTECTIVE_PLAN_MUST_REDUCE" });
    expect(
      proveProtectiveExecutionAdmissionV2(
        protective({
          currentRuntimePosture: "HALT",
          riskAllowance: {
            ...protective().riskAllowance,
            postureAtIssuance: "FULL_ANALYSIS_AND_NEW_RISK",
          },
        }),
      ),
    ).toEqual({ ok: false, code: "RUNTIME_HALTED" });
    expect(
      proveProtectiveExecutionAdmissionV2(
        protective({
          currentRuntimePosture: "CLOSE_ONLY",
          riskAllowance: {
            ...protective().riskAllowance,
            postureAtIssuance: "FULL_ANALYSIS_AND_NEW_RISK",
          },
        }),
      ),
    ).toEqual({ ok: false, code: "STALE_ALLOWANCE_AFTER_RUNTIME_DOWNGRADE" });
  });
});
