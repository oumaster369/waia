/**
 * WP-6A — dual-path parity for bounded hot state (ADR-0025 AD-4).
 *
 * Runs the same bounded segment twice: once on the legacy path where every economic row stays in
 * the snapshotted database, once with the streaming economic ledger enabled. Terminal economics
 * must be byte-identical. Any difference is a STOP condition, never a tuning opportunity.
 *
 * Also proves the point of the change: the checkpointed hot-state database must actually shrink.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FHV_BOUNDED_HOT_STATE_ENV,
  isFhvBoundedHotStateEnabled,
} from "@/lib/trader/execution/fhv-hot-state-pruner";
import {
  readFhvEconomicLedgerManifest,
  readFhvEconomicLedgerRows,
  verifyFhvEconomicLedger,
} from "@/lib/trader/observability/fhv-economic-ledger";
import {
  executeFhvFullHistoricalLaunch,
  resolveFhvFullLaunchRunDirectory,
} from "@/lib/trader/observability/fhv-full-historical-launch";

import { TARGET_CYCLE_COUNT } from "./fhv-official-scale-constants";
import {
  buildFhvOfficialScaleHarnessContext,
  extractFhvOfficialScaleParitySnapshot,
  resolveBarsProcessed,
  setupFhvOfficialScaleLaunchPaths,
  teardownFhvOfficialScaleHarnessContext,
  toFhvOfficialScaleLaunchInput,
  type FhvOfficialScaleParitySnapshot,
} from "./fhv-official-scale-harness";

const SEGMENT_CHECKPOINT_EVERY_CYCLES = 1_000;

type PathOutcome = {
  snapshot: FhvOfficialScaleParitySnapshot;
  runDir: string;
  sessionBytes: number;
  residentHotRowCount: number;
  ledgerRowCount: number;
};

function resolveSessionDbPath(runDir: string): string | null {
  const sessions = join(runDir, "sessions");
  if (!existsSync(sessions)) {
    return null;
  }
  for (const generation of readdirSync(sessions)) {
    const candidate = join(sessions, generation, "research-replay.sqlite");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Count the bounded-hot-state rows still resident in the snapshotted database.
 *
 * Includes `trader_lifecycle_events`: like orders/events/fills it is append-only history that the
 * bounded path seals into the economic ledger and prunes, so the nothing-lost invariant must span
 * every table the ledger can absorb.
 */
