/**
 * DEE-415 / HTR-WP21 — dynamic same-run capital-path no-feedback proof (SQLite validation path).
 */

import { describe, expect, it } from "vitest";

import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { buildWp21SameRunConsumerGraph } from "@/lib/trader/intelligence/epistemic/wp21-same-run-consumer-graph";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { splitBarsThreeWay } from "@/lib/trader/market-data/research-dataset";
import { buildResearchIntegrationBars } from "@/tests/helpers/build-research-integration-bars";
import { createWp21ProofInMemoryRuntime } from "@/tests/helpers/wp21-proof-in-memory-runtime";
import {
  createWp21ProofResearchSession,
  runWp21ProofResearchValidation,
} from "@/tests/helpers/wp21-proof-research-session";

const SAME_RUN_RUN_ID = "00000000-0000-4000-8021-000000000021";
const SAME_RUN_BARS = splitBarsThreeWay(buildResearchIntegrationBars()).validation;

describe("trader wp21 same-run no-feedback dynamic proof", () => {
  it("preserves capital-path bytes when only WP21 execution/repository bundle changes", async () => {
    const graph = buildWp21SameRunConsumerGraph();
    expect(graph.capitalPathConsumers).toEqual([]);

    const sharedConfig = {
      runId: SAME_RUN_RUN_ID,
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      bars: SAME_RUN_BARS,
      wp21Fields: {
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      },
    } as const;

    const { session: sessionA, context: contextA } = await createWp21ProofResearchSession();
    const inMemoryA = createWp21ProofInMemoryRuntime();
    const armA = await runWp21ProofResearchValidation({
      ...sharedConfig,
      context: contextA,
      session: sessionA,
      wp21Fields: {
        ...sharedConfig.wp21Fields,
        intelligenceRecordsSink: inMemoryA.intelligenceRecordsSink,
        forecastDecisionSink: inMemoryA.forecastDecisionSink,
      },
    });
    sessionA.cleanup();

    const { session: sessionB, context: contextB } = await createWp21ProofResearchSession();
    const inMemoryB = createWp21ProofInMemoryRuntime();
    const armB = await runWp21ProofResearchValidation({
      ...sharedConfig,
      context: contextB,
      session: sessionB,
      wp21Fields: {
        ...sharedConfig.wp21Fields,
        intelligenceRecordsSink: inMemoryB.intelligenceRecordsSink,
        forecastDecisionSink: inMemoryB.forecastDecisionSink,
        outcomeResolutionSink: inMemoryB.outcomeResolutionSink,
        calibrationSink: inMemoryB.calibrationSink,
        wp21RuntimeDeps: inMemoryB.wp21RuntimeDeps,
      },
    });
    sessionB.cleanup();

    expect(armA.capitalPathDigest).toBeTruthy();
    expect(armB.capitalPathDigest).toBe(armA.capitalPathDigest);
    expect(inMemoryA.epistemicRecordCount()).toBe(0);
    expect(inMemoryB.epistemicRecordCount()).toBeGreaterThan(0);
  });
});
