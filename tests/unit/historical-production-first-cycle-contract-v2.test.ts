import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertHistoricalFirstCycleCurrentInformationBindingV2,
  assertHistoricalFirstCyclePredictiveBoundaryV2,
  type HistoricalProductionFirstCycleBootstrapInputV2,
  type HistoricalProductionFirstCycleBootstrapResultV2,
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
    expect(source).toContain("requireHistoricalApprovedOperatorRoleV2");
    expect(source).toContain("WF_PREDICTIVE_NOT_QUALIFIED");
    expect(source).toContain("walkForward.rawSha256Hex !== walkForwardPartitions[0]!.rawSha256");
    expect(source).toContain("window.semanticContentDigest !== subpartitions[0]!.semanticContentDigest");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).not.toContain("await sql`SELECT pg_advisory_unlock(hashtextextended(${runLockKey},0))`");
    expect(source).toContain("initialRecordIndex: input.executionExtent.initialRecordIndex");
    expect(source).toContain("cycleCount: input.executionExtent.cycleCount");

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
    expect(source).toContain("const firstRecordIndex = predictivePartition.barCount");
    expect(source).toContain("current.cycle.closedBar.barOpenTime !== wfEconomic.startUtc");
    expect(source).toContain('partition: "WALK_FORWARD"');
    expect(source).toContain("foldCanonicalRuntimeIntelligenceStateV1");
    expect(source).toContain("marketPitBoundary: sealedKnowledge.marketPitBoundary");
    expect(source).toContain("snapshotContentDigestHex: sealedKnowledge.snapshotContentDigestHex");
    expect(source).not.toContain("dynamicSealedKnowledge");
    expect(source).toContain("ratificationRow.created_at");
    expect(source).toContain("trustAsOfReceiptId: currentTrust.receipt.id");
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

  it("accepts only an exact immutable predictive-to-economic boundary", () => {
    const canonical = {
      boundaryRecordIndex: 999,
      firstEconomicRecordIndex: 1000,
      boundaryBarCloseTime: "2026-01-01T00:00:00.000Z",
      evidencePublicAvailableAt: "2026-01-01T00:00:00.000Z",
      evidenceObservationEventTime: "2026-01-01T00:00:00.000Z",
      sealedKnowledgeMarketPitBoundary: "2026-01-01T00:00:00.000Z",
      economicBarOpenTime: "2026-01-01T00:00:00.000Z",
      economicBarCloseTime: "2026-01-01T00:01:00.000Z",
    } as const;
    expect(() => assertHistoricalFirstCyclePredictiveBoundaryV2(canonical)).not.toThrow();

    for (const forged of [
      { ...canonical, boundaryRecordIndex: 1000, firstEconomicRecordIndex: 999 },
      { ...canonical, economicBarCloseTime: canonical.boundaryBarCloseTime },
      {
        ...canonical,
        boundaryBarCloseTime: "2026-01-01T00:02:00.000Z",
        evidencePublicAvailableAt: "2026-01-01T00:02:00.000Z",
        evidenceObservationEventTime: "2026-01-01T00:02:00.000Z",
      },
      {
        ...canonical,
        evidenceObservationEventTime: "2026-01-01T00:00:00.001Z",
      },
      {
        ...canonical,
        sealedKnowledgeMarketPitBoundary: canonical.economicBarCloseTime,
      },
      {
        ...canonical,
        sealedKnowledgeMarketPitBoundary: "2026-01-01T00:02:00.000Z",
      },
    ]) {
      expect(() => assertHistoricalFirstCyclePredictiveBoundaryV2(forged)).toThrow(
        "HISTORICAL_PRODUCTION_FIRST_CYCLE_REFUSED:" +
        "HISTORICAL_DATASET_TRUST_BOUNDARY_CHRONOLOGY",
      );
    }
  });

  it("binds predictive evidence to the exact boundary row and economic data separately", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
    ), "utf8");
    expect(source).toContain("const boundaryCycleId = `${authority.runId}:WALK_FORWARD:");
    expect(source).toContain("`${firstRecordIndex - 1}`");
    expect(source).toContain("sealedMarketEvidence.datasetAuthorityId !== boundaryDataset.id");
    expect(source).toContain("boundaryDataset.authority_content_digest_hex");
    expect(source).toContain("boundaryDataset.membership_content_digest_hex");
    expect(source).toContain("boundaryDataset.sealed_cycle_content_digest_hex");
    expect(source).toContain("dataset.authority_content_digest_hex");
    expect(source).toContain("datasetAuthorityId: dataset.id");
    expect(source).toContain("observationId: storedCurrentObservation.observation.id");
    expect(source).toContain(
      "wfPredictiveSemanticContentDigestHex:\n      sealedMarketEvidence.wfPredictiveSemanticContentDigestHex",
    );
  });

  it("refuses any mismatch in the current economic information authority", () => {
    const pitAnchor = "2026-01-01T00:01:00.000Z";
    const recordTime = "2026-09-01T00:00:00.000Z";
    const canonical = {
      pitAnchor,
      normalizedInputDigestHex: "normalized",
      normalizedEventTimeUtc: pitAnchor,
      normalizedIngestTimeUtc: recordTime,
      normalizedLatestBarCloseTime: pitAnchor,
      attemptNormalizedInputDigestHex: "normalized",
      attemptEventTimeUtc: pitAnchor,
      attemptAvailableAtUtc: recordTime,
      attemptIngestTimeUtc: recordTime,
      storedNormalizedInputDigestHex: "normalized",
      storedEventTimeUtc: pitAnchor,
      storedAvailableAtUtc: recordTime,
      storedIngestTimeUtc: recordTime,
      epistemicRecordCutoff: recordTime,
      storedSourceId: "root-source",
      trustRootSourceId: "root-source",
      currentDataset: {
        id: "economic-authority",
        authorityContentDigestHex: "economic-content",
        datasetAuthorityDigestHex: "economic-dataset",
        membershipContentDigestHex: "economic-membership",
        sealedCycleContentDigestHex: "economic-cycle",
      },
      informationAuthority: {
        datasetAuthorityId: "economic-authority",
        datasetAuthorityContentDigestHex: "economic-content",
        datasetAuthorityDigestHex: "economic-dataset",
        membershipContentDigestHex: "economic-membership",
        sealedCycleContentDigestHex: "economic-cycle",
        publicAvailableAt: pitAnchor,
        canonicalRecordAvailableAt: recordTime,
        canonicalRecordIngestTime: recordTime,
        observationId: "economic-observation",
        observationContentDigestHex: "economic-observation-content",
      },
      storedObservationId: "economic-observation",
      storedObservationContentDigestHex: "economic-observation-content",
    } as const;
    expect(() => assertHistoricalFirstCycleCurrentInformationBindingV2(canonical))
      .not.toThrow();
    for (const forged of [
      { ...canonical, attemptNormalizedInputDigestHex: "predictive-digest" },
      { ...canonical, storedSourceId: "forged-source" },
      { ...canonical, storedAvailableAtUtc: pitAnchor },
      { ...canonical, informationAuthority: {
        ...canonical.informationAuthority,
        datasetAuthorityId: "predictive-boundary-authority",
      } },
      { ...canonical, informationAuthority: {
        ...canonical.informationAuthority,
        observationId: "predictive-boundary-observation",
      } },
    ]) {
      expect(() => assertHistoricalFirstCycleCurrentInformationBindingV2(forged)).toThrow(
        "CURRENT_INFORMATION_AUTHORITY_BINDING",
      );
    }
  });

  it("supports bounded WALK_FORWARD registration chunks without weakening DEVELOPMENT", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2.ts",
    ), "utf8");
    expect(source).toContain('firstMembership.partition === "DEVELOPMENT"');
    expect(source).toContain("HISTORICAL_DATASET_AUTHORITY_RANGE_CONFLICT");
    expect(source).toContain("authority_content_digest_hex=${authorityDigest}");
    expect(source).toContain("HISTORICAL_DATASET_AUTHORITY_CONFLICT");
  });

  it("reads immutable final authority without requesting an UPDATE-strength row lock", () => {
    for (const path of [
      "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
      "lib/trader/historical-simulation-v2/production-next-cycle-information-v2.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      const query = source.match(
        /FROM trader_historical_four_surface_ratified_admission_v2[\s\S]*?\n\s*`;/,
      )?.[0];
      expect(query, path).toBeDefined();
      expect(query, path).not.toContain("FOR SHARE");
    }
  });

  it("keeps production runner reads compatible with the SELECT-only append-only surface", () => {
    const runnerFiles = [
      "production-first-cycle-bootstrap-v2.ts",
      "production-next-cycle-information-v2.ts",
      "production-next-cycle-forecast-v2.ts",
      "production-next-cycle-authority-v2.ts",
      "production-next-cycle-preparation-v2.ts",
      "production-learning-projection-v2.ts",
      "production-runtime-state-v2.ts",
      "production-initial-cycle-index-v2.ts",
      "pit-forecast-input-producer-v2.ts",
      "knowledge-snapshot-binding-v2.ts",
      "forecast-knowledge-bootstrap-v2.ts",
      "canonical-verification-receipt-postgres-v2.ts",
      "reason-ledger-repository-postgres.ts",
      "atomic-cycle-repository-postgres-v2.ts",
      "run-lifecycle-postgres-v2.ts",
    ];
    for (const file of runnerFiles) {
      const source = readFileSync(resolve(
        process.cwd(),
        "lib/trader/historical-simulation-v2",
        file,
      ), "utf8");
      expect(source, file).not.toMatch(/FOR\s+(?:NO\s+KEY\s+)?(?:SHARE|UPDATE)/i);
    }
    const atomic = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2.ts",
    ), "utf8");
    expect(atomic).toContain("pg_advisory_lock");
    expect(atomic).toContain('withPostgresSessionTransactionV2(connection, "SERIALIZABLE"');
    const lifecycle = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2.ts",
    ), "utf8");
    expect(lifecycle).toContain("pg_advisory_xact_lock");
    expect(lifecycle).toContain("pg_try_advisory_lock");
  });
});
