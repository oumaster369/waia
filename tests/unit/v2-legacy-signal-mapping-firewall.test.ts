import { describe, expect, it } from "vitest";

import { mapSignalToLiveSubmitOrder } from "@/lib/trader/live/signal-to-live-order";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  assertHypothesisConfidenceNonAuthoritative,
  assertLegacySignalMappingNotV2CapitalAuthority,
  AuthorityChainViolationError,
  V2_CAPITAL_AUTHORITY_PATH,
} from "@/lib/trader/risk/authority-chain";

const SIGNAL: StrategySignal = {
  strategySignalId: "sig-1",
  organizationId: "org",
  strategyId: MEAN_REVERSION_V0,
  strategyVersion: "1.0.0",
  symbol: "BTC/USDT",
  outcome: "SIGNAL",
  side: "buy",
  confidence: "0.5",
  expectedEdge: "10",
  maxRisk: "100",
  reasonCodes: [],
  msvId: "msv",
  featureSetId: "fs",
  evaluatedAt: "2026-08-10T00:00:00.000Z",
};

describe("DEE-521/528 legacy signal mapping V2 firewall", () => {
  it("signal-to-live-order is legacy V1 and fails closed under V2 authority identity", () => {
    expect(() =>
      mapSignalToLiveSubmitOrder({
        signal: SIGNAL,
        accountKey: "a",
        referencePrice: "50000",
        defaultQuantity: "1",
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: "1.0.0",
        credentialId: "cred",
        capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      }),
    ).toThrow(AuthorityChainViolationError);
  });

  it("signal-to-live-order may use maxRisk only on legacy/non-V2 path", () => {
    const order = mapSignalToLiveSubmitOrder({
      signal: SIGNAL,
      accountKey: "a",
      referencePrice: "50000",
      defaultQuantity: "1",
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "1.0.0",
      credentialId: "cred",
      capitalAuthorityPath: "v1",
    });
    expect(order?.quantity).toBe("0.002");
  });

  it("paper signal-to-order fails closed under V2 authority identity", () => {
    expect(() =>
      mapSignalToSubmitOrder({
        signal: SIGNAL,
        accountKey: "a",
        referencePrice: "50000",
        executionMode: "paper",
        defaultQuantity: "1",
        capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      }),
    ).toThrow(AuthorityChainViolationError);
  });

  it("hypothesis confidence used as probability/capital authority fails closed", () => {
    expect(() =>
      assertHypothesisConfidenceNonAuthoritative({
        convictionValue: 0.99,
        usedAsProbabilityOrCapitalAuthority: true,
      }),
    ).toThrow(AuthorityChainViolationError);
    expect(() =>
      assertHypothesisConfidenceNonAuthoritative({
        convictionValue: 0.99,
        usedAsProbabilityOrCapitalAuthority: false,
      }),
    ).not.toThrow();
  });

  it("legacy mapping assert rejects V2 identity", () => {
    expect(() => assertLegacySignalMappingNotV2CapitalAuthority(V2_CAPITAL_AUTHORITY_PATH)).toThrow(
      /cannot claim V2/,
    );
  });
});
