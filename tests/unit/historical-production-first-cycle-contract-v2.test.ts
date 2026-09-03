import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  HistoricalProductionFirstCycleBootstrapInputV2,
  HistoricalProductionFirstCycleBootstrapResultV2,
} from
  "@/lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2";
import type { HistoricalFourSurfaceAuthenticatedRatificationInputV2 } from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";

describe("DEE-919 production first-cycle contract", () => {
  it("keeps SQL, receipts, Forecasts, knowledge and holdout out of caller authority", () => {
    const forbidden: Readonly<Record<string, boolean>> = {
      sql: false as "sql" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
        ? true : false,
      corpus: false as "corpus" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
        ? true : false,
      forecast: false as "forecast" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
        ? true : false,
      knowledgeState: false as
        "knowledgeState" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
          ? true : false,
      partition: false as
        "partition" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
          ? true : false,
      holdout: false as "holdout" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
        ? true : false,
      authenticatedOperatorUserId: false as
        "authenticatedOperatorUserId" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
          ? true : false,
      scientificAdmissionReceiptIds: false as
        "scientificAdmissionReceiptIds" extends keyof HistoricalProductionFirstCycleBootstrapInputV2
          ? true : false,
    };
    expect(forbidden).toEqual({
      sql: false,
      corpus: false,
      forecast: false,
      knowledgeState: false,
      partition: false,
      holdout: false,
      authenticatedOperatorUserId: false,
      scientificAdmissionReceiptIds: false,
    });
  });

  it("makes WALK_FORWARD and the absence of every live/capital/holdout authority explicit", () => {
    const partition: HistoricalProductionFirstCycleBootstrapResultV2["partition"] =
      "WALK_FORWARD";
    const boundary: HistoricalProductionFirstCycleBootstrapResultV2["authorityBoundary"] = {
      capitalAuthority: "NONE",
      liveTradingAuthority: "NONE",
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED",
    };
    expect({ partition, boundary }).toEqual({
      partition: "WALK_FORWARD",
      boundary,
    });
  });

  it("uses one required direct/session client and exposes no TEST_ONLY capability through indexes", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
    ), "utf8");
    expect(source).toContain("withRequiredSessionPostgresClient");
    expect(source).not.toContain("withWaiaPostgresClient");
    expect(source).toContain("pg_advisory_lock");
    expect(source).toContain("pg_advisory_unlock");
    expect(source).toContain("finally");

    const productionImports = [
      "lib/trader/research/execopp-qualification/index.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
    expect(productionImports).not.toContain(
      "TEST_ONLY_prepareHistoricalProductionFirstCycleWithHeldPostgresV2",
    );
  });

  it("keeps actor, receipts and evidence outside the authenticated ratification request", () => {
    const forbidden: Readonly<Record<string, boolean>> = {
      operatorUserId: false as
        "operatorUserId" extends keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2
          ? true : false,
      authenticatedOperatorUserId: false as
        "authenticatedOperatorUserId" extends
          keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2 ? true : false,
      aggregateAdmissionReceiptId: false as
        "aggregateAdmissionReceiptId" extends
          keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2 ? true : false,
      scientificAdmissionReceiptIds: false as
        "scientificAdmissionReceiptIds" extends
          keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2 ? true : false,
      corpus: false as
        "corpus" extends keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2
          ? true : false,
      evidence: false as
        "evidence" extends keyof HistoricalFourSurfaceAuthenticatedRatificationInputV2
          ? true : false,
    };
    expect(forbidden).toEqual({
      operatorUserId: false,
      authenticatedOperatorUserId: false,
      aggregateAdmissionReceiptId: false,
      scientificAdmissionReceiptIds: false,
      corpus: false,
      evidence: false,
    });
  });

  it("keeps low-level ratification persistence private and blocks production TEST_ONLY imports", () => {
    const authorityPath = resolve(process.cwd(),
      "lib/trader/research/execopp-qualification/" +
      "historical-four-surface-ratified-admission-v2.ts");
    const source = readFileSync(authorityPath, "utf8");
    expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+INTERNAL_persistHistorical/);
    expect(source).toContain("getOptionalAdminSessionUserId");
    expect(source).toContain("WF_PREDICTIVE_NOT_QUALIFIED");
    expect(source).toContain("walkForward.rawSha256Hex !== walkForwardPartitions[0]!.rawSha256");
    expect(source).toContain("window.semanticContentDigest !== subpartitions[0]!.semanticContentDigest");

    const productionFiles = [
      "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
      "lib/trader/research/execopp-qualification/index.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
    expect(productionFiles).not.toContain(
      "TEST_ONLY_ratifyHistoricalFourSurfaceAdmissionWithHeldPostgresV2",
    );
    expect(productionFiles).not.toContain("INTERNAL_persistHistoricalFourSurfaceRatificationV2");
  });

  it("counts persisted Forecasts through their tenant-bound bundle run identity", () => {
    const integrationSource = readFileSync(resolve(
      process.cwd(),
      "tests/integration/postgres-historical-production-first-cycle-v2.test.ts",
    ), "utf8");
    expect(integrationSource).toContain("bundle.id = forecast.bundle_id");
    expect(integrationSource).toContain(
      "bundle.organization_id = forecast.organization_id",
    );
    expect(integrationSource).toContain("bundle.run_id=${runId}");
    expect(integrationSource).not.toContain("forecast.run_id");
    expect(integrationSource).toContain('"PIT_PERSISTED",');
    expect(integrationSource).toContain('forecasts: "2"');
  });

  it("derives the first Forecast PIT from the sealed predictive/economic boundary", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
    ), "utf8");
    expect(source).toContain("wfPredictive.endUtc !== wfEconomic.startUtc");
    expect(source).toContain("const firstRecordIndex = predictivePartition.barCount - 1");
    expect(source).toContain("current.cycle.closedBar.barCloseTime !== wfEconomic.startUtc");
    expect(source).toContain('partition: "WALK_FORWARD"');
    expect(source).toContain("foldCanonicalRuntimeIntelligenceStateV1");
    expect(source).toContain("ratificationRow.created_at");
    expect(source).toContain("trustAsOfReceiptId: sealedMarketEvidence.trustAsOfReceiptId");
    expect(source).toContain("trustRevisionId: sealedMarketEvidence.trustRevisionId");
    expect(source).toContain(
      "trustRevisionContentDigest: sealedMarketEvidence.trustRevisionContentDigestHex",
    );
    expect(source).toContain("historicalDatasetTrustAuthority");
    expect(source).toContain("persistRequiredInformationProfileWithinTransactionV2Postgres");
    expect(source).toContain(
      "persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2",
    );
    expect(source.indexOf(
      "await persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2",
    )).toBeLessThan(source.indexOf("await persistHistoricalForecastCycleV2"));
    expect(source).not.toContain("trustRevisionId: null");
    expect(source).not.toContain(
      "const firstRecordIndex = input.preflight.initialDevelopmentRecordIndex",
    );
  });
});
