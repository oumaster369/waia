import { describe, expect, it } from "vitest";

import {
  attributeLegs,
  riskStateMatchesLot,
  type AttributionOrder,
} from "@/lib/trader/admin-console/attribution/trade-attribution";

const credential = { id: "cred-1", organizationId: "org-1", exchangeAccountId: "acct-1" };
const otherCredential = { id: "cred-2", organizationId: "org-1", exchangeAccountId: "acct-2" };

function order(overrides: Partial<AttributionOrder> = {}): AttributionOrder {
  return {
    id: "order-1",
    organizationId: "org-1",
    historicalRunId: null,
    executionMode: "live",
    credentialId: "cred-1",
    strategySignalId: "signal-1",
    symbol: "BTCUSDT",
    ...overrides,
  };
}

describe("trade attribution", () => {
  it("attributes several fills of one order to that order's account", () => {
    const result = attributeLegs(
      [
        {
          id: "l1",
          organizationId: "org-1",
          orderId: "order-1",
          strategySignalId: null,
          symbol: "BTCUSDT",
          accountKey: null,
        },
        {
          id: "l2",
          organizationId: "org-1",
          orderId: "order-1",
          strategySignalId: null,
          symbol: "BTCUSDT",
          accountKey: null,
        },
      ],
      [order()],
      [credential],
    );
    expect(result).toMatchObject({
      state: "attributed",
      mode: "live",
      exchangeAccountId: "acct-1",
    });
  });

  it("does not guess when one signal matches two accounts", () => {
    const result = attributeLegs(
      [
        {
          id: "l1",
          organizationId: "org-1",
          orderId: null,
          strategySignalId: "signal-1",
          symbol: "BTCUSDT",
          accountKey: null,
        },
      ],
      [order(), order({ id: "order-2", credentialId: "cred-2" })],
      [credential, otherCredential],
    );
    expect(result.state).toBe("ambiguous");
  });

  it("keeps a historical order out of live and still uses a revoked credential id", () => {
    const historical = attributeLegs(
      [
        {
          id: "l1",
          organizationId: "org-1",
          orderId: "order-1",
          strategySignalId: null,
          symbol: "BTCUSDT",
          accountKey: null,
        },
      ],
      [order({ historicalRunId: "run-1", executionMode: "live" })],
      [credential],
    );
    expect(historical).toMatchObject({ state: "attributed", mode: "history" });
    const revoked = attributeLegs(
      [
        {
          id: "l1",
          organizationId: "org-1",
          orderId: "order-1",
          strategySignalId: null,
          symbol: "BTCUSDT",
          accountKey: null,
        },
      ],
      [order()],
      [credential],
    );
    expect(revoked).toMatchObject({ state: "attributed", exchangeAccountId: "acct-1" });
  });

  it("leaves a leg with no candidate unattributed", () => {
    const result = attributeLegs(
      [
        {
          id: "l1",
          organizationId: "org-1",
          orderId: null,
          strategySignalId: "missing",
          symbol: "BTCUSDT",
          accountKey: "acct-1",
        },
      ],
      [order()],
      [credential],
    );
    expect(result.state).toBe("unattributed");
  });

  it("matches risk state only to the lot account key", () => {
    expect(riskStateMatchesLot({ lotAccountKey: "paper-1", riskAccountId: "paper-1" })).toBe(true);
    expect(riskStateMatchesLot({ lotAccountKey: "paper-1", riskAccountId: "exchange-1" })).toBe(
      false,
    );
    expect(riskStateMatchesLot({ lotAccountKey: "paper-1", riskAccountId: null })).toBe(false);
  });
});
