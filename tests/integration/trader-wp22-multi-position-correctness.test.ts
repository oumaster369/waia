import { describe, expect, it } from "vitest";

import {
  assertHtrWp22MultiPositionCorrectnessSemanticsSupported,
  buildHtrWp22InterleavedBars,
  evaluateHtrWp22MultiPositionCorrectness,
  HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA,
  HTR_WP22_MULTI_POSITION_ORDER_SCHEDULE,
  runHtrWp22MultiPositionCorrectness,
  computeHtrWp22MultiPositionCorrectnessSemanticDigest,
} from "@/lib/trader/backtest/htr-wp22-multi-position-correctness";
import {
  buildHtrWp22FixtureManifest,
  HTR_WP22_FIXTURE_INITIAL_CASH_USDT,
  loadHtrWp22FixtureManifest,
  verifyHtrWp22FixtureManifest,
} from "@/lib/trader/backtest/htr-wp22-fixture-manifest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

describe("HTR-WP22 multi-position BTC/ETH correctness", () => {
  it("loads fixture manifest with exact initial cash and digests", () => {
    const manifest = loadHtrWp22FixtureManifest();
    const rebuilt = buildHtrWp22FixtureManifest();
    expect(verifyHtrWp22FixtureManifest(manifest)).toBe(true);
    expect(manifest.initialCashUsdt).toBe(HTR_WP22_FIXTURE_INITIAL_CASH_USDT);
    expect(manifest.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(manifest.legs[0].fileSha256).toBe(rebuilt.legs[0].fileSha256);
    expect(manifest.legs[1].fileSha256).toBe(rebuilt.legs[1].fileSha256);
  });

  it("builds interleaved dual-symbol bar stream", () => {
    const bars = buildHtrWp22InterleavedBars();
    expect(bars.length).toBe(240);
    expect(bars.some((bar) => bar.symbol.startsWith("BTC"))).toBe(true);
    expect(bars.some((bar) => bar.symbol.startsWith("ETH"))).toBe(true);
  });

  it("runs bounded shared-portfolio correctness proof with independent oracle parity", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    expect(result.schemaVersion).toBe(HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA);
    expect(result.initialCash).toBe("100000.00");
    expect(result.initialInventories).toEqual({ BTC: "0", ETH: "0" });
    expect(result.fills.bySymbol.BTCUSDT).toBeGreaterThan(0);
    expect(result.fills.bySymbol.ETHUSDT).toBeGreaterThan(0);
    expect(result.orders.total).toBe(HTR_WP22_MULTI_POSITION_ORDER_SCHEDULE.length);
    expect(result.orders.bySymbol.BTCUSDT).toBe(2);
    expect(result.orders.bySymbol.ETHUSDT).toBe(2);
    expect(result.assertions.bothSymbolsExecuted).toBe(true);
    expect(result.assertions.concurrentExposureObserved).toBe(true);
    expect(result.assertions.noNegativeCash).toBe(true);
    expect(result.assertions.noNegativeBtc).toBe(true);
    expect(result.assertions.noNegativeEth).toBe(true);
    expect(result.assertions.noLeverageBorrowShort).toBe(true);
    expect(result.checkpointResume.semanticParity).toBe("EXACT");
    expect(result.checkpointResume.digestParity).toBe("EXACT");
    expect(Object.values(result.reconciliation).every((entry) => entry === "PASS")).toBe(true);
    expect(evaluateHtrWp22MultiPositionCorrectness(result)).toBe(true);
    expect(result.terminalState).toBe("HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS");
    expect(result.terminalReasons).toEqual(["HTR_WP22_MULTI_POSITION_SCENARIO_COMPLETE"]);
  });

  it("changes semantic digest on one-byte mutation", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const digest = computeHtrWp22MultiPositionCorrectnessSemanticDigest(result);
    const mutated = {
      ...result,
      portfolio: { ...result.portfolio, endingCash: `${result.portfolio.endingCash}0` },
    };
    const mutatedDigest = computeHtrWp22MultiPositionCorrectnessSemanticDigest(mutated);
    expect(mutatedDigest).not.toBe(digest);
  });

  it("rejects malformed fixture manifest payload hash", () => {
    const manifest = loadHtrWp22FixtureManifest();
    const tampered = {
      ...manifest,
      initialCashUsdt: "999999.99" as typeof manifest.initialCashUsdt,
    };
    expect(verifyHtrWp22FixtureManifest(tampered)).toBe(false);
  });

  it("rejects wrong fixture file digest", () => {
    const manifest = loadHtrWp22FixtureManifest();
    const tampered = {
      ...manifest,
      legs: [
        { ...manifest.legs[0], fileSha256: "0".repeat(64) },
        manifest.legs[1],
      ] as typeof manifest.legs,
    };
    expect(verifyHtrWp22FixtureManifest(tampered)).toBe(false);
  });

  it("rejects missing symbol in fixture manifest", () => {
    const manifest = loadHtrWp22FixtureManifest();
    const tampered = {
      ...manifest,
      symbols: ["BTCUSDT"] as unknown as typeof manifest.symbols,
    };
    expect(verifyHtrWp22FixtureManifest(tampered)).toBe(false);
  });

  it("cannot pass when reconciliation is tampered", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      reconciliation: { ...result.reconciliation, cashParity: "FAIL" as const },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("cannot pass when assertions are tampered", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      assertions: { ...result.assertions, bothSymbolsExecuted: false },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("cannot pass with negative inventory assertion failure", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      terminalState: "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS" as const,
      assertions: { ...result.assertions, noNegativeBtc: false },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("cannot pass with borrowed cash assertion failure", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      terminalState: "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS" as const,
      assertions: { ...result.assertions, noNegativeCash: false },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("cannot pass with duplicated fill ledger contamination", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      fills: { ...result.fills, total: result.fills.total + 1 },
      reconciliation: { ...result.reconciliation, orderFillParity: "FAIL" as const },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("fails closed on unsupported semantic reconciliation value", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      reconciliation: {
        ...result.reconciliation,
        cashParity: "UNKNOWN" as unknown as typeof result.reconciliation.cashParity,
      },
    };
    expect(() => assertHtrWp22MultiPositionCorrectnessSemanticsSupported(tampered)).toThrow(
      "UNSUPPORTED_RECONCILIATION_VALUE",
    );
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("fails closed on unsupported schema version", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      schemaVersion: "unsupported/v0" as typeof result.schemaVersion,
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("cannot claim PASS with failed reconciliation while terminalState is tampered", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const tampered = {
      ...result,
      terminalState: "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS" as const,
      reconciliation: { ...result.reconciliation, pnlParity: "FAIL" as const },
    };
    expect(evaluateHtrWp22MultiPositionCorrectness(tampered)).toBe(false);
  });

  it("binds payloadSha256 to semantic body", async () => {
    const result = await runHtrWp22MultiPositionCorrectness();
    const { payloadSha256, ...body } = result;
    expect(payloadSha256).toBe(computeSemanticSha256Hex(body));
  });
});
