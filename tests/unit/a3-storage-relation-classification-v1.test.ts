import { describe, expect, it } from "vitest";

import {
  A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES,
  A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES,
  A3_PACKAGE_FIXED_RELATION_TABLES,
  A3_PROPORTIONAL_RELATION_TABLES,
  A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES,
  assertA3StorageInventoriesClosedAndDisjoint,
  assertExcludedResearchNotInIncludedMeasurementSets,
  classifyA3StorageBaseTable,
  computeA3TotalProjectedBytesTerms,
  enumerateA3FixedV2ClassificationItems,
  isIndependentA3SemanticStorageSurface,
  measureEnumeratedFixedV2OtherEvidenceV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-relation-classification-v1";
import {
  FORECAST_V2_PACKAGE_FIXED_TABLES,
  FORECAST_V2_STORAGE_TABLES,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";

describe("A3 storage relation classification (full-migration harness)", () => {
  it("TEST 7 — package-fixed inventory unchanged", () => {
    expect([...A3_PACKAGE_FIXED_RELATION_TABLES]).toEqual([...FORECAST_V2_PACKAGE_FIXED_TABLES]);
    expect([...A3_PACKAGE_FIXED_RELATION_TABLES]).toEqual([
      "trader_forecast_target_definition_v2",
      "trader_forecast_target_bucket_v2",
      "trader_forecast_predictive_package_v2",
      "trader_forecast_predictive_package_target_v2",
      "trader_forecast_replica_artifact_v2",
    ]);
  });

  it("TEST 8 — proportional inventory unchanged", () => {
    expect([...A3_PROPORTIONAL_RELATION_TABLES]).toEqual([
      "trader_forecast_bundle_v2",
      "trader_forecast_v2",
      "trader_forecast_outcome_v2",
      "trader_forecast_calibration_observation_v2",
      "trader_forecast_scenario_v2",
    ]);
    expect(
      [...A3_PACKAGE_FIXED_RELATION_TABLES, ...A3_PROPORTIONAL_RELATION_TABLES].sort(),
    ).toEqual([...FORECAST_V2_STORAGE_TABLES].sort());
  });

  it("TEST 9 — no double counting across projection classes", () => {
    expect(() => assertA3StorageInventoriesClosedAndDisjoint()).not.toThrow();
    const all = [
      ...A3_PACKAGE_FIXED_RELATION_TABLES,
      ...A3_PROPORTIONAL_RELATION_TABLES,
      ...A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES,
      ...A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("classifies failed PHASE-02 research relations as allowed-to-exist", () => {
    for (const relname of A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES) {
      expect(classifyA3StorageBaseTable(relname)).toBe(
        "RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST",
      );
    }
  });

  it("TEST 2 — package-set contamination fails closed", () => {
    expect(() =>
      assertExcludedResearchNotInIncludedMeasurementSets({
        packageFixedTables: [...A3_PACKAGE_FIXED_RELATION_TABLES, "trader_knowledge_edges"],
      }),
    ).toThrow(/contaminated package-fixed/);
  });

  it("TEST 3 — proportional contamination fails closed", () => {
    expect(() =>
      assertExcludedResearchNotInIncludedMeasurementSets({
        proportionalTables: [...A3_PROPORTIONAL_RELATION_TABLES, "trader_pattern_definition_v1"],
      }),
    ).toThrow(/contaminated proportional/);
  });

  it("TEST 4 — enumerated-fixed contamination fails closed", () => {
    expect(() =>
      assertExcludedResearchNotInIncludedMeasurementSets({
        enumeratedFixedV2OtherTables: ["trader_research_trial_registration_v1"],
      }),
    ).toThrow(/contaminated enumerated_fixed_V2_other/);
  });

  it("TEST 5 — unknown V2 surface classified prohibited", () => {
    expect(classifyA3StorageBaseTable("trader_forecast_mystery_surface_v2")).toBe(
      "PROHIBITED_UNEXPECTED_SURFACE",
    );
  });

  it("legacy Forecast V1 coexistence is allowed to exist", () => {
    for (const relname of A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES) {
      expect(classifyA3StorageBaseTable(relname)).toBe(
        "LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST",
      );
    }
  });

  it("TEST 6 — indexes are not independent semantic surfaces", () => {
    expect(
      isIndependentA3SemanticStorageSurface({
        relname: "trader_knowledge_edges_pkey",
        relkind: "i",
      }),
    ).toBe(false);
    expect(
      isIndependentA3SemanticStorageSurface({
        relname: "trader_knowledge_edges",
        relkind: "r",
      }),
    ).toBe(true);
  });

  it("TEST 10 — aggregate formula adds package_fixed and enumerated_fixed once", () => {
    const terms = computeA3TotalProjectedBytesTerms({
      totalCompleteBundles: 12_625_920,
      bytesPerCompleteBundle: 3600,
      packageFixedContributionBytes: 14_213_120,
      enumeratedFixedV2OtherBytes: 4096,
    });
    expect(terms.proportionalTermBytes).toBe(12_625_920 * 3600);
    expect(terms.packageFixedContributionBytes).toBe(14_213_120);
    expect(terms.enumeratedFixedV2OtherBytes).toBe(4096);
    expect(terms.totalProjectedBytes).toBe(12_625_920 * 3600 + 14_213_120 + 4096);
  });

  it("enumeration items keep research excluded-by-plan (not other-fixed-v2)", () => {
    const items = enumerateA3FixedV2ClassificationItems();
    expect(items.filter((i) => i.category === "other-fixed-v2")).toHaveLength(0);
    expect(items.some((i) => i.category === "excluded-by-plan")).toBe(true);
    expect(A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES).toHaveLength(0);
  });

  it("TEST 1 — known research + V1 coexistence does not fail closed-world measure", async () => {
    const research = [...A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES];
    const legacy = [...A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES];
    const forecastTables = [...FORECAST_V2_STORAGE_TABLES];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("relkind") && text.includes("trader_forecast_%")) {
        return [
          ...forecastTables.map((relname) => ({ relname, relkind: "r" })),
          ...research.map((relname) => ({ relname, relkind: "r" })),
          ...legacy.map((relname) => ({ relname, relkind: "r" })),
        ];
      }
      if (text.includes("pg_total_relation_size")) {
        return [{ total_bytes: "0" }];
      }
      if (text.includes("FROM pg_class") && values.length === 1) {
        return [];
      }
      throw new Error(`unexpected sql in mock: ${text}`);
    }) as unknown as Parameters<typeof measureEnumeratedFixedV2OtherEvidenceV1>[0];

    const result = await measureEnumeratedFixedV2OtherEvidenceV1(sql);
    expect(result.enumeratedFixedV2OtherBytes).toBe(0);
    expect([...result.allowedResearchPresent].sort()).toEqual([...research].sort());
    expect([...result.allowedLegacyV1Present].sort()).toEqual([...legacy].sort());
    expect(result.measuredSurfaces).toEqual([]);
  });

  it("TEST 5b — unexpected Forecast V2 base table fails closed", async () => {
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("relkind") && text.includes("trader_forecast_%")) {
        return [
          ...FORECAST_V2_STORAGE_TABLES.map((relname) => ({ relname, relkind: "r" })),
          { relname: "trader_forecast_mystery_surface_v2", relkind: "r" },
        ];
      }
      throw new Error(`unexpected sql in mock: ${text}`);
    }) as unknown as Parameters<typeof measureEnumeratedFixedV2OtherEvidenceV1>[0];

    await expect(measureEnumeratedFixedV2OtherEvidenceV1(sql)).rejects.toThrow(
      /unexpected unclassified/,
    );
  });
});
