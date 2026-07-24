import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { writeFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-campaign-control-files";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  assertFhvT4PauseArmedBeforeCampaignStart,
  assertFhvT4PreArmPauseCommand,
  FhvT4DeterministicPauseError,
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  isFhvT4DeterministicPauseManifest,
  readFhvT4PauseArmedRecord,
  serializeFhvT4PauseArmedRecord,
  shouldFhvT4PauseAtCycle,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { signFhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4-deterministic-pause";
const ORG_ID = "00000000-0000-4000-8000-000000000435";
const SECRET = "fhv-t4-deterministic-pause-secret";

function prepareT4RunDir(root: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: root,
    t4DeterministicPause: true,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

function writePendingPauseRequest(runDir: string): void {
  writeFhvCampaignControlRequest(runDir, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "PAUSE_AT_CHECKPOINT",
    runId: RUN_ID,
    organizationId: ORG_ID,
    operatorId: "t4-operator",
    reason: "deterministic pre-arm",
    requestedAtUtc: new Date().toISOString(),
  });
}

function writeArmedRecord(runDir: string): void {
  writeFhvT4PauseArmedRecord(runDir, {
    schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    fixtureId: "HTR_WP03_BENCHMARK",
    deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    commandId: "cmd-t4-arm",
    idempotencyKey: "idem-t4-arm",
    operatorId: "t4-operator",
    armedAtUtc: new Date().toISOString(),
  });
}

describe("fhv-t4-deterministic-pause (DEE-435)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("detects T4 deterministic pause manifests", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-manifest-"));
    const runDir = prepareT4RunDir(root);
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: `${RUN_ID}-plain`,
      organizationId: ORG_ID,
      artifactRoot: join(root, "other"),
    });
    expect(isFhvT4DeterministicPauseManifest(config)).toBe(false);
    expect(
      isFhvT4DeterministicPauseManifest(
        buildFhvRehearsalLaunchConfig({
          fixtureId: "HTR_WP03_BENCHMARK",
          targetSha: TARGET_SHA,
          runId: `${RUN_ID}-t4`,
          organizationId: ORG_ID,
          artifactRoot: join(root, "t4"),
          t4DeterministicPause: true,
        }),
      ),
    ).toBe(true);
    expect(existsSync(join(runDir, "fhv-rehearsal-manifest.v1.json"))).toBe(true);
  });

  it("deterministic pause boundary holds across >=10 cycle evaluations", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-cycles-"));
    const runDir = prepareT4RunDir(root);
    const manifest = readFhvRehearsalManifest(runDir);

    const expected: boolean[] = [];
    for (let cycle = 31; cycle <= 42; cycle += 1) {
      const pause = shouldFhvT4PauseAtCycle({
        runRoot: runDir,
        manifest,
        cyclesProcessed: cycle,
        pauseRequested: true,
      });
      expected.push(pause);
      expect(pause).toBe(cycle >= FHV_REHEARSAL_CHECKPOINT_CYCLE);
    }
    expect(expected.filter(Boolean).length).toBe(3);
    expect(expected.at(-1)).toBe(true);
    expect(expected.at(8)).toBe(false);
    expect(expected.at(9)).toBe(true);
  });

  it("refuses campaign start when T4 pause is not armed", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-not-armed-"));
    const runDir = prepareT4RunDir(root);
    const manifest = readFhvRehearsalManifest(runDir);

    expect(() => assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: runDir, manifest })).toThrow(
      FhvT4DeterministicPauseError,
    );
    try {
      assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: runDir, manifest });
    } catch (error) {
      expect((error as FhvT4DeterministicPauseError).code).toBe("FHV_T4_PAUSE_NOT_ARMED");
    }
  });

  it("allows campaign start when armed record and pending pause request match", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-armed-"));
    const runDir = prepareT4RunDir(root);
    const manifest = readFhvRehearsalManifest(runDir);
    writeArmedRecord(runDir);
    writePendingPauseRequest(runDir);
    expect(() =>
      assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: runDir, manifest }),
    ).not.toThrow();
  });

  it("skips pre-start gate for non-T4 manifests", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-skip-"));
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
    });
    const runDir = materializeFhvRehearsalManifest(config).runDir;
    expect(() =>
      assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: runDir, manifest: config }),
    ).not.toThrow();
  });

  it("serializes and verifies armed record digest", () => {
    const record = serializeFhvT4PauseArmedRecord({
      schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
      commandId: "cmd-digest",
      idempotencyKey: "idem-digest",
      operatorId: "t4-operator",
      armedAtUtc: "2026-07-24T12:00:00.000Z",
    });
    expect(record.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects tampered armed record digest on read", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-digest-"));
    const runDir = prepareT4RunDir(root);
    writeArmedRecord(runDir);
    const path = join(runDir, "control", "fhv-t4-pause-armed.v1.json");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    parsed.contentDigest = "0".repeat(64);
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    expect(() => readFhvT4PauseArmedRecord(runDir)).toThrow(FhvT4DeterministicPauseError);
  });

  it("rejects pre-arm when command enforcement is disabled", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-prearm-"));
    const runDir = prepareT4RunDir(root);
    const manifest = readFhvRehearsalManifest(runDir);
    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: "cmd-prearm",
        campaignRunId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "t4-operator",
        action: "PAUSE_AT_CHECKPOINT",
        reason: "pre-arm pause",
        issuedAtUtc: new Date().toISOString(),
        expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
        nonce: "nonce-prearm",
        idempotencyKey: "idem-prearm",
        expectedCampaignState: { phase: "validation" },
        confirmationPhraseClass: "PAUSE",
      },
      SECRET,
    );
    expect(() =>
      assertFhvT4PreArmPauseCommand({
        command,
        manifest,
        targetSha: TARGET_SHA,
        commandEnforcementEnabled: false,
        runRoot: runDir,
      }),
    ).toThrow(FhvT4DeterministicPauseError);
  });
});
