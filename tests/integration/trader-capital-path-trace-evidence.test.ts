/**
 * DEE-415 — capital-path trace observability evidence (TRACE-01..TRACE-10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCapitalPathTraceChronology,
  assertCapitalPathTraceOneByteMutationRejected,
  detectCapitalPathTraceMutation,
} from "@/lib/trader/observability/capital-path-trace-collector";
import {
  assertCapitalPathTraceEventV1,
  CAPITAL_PATH_TRACE_EVENT_REQUIRED_KEYS,
  CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION,
  computeCapitalPathTraceSemanticDigest,
} from "@/lib/trader/observability/capital-path-trace-event.types";
import {
  cleanupCapitalPathTraceArtifacts,
  proveTraceInstrumentationDoesNotAlterEconomics,
  runAllCapitalPathTraceScenarios,
  TRACE_SCENARIOS,
  writeCapitalPathTraceArtifacts,
} from "@/lib/trader/research/capital-path-trace-harness";

describe("DEE-415 capital-path trace evidence (TRACE-01..TRACE-10)", () => {
  it("executes all TRACE scenarios with schema-valid chronological evidence", async () => {
    const { results, index } = await runAllCapitalPathTraceScenarios();
    const stagingDir = writeCapitalPathTraceArtifacts({ results, index });

    try {
      expect(index.traceExpected).toBe(10);
      expect(index.traceObserved).toBe(10);
      expect(index.tracePassed).toBe(10);
      expect(index.traceFailed).toBe(0);
      expect(index.traceSkipped).toBe(0);
      expect(index.entries).toHaveLength(10);

      for (const scenario of TRACE_SCENARIOS) {
        const result = results.find((entry) => entry.scenario === scenario);
        expect(result?.passed, result?.failureReason).toBe(true);
        expect(result?.collector.events.length).toBeGreaterThan(0);

        const jsonl = readFileSync(join(stagingDir, `${scenario}.jsonl`), "utf8");
        const events = jsonl
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        expect(events.length).toBe(result?.collector.events.length);

        for (const event of events) {
          assertCapitalPathTraceEventV1(event);
          expect(event.schemaVersion).toBe(CAPITAL_PATH_TRACE_EVENT_SCHEMA_VERSION);
          for (const key of CAPITAL_PATH_TRACE_EVENT_REQUIRED_KEYS) {
            expect(event).toHaveProperty(key);
          }
          expect(event.repositoryPath.startsWith("/")).toBe(false);
          expect(event.repositoryPath.match(/^[A-Za-z]:\\/)).toBeNull();
        }

        assertCapitalPathTraceChronology(events);
      }

      const indexFile = JSON.parse(readFileSync(join(stagingDir, "trace-index.json"), "utf8"));
      expect(indexFile.tracePassed).toBe(10);
      expect(indexFile.indexDigest).toBe(index.indexDigest);
    } finally {
      cleanupCapitalPathTraceArtifacts(stagingDir);
    }
  });

  it("produces stable trace digests across identical runs and rejects one-byte mutation", async () => {
    const first = await runAllCapitalPathTraceScenarios();
    const second = await runAllCapitalPathTraceScenarios();

    for (const scenario of TRACE_SCENARIOS) {
      const firstResult = first.results.find((entry) => entry.scenario === scenario)!;
      const secondResult = second.results.find((entry) => entry.scenario === scenario)!;
      expect(firstResult.collector.semanticDigest()).toBe(secondResult.collector.semanticDigest());
      expect(
        detectCapitalPathTraceMutation(
          firstResult.collector.events,
          firstResult.collector.semanticDigest(),
        ),
      ).toBe(true);
      assertCapitalPathTraceOneByteMutationRejected(firstResult.collector.events);
    }

    expect(computeCapitalPathTraceSemanticDigest(first.results[0]!.collector.events)).toHaveLength(
      64,
    );
  });

  it("proves trace instrumentation does not change normal-run economic outputs", async () => {
    expect(await proveTraceInstrumentationDoesNotAlterEconomics()).toBe(true);
  });
});
