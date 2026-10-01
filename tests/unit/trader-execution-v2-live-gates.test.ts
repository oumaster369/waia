import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assembleExecutionV2LiveGateFacts,
  evaluateExecutionV2LiveGates,
  EXECUTION_V2_LIVE_GATE_REASONS,
  type ExecutionV2LiveGateFacts,
  type ExecutionV2LiveGateReason,
} from "@/lib/trader/execution/v2/live-gates";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";

const ORG = "00000000-0000-4000-8000-000000115104";

function tradeMetadata(scopes: readonly string[] = ["read", "trade"]): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(
      buildHtxPermissionMetadata({
        exchangeAccountId: "acct-1",
        scopes,
      }),
    ),
  ) as Record<string, unknown>;
}

function admitted(): ExecutionV2LiveGateFacts {
  return {
    executionMode: "live",
    organizationId: ORG,
    org0OrganizationId: ORG,
    liveEnable: { state: "ENABLED", maxNotionalCap: "25" },
    strategyId: "strategy-1",
    strategyVersion: "v1",
    promotion: { strategyId: "strategy-1", strategyVersion: "v1", state: "EFFECTIVE" },
    credentialId: "cred-1",
    credential: {
      status: "active",
      venue: "htx",
      exchangeAccountId: "acct-1",
      permissionMetadata: tradeMetadata(),
    },
    requestedNotional: "25",
  };
}

