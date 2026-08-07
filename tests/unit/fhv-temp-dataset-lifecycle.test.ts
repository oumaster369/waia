/**
 * WP-0 — FHV temporary dataset lifecycle closure.
 *
 * Locks the thirteen required behaviours that prevent unbounded official-scale corpus
 * materialization under TMPDIR (151 leaked roots / 256.1 GB in the PR452 forensics).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireFhvManagedDatasetRoot,
  assertFhvLocalDatasetDiskPreflight,
  assertFhvOfficialFullCorpusExecutionSurface,
  buildFhvTempDatasetIdentityFromSealedDataset,
  classifyFhvTempRootsForSweep,
  FHV_LOCAL_MIN_FREE_BYTES,
  FHV_MANAGED_TEMP_PREFIXES,
  FHV_PRESERVED_FAILURE_ROOT_LIMIT,
  FHV_TEMP_DATASET_IDENTITY_FILENAME,
  FHV_TEMP_ROOT_LOCK_FILENAME,
  findReusableFhvDatasetRoot,
  isFhvTempRootActive,
  listFhvManagedTempRoots,
  readFhvTempDatasetIdentity,
  readFhvTempRootLock,
  releaseFhvManagedDatasetRoot,
  sweepStaleFhvTempRoots,
} from "@/tests/helpers/fhv-temp-root-registry";

const RELEASE_SHA = "528a5a5529f42eb9998f783a5827e23ea3a7f557";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

let tempRootDir = "";

/** Minimal sealed-dataset surface: enough for identity derivation and verification. */
function writeFakeSealedDataset(root: string, datasetContentDigest: string): void {
  writeFileSync(
    join(root, "fhv-dataset-manifest.v2.json"),
    JSON.stringify({
      schemaVersion: "fhv-dataset-manifest/v2",
      datasetContentDigest,
      manifestSemanticDigest: `m${datasetContentDigest.slice(1)}`,
      sourceLogicalDatasetDigest: datasetContentDigest,
      holdoutSealDigest: `h${datasetContentDigest.slice(1)}`,
      releaseSha: RELEASE_SHA,
    }),
    "utf8",
  );
  writeFileSync(
    join(root, "fhv-dataset-seal-receipt.v2.json"),
    JSON.stringify({
      schemaVersion: "fhv-dataset-seal-receipt/v2",
      datasetContentDigest,
      sealedAtUtc: new Date().toISOString(),
      sealReceiptDigest: `s${datasetContentDigest.slice(1)}`,
    }),
    "utf8",
  );
  writeFileSync(join(root, "bars.v2.ndjson"), "{}\n", "utf8");
}

function fakeBuilder(datasetContentDigest: string): (root: string) => void {
  return (root: string) => writeFakeSealedDataset(root, datasetContentDigest);
}

function identityOf(builtBy: string) {
  return (root: string) =>
    buildFhvTempDatasetIdentityFromSealedDataset(root, { builtBy, totalBars: 6_312_960 });
}

function acquire(
  prefix: (typeof FHV_MANAGED_TEMP_PREFIXES)[number],
  digest = DIGEST_A,
  builtBy = "fakeBuilder",
): string {
  return acquireFhvManagedDatasetRoot(
    {
      prefix,
      build: fakeBuilder(digest),
      identityOf: identityOf(builtBy),
      releaseSha: RELEASE_SHA,
      minFreeBytes: 1,
    },
    { tempRootDir },
  ).datasetRoot;
}

/** Simulate a SIGKILLed owner: an ACTIVE lock from a dead pid, aged past the freshness window. */
function orphanRoot(root: string, prefix: string): void {
  writeFileSync(
    join(root, FHV_TEMP_ROOT_LOCK_FILENAME),
    JSON.stringify({
      schemaVersion: "fhv-temp-root-lock/v1",
      pid: 999_999_999,
      startedAtUtc: new Date(0).toISOString(),
      prefix,
      outcome: "ACTIVE",
    }),
    "utf8",
  );
}

/** Clock far enough ahead that any freshly written lock is past the freshness window. */
function stalenessClock(): number {
  return Date.now() + 10_000_000;
}

function managedDirCount(): number {
  return readdirSync(tempRootDir).filter((name) =>
    FHV_MANAGED_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix)),
  ).length;
}

beforeEach(() => {
  tempRootDir = mkdtempSync(join(tmpdir(), "fhv-lifecycle-spec-"));
});

afterEach(() => {
  if (tempRootDir) {
    rmSync(tempRootDir, { recursive: true, force: true });
    tempRootDir = "";
  }
  delete process.env.FHV_PRESERVE_TEMP_DATASETS;
});

