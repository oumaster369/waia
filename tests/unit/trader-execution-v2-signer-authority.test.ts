import { describe, expect, it } from "vitest";

import {
  evaluateExecutionV2LiveGates,
  EXECUTION_V2_LIVE_GATE_REASONS,
  type ExecutionV2LiveGateFacts,
} from "@/lib/trader/execution/v2/live-gates";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";

const organizationId = "00000000-0000-4000-8000-000000116101";

function otherwiseAdmittedLiveFacts(): ExecutionV2LiveGateFacts {
  return {
    executionMode: "live",
    organizationId,
    org0OrganizationId: organizationId,
    liveEnable: { state: "ENABLED", maxNotionalCap: "25" },
    strategyId: "dee1161-synthetic-strategy",
    strategyVersion: "v1",
    promotion: {
      strategyId: "dee1161-synthetic-strategy",
      strategyVersion: "v1",
      state: "EFFECTIVE",
    },
    credentialId: "00000000-0000-4000-8000-000000116102",
    credential: {
      status: "active",
      venue: "htx",
      exchangeAccountId: "synthetic-account",
      permissionMetadata: JSON.parse(JSON.stringify(buildHtxPermissionMetadata({
        exchangeAccountId: "synthetic-account",
        scopes: ["read", "trade"],
      }))) as Record<string, unknown>,
    },
    requestedNotional: "25",
  };
}

describe("Execution V2 signer-authority refusal (DEE-1161)", () => {
  it("refuses otherwise-valid metadata-only live facts when exact signer authority is absent", () => {
    expect(EXECUTION_V2_LIVE_GATE_REASONS).toContain("SIGNER_BINDING_UNAVAILABLE");
    expect(evaluateExecutionV2LiveGates(otherwiseAdmittedLiveFacts())).toEqual({
      ok: false,
      reason: "SIGNER_BINDING_UNAVAILABLE",
    });
  });

  it("keeps an actual malformed or read-only credential as its concrete credential fault", () => {
    const facts = otherwiseAdmittedLiveFacts();
    const readonlyCredential = {
      ...facts.credential!,
      permissionMetadata: JSON.parse(JSON.stringify(buildHtxPermissionMetadata({
        exchangeAccountId: "synthetic-account",
        scopes: ["read"],
      }))) as Record<string, unknown>,
    };

    expect(evaluateExecutionV2LiveGates({ ...facts, credential: readonlyCredential })).toEqual({
      ok: false,
      reason: "CREDENTIAL_NOT_TRADE_SCOPED",
    });
  });
});
