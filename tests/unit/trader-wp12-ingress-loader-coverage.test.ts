/**
 * HTR-WP12 — ingress gate wired on historical loaders.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadQualificationBars } from "@/lib/trader/backtest/replay-qualification-harness";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { HistoricalBarSource } from "@/lib/trader/market-data/historical-bar-source";
import * as barIntegrityGate from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { makeSyntheticBars } from "@/tests/unit/helpers/wp11-wp12-fixture";

describe("HTR-WP12 ingress loader coverage", () => {
  it("HistoricalBarSource invokes ingress gate at construction", () => {
    const spy = vi.spyOn(barIntegrityGate, "assertIngestBarsIntegrityOrThrow");
    const bars = makeSyntheticBars(25);
    new HistoricalBarSource({ bars, cycleIdPrefix: "wp12-gate" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        bars,
        expectedSymbol: "BTC/USDT",
        expectedInterval: "1m",
      }),
    );
    spy.mockRestore();
  });

  it("HistoricalBarReplaySource invokes ingress gate at construction", () => {
    const spy = vi.spyOn(barIntegrityGate, "assertIngestBarsIntegrityOrThrow");
    const bars = makeSyntheticBars(25);
    new HistoricalBarReplaySource({ bars, cycleIdPrefix: "wp12-gate" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        bars,
        expectedSymbol: "BTC/USDT",
        expectedInterval: "1m",
      }),
    );
    spy.mockRestore();
  });

  it("HistoricalBarSource rejects bars that fail ingress integrity", () => {
    const bars = makeSyntheticBars(25);
    bars[0] = { ...bars[0]!, symbol: "ETH/USDT" };
    expect(() => new HistoricalBarSource({ bars })).toThrow(/HTR_WP12_INGRESS_IDENTITY_MISMATCH/);
  });

  it("HistoricalBarReplaySource rejects bars that fail ingress integrity", () => {
    const bars = makeSyntheticBars(25);
    bars[0] = { ...bars[0]!, volume: "-5" };
    expect(() => new HistoricalBarReplaySource({ bars })).toThrow(
      /HTR_WP12_INGRESS_NEGATIVE_VOLUME/,
    );
  });

  it("loadQualificationBars invokes ingress gate before returning bars", () => {
    const spy = vi.spyOn(barIntegrityGate, "assertIngestBarsIntegrityOrThrow");
    const bars = makeSyntheticBars(25);
    const tempDir = mkdtempSync(path.join(tmpdir(), "wp12-qual-bars-"));
    const datasetPath = path.join(tempDir, "synthetic-qualification-bars.json");
    writeFileSync(datasetPath, JSON.stringify({ bars }));

    expect(() => loadQualificationBars("N1", datasetPath)).toThrow(/sha256 mismatch/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("loadQualificationBars runs gate when digest matches approved N1 fixture", () => {
    const n1Path = path.join(
      process.cwd(),
      "tests/fixtures/trader/d11b/normalized/btcusdt-1m-2023q2clean.N1.json",
    );

    const spy = vi.spyOn(barIntegrityGate, "assertIngestBarsIntegrityOrThrow");
    const bars = loadQualificationBars("N1", n1Path);
    expect(spy).toHaveBeenCalled();
    expect(bars.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
