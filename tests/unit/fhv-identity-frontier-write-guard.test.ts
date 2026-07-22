import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { HTR_WP03_BENCHMARK_FIXTURE_SHA256 } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayCheckpoint,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  serializeCheckpoint,
  writeReplayCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  assertIdentityFrontierMonotonicWrite,
  FhvCampaignIdentityError,
} from "@/lib/trader/observability/fhv-campaign-identity";
import { buildSyntheticEconomicFrontier } from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";

const RUN_ID = "fhv-write-guard-unit";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";

function baseCheckpoint(identity: {
  safeResumeThroughCycleIndex: number;
  newIdSeq: number;
  randomUuidSeq: number;
}) {
  return serializeCheckpoint({
    schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
    backtestRunId: RUN_ID,
    datasetContentDigest: "digest",
    datasetId: "fhv-rehearsal-wp03",
    codeSha: TARGET_SHA,
    activePhase: "validation",
    dbDurableThroughPhase: "none",
    evidenceDurableThroughCycleIndex: identity.safeResumeThroughCycleIndex,
    safeResumeThroughCycleIndex: identity.safeResumeThroughCycleIndex,
    evidenceRunDir: "/tmp/evidence",
    evidenceChainDigest: "chain",
    evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
    dbConnectionMode: "harness",
    replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
    fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    campaignIdentityFrontierState: {
      schemaVersion: "fhv-campaign-identity-frontier/v1",
      runId: RUN_ID,
      organizationId: ORG_ID,
      ...identity,
    },
    rehearsalEconomicFrontierState: buildSyntheticEconomicFrontier({
      runId: RUN_ID,
      organizationId: ORG_ID,
      safeResumeThroughCycleIndex: identity.safeResumeThroughCycleIndex,
    }),
  });
}

describe("FHV identity frontier monotonic write guard (DEE-431 R3)", () => {
  it("accepts valid monotonic write", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-write-guard-ok-"));
    try {
      writeReplayCheckpoint(
        root,
        baseCheckpoint({ safeResumeThroughCycleIndex: 44, newIdSeq: 10, randomUuidSeq: 10 }),
      );
      expect(() =>
        assertIdentityFrontierMonotonicWrite({
          runRoot: root,
          frontier: {
            schemaVersion: "fhv-campaign-identity-frontier/v1",
            runId: RUN_ID,
            organizationId: ORG_ID,
            safeResumeThroughCycleIndex: 45,
            newIdSeq: 11,
            randomUuidSeq: 11,
          },
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "cycle frontier rollback",
      { safeResumeThroughCycleIndex: 43, newIdSeq: 11, randomUuidSeq: 11 },
    ],
    ["newIdSeq rollback", { safeResumeThroughCycleIndex: 45, newIdSeq: 9, randomUuidSeq: 11 }],
    ["randomUuidSeq rollback", { safeResumeThroughCycleIndex: 45, newIdSeq: 11, randomUuidSeq: 9 }],
    ["mixed rollback", { safeResumeThroughCycleIndex: 43, newIdSeq: 9, randomUuidSeq: 9 }],
  ] as const)("rejects %s", (_label, nextIdentity) => {
    const root = mkdtempSync(join(tmpdir(), "fhv-write-guard-rollback-"));
    try {
      writeReplayCheckpoint(
        root,
        baseCheckpoint({ safeResumeThroughCycleIndex: 44, newIdSeq: 10, randomUuidSeq: 10 }),
      );
      expect(() =>
        assertIdentityFrontierMonotonicWrite({
          runRoot: root,
          frontier: {
            schemaVersion: "fhv-campaign-identity-frontier/v1",
            runId: RUN_ID,
            organizationId: ORG_ID,
            ...nextIdentity,
          },
        }),
      ).toThrow(FhvCampaignIdentityError);
      try {
        assertIdentityFrontierMonotonicWrite({
          runRoot: root,
          frontier: {
            schemaVersion: "fhv-campaign-identity-frontier/v1",
            runId: RUN_ID,
            organizationId: ORG_ID,
            ...nextIdentity,
          },
        });
      } catch (error) {
        expect((error as FhvCampaignIdentityError).code).toBe(
          "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK",
        );
      }
      const prior = readReplayCheckpoint(root);
      expect(prior?.campaignIdentityFrontierState?.newIdSeq).toBe(10);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
