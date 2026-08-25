import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import {
  MARKET_UNDERSTANDING_BLIND_HOLDOUT_BOUNDARIES_V1,
  MARKET_UNDERSTANDING_DIRECT_IMPORT_REACHABILITY_V1,
  MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1,
  MARKET_UNDERSTANDING_EXPORT_AND_PERSISTENCE_V1,
  MARKET_UNDERSTANDING_FORBIDDEN_AUTHORITY_SEGMENTS_V1,
  MARKET_UNDERSTANDING_FORBIDDEN_BYPASS_MARKERS_V1,
  MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1,
  MARKET_UNDERSTANDING_GUARDIAN_LANE_V1,
  MARKET_UNDERSTANDING_IMPORT_MODULES_V1,
  MARKET_UNDERSTANDING_INDIRECT_CONSUMERS_V1,
  MARKET_UNDERSTANDING_LEGACY_CONSUMERS_V1,
  MARKET_UNDERSTANDING_PRODUCERS_V1,
  auditMarketUnderstandingConsumerInventoryV1,
  type MarketUnderstandingImportV1,
} from "@/lib/trader/intelligence/market-understanding-consumer-inventory-v1";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";

const ROOT = process.cwd();
const INVENTORY_PATH =
  "lib/trader/intelligence/market-understanding-consumer-inventory-v1.ts";
const PRODUCTION_ROOTS = ["app", "lib", "scripts"] as const;

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && [".ts", ".tsx"].includes(extname(path))) files.push(path);
  }
  return files;
}

function productionSources(): string[] {
  return PRODUCTION_ROOTS.flatMap((path) => sourceFiles(join(ROOT, path)));
}

function repoRelative(path: string): string {
  return relative(ROOT, path).split("\\").join("/");
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]!);
}

function runtimeImportSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]!);
}

function directImporters(modulePath: string): string[] {
  return productionSources()
    .filter((path) => importSpecifiers(readFileSync(path, "utf8")).includes(modulePath))
    .map(repoRelative)
    .sort();
}

