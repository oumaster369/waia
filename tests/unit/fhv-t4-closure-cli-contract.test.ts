import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { waitFhvT4PausedTerminal } from "@/lib/trader/observability/fhv-t4-bounded-wait";
import {
  resolveFhvRehearsalAlertPolicyDigest,
  resolveFhvRehearsalRunDirectory,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  resolveFhvT4ClosureCliConfig,
  runFhvT4ClosureCli,
} from "@/scripts/trader/fhv-t4-closure-cli";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-cli-contract";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function writeManifest(runDir: string, overrides?: { runId?: string; targetSha?: string }) {
  writeFileSync(
    join(runDir, "fhv-rehearsal-manifest.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-rehearsal-launch/v1",
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: overrides?.targetSha ?? TARGET_SHA,
        runId: overrides?.runId ?? RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
        maxRuntimeMs: 300_000,
        t4DeterministicPause: true,
        deterministicPauseAtCycle: 40,
      },
      null,
      2,
    )}\n`,
  );
}

describe("fhv-t4 closure CLI executable contract (DEE-436)", () => {
  it("requires --timeout-ms and propagates exact 300000", async () => {
    expect(() =>
      resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
        "wait-paused",
        "--run-root",
        "/tmp/x",
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--target-sha",
        TARGET_SHA,
      ]),
    ).toThrow(/timeout-ms is required/);

    const config = resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
      "wait-paused",
      "--run-root",
      "/tmp/x",
      "--run-id",
      RUN_ID,
      "--organization-id",
      ORG_ID,
      "--target-sha",
      TARGET_SHA,
      "--timeout-ms",
      "300000",
    ]);
    expect(config.timeoutMs).toBe(300000);
  });

  it("rejects unknown flags, malformed timeout, and missing identity", async () => {
    expect(() =>
      resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
        "wait-paused",
        "--run-root",
        "/tmp/x",
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--target-sha",
        TARGET_SHA,
        "--timeout-ms",
        "300000",
        "--not-a-flag",
        "1",
      ]),
    ).toThrow(/Unsupported flag/);

    expect(() =>
      resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
        "wait-paused",
        "--run-root",
        "/tmp/x",
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--target-sha",
        TARGET_SHA,
        "--timeout-ms",
        "abc",
      ]),
    ).toThrow(/positive integer/);

    const result = await runFhvT4ClosureCli(
      resolveFhvT4ClosureCliConfig({} as NodeJS.ProcessEnv, [
        "wait-paused",
        "--run-root",
        "/tmp/x",
        "--timeout-ms",
        "1000",
      ]),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.lines.join("\n")).toMatch(/CONFIG_INCOMPLETE|required/i);
    expect(JSON.stringify(result.payload ?? null)).not.toMatch(/"exitCode":0/);
  });

  it("honors a smaller wait timeout and exits nonzero", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-wait-timeout-"));
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    mkdirSync(runDir, { recursive: true });
    writeManifest(runDir);

    let now = 0;
    await expect(
      waitFhvT4PausedTerminal({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        timeoutMs: 50,
        pollMs: 10,
        deps: {
          nowMs: () => {
            now += 20;
            return now;
          },
          sleepMs: async () => undefined,
        },
      }),
    ).rejects.toThrow(/Timed out waiting for REHEARSAL_PAUSED/);
  });

  it("rejects wait identity mismatch against manifest", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-wait-id-"));
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    mkdirSync(runDir, { recursive: true });
    writeManifest(runDir, { targetSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });

    await expect(
      waitFhvT4PausedTerminal({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        timeoutMs: 100,
        pollMs: 10,
        deps: { nowMs: () => 0, sleepMs: async () => undefined },
      }),
    ).rejects.toThrow(/identity does not match|WAIT_IDENTITY_MISMATCH/i);
  });

  it("rejects wrong terminal identity belonging to another run", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-wait-term-"));
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    mkdirSync(runDir, { recursive: true });
    writeManifest(runDir);
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({
        classification: "REHEARSAL_PAUSED",
        runId: "foreign-run",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      })}\n`,
    );

    await expect(
      waitFhvT4PausedTerminal({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        timeoutMs: 100,
        pollMs: 10,
        deps: { nowMs: () => 0, sleepMs: async () => undefined },
      }),
    ).rejects.toThrow(/TERMINAL_IDENTITY_MISMATCH|another run/i);
  });
});
