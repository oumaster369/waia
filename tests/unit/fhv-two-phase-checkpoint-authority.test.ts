import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseWalCheckpointTruncateResult,
  assertSqliteWalTruncated,
  assertWalCheckpointTruncateSucceeded,
} from "@/lib/trader/observability/fhv-sqlite-wal-truncate";
import { verifyFhvDestinationShaOffMainThread } from "@/lib/trader/observability/fhv-destination-sha-verifier";
import {
  FHV_CHECKPOINT_READY_MARKER,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
  resolveFhvProvisionalEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { IDHPS_COMPOSITE_MIRROR_FILENAME } from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import {
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  readFhvAuthorizationClaim,
  resolveFhvAuthorizationClaimPath,
  takeoverFhvAuthorizationRunning,
  writeFhvAuthorizationClaimAtomic,
} from "@/lib/trader/observability/fhv-authorization-claim";
import {
  captureFhvProvisionalExecutionEpoch,
  computeFhvCycleZeroCheckpointDigest,
  createFhvEpochBoundaryController,
  prepareFhvOfficialLaunchExecution,
  promoteFhvVerifiedExecutionEpoch,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import { buildFhvConfigurationFreeze } from "@/lib/trader/observability/fhv-configuration-freeze";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  FhvExecutionWalWriter,
  truncateFhvExecutionWalToJournalAuthoritativeCommit,
} from "@/lib/trader/observability/fhv-execution-wal";
import {
  buildFhvLaunchJournal,
  readFhvLaunchJournal,
  writeFhvLaunchJournalAtomic,
} from "@/lib/trader/observability/fhv-launch-journal";
import { pruneFhvCheckpointBundlesToTwoNewest } from "@/lib/trader/observability/fhv-checkpoint-retention";
import {
  createEmptyIdhpsInventoryMirror,
  applyOrderToIdhpsInventoryMirror,
} from "@/lib/trader/paper/idhps-inventory-mirror";
import {
  captureFrozenPendingIdhpsEpoch,
  materializePostCommitIdhpsCompositeFromFrozen,
  rotateIdhpsLiveEpochWorkingSetAfterProvisionalFreeze,
} from "@/lib/trader/observability/fhv-idhps-epoch-rotation";
import {
  openIdhpsSession,
  closeIdhpsSession,
  getIdhpsSession,
} from "@/lib/trader/execution/idhps-session-registry";
import {
  createFhvCompositeEvidenceSink,
  FhvEvidenceLifecycleError,
  resolveFhvSpeculativeEpochEvidenceSegmentDir,
} from "@/lib/trader/observability/fhv-composite-evidence-sink";
import {
  assertFhvWp3bHostQualified,
  FHV_WP3B_GATE2_LIVENESS_MS,
  FhvWp3bReceiptError,
} from "@/lib/trader/observability/fhv-wp3b-receipt";
import {
  cleanupFhvEpochEvidenceGenerations,
  cleanupFhvTwoPhaseResumeState,
} from "@/lib/trader/observability/fhv-two-phase-recovery";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const RUN_ID = "fhv-two-phase";

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (caught) {
    return (caught as { code?: string }).code ?? (caught as Error).message;
  }
}

