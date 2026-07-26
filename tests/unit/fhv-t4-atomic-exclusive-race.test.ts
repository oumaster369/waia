import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AtomicFileWriteError,
  prepareAtomicExclusiveTemp,
  publishAtomicExclusiveTemp,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

type RaceWorkerResult = Readonly<{
  ok: boolean;
  label: string;
  code?: string;
  payload?: string;
}>;

const WORKER_PATH = join(process.cwd(), "tests/helpers/fhv-t4-atomic-race-worker.ts");

function spawnRaceWorker(finalPath: string, label: string, payload: string): ChildProcess {
  return fork(WORKER_PATH, [finalPath, label, payload], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    cwd: process.cwd(),
  });
}

function runBarrierSynchronizedRace(finalPath: string): Promise<{
  results: RaceWorkerResult[];
  winnerBytes: string;
}> {
  return new Promise((resolve, reject) => {
    const workers: ChildProcess[] = [];
    const results: RaceWorkerResult[] = [];
    let readyCount = 0;

    function maybeReleaseBarrier(): void {
      if (readyCount !== 2) {
        return;
      }
      for (const worker of workers) {
        worker.send?.("go");
      }
    }

    function onWorkerMessage(message: unknown): void {
      if (message === "ready") {
        readyCount += 1;
        maybeReleaseBarrier();
        return;
      }
      results.push(message as RaceWorkerResult);
      if (results.length === 2) {
        resolve({
          results,
          winnerBytes: readFileSync(finalPath, "utf8"),
        });
      }
    }

    for (const [label, payload] of [
      ["A", "BYTES_A"],
      ["B", "BYTES_B"],
    ] as const) {
      const worker = spawnRaceWorker(finalPath, label, payload);
      worker.on("message", onWorkerMessage);
      worker.on("error", reject);
      workers.push(worker);
    }
  });
}

describe("atomic exclusive publish race (DEE-436 F-01)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("prepareAtomicExclusiveTemp + publishAtomicExclusiveTemp rejects sequential overwrite", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-exclusive-prep-"));
    const target = join(root, "proof.json");
    const tempPath = prepareAtomicExclusiveTemp(target, '{"first":1}\n');
    publishAtomicExclusiveTemp(tempPath, target);
    const secondTemp = prepareAtomicExclusiveTemp(target, '{"second":2}\n');
    expect(() => publishAtomicExclusiveTemp(secondTemp, target)).toThrow(AtomicFileWriteError);
    expect(readFileSync(target, "utf8")).toBe('{"first":1}\n');
  });

  it("concurrent child processes: exactly one publish wins via linkSync barrier", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-exclusive-fork-race-"));
    const target = join(root, "race.json");

    const { results, winnerBytes } = await runBarrierSynchronizedRace(target);

    expect(results).toHaveLength(2);
    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.code).toBe("PHASE_RECEIPT_OVERWRITE_ALLOWED");
    expect(winnerBytes).toBe(winners[0]?.payload);
    expect(["BYTES_A", "BYTES_B"]).toContain(winnerBytes);
  }, 30_000);
});