describe("Execution V2 live gates (DEE-1151 P0-4)", () => {
  it("refuses otherwise-complete metadata until exact signer authority exists", () => {
    expect(evaluateExecutionV2LiveGates(admitted())).toEqual({ ok: false, reason: "SIGNER_BINDING_UNAVAILABLE" });
    expect(
      evaluateExecutionV2LiveGates({ ...admitted(), requestedNotional: "24.99999999" }),
    ).toEqual({
      ok: false, reason: "SIGNER_BINDING_UNAVAILABLE",
    });
  });

  it.each<
    [
      string,
      (facts: ExecutionV2LiveGateFacts) => ExecutionV2LiveGateFacts,
      ExecutionV2LiveGateReason,
    ]
  >([
    ["paper mode", (facts) => ({ ...facts, executionMode: "paper" }), "LIVE_MODE_REQUIRED"],
    ["unset org0", (facts) => ({ ...facts, org0OrganizationId: null }), "ORG0_ALLOWLIST_UNSET"],
    [
      "other org",
      (facts) => ({ ...facts, org0OrganizationId: "other-org" }),
      "ORG0_NOT_ALLOWLISTED",
    ],
    ["no live enable", (facts) => ({ ...facts, liveEnable: null }), "LIVE_ENABLE_ABSENT"],
    [
      "live disabled",
      (facts) => ({ ...facts, liveEnable: { state: "DISABLED", maxNotionalCap: "25" } }),
      "LIVE_ENABLE_NOT_ENABLED",
    ],
    [
      "cooling off",
      (facts) => ({ ...facts, liveEnable: { state: "COOLING_OFF", maxNotionalCap: "25" } }),
      "LIVE_ENABLE_NOT_ENABLED",
    ],
    [
      "zero cap",
      (facts) => ({ ...facts, liveEnable: { state: "ENABLED", maxNotionalCap: "0" } }),
      "LIVE_NOTIONAL_CAP_NOT_POSITIVE",
    ],
    [
      "blank cap",
      (facts) => ({ ...facts, liveEnable: { state: "ENABLED", maxNotionalCap: "" } }),
      "LIVE_NOTIONAL_CAP_NOT_POSITIVE",
    ],
    ["missing strategy", (facts) => ({ ...facts, strategyId: "  " }), "STRATEGY_CONTEXT_ABSENT"],
    [
      "missing version",
      (facts) => ({ ...facts, strategyVersion: null }),
      "STRATEGY_CONTEXT_ABSENT",
    ],
    ["no promotion", (facts) => ({ ...facts, promotion: null }), "PROMOTION_NOT_EFFECTIVE"],
    [
      "draft promotion",
      (facts) => ({
        ...facts,
        promotion: { strategyId: "strategy-1", strategyVersion: "v1", state: "DRAFT" },
      }),
      "PROMOTION_NOT_EFFECTIVE",
    ],
    [
      "version mismatch",
      (facts) => ({
        ...facts,
        promotion: { strategyId: "strategy-1", strategyVersion: "v0", state: "EFFECTIVE" },
      }),
      "PROMOTION_VERSION_MISMATCH",
    ],
    [
      "missing credential",
      (facts) => ({ ...facts, credentialId: null, credential: null }),
      "CREDENTIAL_REQUIRED",
    ],
    [
      "revoked credential",
      (facts) => ({ ...facts, credential: { ...facts.credential!, status: "revoked" } }),
      "CREDENTIAL_REQUIRED",
    ],
    [
      "wrong venue",
      (facts) => ({ ...facts, credential: { ...facts.credential!, venue: "binance" } }),
      "CREDENTIAL_REQUIRED",
    ],
    [
      "read-only scope",
      (facts) => ({
        ...facts,
        credential: { ...facts.credential!, permissionMetadata: tradeMetadata(["read"]) },
      }),
      "CREDENTIAL_NOT_TRADE_SCOPED",
    ],
    [
      "unreadable metadata",
      (facts) => ({ ...facts, credential: { ...facts.credential!, permissionMetadata: null } }),
      "CREDENTIAL_NOT_TRADE_SCOPED",
    ],
    [
      "notional above cap",
      (facts) => ({ ...facts, requestedNotional: "25.00000001" }),
      "LIVE_NOTIONAL_CAP_EXCEEDED",
    ],
    [
      "unreadable notional",
      (facts) => ({ ...facts, requestedNotional: "nope" }),
      "LIVE_NOTIONAL_CAP_EXCEEDED",
    ],
  ])("refuses when %s", (_label, mutate, reason) => {
    expect(EXECUTION_V2_LIVE_GATE_REASONS).toContain(reason);
    expect(evaluateExecutionV2LiveGates(mutate(admitted()))).toEqual({ ok: false, reason });
  });

  it("treats zero or several EFFECTIVE promotions as not effective", () => {
    const base = {
      executionMode: "live" as const,
      organizationId: ORG,
      org0OrganizationId: ORG,
      requestedNotional: "25",
      strategyId: "strategy-1",
      strategyVersion: "v1",
      credentialId: "cred-1",
      liveEnable: { state: "ENABLED", maxNotionalCap: "25" },
      credential: admitted().credential,
    };
    const row = { strategyId: "strategy-1", strategyVersion: "v1", state: "EFFECTIVE" };
    expect(
      evaluateExecutionV2LiveGates(
        assembleExecutionV2LiveGateFacts({ ...base, effectivePromotions: [] }),
      ).ok,
    ).toBe(false);
    expect(
      evaluateExecutionV2LiveGates(
        assembleExecutionV2LiveGateFacts({ ...base, effectivePromotions: [row, row] }),
      ),
    ).toEqual({ ok: false, reason: "PROMOTION_NOT_EFFECTIVE" });
    expect(
      evaluateExecutionV2LiveGates(
        assembleExecutionV2LiveGateFacts({ ...base, effectivePromotions: [row] }),
      ),
    ).toEqual({ ok: false, reason: "SIGNER_BINDING_UNAVAILABLE" });
  });

  it("keeps the authoritative check inside the live bind transaction", () => {
    const authority = readFileSync(
      resolve(process.cwd(), "lib/trader/execution/v2/authority-postgres.ts"),
      "utf8",
    );
    const live = readFileSync(
      resolve(process.cwd(), "lib/trader/live/build-live-cli-deps.ts"),
      "utf8",
    );
    const paper = readFileSync(
      resolve(process.cwd(), "lib/trader/paper/build-worker-deps.ts"),
      "utf8",
    );
    const gates = readFileSync(
      resolve(process.cwd(), "lib/trader/execution/v2/live-gates.ts"),
      "utf8",
    );
    expect(authority).toContain('input.executionMode === "live"');
    expect(authority).toContain("recordExecutionV2LiveGateVerdictPostgres");
    expect(live).toContain("createAssertExecutionV2LiveAuthorized");
    expect(paper).not.toContain("recordExecutionV2LiveGateVerdictPostgres");
    expect(paper).not.toContain("createAssertExecutionV2LiveAuthorized");
    expect(gates).not.toContain("encryptedPayload");
    expect(gates).not.toContain("getDecryptedCredentials");
  });
});