describe("WP-0 FHV temp dataset lifecycle", () => {
  it("B8: disk preflight fails closed below the floor with a named classification", () => {
    expect(() =>
      assertFhvLocalDatasetDiskPreflight({
        tempRootDir,
        minFreeBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/BLOCKED_BY_FHV_LOCAL_DISK_CAPACITY/);

    const ok = assertFhvLocalDatasetDiskPreflight({ tempRootDir, minFreeBytes: 1 });
    expect(ok.availableBytes).toBeGreaterThan(0);
    expect(FHV_LOCAL_MIN_FREE_BYTES).toBe(30_000_000_000);
  });

  it("B5 + B12: writes a per-run ownership lock and a stable identity sidecar", () => {
    const root = acquire("fhv-official-scale-dataset-");

    const lock = readFhvTempRootLock(root);
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.outcome).toBe("ACTIVE");
    expect(existsSync(join(root, FHV_TEMP_ROOT_LOCK_FILENAME))).toBe(true);

    const identity = readFhvTempDatasetIdentity(root);
    expect(identity).not.toBeNull();
    expect(identity?.datasetContentDigest).toBe(DIGEST_A);
    expect(identity?.manifestSemanticDigest).toBe(`m${DIGEST_A.slice(1)}`);
    expect(identity?.sourceLogicalDatasetDigest).toBe(DIGEST_A);
    expect(identity?.holdoutSealDigest).toBe(`h${DIGEST_A.slice(1)}`);
    expect(identity?.sealReceiptDigest).toBe(`s${DIGEST_A.slice(1)}`);
    expect(identity?.releaseSha).toBe(RELEASE_SHA);
    expect(identity?.totalBars).toBe(6_312_960);
    expect(existsSync(join(root, FHV_TEMP_DATASET_IDENTITY_FILENAME))).toBe(true);
  });

  it("B2: cleanup runs after PASS", () => {
    const root = acquire("fhv-official-scale-dataset-");
    expect(releaseFhvManagedDatasetRoot(root, "PASS", { tempRootDir })).toBe("REMOVED");
    expect(existsSync(root)).toBe(false);
    expect(managedDirCount()).toBe(0);
  });

  it("B2 + B3 + B11: ordinary FAIL preserves at most the newest N roots", () => {
    const first = acquire("fhv-official-scale-dataset-");
    releaseFhvManagedDatasetRoot(first, "FAIL", { tempRootDir, nowMs: 1_000 });
    expect(existsSync(first)).toBe(true);

    const second = acquire("fhv-official-scale-dataset-", DIGEST_B);
    releaseFhvManagedDatasetRoot(second, "FAIL", { tempRootDir, nowMs: 2_000 });

    expect(FHV_PRESERVED_FAILURE_ROOT_LIMIT).toBe(1);
    expect(existsSync(second)).toBe(true);
    expect(existsSync(first)).toBe(false);
    expect(managedDirCount()).toBe(1);
  });

  it("B4: explicit opt-in preservation retains a PASS root", () => {
    process.env.FHV_PRESERVE_TEMP_DATASETS = "1";
    const root = acquire("fhv-official-scale-dataset-");
    expect(releaseFhvManagedDatasetRoot(root, "PASS", { tempRootDir })).toBe("PRESERVED");
    expect(existsSync(root)).toBe(true);
  });

  it("B1: a throwing build leaves no partial root behind", () => {
    expect(() =>
      acquireFhvManagedDatasetRoot(
        {
          prefix: "fhv-official-scale-dataset-",
          build: (root) => {
            writeFileSync(join(root, "partial.ndjson"), "x", "utf8");
            throw new Error("synthetic build failure");
          },
          identityOf: identityOf("fakeBuilder"),
          minFreeBytes: 1,
        },
        { tempRootDir },
      ),
    ).toThrow(/synthetic build failure/);

    expect(managedDirCount()).toBe(0);
  });

  it("B6 + B9: repeated runs recover the stale root instead of accumulating copies", () => {
    let builds = 0;
    const countingBuild = (root: string): void => {
      builds += 1;
      writeFakeSealedDataset(root, DIGEST_A);
    };

    for (let run = 0; run < 3; run += 1) {
      const { datasetRoot } = acquireFhvManagedDatasetRoot(
        {
          prefix: "fhv-official-scale-dataset-",
          build: countingBuild,
          identityOf: identityOf("fakeBuilder"),
          releaseSha: RELEASE_SHA,
          minFreeBytes: 1,
        },
        { tempRootDir, nowMs: stalenessClock() },
      );
      // Simulate a killed process: leave the root behind without releasing it.
      orphanRoot(datasetRoot, "fhv-official-scale-dataset-");
      expect(managedDirCount()).toBe(1);
    }

    expect(builds).toBe(1);
    expect(managedDirCount()).toBe(1);
  });

  it("B13: reuses a matching identity across a different helper prefix", () => {
    const seeded = acquire("fhv-source-frontier-v2-");
    orphanRoot(seeded, "fhv-source-frontier-v2-");

    const reusable = findReusableFhvDatasetRoot(
      { datasetContentDigest: DIGEST_A },
      { tempRootDir, nowMs: stalenessClock() },
    );
    expect(reusable?.path).toBe(seeded);

    const result = acquireFhvManagedDatasetRoot(
      {
        prefix: "fhv-cursor-restore-v2-",
        build: () => {
          throw new Error("must not rebuild an already-materialized datasetContentDigest");
        },
        identityOf: identityOf("fakeBuilder"),
        expectedDatasetContentDigest: DIGEST_A,
        minFreeBytes: 1,
      },
      { tempRootDir, nowMs: stalenessClock() },
    );
    expect(result.reused).toBe(true);
    expect(result.datasetRoot).toBe(seeded);
    expect(managedDirCount()).toBe(1);
  });

  it("B10: an active run is never swept or released by another owner", () => {
    const root = acquire("fhv-official-scale-dataset-");
    expect(isFhvTempRootActive(root, { tempRootDir })).toBe(true);

    const foreign = releaseFhvManagedDatasetRoot(root, "PASS", {
      tempRootDir,
      isPidAlive: () => true,
    });
    // Same-pid owner may release; a foreign live owner may not.
    expect(foreign).toBe("REMOVED");

    const other = acquire("fhv-source-frontier-v2-", DIGEST_B);
    writeFileSync(
      join(other, FHV_TEMP_ROOT_LOCK_FILENAME),
      JSON.stringify({
        schemaVersion: "fhv-temp-root-lock/v1",
        pid: 424_242,
        startedAtUtc: new Date().toISOString(),
        prefix: "fhv-source-frontier-v2-",
        outcome: "ACTIVE",
      } satisfies Record<string, unknown>),
      "utf8",
    );
    expect(
      releaseFhvManagedDatasetRoot(other, "PASS", { tempRootDir, isPidAlive: () => true }),
    ).toBe("SKIPPED_ACTIVE");
    expect(existsSync(other)).toBe(true);

    const plan = classifyFhvTempRootsForSweep({
      tempRootDir,
      isPidAlive: () => true,
      minAgeMs: 0,
      nowMs: Date.now() + 10_000_000,
    });
    expect(plan.deletable).toHaveLength(0);
    expect(plan.entries.every((entry) => entry.disposition === "RETAIN_ACTIVE")).toBe(true);
  });

  it("B7: sweep deletes only aged duplicates of a retained identity and never unmatched roots", () => {
    const keep = acquire("fhv-official-scale-dataset-");
    const duplicate = acquire("fhv-source-frontier-v2-", DIGEST_A);
    const unmatched = mkdtempSync(join(tempRootDir, "fhv-cursor-restore-v2-"));
    mkdirSync(join(unmatched, "partitions"), { recursive: true });

    const sweepOptions = {
      tempRootDir,
      isPidAlive: () => false,
      minAgeMs: 0,
      nowMs: Date.now() + 10_000_000,
    };

    const dryRun = sweepStaleFhvTempRoots({ ...sweepOptions, dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.removed).toHaveLength(0);
    expect(existsSync(keep)).toBe(true);
    expect(existsSync(duplicate)).toBe(true);
    expect(existsSync(unmatched)).toBe(true);

    const unmatchedEntry = dryRun.plan.entries.find((entry) => entry.path === unmatched);
    expect(unmatchedEntry?.disposition).toBe("RETAIN_UNMATCHED");

    const confirmed = sweepStaleFhvTempRoots({ ...sweepOptions, dryRun: false });
    expect(confirmed.removed).toHaveLength(1);
    expect(existsSync(unmatched)).toBe(true);
    // Exactly one of the two identical-identity roots survives.
    expect([keep, duplicate].filter((path) => existsSync(path))).toHaveLength(1);
  });

  it("B7: a root whose sidecar no longer matches the dataset is retained for Human review", () => {
    const root = acquire("fhv-official-scale-dataset-");
    writeFakeSealedDataset(root, DIGEST_B);

    const plan = classifyFhvTempRootsForSweep({
      tempRootDir,
      isPidAlive: () => false,
      minAgeMs: 0,
      nowMs: Date.now() + 10_000_000,
    });
    expect(plan.deletable).toHaveLength(0);
    expect(plan.entries[0]?.disposition).toBe("RETAIN_UNMATCHED");
  });

  it("discovery only ever considers the managed FHV prefixes", () => {
    acquire("fhv-official-scale-dataset-");
    mkdirSync(join(tempRootDir, "unrelated-tool-cache"), { recursive: true });

    const roots = listFhvManagedTempRoots({ tempRootDir });
    expect(roots).toHaveLength(1);
    expect(FHV_MANAGED_TEMP_PREFIXES).toEqual([
      "fhv-official-scale-dataset-",
      "fhv-source-frontier-v2-",
      "fhv-cursor-restore-v2-",
    ]);
  });

  it("official full-corpus execution is prohibited on the workstation", () => {
    expect(() => assertFhvOfficialFullCorpusExecutionSurface({})).toThrow(
      /BLOCKED_BY_FHV_OFFICIAL_FULL_CORPUS_WORKSTATION_PROHIBITION/,
    );
    expect(assertFhvOfficialFullCorpusExecutionSurface({ GITHUB_ACTIONS: "true" }).surface).toBe(
      "GITHUB_ACTIONS",
    );
    expect(assertFhvOfficialFullCorpusExecutionSurface({ CI: "true" }).surface).toBe(
      "GITHUB_ACTIONS",
    );
    expect(
      assertFhvOfficialFullCorpusExecutionSurface({
        FHV_OFFICIAL_EXECUTION_SURFACE: "EXECUTION_SERVER",
      }).surface,
    ).toBe("EXECUTION_SERVER");
  });
});
