import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";

const ORG = "00000000-0000-4000-8000-0000000257b";

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("trader signal-to-order mapper (DEE-257)", () => {
  it("maps SIGNAL to SubmitOrderInput with strategySignalId", () => {
    const fixture = loadFixture();
    const { signal, msv, features } = runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "mapper-id",
    });

    const submit = mapSignalToSubmitOrder({
      signal,
      accountKey: "acct-1",
      referencePrice: features.features.close,
      executionMode: "mock",
      defaultQuantity: "0.01",
      tradingPermission: msv.derived.tradingPermission,
      clientOrderId: "client-mapper-257",
      idempotencyKey: "idem-mapper-257",
    });

    expect(submit).not.toBeNull();
    expect(submit?.strategySignalId).toBe(signal.strategySignalId);
    expect(submit?.symbol).toBe("BTC/USDT");
    expect(submit?.type).toBe("market");
    expect(submit?.quantity).toBe("0.01");
  });

  it("returns null for NO_SIGNAL", () => {
    const submit = mapSignalToSubmitOrder({
      signal: {
        strategySignalId: "sig-no",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        organizationId: ORG,
        symbol: "BTC/USDT",
        outcome: "NO_SIGNAL",
        reasonCodes: ["STRAT_MR_ZSCORE_NEUTRAL"],
        msvId: "msv-no",
        featureSetId: "feat-no",
        evaluatedAt: "2026-01-01T00:25:00.000Z",
      },
      accountKey: "acct-1",
      referencePrice: "64000.00",
      executionMode: "mock",
      defaultQuantity: "0.01",
    });

    expect(submit).toBeNull();
  });

  it("returns null when trading permission is PAPER_ONLY (fail-closed)", () => {
    const submit = mapSignalToSubmitOrder({
      signal: {
        strategySignalId: "sig-paper",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        organizationId: ORG,
        symbol: "BTC/USDT",
        outcome: "SIGNAL",
        side: "buy",
        reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
        msvId: "msv-paper",
        featureSetId: "feat-paper",
        evaluatedAt: "2026-01-01T00:25:00.000Z",
      },
      accountKey: "acct-1",
      referencePrice: "64000.00",
      executionMode: "mock",
      defaultQuantity: "0.01",
      tradingPermission: "PAPER_ONLY",
    });

    expect(submit).toBeNull();
  });
});