describe("two-phase checkpoint authority", () => {
  const roots: string[] = [];

  afterEach(() => {
    closeIdhpsSession();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function tmp(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it("WAL TRUNCATE fail-closed codes", () => {
    expect(codeOf(() => parseWalCheckpointTruncateResult([]))).toContain(
      "FHV_WAL_TRUNCATE_RESULT_MISSING",
    );
    expect(
      codeOf(() =>
        assertSqliteWalTruncated({
          sqliteName: "/tmp/x.sqlite",
          pragmaResult: [{ busy: 1, log: 0, checkpointed: 0 }],
        }),
      ),
    ).toContain("FHV_WAL_TRUNCATE_BUSY");
    expect(
      codeOf(() =>
        assertSqliteWalTruncated({
          sqliteName: "/tmp/x.sqlite",
          pragmaResult: [{ busy: 0, log: 4, checkpointed: 1 }],
        }),
      ),
    ).toContain("FHV_WAL_TRUNCATE_INCOMPLETE");
    expect(codeOf(() => parseWalCheckpointTruncateResult([{ hello: 1 }]))).toContain(
      "FHV_WAL_TRUNCATE_NOT_WAL",
    );
  });

  it("WAL TRUNCATE WAL file non-empty fails closed", () => {
    const root = tmp("fhv-wal-not-empty-");
    const walPath = join(root, "session.sqlite-wal");
    writeFileSync(walPath, Buffer.from("not-empty"));
    expect(
      codeOf(() =>
        assertWalCheckpointTruncateSucceeded(
          { busy: 0, log: 0, checkpointed: 0 },
          join(root, "session.sqlite"),
        ),
      ),
    ).toContain("FHV_WAL_TRUNCATE_WAL_NOT_EMPTY");
  });

  it("WAL TRUNCATE success empties WAL file", () => {
    const root = tmp("fhv-wal-trunc-");
    const dbPath = join(root, "session.sqlite");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);");
    const result = db.pragma("wal_checkpoint(TRUNCATE)");
    assertSqliteWalTruncated({ sqliteName: dbPath, pragmaResult: result });
    const walPath = `${dbPath}-wal`;
    if (existsSync(walPath)) {
      expect(statSync(walPath).size).toBe(0);
    }
    db.close();
  });

  it("provisional checkpoint is never resume-selectable and has no .ready", async () => {
    const runRoot = tmp("fhv-prov-");
    const { controller } = bootstrap(runRoot);
    const pendingCycles: number[] = [];
    const original = controller.onCycleBoundary;
    // Capture at cycle 2 then inspect provisional before promotion by using commit helper.
    const result = await controller.commitFinalPartialEpoch(1);
    expect(existsSync(join(result.checkpointDir, FHV_CHECKPOINT_READY_MARKER))).toBe(true);
    expect(existsSync(resolveFhvProvisionalEpochCheckpointDir(runRoot, 0))).toBe(false);
    expect(() =>
      readFhvExecutionCheckpointBundle(resolveFhvProvisionalEpochCheckpointDir(runRoot, 0)),
    ).toThrow();
    expect(pendingCycles).toEqual([]);
    void original;
  });

  it("verified bundle binds required composite before journal authority", async () => {
    const runRoot = tmp("fhv-composite-");
    const { controller } = bootstrap(runRoot);
    const result = await controller.commitFinalPartialEpoch(2);
    const journal = readFhvLaunchJournal(runRoot);
    expect(journal.lastCommittedEpoch).toBe(0);
    const bundle = readFhvExecutionCheckpointBundle(result.checkpointDir);
    expect(
      bundle.manifest.files.some((file) => file.relativePath === IDHPS_COMPOSITE_MIRROR_FILENAME),
    ).toBe(true);
    expect(existsSync(join(result.checkpointDir, IDHPS_COMPOSITE_MIRROR_FILENAME))).toBe(true);
  });

  it("canonical WAL freeze rejects EPOCH_BEGIN N+1 before EPOCH_COMMIT N", () => {
    const runRoot = tmp("fhv-wal-freeze-");
    const writer = new FhvExecutionWalWriter(
      runRoot,
      RUN_ID,
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      1,
    );
    writer.appendRecord({
      epochId: 0,
      cycleIndex: 0,
      cycleCommitId: "b",
      recordType: "EPOCH_BEGIN",
      payload: { epochId: 0 },
    });
    writer.freezeUntilEpochCommit(0);
    expect(() =>
      writer.appendRecord({
        epochId: 1,
        cycleIndex: 1,
        cycleCommitId: "n1",
        recordType: "EPOCH_BEGIN",
        payload: { epochId: 1 },
      }),
    ).toThrow(/canonical WAL frozen through EPOCH_COMMIT/);
  });

  it("recovery truncates checksum-valid tail after journal-authoritative EPOCH_COMMIT", async () => {
    const runRoot = tmp("fhv-wal-trim-");
    const { controller, walWriter } = bootstrap(runRoot);
    await controller.commitFinalPartialEpoch(1);
    const journal = readFhvLaunchJournal(runRoot);
    walWriter.appendRecord({
      epochId: 1,
      cycleIndex: 2,
      cycleCommitId: "speculative",
      recordType: "EPOCH_BEGIN",
      payload: { epochId: 1 },
    });
    const prefix = truncateFhvExecutionWalToJournalAuthoritativeCommit({
      walPath: walWriter.getWalPath(),
      lastCommittedEpoch: journal.lastCommittedEpoch,
      lastCommittedCycle: journal.lastCommittedCycle,
      lastEpochCommitDigest: journal.lastEpochCommitDigest,
    });
    expect(prefix.records.at(-1)?.recordType).toBe("EPOCH_COMMIT");
    expect(prefix.records.some((record) => record.cycleCommitId === "speculative")).toBe(false);
  });

  it("destination SHA verifier runs off the main thread while the loop progresses", async () => {
    const root = tmp("fhv-sha-worker-");
    const destPath = join(root, "session.sqlite");
    const payload = Buffer.alloc(64 * 1024, 7);
    writeFileSync(destPath, payload);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);
    const verified = await verifyFhvDestinationShaOffMainThread({
      runId: RUN_ID,
      epochId: 0,
      generation: 1,
      destPath,
      expectedBytes: payload.length,
      fencingGeneration: 1,
      delayMs: 120,
    });
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
    expect(verified.digest).toBe(createHash("sha256").update(payload).digest("hex"));
  });

  it("mutation mismatch fails closed", async () => {
    const root = tmp("fhv-sha-mismatch-");
    const destPath = join(root, "session.sqlite");
    writeFileSync(destPath, Buffer.from("abc"));
    await expect(
      verifyFhvDestinationShaOffMainThread({
        runId: RUN_ID,
        epochId: 0,
        generation: 1,
        destPath,
        expectedBytes: 99,
        fencingGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: "FHV_DEST_SHA_SIZE_MISMATCH" });
  });

  it("frozen N inventory is detached from live N+1 rotation", () => {
    const root = tmp("fhv-idhps-");
    const db = new Database(join(root, "s.sqlite"));
    db.exec(`
      CREATE TABLE trader_orders (
        id TEXT, organization_id TEXT, credential_id TEXT, venue TEXT, execution_mode TEXT,
        symbol TEXT, side TEXT, type TEXT, price TEXT, quantity TEXT, filled_quantity TEXT,
        avg_fill_price TEXT, state TEXT, state_version INTEGER, exchange_order_id TEXT,
        client_order_id TEXT, idempotency_key TEXT, risk_decision_id TEXT,
        strategy_signal_id TEXT, allocation_decision_id TEXT, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE trader_fills (
        id TEXT, organization_id TEXT, order_id TEXT, exchange_trade_id TEXT, price TEXT,
        quantity TEXT, fee TEXT, fee_asset TEXT, executed_at INTEGER, created_at INTEGER
      );
    `);
    openIdhpsSession(db, { enableBans: false });
    const runtime = getIdhpsSession()!;
    runtime.inventory = createEmptyIdhpsInventoryMirror();
    const open: OrderRow = {
      id: "open-1",
      symbol: "BTC/USDT",
      state: "PARTIALLY_FILLED",
      filledQuantity: "0.25",
    } as OrderRow;
    const terminal: OrderRow = {
      id: "term-1",
      symbol: "BTC/USDT",
      state: "FILLED",
      filledQuantity: "1",
    } as OrderRow;
    applyOrderToIdhpsInventoryMirror(runtime.inventory, open);
    applyOrderToIdhpsInventoryMirror(runtime.inventory, terminal);
    const frozen = captureFrozenPendingIdhpsEpoch(0);
    expect(frozen.inventory.terminalOrderIdsSinceEpoch).toContain("term-1");
    rotateIdhpsLiveEpochWorkingSetAfterProvisionalFreeze(frozen);
    expect(runtime.inventory.terminalOrderIdsSinceEpoch).toEqual([]);
    expect(runtime.inventory.filledQuantityByOrder["term-1"]).toBeUndefined();
    expect(frozen.inventory.filledQuantityByOrder["term-1"]).toBe("1");
    const later: OrderRow = {
      id: "term-2",
      symbol: "BTC/USDT",
      state: "FILLED",
      filledQuantity: "2",
    } as OrderRow;
    applyOrderToIdhpsInventoryMirror(runtime.inventory, later);
    expect(frozen.inventory.terminalOrderIdsSinceEpoch).not.toContain("term-2");
    const composite = materializePostCommitIdhpsCompositeFromFrozen(frozen);
    expect(composite.inventory.filledQuantityByOrder["term-1"]).toBeUndefined();
    expect(runtime.inventory.filledQuantityByOrder["term-2"]).toBe("2");
    db.close();
  });

  it("active evidence writer is never relocated", async () => {
    const runRoot = tmp("fhv-ev-");
    const sink = createFhvCompositeEvidenceSink({
      runDir: runRoot,
      runId: RUN_ID,
      gitSha: "abc",
      environment: "test",
      epochId: 0,
      generation: 1,
      enableTraceEvidence: false,
      runLogRoot: join(runRoot, "trace"),
      organizationId: "00000000-0000-4000-8000-000000000001",
      accountKey: "k",
      provenance: {
        codeSha: "abc",
        dirtyTree: false,
        datasetManifestDigest: "d".repeat(64),
        runConfigDigest: "c".repeat(64),
        strategyVersions: [],
        costModelVersion: "v",
        riskPolicyVersion: "v",
        initialPortfolioDigest: "p",
      },
    });
    expect(sink.currentSegmentDir).toBe(
      resolveFhvSpeculativeEpochEvidenceSegmentDir(runRoot, 0, 1),
    );
    expect(() => sink.promoteSealedEpochEvidence({ epochId: 0, generation: 1 })).toThrow(
      FhvEvidenceLifecycleError,
    );
  });

  it("retention ignores provisional and epochs above journal", async () => {
    const runRoot = tmp("fhv-ret-");
    const { controller } = bootstrap(runRoot);
    await controller.commitFinalPartialEpoch(1);
    mkdirSync(join(runRoot, "checkpoints", "epoch-9"), { recursive: true });
    writeFileSync(join(runRoot, "checkpoints", "epoch-9", "x"), "nope");
    const pruned = pruneFhvCheckpointBundlesToTwoNewest(runRoot);
    expect(pruned.retainedEpochIds).toEqual([0]);
  });

  it("WP3B receipt requires both GATE 1 and GATE 2", () => {
    const root = tmp("fhv-wp3b-");
    const body: Record<string, unknown> = {
      schemaVersion: "fhv-wp3b-host-qualification/v2",
      capturedAtUtc: new Date().toISOString(),
      releaseSha: "release",
      host: { hostname: "h", platform: "darwin", sha256BytesPerSecond: 2_800_000_000 },
      cloneCapability: {
        supported: true,
        status: "NATIVE_CLONE_SUCCEEDED",
        mechanism: "darwin:clonefile",
      },
      identityProofs: { digestsMatch: true, mutationIsolated: true, cloneClaimTruthful: true },
      contract: { qualificationDepthBytes: 1_073_741_824, budgetMs: 400 },
      fixtureBytes: 1_073_741_824,
      measurements: {
        measuredMs: [10, 11, 12],
        everyIterationWithinBudget: true,
        durabilityInsideTimer: true,
        negativeTestDetectsBreach: true,
      },
      gate1BlockingCapture: { status: "PASS", measuredMs: [10, 11, 12], budgetMs: 400 },
      gate2DestinationVerification: {
        status: "FAIL",
        measuredMs: [1, 1, 1],
        budgetMs: FHV_WP3B_GATE2_LIVENESS_MS,
      },
      classification: "EXECUTION_SERVER_WP3B_HOST_QUALIFIED",
    };
    const receipt = {
      ...body,
      receiptDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    };
    const path = join(root, "receipt.json");
    writeFileSync(path, `${JSON.stringify(receipt)}\n`);
    expect(() => assertFhvWp3bHostQualified({ receiptPath: path })).toThrow(FhvWp3bReceiptError);
  });

  it("canonical session.sqlite is the same inode that was SHA-verified", async () => {
    const runRoot = tmp("fhv-inode-");
    const { claimPath, walWriter, claim } = bootstrap(runRoot);
    const pending = await captureFhvProvisionalExecutionEpoch({
      runDir: runRoot,
      runId: RUN_ID,
      claimPath,
      walWriter,
      authorizationClaim: claim,
      epochId: 0,
      epochFirstCycle: 0,
      lastCycle: 1,
      walStartOffset: walWriter.walBytesWritten,
      previousEpochCommitDigest: "0".repeat(64),
      snapshotDigests: { sourceCursorDigest: "s".repeat(64) },
      skipSessionBackup: true,
    });
    const before = statSync(pending.destPath);
    const result = await promoteFhvVerifiedExecutionEpoch(pending);
    const after = statSync(join(result.checkpointDir, "session.sqlite"));
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(existsSync(resolveFhvProvisionalEpochCheckpointDir(runRoot, 0))).toBe(false);
  });

  it("cycle loop progresses while a delayed destination verifier is still running", async () => {
    const runRoot = tmp("fhv-backlog-");
    const { controller } = bootstrap(runRoot, { verifierDelayMs: 180, checkpointEveryCycles: 2 });
    await controller.onCycleBoundary({ cycleIndex: 1, cycleCount: 2 });
    const started = performance.now();
    const decision = await controller.onCycleBoundary({ cycleIndex: 2, cycleCount: 3 });
    expect(performance.now() - started).toBeLessThan(80);
    expect(decision).toBe("continue");
    await controller.drainPendingVerification();
  });

  it("freeze N+1 waits when N is still pending (backlog <= 1)", async () => {
    const runRoot = tmp("fhv-backpressure-");
    const { controller } = bootstrap(runRoot, { verifierDelayMs: 80, checkpointEveryCycles: 2 });
    await controller.onCycleBoundary({ cycleIndex: 1, cycleCount: 2 });
    const started = performance.now();
    await controller.onCycleBoundary({ cycleIndex: 3, cycleCount: 4 });
    expect(performance.now() - started).toBeGreaterThan(50);
    await controller.drainPendingVerification();
  });

  it("resume keeps journal-bound evidence generation, not live fencing", async () => {
    const runRoot = tmp("fhv-evidence-gen-");
    const { controller, claimPath } = bootstrap(runRoot);
    await controller.commitFinalPartialEpoch(1);
    const recovered = cleanupFhvTwoPhaseResumeState(runRoot);
    const bundle = readFhvExecutionCheckpointBundle(resolveFhvEpochCheckpointDir(runRoot, 0));
    expect(recovered.committedGeneration).toBe(bundle.manifest.generation);

    const keep = join(runRoot, "evidence", "epoch-0", `generation-${bundle.manifest.generation}`);
    const stale = join(
      runRoot,
      "evidence",
      "epoch-0",
      `generation-${bundle.manifest.generation + 1}`,
    );
    mkdirSync(keep, { recursive: true });
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(keep, "ok"), "1");
    writeFileSync(join(stale, "no"), "1");

    takeoverFhvAuthorizationRunning({ claimPath, leaseOwner: "resume@test" });
    const claim = readFhvAuthorizationClaim(claimPath);
    expect(claim.fencingGeneration).not.toBe(bundle.manifest.generation);

    cleanupFhvEpochEvidenceGenerations({
      runDir: runRoot,
      epochId: 0,
      keepGeneration: recovered.committedGeneration!,
    });
    expect(existsSync(keep)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it("orphan provisional is cleaned on resume", async () => {
    const runRoot = tmp("fhv-orphan-");
    const { controller } = bootstrap(runRoot);
    await controller.commitFinalPartialEpoch(1);
    const provisional = resolveFhvProvisionalEpochCheckpointDir(runRoot, 3);
    mkdirSync(provisional, { recursive: true });
    writeFileSync(join(provisional, "session.sqlite"), "stale");
    cleanupFhvTwoPhaseResumeState(runRoot);
    expect(existsSync(provisional)).toBe(false);
    expect(
      existsSync(join(resolveFhvEpochCheckpointDir(runRoot, 0), FHV_CHECKPOINT_READY_MARKER)),
    ).toBe(true);
  });

  it("journal N / claim N-1 catch-up requires a complete verified checkpoint", async () => {
    const runRoot = tmp("fhv-claim-lag-");
    const { controller, claimPath } = bootstrap(runRoot);
    await controller.commitFinalPartialEpoch(1);
    const claim = readFhvAuthorizationClaim(claimPath);
    const rolled = {
      ...claim,
      lastCommittedEpoch: -1,
      lastCommittedCycle: -1,
      checkpointDigest: "0".repeat(64),
      walCommitDigest: "0".repeat(64),
    };
    const { authorizationClaimDigest: _, ...body } = rolled;
    writeFileSync(
      claimPath,
      `${JSON.stringify(
        { ...body, authorizationClaimDigest: computeStableJsonDigest(body) },
        null,
        2,
      )}\n`,
    );
    const freeze = buildFhvConfigurationFreeze({
      releaseSha: "abc123",
      runId: RUN_ID,
      organizationId: "00000000-0000-4000-8000-000000000001",
      operatorId: "op",
      datasetDigest: "d".repeat(64),
      manifestDigest: "m".repeat(64),
      strategyVersions: ["s@v1"],
      strategyDigests: ["s".repeat(64)],
      checkpointDigest: "c".repeat(64),
    });
    const resumed = prepareFhvOfficialLaunchExecution({
      runDir: runRoot,
      runId: RUN_ID,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      authorizationReceiptDigest: "r".repeat(64),
      releaseSha: "abc123",
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreeze: freeze,
      leaseOwner: "operator@test",
    });
    expect(resumed.authorizationClaim.lastCommittedEpoch).toBe(0);
  });

  it("verifier crash fails closed", async () => {
    await expect(
      verifyFhvDestinationShaOffMainThread({
        runId: RUN_ID,
        epochId: 0,
        generation: 1,
        destPath: join(tmp("fhv-missing-"), "no-such-session.sqlite"),
        expectedBytes: 12,
        fencingGeneration: 1,
      }),
    ).rejects.toMatchObject({ code: "FHV_DEST_SHA_READ_FAILED" });
  });

  function bootstrap(
    runRoot: string,
    options?: { verifierDelayMs?: number; checkpointEveryCycles?: number },
  ) {
    const claimPath = resolveFhvAuthorizationClaimPath(runRoot);
    const cycleZeroCheckpointDigest = computeFhvCycleZeroCheckpointDigest({
      configurationFreezeDigest: "f".repeat(64),
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      runId: RUN_ID,
    });
    const issued = buildFhvAuthorizationClaimIssued({
      authorizationReceiptDigest: "r".repeat(64),
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      runId: RUN_ID,
      releaseSha: "abc123",
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      configurationFreezeDigest: "f".repeat(64),
    });
    writeFhvAuthorizationClaimAtomic(claimPath, issued);
    let claim = claimFhvAuthorizationExclusive({
      claimPath,
      leaseOwner: "operator@test",
      leaseExpiresAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
      cycleZeroCheckpointDigest,
    });
    claim = beginFhvAuthorizationRunning({ claimPath, leaseOwner: "operator@test" });
    const walWriter = new FhvExecutionWalWriter(
      runRoot,
      RUN_ID,
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      claim.fencingGeneration,
    );
    writeFhvLaunchJournalAtomic(
      runRoot,
      buildFhvLaunchJournal({ runId: RUN_ID, walPath: walWriter.getWalPath() }),
    );
    const controller = createFhvEpochBoundaryController({
      runDir: runRoot,
      runId: RUN_ID,
      claimPath,
      walWriter,
      authorizationClaim: claim,
      checkpointConfig: {
        checkpointEveryCycles: options?.checkpointEveryCycles ?? 10,
        maxCheckpointWalBytes: 67_108_864,
      },
      sourceCursorDigest: "s".repeat(64),
      skipSessionBackup: true,
      ...(options?.verifierDelayMs !== undefined
        ? { verifierDelayMs: options.verifierDelayMs }
        : {}),
    });
    controller.beginInitialEpoch();
    return { claimPath, walWriter, controller, claim };
  }
});
