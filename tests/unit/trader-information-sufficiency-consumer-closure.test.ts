import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INFORMATION_SUFFICIENCY_CONSUMERS_V2,
  INFORMATION_SUFFICIENCY_FORBIDDEN_BYPASS_MARKERS_V2,
  INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2,
  INFORMATION_SUFFICIENCY_PRODUCERS_V2,
  INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2,
  auditInformationSufficiencyConsumerInventoryV2,
  type InformationSufficiencyImportV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-consumer-inventory-v2";

const ROOT = process.cwd();
const WAVE_C_PROOF = "tests/unit/trader-information-sufficiency-runtime.test.ts";

const IMPORT_MODULES: Record<InformationSufficiencyImportV2, string> = {
  RUN_EVALUATION_CYCLE: "@/lib/trader/intelligence/evaluation-cycle",
  BUILD_FORECAST_DECISION_BUNDLE:
    "@/lib/trader/intelligence/forecast-decision/forecast-decision-service",
  FORECAST_DECISION_CONSTRUCTION_AUTHORITY:
    "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority",
  FORECAST_DECISION_RAW_PERSISTENCE:
    "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres",
  FORECAST_DECISION_LOW_LEVEL_DECISION_REPOSITORY:
    "@/lib/trader/intelligence/forecast-decision/decision-record-repository-postgres",
  FORECAST_DECISION_BARREL: "@/lib/trader/intelligence/forecast-decision",
  TRADER_INTELLIGENCE_BARREL: "@/lib/trader/intelligence",
  TRADER_PAPER_BARREL: "@/lib/trader/paper",
  RUN_PAPER_CYCLE_ONCE: "@/lib/trader/paper/paper-cycle-runner",
};

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function repoRelative(path: string): string {
  return relative(ROOT, path).split("\\").join("/");
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("DEE-689 information-sufficiency producer, consumer, and bypass closure", () => {
  it("pins every producer and consumer to an existing symbol-bearing source", () => {
    expect(auditInformationSufficiencyConsumerInventoryV2()).toEqual([]);

    for (const producer of INFORMATION_SUFFICIENCY_PRODUCERS_V2) {
      const absolute = join(ROOT, producer.path);
      if (!existsSync(absolute)) {
        expect(producer.path).toBe(INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.repository);
        expect(existsSync(join(ROOT, WAVE_C_PROOF))).toBe(false);
        continue;
      }
      const source = read(producer.path);
      for (const symbol of producer.symbols) expect(source, producer.path).toContain(symbol);
    }

    for (const consumer of INFORMATION_SUFFICIENCY_CONSUMERS_V2) {
      expect(existsSync(join(ROOT, consumer.path)), consumer.path).toBe(true);
      const source = read(consumer.path);
      for (const symbol of consumer.symbols) expect(source, consumer.path).toContain(symbol);
    }
  });

  it("accounts for every direct evaluation, Forecast/Decision, and paper-cycle importer", () => {
    const sources = sourceFiles(join(ROOT, "lib/trader"));
    for (const [importKind, modulePath] of Object.entries(IMPORT_MODULES) as Array<
      [InformationSufficiencyImportV2, string]
    >) {
      const scanned = sources
        .filter((path) => readFileSync(path, "utf8").includes(`from "${modulePath}"`))
        .map(repoRelative)
        .sort();
      const inventoried = INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter((entry) =>
        (entry.imports as readonly InformationSufficiencyImportV2[]).includes(importKind),
      )
        .map((entry) => entry.path)
        .sort();
      expect(scanned, importKind).toEqual(inventoried);
    }
  });

  it("keeps fixture, poll, backtest, non-capital, and Guardian lanes explicit", () => {
    expect(
      INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter(
        (entry) => entry.disposition === "FIXTURE_ENTRY_FAIL_CLOSED",
      ).map((entry) => entry.path),
    ).toEqual(["lib/trader/paper/run-fixture-paper-cycles.ts"]);
    expect(
      INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter(
        (entry) => entry.disposition === "POLL_ENTRY_FAIL_CLOSED",
      ).map((entry) => entry.path),
    ).toEqual([
      "lib/trader/paper/paper-bar-close-loop.ts",
      "lib/trader/paper/run-paper-loop-cycle.ts",
    ]);
    expect(
      INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter(
        (entry) => entry.disposition === "BACKTEST_ENTRY_FAIL_CLOSED",
      ).map((entry) => entry.path),
    ).toEqual(["lib/trader/backtest/backtest-runner.ts"]);

    const nonCapital = INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter(
      (entry) => entry.disposition === "RESEARCH_NON_CAPITAL_EXPLICIT",
    );
    expect(nonCapital.length).toBeGreaterThan(0);
    expect(nonCapital.every((entry) => entry.authorityPurpose === "RESEARCH_NON_CAPITAL")).toBe(
      true,
    );

    expect(
      INFORMATION_SUFFICIENCY_CONSUMERS_V2.find(
        (entry) => entry.path === "lib/trader/live/run-live-cycle.ts",
      ),
    ).toMatchObject({
      disposition: "EXCLUDED_RESERVED_LIVE_UNGATED",
      authorityPurpose: "NONE",
    });
    expect(read("lib/trader/live/run-live-cycle.ts")).not.toContain(
      "declareExecutableInformationSufficiencyAuthorityV2",
    );

    expect(
      INFORMATION_SUFFICIENCY_CONSUMERS_V2.find(
        (entry) =>
          entry.path ===
          "lib/trader/intelligence/forecast-decision/forecast-decision-completeness.ts",
      ),
    ).toMatchObject({
      disposition: "LOW_LEVEL_READ_ONLY_COMPLETENESS",
      authorityPurpose: "NONE",
    });

    expect(INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2).toMatchObject({
      purpose: "OPEN_POSITION_REASSESSMENT",
      disposition: "SEPARATE_RISK_REDUCING_EXIT_LANE",
      blockedByNewOpportunityInsufficiency: false,
      createsCapitalAuthority: false,
    });
    const guardianSource = read(INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2.path);
    for (const symbol of INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2.symbols) {
      expect(guardianSource).toContain(symbol);
    }
  });

  it("activates exact Wave C authority markers when its admitted runtime proof lands", () => {
    if (!existsSync(join(ROOT, WAVE_C_PROOF))) return;

    for (const path of [
      INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.evaluationCycle,
      INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.forecastDecision,
      INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.paperCycle,
    ]) {
      expect(read(path), path).toContain("information-sufficiency");
    }
    for (const entry of INFORMATION_SUFFICIENCY_CONSUMERS_V2.filter(
      (consumer) => consumer.disposition === "RESEARCH_NON_CAPITAL_EXPLICIT",
    )) {
      expect(read(entry.path), entry.path).toContain(
        "declareResearchNonCapitalInformationAuthorityV2",
      );
    }
    expect(read(INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2.path)).toContain(
      "OPEN_POSITION_REASSESSMENT",
    );
  });

  it("keeps raw construction and persistence behind authenticated authority", () => {
    const publicIndex = read("lib/trader/intelligence/forecast-decision/index.ts");
    expect(publicIndex).not.toContain("persistForecastDecisionBundle,");
    for (const rawBuilder of [
      "buildForecastRecords",
      "buildDecisionRecord",
      "buildDecisionForecastLinks",
      "buildEntryPurposeRecord",
    ]) {
      expect(publicIndex).not.toContain(
        `/${rawBuilder.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      );
    }

    expect(read(INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.forecastDecisionPersistence)).toContain(
      "ForecastDecisionPersistenceAuthorizationV2",
    );
    expect(read(INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.forecastDecisionPersistence)).toContain(
      "admitForecastDecisionPersistence",
    );
  });

  it("finds no named information-sufficiency bypass in trader sources", () => {
    const inventoryPath = repoRelative(
      join(
        ROOT,
        "lib/trader/intelligence/information-sufficiency/information-sufficiency-consumer-inventory-v2.ts",
      ),
    );
    const bypasses = sourceFiles(join(ROOT, "lib/trader"))
      .map(repoRelative)
      .filter((path) => path !== inventoryPath)
      .flatMap((path) =>
        INFORMATION_SUFFICIENCY_FORBIDDEN_BYPASS_MARKERS_V2.filter((marker) =>
          read(path).includes(marker),
        ).map((marker) => `${path}:${marker}`),
      );
    expect(bypasses).toEqual([]);
  });
});
