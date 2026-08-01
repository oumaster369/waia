/**
 * DEE-436 — concurrent authorization receipt consumption (O_EXCL lock).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import { setupFhvBoundedLaunchArtifacts } from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";

function spawnWorker(receiptPath: string, label: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(
      "tests/helpers/fhv-auth-concurrent-consume-worker.ts",
      [receiptPath, label],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    child.once("message", (message) => {
      if (message === "ready") {
        resolve(child);
      }
    });
    child.once("error", reject);
  });
}

describe("DEE-436 FHV auth concurrent consume", () => {
  it("allows exactly one winner when two node processes consume in parallel", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-race-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-race-run",
        organizationId: ORG_ID,
        operatorId: "fhv-auth-race-operator",
      });
      const workerA = await spawnWorker(prep.authorizationReceiptPath, "A");
      const workerB = await spawnWorker(prep.authorizationReceiptPath, "B");
      const results: Array<{ ok: boolean; label: string }> = [];
      await Promise.all([
        new Promise<void>((resolve) => {
          let count = 0;
          const onResult = () => {
            count += 1;
            if (count >= 2) {
              resolve();
            }
          };
          workerA.on("message", (message: { ok: boolean; label: string }) => {
            results.push(message);
            onResult();
          });
          workerB.on("message", (message: { ok: boolean; label: string }) => {
            results.push(message);
            onResult();
          });
          workerA.send("go");
          workerB.send("go");
        }),
      ]);
      workerA.kill();
      workerB.kill();
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
      const consumed = JSON.parse(readFileSync(prep.authorizationReceiptPath, "utf8"));
      expect(consumed.consumed).toBe(true);
      expect(consumed.consumedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