function resolveInternalImport(fromPath: string, specifier: string): string | null {
  let candidate: string;
  if (specifier.startsWith("@/")) candidate = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = resolve(dirname(fromPath), specifier);
  else return null;
  for (const path of [`${candidate}.ts`, `${candidate}.tsx`, join(candidate, "index.ts"), candidate]) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function reachableProductionConsumers(startPaths: readonly string[]): Set<string> {
  const sources = productionSources();
  const consumersByDependency = new Map<string, string[]>();
  for (const sourcePath of sources) {
    for (const specifier of runtimeImportSpecifiers(readFileSync(sourcePath, "utf8"))) {
      const dependencyPath = resolveInternalImport(sourcePath, specifier);
      if (!dependencyPath) continue;
      const consumers = consumersByDependency.get(dependencyPath) ?? [];
      consumers.push(sourcePath);
      consumersByDependency.set(dependencyPath, consumers);
    }
  }
  const pending = startPaths.map((path) => join(ROOT, path));
  const visited = new Set<string>(pending);
  while (pending.length > 0) {
    const dependencyPath = pending.pop()!;
    for (const sourcePath of consumersByDependency.get(dependencyPath) ?? []) {
      if (visited.has(sourcePath)) continue;
      visited.add(sourcePath);
      pending.push(sourcePath);
    }
  }
  return new Set([...visited].map(repoRelative));
}

function functionBody(source: string, name: string): string {
  const declaration = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (declaration < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf("{", declaration);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadLegacyUnderstanding(path: string): MarketUnderstandingSnapshot {
  return JSON.parse(read(path)) as MarketUnderstandingSnapshot;
}

describe("DEE-715 exact Market Understanding producer, consumer, and bypass closure", () => {
  it("pins every producer, legacy consumer, indirect carrier, export, and persistence seam", () => {
    expect(auditMarketUnderstandingConsumerInventoryV1()).toEqual([]);
    for (const entry of [
      ...MARKET_UNDERSTANDING_PRODUCERS_V1,
      ...MARKET_UNDERSTANDING_LEGACY_CONSUMERS_V1,
    ]) {
      expect(existsSync(join(ROOT, entry.path)), entry.path).toBe(true);
      const source = read(entry.path);
      for (const symbol of entry.symbols) expect(source, `${entry.path}:${symbol}`).toContain(symbol);
    }
    for (const entry of MARKET_UNDERSTANDING_INDIRECT_CONSUMERS_V1) {
      expect(existsSync(join(ROOT, entry.path)), entry.path).toBe(true);
      expect(read(entry.path), `${entry.path}:${entry.symbol}`).toContain(entry.symbol);
      expect(entry.createsCapitalAuthority).toBe(false);
    }
    for (const entry of MARKET_UNDERSTANDING_EXPORT_AND_PERSISTENCE_V1) {
      expect(existsSync(join(ROOT, entry.path)), entry.path).toBe(true);
    }
  });

  it("accounts exactly for every production import of exact, legacy, bridge, and replay seams", () => {
    for (const [kind, modulePath] of Object.entries(MARKET_UNDERSTANDING_IMPORT_MODULES_V1) as Array<
      [MarketUnderstandingImportV1, string]
    >) {
      expect(directImporters(modulePath), kind).toEqual(
        [...MARKET_UNDERSTANDING_DIRECT_IMPORT_REACHABILITY_V1[kind]].sort(),
      );
    }
  });

  it("keeps canonical Source/PIT/Trust and exact artifacts out of reserved authority modules", () => {
    const leaks = productionSources()
      .map((path) => ({ path: repoRelative(path), imports: importSpecifiers(readFileSync(path, "utf8")) }))
      .filter(({ path }) =>
        MARKET_UNDERSTANDING_FORBIDDEN_AUTHORITY_SEGMENTS_V1.some((segment) =>
          `/${path}`.includes(segment),
        ) ||
        MARKET_UNDERSTANDING_BLIND_HOLDOUT_BOUNDARIES_V1.includes(
          path as (typeof MARKET_UNDERSTANDING_BLIND_HOLDOUT_BOUNDARIES_V1)[number],
        ) ||
        path === MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.path,
      )
      .flatMap(({ path, imports }) =>
        imports
          .filter((specifier) =>
            MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1.includes(
              specifier as (typeof MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1)[number],
            ),
          )
          .map((specifier) => `${path}:${specifier}`),
      );
    expect(leaks).toEqual([]);

    const forecast = read(
      "lib/trader/intelligence/forecast-decision/forecast-decision-service.ts",
    );
    expect(forecast).not.toMatch(/understanding|canonical-pit|trust-as-of/i);
    const evaluation = read("lib/trader/intelligence/evaluation-cycle.ts");
    const forecastComposition = evaluation.slice(
      evaluation.indexOf("const forecastDecisionBundle"),
      evaluation.indexOf("return {", evaluation.indexOf("const forecastDecisionBundle")),
    );
    expect(forecastComposition).not.toContain("understandingArtifact");
  });

  it("keeps legacy snapshots telemetry-only and unable to amplify economic outputs", () => {
    const fixture = JSON.parse(
      read("tests/fixtures/trader/btcusdt-1m-mean-reversion.json"),
    ) as { bars: Bar[]; latestQuote: Quote };
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      newId: () => "consumer-closure-features",
    });
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const permissive = loadLegacyUnderstanding(
      "tests/fixtures/trader/market-understanding-aligned-trend.json",
    );
    const restrictive = loadLegacyUnderstanding(
      "tests/fixtures/trader/market-understanding-gaps-conflict.json",
    );
    const left = buildMsvEnvelope({
      features,
      fusedContext,
      understanding: permissive,
      newId: () => "consumer-closure-msv",
    });
    const right = buildMsvEnvelope({
      features,
      fusedContext,
      understanding: restrictive,
      newId: () => "consumer-closure-msv",
    });
    const { understanding: leftTelemetry, ...leftEconomic } = left;
    const { understanding: rightTelemetry, ...rightEconomic } = right;
    expect(leftTelemetry).not.toEqual(rightTelemetry);
    expect(leftEconomic).toEqual(rightEconomic);

    const reconstruction = buildReconstructionSnapshot({
      bars1m: fixture.bars,
      evaluatedAt,
      fusedContext,
    });
    const base = {
      reconstruction,
      evaluatedAt,
      sessionState: createEmptyHypothesisSessionState(),
    };
    expect(buildHypothesisSet({ ...base, understanding: permissive })).toEqual(
      buildHypothesisSet({ ...base, understanding: restrictive }),
    );

    for (const name of ["resolveTradingPermission", "resolveConvictionPermission", "hasHardVeto"]) {
      expect(functionBody(read("lib/trader/intelligence/cde-v0.ts"), name), name).not.toContain(
        "understanding",
      );
    }
    expect(functionBody(read("lib/trader/intelligence/market-state-finalization.ts"), "finalizeMarketStateSnapshot").match(/input\.understanding/g)).toHaveLength(1);
  });

  it("keeps Guardian and reserved live composition free of exact evidence authority", () => {
    expect(MARKET_UNDERSTANDING_GUARDIAN_LANE_V1).toMatchObject({
      consumesExactArtifact: false,
      consumesCanonicalSourcePitTrust: false,
      createsCapitalAuthority: false,
    });
    const guardian = functionBody(
      read(MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.path),
      MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.symbol,
    );
    expect(guardian).not.toMatch(/understandingArtifact|canonical-pit|trust-as-of/i);
    const live = read("lib/trader/live/run-live-cycle.ts");
    expect(live).not.toMatch(/informationSufficiencyAuthority|understandingArtifact/);
  });

  it("accounts for blind runtime consumers and forbids holdout authority or bypasses", () => {
    const reachableConsumers = reachableProductionConsumers([
      "lib/trader/intelligence/market-understanding-evidence-attribution-v1.ts",
      "lib/trader/intelligence/market-understanding-bridge-v0.ts",
      "lib/trader/intelligence/evaluation-cycle.ts",
      "lib/trader/research/replay-repro-digest.ts",
    ]);
    expect(reachableConsumers.has("lib/trader/backtest/backtest-runner.ts")).toBe(true);
    for (const path of MARKET_UNDERSTANDING_BLIND_HOLDOUT_BOUNDARIES_V1) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(reachableConsumers.has(path), path).toBe(
        path === "lib/trader/research/research-orchestrator.ts",
      );
      expect(
        importSpecifiers(read(path)).filter((specifier) =>
          MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1.includes(
            specifier as (typeof MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1)[number],
          ),
        ),
      ).toEqual([]);
    }
    expect(read("lib/trader/research/research-orchestrator.ts")).not.toContain(
      "informationSufficiencyAuthority",
    );

    const bypasses = productionSources()
      .map(repoRelative)
      .filter((path) => path !== INVENTORY_PATH)
      .flatMap((path) =>
        MARKET_UNDERSTANDING_FORBIDDEN_BYPASS_MARKERS_V1.filter((marker) =>
          read(path).includes(marker),
        ).map((marker) => `${path}:${marker}`),
      );
    expect(bypasses).toEqual([]);
  });

  it("leaves durable Understanding persistence to DEE-623", () => {
    expect(MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1).toEqual({
      owner: "DEE-623",
      status: "DEFERRED",
      repository: null,
      migration: null,
      createsCapitalAuthority: false,
    });
    expect(read("lib/trader/backtest/streaming-evidence/cycle-evidence-projection.ts")).not.toContain(
      "understandingArtifact",
    );
    expect(read("lib/trader/backtest/streaming-evidence/streaming-evidence-reader.ts")).not.toContain(
      "understandingArtifact",
    );
    expect(read("lib/trader/research/m9-market-understanding-export.ts")).toContain(
      "buildMarketUnderstandingReplayIdentityV1",
    );
    expect(read("lib/trader/research/m9-decision-trace-export.ts")).toContain(
      "buildMarketUnderstandingReplayIdentityV1",
    );
    expect(read("lib/trader/index.ts")).not.toMatch(
      /MarketUnderstandingArtifactV1|defineMarketUnderstandingArtifactV1/,
    );
    const durableLeaks = sourceFiles(join(ROOT, "db"))
      .filter((path) => /MarketUnderstandingArtifactV1|market_understanding_artifact/.test(readFileSync(path, "utf8")))
      .map(repoRelative);
    expect(durableLeaks).toEqual([]);
  });
});
