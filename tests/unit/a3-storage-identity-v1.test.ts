import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGGREGATE_IMPLEMENTATION_PATHS,
  computeA3CanonicalContractDigestHex,
  computeA3PackageSurfaceSemanticDigestHex,
  computeA3PhaseIdentityLayers,
  computePhase01ImplementationDigestHex,
  computeStorageSurfaceDigestHex,
  computeWorktreeProvenanceDigestHex,
  PHASE01_IMPLEMENTATION_PATHS,
  PHASE02_IMPLEMENTATION_PATHS,
  PHASE03_IMPLEMENTATION_PATHS,
  STORAGE_SURFACE_PATHS,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-contract-v1";
import { computeA3AggregateReceipt } from "@/lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1";
import {
  assertAggregateReceiptInputsCompatible,
  assertPhaseReceiptStillValid,
  listInvalidatedPhases,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-invalidation-manifest-v1";
import { readA3ReceiptFile } from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import {
  a3TestIdentity,
  sampleA3Phase01,
  sampleA3Phase02,
  sampleA3Phase03,
  sampleA3Provenance,
} from "./a3-storage-test-fixtures-v1";

const REPO_ROOT = join(__dirname, "../..");
const DIAGNOSTICS_PATH =
  "lib/trader/intelligence/forecast-v2/a3-phase01-progress-diagnostics-v1.ts";

function loadIdentity(
  dirtyTreeDigestHex = "test-dirty-tree",
): ReturnType<typeof computeA3PhaseIdentityLayers> {
  return computeA3PhaseIdentityLayers({
    repoRoot: REPO_ROOT,
    localHeadCommit: "test-head",
    dirtyTreeDigestHex,
  });
}

describe("A3 identity layers and invalidation manifest", () => {
  it("canonical contract digest remains Human-ratified b4474831…", () => {
    expect(computeA3CanonicalContractDigestHex()).toBe(
      "b4474831d71b7b1326dc547461329411dcb9bc4cb8802f80cf0ed11690161548",
    );
  });

  it("storage surface digest changes from pre-repair physical surface", () => {
    const storage = computeStorageSurfaceDigestHex(REPO_ROOT);
    expect(storage).not.toBe("7741176d39c2a4207bb7ad96a29f40859e22c4bdc33d8b43d189d1680cee4cbc");
    expect(storage).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stall-detector-only source change changes phase01 implementation but not storage surface", () => {
    const canonicalBefore = computeA3CanonicalContractDigestHex();
    const storageBefore = computeStorageSurfaceDigestHex(REPO_ROOT);
    const phase01Before = computePhase01ImplementationDigestHex(REPO_ROOT);
    const diagnosticsContent = readFileSync(join(REPO_ROOT, DIAGNOSTICS_PATH), "utf8");
    const phase01After = computePhase01ImplementationDigestHex(REPO_ROOT, {
      [DIAGNOSTICS_PATH]: `${diagnosticsContent}\n// stall-detector tweak\n`,
    });

    expect(computeA3CanonicalContractDigestHex()).toBe(canonicalBefore);
    expect(computeStorageSurfaceDigestHex(REPO_ROOT)).toBe(storageBefore);
    expect(phase01After).not.toBe(phase01Before);
    expect(PHASE01_IMPLEMENTATION_PATHS).toContain(DIAGNOSTICS_PATH);
    expect(STORAGE_SURFACE_PATHS).not.toContain(DIAGNOSTICS_PATH);
  });

  it("DEE-531-only change does not invalidate A3 receipts", () => {
    const identity = loadIdentity();
    const stored = sampleA3Phase01();
    const dee531Paths = [
      "lib/trader/research/benchmark/validation-bootstrap-v1.ts",
      "lib/trader/research/benchmark/research-harness-admission-orchestrator-v1.ts",
    ];
    for (const path of [
      ...PHASE01_IMPLEMENTATION_PATHS,
      ...PHASE02_IMPLEMENTATION_PATHS,
      ...PHASE03_IMPLEMENTATION_PATHS,
      ...AGGREGATE_IMPLEMENTATION_PATHS,
      ...STORAGE_SURFACE_PATHS,
    ]) {
      expect(dee531Paths).not.toContain(path);
    }
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase01", stored, current: identity }),
    ).not.toThrow();
  });

  it("PHASE-02-only implementation change invalidates phase02 but preserves phase01", () => {
    const identity = loadIdentity();
    const storedPhase01 = sampleA3Phase01();
    const storedPhase02 = sampleA3Phase02({ phaseImplementationDigest: "old-phase02-impl" });
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase01", stored: storedPhase01, current: identity }),
    ).not.toThrow();
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase02", stored: storedPhase02, current: identity }),
    ).toThrow(/invalidated/);
  });

  it("PHASE-03-only implementation change invalidates phase03 only", () => {
    const identity = loadIdentity();
    const storedPhase01 = sampleA3Phase01();
    const storedPhase03 = sampleA3Phase03({ phaseImplementationDigest: "old-phase03-impl" });
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase01", stored: storedPhase01, current: identity }),
    ).not.toThrow();
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase03", stored: storedPhase03, current: identity }),
    ).toThrow(/invalidated/);
  });

  it("aggregate-only code change requires re-aggregation without invalidating measurement receipts", () => {
    const identity = loadIdentity();
    const storedPhase01 = sampleA3Phase01();
    expect(() =>
      assertPhaseReceiptStillValid({ phase: "phase01", stored: storedPhase01, current: identity }),
    ).not.toThrow();
    const aggregateInvalidated = listInvalidatedPhases({
      stored: {
        a3CanonicalContractDigest: identity.a3CanonicalContractDigest,
        storageSurfaceDigest: identity.storageSurfaceDigest,
        phaseImplementationDigest: "old-aggregate-implementation",
        worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
      },
      current: identity,
      phase: "aggregate",
    });
    expect(aggregateInvalidated).toEqual(["aggregate"]);
  });

  it("DDL/storage-surface change invalidates phase01 and phase02", () => {
    const identity = loadIdentity();
    const stored = sampleA3Phase01({ storageSurfaceDigest: "old-storage-surface" });
    const invalidated = listInvalidatedPhases({
      stored,
      current: identity,
      phase: "phase01",
    });
    expect(invalidated).toContain("phase01");
    expect(invalidated).toContain("phase02");
  });

  it("aggregate fails closed on observed package surface mismatch", () => {
    const aggregate = computeA3AggregateReceipt({
      identity: a3TestIdentity,
      provenance: sampleA3Provenance(),
      phase01: sampleA3Phase01(),
      phase02: sampleA3Phase02({ observedPackageSurfaceDigestHex: "mismatch" }),
      phase03: sampleA3Phase03(),
    });
    expect(aggregate.pass).toBe(false);
  });

  it("fails closed on corrupt receipt digest", () => {
    expect(() => readA3ReceiptFile(join("/tmp", "missing-a3-phase-01.json"))).toThrow(
      /missing receipt/,
    );
  });

  it("differing worktree provenance alone does not invalidate compatible receipts", () => {
    const identity = loadIdentity("dirty-tree-a");
    const otherWorktree = loadIdentity("dirty-tree-b");
    const stored = sampleA3Phase01();
    expect(stored.worktreeProvenanceDigest).not.toBe(otherWorktree.worktreeProvenanceDigest);
    expect(() =>
      assertAggregateReceiptInputsCompatible({
        current: otherWorktree,
        phase01: stored,
        phase02: sampleA3Phase02(),
        phase03: sampleA3Phase03(),
      }),
    ).not.toThrow();
  });

  it("expected package digest remains canonical-only", () => {
    const identity = loadIdentity();
    expect(identity.packageSurfaceSemanticDigestHex).toBe(
      computeA3PackageSurfaceSemanticDigestHex(),
    );
    expect(computeWorktreeProvenanceDigestHex("abc")).not.toBe(
      computeWorktreeProvenanceDigestHex("def"),
    );
  });
});