function countResidentHotStateRows(sessionPath: string): number {
  const db = new Database(sessionPath, { readonly: true });
  try {
    let total = 0;
    for (const table of [
      "trader_orders",
      "trader_order_events",
      "trader_fills",
      "trader_lifecycle_events",
    ]) {
      total += (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
    }
    return total;
  } finally {
    db.close();
  }
}

describe("WP-6A bounded hot state dual-path parity", () => {
  const harness = buildFhvOfficialScaleHarnessContext();
  const outcomes = new Map<"legacy" | "bounded", PathOutcome>();

  async function runPath(mode: "legacy" | "bounded"): Promise<PathOutcome> {
    /*
     * Both paths use the SAME runId, executed sequentially with the run directory cleaned in
     * between. `computeSemanticParityDigest` hashes strategyExecutions, whose clientOrderId
     * embeds the runId, so a differing runId would make authoritativeEvidenceDigest incomparable
     * across paths. Holding runId fixed keeps every digest — including the run-identity-bound
     * ones — a valid parity invariant.
     */
    const runId = "fhv-official-scale-parity";
    rmSync(join(harness.artifactRoot, "prep", runId), { recursive: true, force: true });
    rmSync(resolveFhvFullLaunchRunDirectory(harness.artifactRoot, runId), {
      recursive: true,
      force: true,
    });

    const previous = process.env[FHV_BOUNDED_HOT_STATE_ENV];
    if (mode === "bounded") {
      process.env[FHV_BOUNDED_HOT_STATE_ENV] = "1";
    } else {
      delete process.env[FHV_BOUNDED_HOT_STATE_ENV];
    }

    try {
      expect(isFhvBoundedHotStateEnabled()).toBe(mode === "bounded");
      const paths = setupFhvOfficialScaleLaunchPaths({
        harness,
        runId,
        maxCycles: TARGET_CYCLE_COUNT,
        targetCycleCount: TARGET_CYCLE_COUNT,
        checkpointEveryCycles: SEGMENT_CHECKPOINT_EVERY_CYCLES,
      });
      const result = await executeFhvFullHistoricalLaunch(
        toFhvOfficialScaleLaunchInput(paths, { maxCycles: TARGET_CYCLE_COUNT }),
      );

      const snapshot = extractFhvOfficialScaleParitySnapshot({
        runDir: result.runDir,
        ...(result.backtest?.sourceFrontier
          ? { sourceFrontier: result.backtest.sourceFrontier }
          : {}),
        ...(result.semanticReproDigest ? { semanticReproDigest: result.semanticReproDigest } : {}),
        classification: result.classification,
        ...(result.backtest?.accountingFrontierState?.accountingSequence != null
          ? { accountingSequence: result.backtest.accountingFrontierState.accountingSequence }
          : {}),
        ...(result.backtest?.accountingFrontierState?.consumedFillIds
          ? { fillsCount: result.backtest.accountingFrontierState.consumedFillIds.length }
          : {}),
      });

      const sessionPath = resolveSessionDbPath(result.runDir);
      expect(sessionPath).not.toBeNull();

      return {
        snapshot,
        runDir: result.runDir,
        sessionBytes: statSync(sessionPath as string).size,
        residentHotRowCount: countResidentHotStateRows(sessionPath as string),
        ledgerRowCount: readFhvEconomicLedgerManifest(result.runDir).totalRowCount,
      };
    } finally {
      if (previous == null) {
        delete process.env[FHV_BOUNDED_HOT_STATE_ENV];
      } else {
        process.env[FHV_BOUNDED_HOT_STATE_ENV] = previous;
      }
      void resolveBarsProcessed;
    }
  }

  beforeAll(async () => {
    outcomes.set("legacy", await runPath("legacy"));
    outcomes.set("bounded", await runPath("bounded"));
  }, 1_800_000);

  afterAll(() => {
    teardownFhvOfficialScaleHarnessContext(harness);
  });

  it("is disabled by default so the legacy path stays canonical", () => {
    expect(isFhvBoundedHotStateEnabled({})).toBe(false);
    expect(isFhvBoundedHotStateEnabled({ [FHV_BOUNDED_HOT_STATE_ENV]: "1" })).toBe(true);
  });

  it("produces identical economic quantities on both paths", () => {
    const legacy = outcomes.get("legacy")!;
    const bounded = outcomes.get("bounded")!;

    expect(bounded.snapshot.classification).toBe(legacy.snapshot.classification);
    expect(bounded.snapshot.accountingSequence).toBe(legacy.snapshot.accountingSequence);
    expect(bounded.snapshot.fillsCount).toBe(legacy.snapshot.fillsCount);
    expect(bounded.snapshot.wp17OpenCount).toBe(legacy.snapshot.wp17OpenCount);
    expect(bounded.snapshot.globalEventSequence).toBe(legacy.snapshot.globalEventSequence);
    expect(bounded.snapshot.sourceExhausted).toBe(legacy.snapshot.sourceExhausted);
    expect(bounded.snapshot.sourceFrontierDigest).toBe(legacy.snapshot.sourceFrontierDigest);
    expect(bounded.snapshot.identityFrontierDigest).toBe(legacy.snapshot.identityFrontierDigest);
  });

  /**
   * The terminal export document is assembled by reading orders, events and fills back through
   * the OrderRepository interface. With economically sealed rows pruned from SQLite, the
   * ledger-backed decorator must reconstruct them exactly — including legacy rowid ordering,
   * Date reconstruction and decimal strings — or this digest diverges.
   */
  it("reproduces the canonical semanticReproDigest through ledger reconstruction", () => {
    const legacy = outcomes.get("legacy")!;
    const bounded = outcomes.get("bounded")!;

    process.stderr.write(
      "[fhv-bounded-hot-state] " +
        `legacy_semantic=${legacy.snapshot.semanticReproDigest} ` +
        `bounded_semantic=${bounded.snapshot.semanticReproDigest}\n`,
    );
    expect(bounded.snapshot.semanticReproDigest).toBe(legacy.snapshot.semanticReproDigest);
    expect(bounded.snapshot.authoritativeEvidenceDigest).toBe(
      legacy.snapshot.authoritativeEvidenceDigest,
    );
    expect(bounded.snapshot.accountingStateDigest).toBe(legacy.snapshot.accountingStateDigest);
  });

  it("keeps the economic record complete and digest-chained in the ledger", () => {
    const legacy = outcomes.get("legacy")!;
    const bounded = outcomes.get("bounded")!;

    const verification = verifyFhvEconomicLedger(bounded.runDir);
    expect(verification.failures).toEqual([]);
    expect(verification.ok).toBe(true);
    expect(verification.segmentCount).toBeGreaterThan(0);

    // Nothing may be lost: every hot-state row is either still resident or sealed into the ledger.
    // Legacy keeps them all resident (ledger empty); bounded splits them between resident and
    // ledger, so the totals must match across both paths.
    expect(bounded.residentHotRowCount + bounded.ledgerRowCount).toBe(
      legacy.residentHotRowCount + legacy.ledgerRowCount,
    );

    const rows = readFhvEconomicLedgerRows(bounded.runDir);
    expect(rows.length).toBe(bounded.ledgerRowCount);
    expect(rows.some((entry) => entry.kind === "trader_fills")).toBe(true);
    expect(rows.some((entry) => entry.kind === "trader_order_events")).toBe(true);
  });

  it("actually bounds the snapshotted hot-state database", () => {
    const legacy = outcomes.get("legacy")!;
    const bounded = outcomes.get("bounded")!;

    // The whole point of ADR-0025: less data is copied and hashed at every epoch.
    expect(bounded.residentHotRowCount).toBeLessThan(legacy.residentHotRowCount);
    expect(bounded.sessionBytes).toBeLessThanOrEqual(legacy.sessionBytes);

    process.stderr.write(
      `[fhv-bounded-hot-state] legacy_rows=${legacy.residentHotRowCount} bounded_rows=${bounded.residentHotRowCount} ` +
        `ledger_rows=${bounded.ledgerRowCount} legacy_bytes=${legacy.sessionBytes} ` +
        `bounded_bytes=${bounded.sessionBytes}\n`,
    );
  });

  it("leaves the ledger manifest readable and consistent", () => {
    const bounded = outcomes.get("bounded")!;
    const manifest = readFhvEconomicLedgerManifest(bounded.runDir);
    expect(manifest.segments.length).toBeGreaterThan(0);
    expect(manifest.chainDigest).toBe(manifest.segments.at(-1)!.chainDigest);
    const raw = readFileSync(
      join(bounded.runDir, "economic-ledger", "economic-ledger-manifest.v1.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(manifest);
  });
});
