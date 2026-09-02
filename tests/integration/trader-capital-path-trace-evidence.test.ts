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
  assertCapitalPathTraceStateDigestContinuity,
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
import { runScientificControlReplayV2Ceremony } from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import { postgresTestOnlyExecutionV2Authority } from "@/tests/helpers/execution-v2-test-only-postgres";

const pgEnabled =
  process.env.WAIA_PG_INTEGRATION === "1" && !!process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!pgEnabled)("DEE-415 capital-path trace evidence (TRACE-01..TRACE-10)", () => {
  it("executes all TRACE scenarios with schema-valid chronological evidence", async () => {
    const { results, index, flags } = await runAllCapitalPathTraceScenarios();
    const stagingDir = writeCapitalPathTraceArtifacts({ results, index });

    try {
      expect(index.traceExpected).toBe(10);
      expect(index.traceObserved).toBe(10);
      expect(index.tracePassed).toBe(8);
      expect(index.traceFailed).toBe(2);
      expect(index.traceSkipped).toBe(0);
      expect(index.uniqueTraceIds).toBe(10);
      expect(index.duplicateTraceIds).toBe(0);
      expect(index.entries).toHaveLength(10);

      expect(index.trace02GuardianStopObserved).toBe(true);
      expect(index.trace03CanonicalAbstentionObserved).toBe(true);
      expect(index.trace04ExactRiskReasonObserved).toBe(false);
      expect(index.drawdownVariantsExpected).toBe(6);
      expect(index.drawdownVariantsObserved).toBe(6);
      expect(index.drawdownVariantsPassed).toBe(6);
      expect(index.drawdownVariantsFailed).toBe(0);
      expect(index.trace08CapitalPathDuplicateSuppressed).toBe(false);
      expect(index.trace09RunnerIngressRejected).toBe(true);
      expect(index.perEventStateDigestsValid).toBe(true);
      expect(index.fullEconomicNonInterference).toBe(true);
      expect(flags.fullEconomicNonInterference).toBe(true);

      const legacyEffectScenarios = new Set(["TRACE-04", "TRACE-08"]);
      for (const scenario of TRACE_SCENARIOS) {
        const result = results.find((entry) => entry.scenario === scenario);
        expect(result?.passed, result?.failureReason).toBe(!legacyEffectScenarios.has(scenario));
        if (!legacyEffectScenarios.has(scenario)) expect(result?.failedInvariants).toEqual([]);
        expect(result?.collector.events.length).toBeGreaterThan(0);
        expect(assertCapitalPathTraceStateDigestContinuity(result!.collector.events)).toBe(true);

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
      expect(indexFile.tracePassed).toBe(8);
      expect(indexFile.indexDigest).toBe(index.indexDigest);

      const authority = await runScientificControlReplayV2Ceremony({
        organizationId: "00000000-0000-4000-8000-000000000415",
        testOnlyExecutionV2Authority: postgresTestOnlyExecutionV2Authority,
      });
      expect(authority.executionV2AuthorityProof).toMatchObject({
        reservationTransferredToPending: true,
        restartPreservedEffectIdentity: true,
        networkSubmissionCalls: 1,
        restartSubmissionCalls: 0,
        terminalStatus: "RECONCILIATION_REQUIRED",
      });
      expect(authority.fillId).toBeNull();
    } finally {
      cleanupCapitalPathTraceArtifacts(stagingDir);
    }
  }, 30_000);

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
