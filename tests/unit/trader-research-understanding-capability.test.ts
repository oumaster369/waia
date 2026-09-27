// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { COMPUTATION_SOURCE_MANIFEST, COMPUTATION_SOURCE_MANIFEST_DIGEST } from "@/lib/trader/paper/research-understanding-v1/computation-manifest";
import { htxPeriodToSeconds, intervalDurationMs } from "@/lib/trader/market-data/mtf/bar-interval-duration";
import { htxPeriodToSeconds as legacySeconds } from "@/lib/trader/connectors/htx/kline-pagination";
import { intervalDurationMs as legacyDuration } from "@/lib/trader/market-data/mtf/mtf-bar-aggregator";
import { readFileSync } from "node:fs";
import { MVP_STRATEGY_REGISTRY, listMvpStrategyRegistry, strategyLifecycleStates } from "@/lib/trader/intelligence/strategies/registry-metadata";
import * as legacyRegistry from "@/lib/trader/intelligence/strategies/registry";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/replay-bar-limits";
import { EXPAND_MIN_BARS as legacyMinimum } from "@/lib/trader/market-data/fixture-bar-replay-source";
import * as input from "@/lib/trader/runtime-v2/recorded-noncapital-input-v2";
import * as receipt from "@/lib/trader/runtime-v2/noncapital-cycle-receipt-v2";

describe("saved research passive dependency boundaries", () => {
  it("checks the complete selected CLI import closure, with legacy modes excluded only by the actual early return", () => {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/trader/generate-research-understanding-manifest.ts", "--check"], { encoding: "utf8" });
    const inventory = JSON.parse(execFileSync(process.execPath,
      ["--import", "tsx", "scripts/trader/generate-research-understanding-manifest.ts", "--runtime"], { encoding: "utf8" }));
    const paths: string[] = inventory.entries.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("lib/trader/paper/research-understanding-v1/repository-postgres.ts");
    expect(paths).toContain("lib/trader/paper/research-understanding-v1/bounded-source-postgres.ts");
    expect(paths).toContain("lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2.ts");
    expect(paths).not.toContain("lib/trader/paper/durable-noncapital/repository-postgres-v1.ts");
    expect(paths).not.toContain("scripts/trader/paper-bar-close-loop-legacy.ts");
    for (const entry of inventory.entries) expect(createHash("sha256").update(readFileSync(entry.path)).digest("hex")).toBe(entry.sha256);
    expect(inventory.boundaries.sqliteRuntime).toContain("getDb is unreachable");
  }, 10000);
  it("retains all seven period values, lookup errors and legacy function identities", () => {
    expect(legacySeconds).toBe(htxPeriodToSeconds); expect(legacyDuration).toBe(intervalDurationMs);
    for (const [period, seconds] of [["1min", 60], ["5min", 300], ["15min", 900], ["30min", 1800], ["60min", 3600], ["4hour", 14400], ["1day", 86400]] as const)
      expect(htxPeriodToSeconds(period)).toBe(seconds);
    for (const [interval, duration] of [["1m", 60000], ["15m", 900000], ["1h", 3600000], ["4h", 14400000], ["1d", 86400000]] as const)
      expect(intervalDurationMs(interval)).toBe(duration);
    for (const period of ["", "1m", " 1min", "1MIN", "unknown"])
      expect(() => htxPeriodToSeconds(period)).toThrow(`[htx] unsupported kline period: ${period}`);
  });
  it("pins the exact current computation closure without hiding executable dependencies", () => {
    expect(COMPUTATION_SOURCE_MANIFEST.length).toBeGreaterThan(30);
    for (const entry of COMPUTATION_SOURCE_MANIFEST) {
      expect(createHash("sha256").update(readFileSync(entry.path)).digest("hex")).toBe(entry.sha256);
      expect(entry.path).not.toMatch(/market-data-gateway|htx-bar-poll-source|fixture-bar-replay-source|mtf-bar-aggregator|volume-qualification|evaluation-cycle|strategies\/(?!registry-metadata)|\/(forecast|execution|decision)\//);
    }
    expect(createHash("sha256").update(JSON.stringify(COMPUTATION_SOURCE_MANIFEST)).digest("hex")).toBe(COMPUTATION_SOURCE_MANIFEST_DIGEST);
  });
  it("retains the registry array, descriptors, order and old-path function references", () => {
    expect(legacyRegistry.MVP_STRATEGY_REGISTRY).toBe(MVP_STRATEGY_REGISTRY);
    expect(legacyRegistry.listMvpStrategyRegistry).toBe(listMvpStrategyRegistry);
    expect(legacyRegistry.strategyLifecycleStates).toBe(strategyLifecycleStates);
    expect(listMvpStrategyRegistry()).toBe(MVP_STRATEGY_REGISTRY);
    expect(MVP_STRATEGY_REGISTRY).toHaveLength(3);
    for (const descriptor of MVP_STRATEGY_REGISTRY) expect(legacyRegistry.getStrategyRegistryEntry(descriptor.strategyId)).toBe(descriptor);
  });
  it("retains primary minimum without exposing a fixture source from the constant leaf", () => {
    expect(EXPAND_MIN_BARS).toBe(20); expect(legacyMinimum).toBe(EXPAND_MIN_BARS);
    expect(readFileSync("lib/trader/market-data/replay-bar-limits.ts", "utf8")).not.toMatch(/\bimport\b|readFile|class /);
    expect(readFileSync("lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1.ts", "utf8")).not.toContain("fixture-bar-replay-source");
  });
  it("shares the exact existing input functions and error behavior through the receipt path", () => {
    expect(receipt.normalizeRecordedNoncapitalInputV2).toBe(input.normalizeRecordedNoncapitalInputV2);
    expect(receipt.recordedNoncapitalInputDigestV2).toBe(input.recordedNoncapitalInputDigestV2);
    const valid = { organizationId: "org", accountId: "account", releaseSha: "a".repeat(40), bar: {
      symbol: "BTC/USDT", interval: "1m" as const, open: "1", high: "2", low: "1", close: "2", volume: "0",
      barOpenTime: "2026-01-01T00:00:00.000Z", barCloseTime: "2026-01-01T00:01:00.000Z",
    } };
    expect(input.recordedNoncapitalInputDigestV2(valid)).toBe(receipt.recordedNoncapitalInputDigestV2(valid));
    expect(Object.isFrozen(input.normalizeRecordedNoncapitalInputV2(valid).bar)).toBe(true);
    expect(() => input.normalizeRecordedNoncapitalInputV2({ ...valid, bar: { ...valid.bar, low: "3" } })).toThrow("NONCAPITAL_CYCLE_INVALID_BAR");
    const source = readFileSync("lib/trader/runtime-v2/recorded-noncapital-input-v2.ts", "utf8");
    expect(source).not.toMatch(/shadow-canonical|canonical-recurring|runtime-authority/);
  });
});
