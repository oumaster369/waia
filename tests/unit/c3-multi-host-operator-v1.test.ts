import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertInventoryStillFreshV1,
  captureFreshMissingInventoryV1,
  claimOffsetV1,
  C3MultiHostOperatorError,
  importShardEvidenceV1,
  partitionShardManifestsV1,
  reconcileExactCoverageV1,
  retryMissingOffsetsV1,
  type C3CampaignIdentityV1,
  type C3ShardEvidenceV1,
} from "@/lib/trader/historical-qualification/c3-multi-host-operator-v1";

const IDENTITY: C3CampaignIdentityV1 = {
  campaignId: "c3-synthetic",
  releaseSha: "a".repeat(40),
  p2DigestHex: "b".repeat(64),
  g1DigestHex: "c".repeat(64),
  originDigestHex: "d".repeat(64),
  packageDigestHex: "e".repeat(64),
};

function evidence(offset: number, shardId: string): C3ShardEvidenceV1 {
  return {
    identity: IDENTITY,
    shardId,
    hostId: "host-a",
    offset,
    evidenceDigestHex: "f".repeat(64),
    inventoryDigestHex: "1".repeat(64),
  };
}

describe("C3 multi-host operator", () => {
  it("does not import the running producer or an order path", () => {
    const source = readFileSync(
      resolve("lib/trader/historical-qualification/c3-multi-host-operator-v1.ts"),
      "utf8",
    );
    expect(source).not.toContain("historical-simulation-v2");
    expect(source).not.toContain("missing-only-forecast-producer");
    expect(source).not.toContain("placeOrder");
    expect(source).not.toContain("child_process");
  });

  it("excludes completed offsets and refuses a stale inventory", () => {
    const inventory = captureFreshMissingInventoryV1({
      identity: IDENTITY,
      targetOffsets: [3, 1, 2, 0],
      completed: [{ offset: 1, evidenceDigestHex: "f".repeat(64) }],
    });
    expect(inventory.offsets).toEqual([0, 2, 3]);
    assertInventoryStillFreshV1(inventory, [{ offset: 1, evidenceDigestHex: "f".repeat(64) }]);
    expect(() =>
      assertInventoryStillFreshV1(inventory, [
        { offset: 1, evidenceDigestHex: "f".repeat(64) },
        { offset: 0, evidenceDigestHex: "a".repeat(64) },
      ]),
    ).toThrow(C3MultiHostOperatorError);
  });

  it("partitions a fresh inventory into disjoint exhaustive shards", () => {
    const inventory = captureFreshMissingInventoryV1({
      identity: IDENTITY,
      targetOffsets: [0, 1, 2, 3, 4],
      completed: [],
    });
    const first = partitionShardManifestsV1({ inventory, hostCount: 2 });
    const second = partitionShardManifestsV1({ inventory, hostCount: 2 });
    expect(first.map((shard) => shard.shardId)).toEqual(second.map((shard) => shard.shardId));
    expect(first.flatMap((shard) => [...shard.offsets]).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    const overlap = first[0]?.offsets.filter((offset) => first[1]?.offsets.includes(offset));
    expect(overlap).toEqual([]);
  });

  it("refuses a second host claim and a conflicting evidence import", () => {
    const inventory = captureFreshMissingInventoryV1({
      identity: IDENTITY,
      targetOffsets: [0, 1],
      completed: [],
    });
    const shards = partitionShardManifestsV1({ inventory, hostCount: 1 });
    const shardId = shards[0]?.shardId ?? "";
    const claims = claimOffsetV1([], {
      offset: 0,
      hostId: "host-a",
      inventoryDigestHex: inventory.contentDigestHex,
    });
    expect(claimOffsetV1(claims, claims[0]!).length).toBe(1);
    expect(() =>
      claimOffsetV1(claims, {
        offset: 0,
        hostId: "host-b",
        inventoryDigestHex: inventory.contentDigestHex,
      }),
    ).toThrow(/CLAIM_COLLISION/);

    const row = { ...evidence(0, shardId), inventoryDigestHex: inventory.contentDigestHex };
    const accepted = importShardEvidenceV1([], row, new Set([shardId]));
    expect(importShardEvidenceV1(accepted, row, new Set([shardId]))).toBe(accepted);
    expect(() =>
      importShardEvidenceV1(
        accepted,
        { ...row, evidenceDigestHex: "9".repeat(64) },
        new Set([shardId]),
      ),
    ).toThrow(/EVIDENCE_CONFLICT/);
  });

  it("retries only missing offsets and reconciles exact coverage", () => {
    const inventory = captureFreshMissingInventoryV1({
      identity: IDENTITY,
      targetOffsets: [0, 1, 2],
      completed: [{ offset: 0, evidenceDigestHex: "a".repeat(64) }],
    });
    const shards = partitionShardManifestsV1({ inventory, hostCount: 1 });
    const shardId = shards[0]?.shardId ?? "";
    const accepted = importShardEvidenceV1(
      [],
      { ...evidence(1, shardId), inventoryDigestHex: inventory.contentDigestHex },
      new Set([shardId]),
    );
    const retry = retryMissingOffsetsV1({
      identity: IDENTITY,
      targetOffsets: [0, 1, 2],
      completed: [{ offset: 0, evidenceDigestHex: "a".repeat(64) }],
      accepted,
    });
    expect(retry.offsets).toEqual([2]);
    expect(() =>
      reconcileExactCoverageV1({
        targetOffsets: [0, 1, 2],
        completed: [{ offset: 0, evidenceDigestHex: "a".repeat(64) }],
        accepted,
      }),
    ).toThrow(/COVERAGE_GAP/);
    const closed = importShardEvidenceV1(
      accepted,
      { ...evidence(2, shardId), inventoryDigestHex: inventory.contentDigestHex },
      new Set([shardId]),
    );
    expect(
      reconcileExactCoverageV1({
        targetOffsets: [0, 1, 2],
        completed: [{ offset: 0, evidenceDigestHex: "a".repeat(64) }],
        accepted: closed,
      }).covered,
    ).toBe(3);
  });
});
