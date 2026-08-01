/**
 * DEE-436 — hermetic Execution Server simulation for T4A operator integration tests.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { serializeFhvT4CompletedCampaignSystemdIdentity } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { computeFhvAlertPolicyDigest } from "@/lib/trader/observability/fhv-alert-policy-v1";
import { renderFhvSystemdUnits } from "@/lib/trader/observability/fhv-systemd-unit-renderer";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import { writeFhvCampaignControlPauseRequest } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME,
  serializeFhvT4ResumeEnforcementProof,
} from "@/lib/trader/observability/fhv-t4-resume-enforcement-proof";

const HERMETIC_TRADER_CLI_PRELUDE = join(
  process.cwd(),
  "scripts/trader/trader-cli-server-only-prelude.cjs",
);

/**
 * Test-equivalent of production `fhv-t4-service-user-exec.sh` `env -i` for package CLIs.
 * Workstation `FHV_SYSTEMCTL_BIN` / `FHV_PYTHON_BIN` must never be inherited — production
 * PASS_ENV and the strict EnvironmentFile parser do not forward those keys.
 */
function buildHermeticServiceUserChildEnv(
  extras: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extras };
  delete env.FHV_SYSTEMCTL_BIN;
  delete env.FHV_PYTHON_BIN;
  return env;
}

const HERMETIC_CAMPAIGN_SYNC_TIMEOUT_MS = 180_000;

const HERMETIC_STRICT_CLOSURE_PACKAGE_SCRIPTS = new Set([
  "trader:fhv:t4:write-observer-qualification-proof",
  "trader:fhv:t4:ingest-host-probe",
  "trader:fhv:t4:verify-deployment",
  "trader:fhv:t4:verify-rollback",
  "trader:fhv:t4:build-evidence-inventory",
  "trader:fhv:t4:seal-evidence",
  "trader:fhv:t4:verify-seal",
  "trader:fhv:t4:verify-ceremony",
  "trader:fhv:t4:wait-paused",
  "trader:fhv:t4:verify-paused",
  "trader:fhv:t4:wait-final",
  "trader:fhv:t4:verify-final",
]);

const HERMETIC_STRICT_CONTINUITY_PACKAGE_SCRIPTS = new Set([
  "trader:fhv:t4:capture-continuity-before",
  "trader:fhv:t4:capture-continuity-after",
  "trader:fhv:t4:verify-continuity",
]);

/** Marker for closure-counter audit: generic unknown-command success must stay disabled. */
export const HERMETIC_UNKNOWN_COMMAND_SUCCESS = 0 as const;

export type FhvT4aHermeticSimulationOptions = Readonly<{
  localReleaseRoot: string;
  targetSha: string;
  releaseTag: string;
  originUrl: string;
  serviceUser: string;
  serviceUserHome: string;
  checkoutParent: string;
  artifactRoot: string;
  environmentFile: string;
  runId: string;
  organizationId: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  systemdAnalyzeBin: string;
  operatorId?: string;
}>;

export type FhvT4aHermeticSshResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

type SystemdUnitState = {
  invocationId: string;
  mainPid: number;
  activeState: "inactive" | "active" | "activating" | "deactivating";
  result: "success" | "failed" | "exit-code";
  nRestarts: number;
  activeEnterMonotonic: string;
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function uuid(): string {
  return createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32);
}

function hermeticServiceUserIdsJson(): string {
  return JSON.stringify({
    uid: typeof process.getuid === "function" ? process.getuid() : 1001,
    gid: typeof process.getgid === "function" ? process.getgid() : 1001,
  });
}

export function createFhvT4aHermeticSimulation(options: FhvT4aHermeticSimulationOptions) {
  const remoteRoot = mkdtempSync(join(tmpdir(), "fhv-t4a-remote-"));
  const emptyCwd = join(remoteRoot, "empty-cwd");
  mkdirSync(emptyCwd, { recursive: true });
  mkdirSync(options.checkoutParent, { recursive: true });
  mkdirSync(dirname(options.artifactRoot), { recursive: true });

  const repoRoot = join(options.checkoutParent, `waia-${options.targetSha}`);
  const runDir = join(options.artifactRoot, "RI-P7/fhv-ops-rehearsal", options.runId);
  const bootId = "11111111-2222-4333-8444-555555555555";

  const buildHermeticCampaignIdentity = () =>
    serializeFhvT4CompletedCampaignSystemdIdentity({
      schemaVersion: "fhv-t4-completed-campaign-systemd-identity/v1",
      unitName: "waia-fhv-campaign.service",
      bootId,
      activeState: "inactive",
      subState: "dead",
      result: "success",
      invocationId: campaign.invocationId || nextInvocation(),
      execMainPid: campaign.mainPid > 0 ? campaign.mainPid : 1001,
      execMainStartTimestampMonotonic: "1000000",
      execMainExitTimestampMonotonic: "2000000",
      execMainCode: 1,
      execMainStatus: 0,
      nRestarts: campaign.nRestarts,
    });

  const buildHermeticObserverIdentity = () => ({
    schemaVersion: "fhv-t4-observer-systemd-identity/v1" as const,
    unitName: "waia-fhv-observer.service",
    bootId,
    invocationId: observer.invocationId || nextInvocation(),
    mainPid: observer.mainPid > 0 ? observer.mainPid : 1001,
    activeEnterTimestampMonotonicUs: observer.activeEnterMonotonic || "1000000",
    activeState: "active" as const,
  });

  let remoteWrites = 0;
  let invocationCounter = 0;
  let campaignPaused = false;
  let campaignCompleted = false;
  let resumeEnforced = false;
  let initialCampaignExecuted = false;

  const observer: SystemdUnitState = {
    invocationId: "",
    mainPid: 0,
    activeState: "inactive",
    result: "success",
    nRestarts: 0,
    activeEnterMonotonic: "0",
  };
  const campaign: SystemdUnitState = {
    invocationId: "",
    mainPid: 0,
    activeState: "inactive",
    result: "success",
    nRestarts: 0,
    activeEnterMonotonic: "0",
  };

  const recordWrite = (path: string): void => {
    remoteWrites += 1;
    mkdirSync(dirname(path), { recursive: true });
  };

  const nextInvocation = (): string => {
    invocationCounter += 1;
    return `${invocationCounter.toString(16).padStart(8, "0")}-sim-invocation`;
  };

  const startUnit = (unit: SystemdUnitState): void => {
    unit.invocationId = nextInvocation();
    unit.mainPid = 1000 + invocationCounter;
    unit.activeState = "active";
    unit.result = "success";
    unit.activeEnterMonotonic = String(1_000_000 + invocationCounter);
  };

  const writeJson = (path: string, payload: unknown): void => {
    recordWrite(path);
    writeFileSync(path, `${JSON.stringify(payload)}\n`);
  };

  const simulationStatePath = join(runDir, "control", "fhv-t4a-hermetic-simulation-state.v1.json");

  const persistSimulationState = (): void => {
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFileSync(
      simulationStatePath,
      `${JSON.stringify({
        schemaVersion: "fhv-t4a-hermetic-simulation-state/v1",
        invocationCounter,
        observer,
        campaign,
        campaignPaused,
        campaignCompleted,
        resumeEnforced,
      })}\n`,
    );
  };

  const loadSimulationState = (): void => {
    if (!existsSync(simulationStatePath)) {
      return;
    }
    const loaded = JSON.parse(readFileSync(simulationStatePath, "utf8")) as {
      invocationCounter?: number;
      observer?: SystemdUnitState;
      campaign?: SystemdUnitState;
      campaignPaused?: boolean;
      campaignCompleted?: boolean;
      resumeEnforced?: boolean;
    };
    if (typeof loaded.invocationCounter === "number" && loaded.invocationCounter >= 0) {
      invocationCounter = loaded.invocationCounter;
    }
    if (loaded.observer) {
      Object.assign(observer, loaded.observer);
    }
    if (loaded.campaign) {
      Object.assign(campaign, loaded.campaign);
    }
    if (typeof loaded.campaignPaused === "boolean") {
      campaignPaused = loaded.campaignPaused;
    }
    if (typeof loaded.campaignCompleted === "boolean") {
      campaignCompleted = loaded.campaignCompleted;
    }
    if (typeof loaded.resumeEnforced === "boolean") {
      resumeEnforced = loaded.resumeEnforced;
    }
  };

  loadSimulationState();

  const runHermeticRehearsalCampaignSync = (
    mode: "initial" | "resume",
  ): FhvT4aHermeticSshResult => {
    ensureRunLayout();
    const workspaceRoot = process.cwd();
    const cliPath = join(workspaceRoot, "scripts/trader/fhv-t4a-hermetic-campaign-sync.ts");
    const result = spawnSync(
      options.nodeBin,
      [
        "--require",
        HERMETIC_TRADER_CLI_PRELUDE,
        "--import",
        "tsx",
        "--conditions=react-server",
        cliPath,
        mode,
        runDir,
        options.runId,
        options.organizationId,
        options.targetSha,
        bootId,
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          WAIA_TRADER_CLI: "1",
          VITEST: "",
        },
        timeout: HERMETIC_CAMPAIGN_SYNC_TIMEOUT_MS,
      },
    );
    if (mode === "initial") {
      campaignPaused = result.status === 0;
    }
    if (mode === "resume") {
      campaignCompleted = result.status === 0;
    }
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  const appendHermeticCommandLedger = (
    action: "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT",
    commandId: string,
    idempotencyKey: string,
  ): void => {
    ensureRunLayout();
    mkdirSync(join(runDir, "control"), { recursive: true });
    const ledgerPath = join(runDir, "control/command-ledger.jsonl");
    if (!existsSync(ledgerPath)) {
      writeFileSync(ledgerPath, "");
    }
    const entry = {
      recordedAtUtc: new Date().toISOString(),
      command: {
        schemaVersion: "fhv-operator-command/v1",
        commandId,
        campaignRunId: options.runId,
        organizationId: options.organizationId,
        operatorId: options.operatorId ?? "hermetic-operator",
        action,
        reason: "hermetic-integration",
        issuedAtUtc: new Date().toISOString(),
        expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
        nonce: `${commandId}-nonce`,
        idempotencyKey,
        expectedCampaignState:
          action === "PAUSE_AT_CHECKPOINT"
            ? { phase: "RUNNING" }
            : { phase: "PAUSED_RESUMABLE", checkpointSeq: 40 },
        confirmationPhraseClass: action === "PAUSE_AT_CHECKPOINT" ? "PAUSE" : "RESUME",
        signature: "hermetic-signature",
        signatureAlgorithm: "HMAC-SHA256",
      },
      source: "test" as const,
    };
    appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
    mkdirSync(join(runDir, "control/command-results"), { recursive: true });
    const isResume = action === "RESUME_FROM_CHECKPOINT";
    writeFileSync(
      join(runDir, "control/command-results", `${commandId}.json`),
      `${JSON.stringify({
        schemaVersion: "fhv-command-result/v1",
        commandId,
        idempotencyKey,
        status: isResume ? "accepted" : "executed",
        message: isResume ? "RESUME accepted; root systemd enforcement required" : "hermetic",
        completedAtUtc: new Date().toISOString(),
        enforcementApplied: !isResume,
      })}\n`,
    );
  };

  const ensureRehearsalEvidenceChain = (): void => {
    ensureRunLayout();
    mkdirSync(join(runDir, "control"), { recursive: true });
    const ledgerPath = join(runDir, "control/command-ledger.jsonl");
    if (!existsSync(ledgerPath)) {
      writeFileSync(ledgerPath, "");
    }
  };

  const runHermeticStrictPackageScript = (
    packageScript: string,
    args: readonly string[],
  ): FhvT4aHermeticSshResult => {
    ensureRehearsalEvidenceChain();
    mkdirSync(repoRoot, { recursive: true });
    const workspaceRoot = process.cwd();
    const subcommand = packageScript.slice("trader:fhv:t4:".length);
    const cliPath = join(workspaceRoot, "scripts/trader/fhv-t4-closure-cli.ts");
    const result = spawnSync(
      options.nodeBin,
      [
        "--require",
        HERMETIC_TRADER_CLI_PRELUDE,
        "--import",
        "tsx",
        "--conditions=react-server",
        cliPath,
        subcommand,
        ...args,
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: buildHermeticServiceUserChildEnv({
          WAIA_TRADER_CLI: "1",
          VITEST: "",
          FHV_T4_SERVICE_USER_IDS_JSON: hermeticServiceUserIdsJson(),
        }),
      },
    );
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  const ensureRunLayout = (): void => {
    recordWrite(runDir);
    mkdirSync(join(runDir, "control"), { recursive: true });
    if (!existsSync(join(runDir, "fhv-rehearsal-manifest.v1.json"))) {
      writeJson(join(runDir, "fhv-rehearsal-manifest.v1.json"), {
        schemaVersion: "fhv-rehearsal-launch/v1",
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: options.targetSha,
        runId: options.runId,
        organizationId: options.organizationId,
        artifactRoot: options.artifactRoot,
        alertPolicyDigest: computeFhvAlertPolicyDigest(),
        maxRuntimeMs: 300_000,
        t4DeterministicPause: true,
        deterministicPauseAtCycle: 40,
      });
    }
  };

  const handleSystemctl = (cmd: string): FhvT4aHermeticSshResult => {
    if (/restart waia-fhv-observer\.service/.test(cmd)) {
      observer.activeState = "deactivating";
      observer.invocationId = nextInvocation();
      observer.mainPid = 2000 + invocationCounter;
      observer.activeState = "active";
      observer.activeEnterMonotonic = String(2_000_000 + invocationCounter);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/start waia-fhv-observer\.service/.test(cmd)) {
      startUnit(observer);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/enable waia-fhv-observer\.service/.test(cmd)) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/start waia-fhv-campaign\.service/.test(cmd) && !resumeEnforced) {
      if (!initialCampaignExecuted) {
        initialCampaignExecuted = true;
        const campaignResult = runHermeticRehearsalCampaignSync("initial");
        if (campaignResult.exitCode !== 0) {
          return campaignResult;
        }
      }
      startUnit(campaign);
      campaignPaused = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/start waia-fhv-campaign\.service/.test(cmd) && resumeEnforced) {
      campaign.activeState = "inactive";
      startUnit(campaign);
      campaignCompleted = false;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/enable waia-fhv-campaign\.service/.test(cmd)) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "systemctl: unit not handled" };
  };

  const runHermeticStrictContinuityScript = (
    packageScript: string,
    args: readonly string[],
  ): FhvT4aHermeticSshResult => {
    ensureRehearsalEvidenceChain();
    mkdirSync(repoRoot, { recursive: true });
    const workspaceRoot = process.cwd();
    const subcommand =
      packageScript === "trader:fhv:t4:verify-continuity"
        ? "verify"
        : `capture-${packageScript.slice("trader:fhv:t4:capture-continuity-".length)}`;
    const cliPath = join(workspaceRoot, "scripts/trader/fhv-t4-continuity-cli.ts");
    const result = spawnSync(
      options.nodeBin,
      [
        "--require",
        HERMETIC_TRADER_CLI_PRELUDE,
        "--import",
        "tsx",
        "--conditions=react-server",
        cliPath,
        subcommand,
        ...args,
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: buildHermeticServiceUserChildEnv({
          WAIA_TRADER_CLI: "1",
          VITEST: "",
          FHV_T4_OBSERVER_SYSTEMD_IDENTITY_JSON: JSON.stringify(buildHermeticObserverIdentity()),
          FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON: JSON.stringify(buildHermeticCampaignIdentity()),
          FHV_T4_SERVICE_USER_IDS_JSON: hermeticServiceUserIdsJson(),
        }),
      },
    );
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  const handlePackage = (packageScript: string, args: string[]): FhvT4aHermeticSshResult => {
    ensureRunLayout();
    if (HERMETIC_STRICT_CLOSURE_PACKAGE_SCRIPTS.has(packageScript)) {
      return runHermeticStrictPackageScript(packageScript, args);
    }
    if (HERMETIC_STRICT_CONTINUITY_PACKAGE_SCRIPTS.has(packageScript)) {
      return runHermeticStrictContinuityScript(packageScript, args);
    }
    if (packageScript === "trader:fhv:rehearsal") {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ runDir, manifestPath: join(runDir, "fhv-rehearsal-manifest.v1.json") })}\n`,
        stderr: "",
      };
    }
    if (packageScript === "trader:fhv:t4:record-checkout-identity") {
      const withoutDigest = {
        schemaVersion: "fhv-t4-checkout-identity/v1" as const,
        repoPath: repoRoot,
        releaseSha: options.targetSha,
        releaseTag: options.releaseTag,
        headSha: options.targetSha,
        tagPeelSha: options.targetSha,
        trackedTreeClean: true as const,
        stagedChanges: false as const,
        mergeInProgress: false as const,
        runId: options.runId,
        organizationId: options.organizationId,
        capturedAtUtc: new Date().toISOString(),
      };
      writeJson(join(runDir, "control/fhv-t4-checkout-identity.v1.json"), {
        ...withoutDigest,
        contentDigest: computePayloadDigest(withoutDigest),
      });
      return { exitCode: 0, stdout: "classification=FHV_T4_CHECKOUT_IDENTITY_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:status") {
      return {
        exitCode: 0,
        stdout: `[fhv-t4-operator] status=healthy\nclassification=FHV_T4_OPERATOR_STATUS_OK\n`,
        stderr: "",
      };
    }
    if (packageScript === "trader:fhv:t4:arm-pause") {
      const withoutDigest = {
        schemaVersion: "fhv-t4-pause-armed/v1" as const,
        runId: options.runId,
        organizationId: options.organizationId,
        targetSha: options.targetSha,
        fixtureId: "HTR_WP03_BENCHMARK" as const,
        deterministicPauseAtCycle: 40 as const,
        commandId: "hermetic-pause-cmd",
        idempotencyKey: "hermetic-pause-key",
        operatorId: options.operatorId ?? "hermetic-operator",
        armedAtUtc: new Date().toISOString(),
      };
      writeJson(join(runDir, "control/fhv-t4-pause-armed.v1.json"), {
        ...withoutDigest,
        contentDigest: computePayloadDigest(withoutDigest),
      });
      appendHermeticCommandLedger(
        "PAUSE_AT_CHECKPOINT",
        "hermetic-pause-cmd",
        "hermetic-pause-key",
      );
      writeFhvCampaignControlPauseRequest(runDir, options.runId, options.organizationId);
      return { exitCode: 0, stdout: "classification=FHV_T4_PAUSE_ARMED\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:verify") {
      return { exitCode: 0, stdout: "classification=FHV_T4_VERIFY_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:resume") {
      appendHermeticCommandLedger(
        "RESUME_FROM_CHECKPOINT",
        "hermetic-resume-cmd",
        "hermetic-resume-key",
      );
      return {
        exitCode: 0,
        stdout: "status=accepted\nclassification=FHV_T4_RESUME_ACCEPTED\n",
        stderr: "",
      };
    }
    if (packageScript === "trader:fhv:t4:capture-continuity-before") {
      const out =
        args[args.indexOf("--output") + 1] ??
        join(runDir, "control/fhv-t4-continuity-before.v1.json");
      writeJson(out, { schemaVersion: "fhv-t4-continuity-before/v1", bound: true, bootId });
      return { exitCode: 0, stdout: "CONTINUITY_RESULT=PASS\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:capture-continuity-after") {
      const out =
        args[args.indexOf("--output") + 1] ??
        join(runDir, "control/fhv-t4-continuity-after.v1.json");
      writeJson(out, { schemaVersion: "fhv-t4-continuity-after/v1", bound: true, bootId });
      return { exitCode: 0, stdout: "CONTINUITY_RESULT=PASS\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:ingest-host-probe") {
      const rawPath =
        args[args.indexOf("--raw-host-probe-json-path") + 1] ??
        join(runDir, "control/fhv-t4-host-probe-raw.v1.json");
      const phaseArg = args[args.indexOf("--host-probe-phase") + 1] ?? "DEPLOYMENT";
      if (!existsSync(rawPath)) {
        return { exitCode: 2, stdout: "", stderr: "HOST_PROBE_RAW_SOURCE_MISSING" };
      }
      const raw = readFileSync(rawPath, "utf8");
      const proofName =
        phaseArg === "POST_ROLLBACK"
          ? "fhv-t4-post-rollback-host-probe-proof.v1.json"
          : "fhv-t4-host-probe-proof.v1.json";
      writeJson(join(runDir, "control", proofName), {
        schemaVersion: "fhv-t4-host-probe-proof/v1",
        hostProbePhase: phaseArg,
        targetSha: options.targetSha,
        runId: options.runId,
        rawDigest: sha256Hex(raw),
      });
      return { exitCode: 0, stdout: "classification=FHV_T4_HOST_PROBE_INGEST_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:write-observer-qualification-proof") {
      const out = args[args.indexOf("--output") + 1];
      const proofJson = args[args.indexOf("--proof-json") + 1];
      if (!out || !proofJson) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: "FHV_T4_OBSERVER_QUALIFICATION_WRITE_INCOMPLETE",
        };
      }
      writeJson(out, JSON.parse(proofJson));
      return {
        exitCode: 0,
        stdout: "classification=FHV_T4_OBSERVER_QUALIFICATION_PROOF_OK\n",
        stderr: "",
      };
    }
    if (packageScript.startsWith("trader:fhv:t4:")) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: `HERMETIC_UNKNOWN_COMMAND_SUCCESS:${packageScript}`,
      };
    }
    return { exitCode: 1, stdout: "", stderr: `unknown package ${packageScript}` };
  };

  function tokenizeShellWords(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inSingle = false;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i]!;
      if (inSingle) {
        if (ch === "'") {
          inSingle = false;
        } else {
          current += ch;
        }
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (/\s/.test(ch)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      current += ch;
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  }

  function extractServiceUserInvocation(
    remoteCommand: string,
  ): { packageScript: string; args: string[] } | null {
    const marker = "-- trader:";
    const idx = remoteCommand.indexOf(marker);
    if (idx === -1) {
      return null;
    }
    const tokens = tokenizeShellWords(remoteCommand.slice(idx + 3).trim());
    const packageScript = tokens[0] ?? "";
    return { packageScript, args: tokens.slice(1) };
  }

  function parseBootstrapRemoteArgs(remoteCommand: string): string[] {
    const marker = "bash -s --";
    const idx = remoteCommand.indexOf(marker);
    if (idx === -1) {
      return [];
    }
    const tail = remoteCommand.slice(idx + marker.length).trim();
    if (!tail) {
      return [];
    }
    return [...tail.matchAll(/'((?:\\'|[^'])*)'/g)].map((match) => match[1]!.replace(/\\'/g, "'"));
  }

  const dispatch = (
    remoteCommand: string,
    stdin: string | undefined,
    asRoot: boolean,
  ): FhvT4aHermeticSshResult => {
    if (
      /^test "\$\(id -u\)" -eq 0/.test(remoteCommand) ||
      /^test \$\(id -u\) -eq 0/.test(remoteCommand)
    ) {
      return asRoot
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "not root" };
    }

    if (/^test -x /.test(remoteCommand)) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (stdin) {
      const bootstrapArgs = parseBootstrapRemoteArgs(remoteCommand);
      if (/fhv-validate-origin-url\.sh/.test(stdin)) {
        const result = spawnSync("bash", ["-s", "--", ...bootstrapArgs], {
          cwd: emptyCwd,
          input: stdin,
          encoding: "utf8",
        });
        return {
          exitCode: result.status ?? 1,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      }
      if (/fhv-t4-host-preflight\.sh/.test(stdin)) {
        const expected = execFileSync(
          "git",
          [
            "-C",
            options.localReleaseRoot,
            "show",
            `${options.targetSha}:scripts/ops/fhv-t4-host-preflight.sh`,
          ],
          { encoding: "utf8" },
        );
        if (sha256Hex(stdin) !== sha256Hex(expected)) {
          return {
            exitCode: 2,
            stdout: "",
            stderr: "stdin bytes != committed host-preflight blob",
          };
        }
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            schemaVersion: "fhv-t4-host-preflight/v2",
            classification: "FHV_T4_HOST_PREFLIGHT_OK",
            hostname: "exec.test",
            machineIdSha256: "a".repeat(64),
            serviceUser: options.serviceUser,
            serviceUid: 1001,
            serviceGid: 1001,
            servicePrimaryGroup: options.serviceUser,
            environmentFile: options.environmentFile,
            artifactRoot: options.artifactRoot,
            checkoutParent: options.checkoutParent,
            nodeBin: options.nodeBin,
            corepackBin: options.corepackBin,
            gitBin: options.gitBin,
            pythonBin: options.pythonBin,
            dockerBin: options.dockerBin,
            systemctlBin: options.systemctlBin,
            systemdAnalyzeBin: options.systemdAnalyzeBin,
            legacyContainerName: FHV_T4A_LEGACY_CONTAINER_NAME,
            legacyContainerImage: FHV_T4A_LEGACY_CONTAINER_IMAGE,
            legacyContainerState: "running",
            hostBootId: bootId,
            minimumFreeKiB: 1000000,
            observedFreeKiB: 5000000,
            hostMonotonicSample: {
              schemaVersion: "fhv-t4-host-monotonic-sample/v1",
              clockSource: "CLOCK_BOOTTIME",
              bootId,
              monotonicNs: "12345",
            },
          })}\nclassification=FHV_T4_HOST_PREFLIGHT_OK\n`,
          stderr: "",
        };
      }
      if (/fhv-t4-supervisor-residual-state-read\.sh/.test(stdin)) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            schemaVersion: "fhv-t4-supervisor-residual-state/v1",
            expectedRunId: options.runId,
            expectedTargetSha: options.targetSha,
            expectedOrganizationId: options.organizationId,
            expectedHostname: "exec.test",
            expectedMachineIdSha256: "a".repeat(64),
            observedHostname: "exec.test",
            observedMachineIdSha256: "a".repeat(64),
            hostBootId: bootId,
            units: [
              {
                unitName: "waia-fhv-observer.service",
                unitFileExists: false,
                unitFilePath: "/etc/systemd/system/waia-fhv-observer.service",
                unitFileSha256: null,
                loadState: "not-found",
                unitFileState: "absent",
                activeState: "inactive",
                subState: "dead",
                fragmentPath: "",
                enabledState: "not-found",
                activeClass: "not-found",
                isFailed: false,
                execStart: "",
                workingDirectory: "",
                environmentFilePath: "",
                embeddedRunId: null,
                embeddedTargetSha: null,
                embeddedOrganizationId: null,
              },
              {
                unitName: "waia-fhv-campaign.service",
                unitFileExists: false,
                unitFilePath: "/etc/systemd/system/waia-fhv-campaign.service",
                unitFileSha256: null,
                loadState: "not-found",
                unitFileState: "absent",
                activeState: "inactive",
                subState: "dead",
                fragmentPath: "",
                enabledState: "not-found",
                activeClass: "not-found",
                isFailed: false,
                execStart: "",
                workingDirectory: "",
                environmentFilePath: "",
                embeddedRunId: null,
                embeddedTargetSha: null,
                embeddedOrganizationId: null,
              },
            ],
          })}\n`,
          stderr: "",
        };
      }
      if (/fhv-t4-supervisor-residual-recovery\.sh/.test(stdin)) {
        const expected = execFileSync(
          "git",
          [
            "-C",
            options.localReleaseRoot,
            "show",
            `${options.targetSha}:scripts/ops/fhv-t4-supervisor-residual-recovery.sh`,
          ],
          { encoding: "utf8" },
        );
        if (sha256Hex(stdin) !== sha256Hex(expected)) {
          return {
            exitCode: 2,
            stdout: "",
            stderr: "stdin bytes != committed recovery script blob",
          };
        }
        const preview = bootstrapArgs.includes("--preview");
        const argValue = (flag: string): string | undefined => {
          const index = bootstrapArgs.indexOf(flag);
          return index >= 0 ? bootstrapArgs[index + 1] : undefined;
        };
        const failedRunId = argValue("--failed-run-id") ?? options.runId;
        const failedTargetSha = argValue("--failed-target-sha") ?? options.targetSha;
        const failedOrgId = argValue("--expected-organization-id") ?? options.organizationId;
        const unitEvidence = (unitName: string) => ({
          unitName,
          unitFileExists: true,
          unitFilePath: `/etc/systemd/system/${unitName}`,
          unitFileSha256: "f".repeat(64),
          loadState: "loaded",
          unitFileState: "enabled",
          activeState: preview ? "active" : "inactive",
          subState: preview ? "running" : "dead",
          fragmentPath: `/etc/systemd/system/${unitName}`,
          enabledState: preview ? "enabled" : "disabled",
          activeClass: preview ? "active" : "inactive",
          isFailed: false,
          execStart: "/usr/bin/node campaign",
          workingDirectory: `/opt/waia/waia-${failedTargetSha}`,
          environmentFilePath: options.environmentFile,
          embeddedRunId: failedRunId,
          embeddedTargetSha: failedTargetSha,
          embeddedOrganizationId: failedOrgId,
        });
        const payload: Record<string, unknown> = {
          schemaVersion: "fhv-t4-supervisor-residual-recovery/v1",
          phase: preview ? "preview" : "recovery",
          classification: preview
            ? "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK"
            : "FHV_T4A_RESIDUAL_RECOVERY_OK",
          failedRunId,
          failedTargetSha,
          failedReleaseTag: argValue("--failed-release-tag") ?? options.releaseTag,
          organizationId: failedOrgId,
          operatorId:
            argValue("--expected-operator-id") ?? options.operatorId ?? "hermetic-operator",
          hostBootId: bootId,
          unitIdentityClassification: "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH",
          beforeState: {
            units: [
              unitEvidence("waia-fhv-observer.service"),
              unitEvidence("waia-fhv-campaign.service"),
            ],
          },
        };
        if (!preview) {
          recordWrite(join(runDir, "control/fhv-t4-residual-recovery-mutation.v1.json"));
          payload.afterState = {
            units: [
              {
                ...unitEvidence("waia-fhv-observer.service"),
                enabledState: "disabled",
                activeClass: "inactive",
                activeState: "inactive",
                subState: "dead",
              },
              {
                ...unitEvidence("waia-fhv-campaign.service"),
                enabledState: "disabled",
                activeClass: "inactive",
                activeState: "inactive",
                subState: "dead",
              },
            ],
          };
        }
        return { exitCode: 0, stdout: `${JSON.stringify(payload)}\n`, stderr: "" };
      }
      if (/fhv-service-user-checkout\.sh/.test(stdin)) {
        const expected = execFileSync(
          "git",
          [
            "-C",
            options.localReleaseRoot,
            "show",
            `${options.targetSha}:scripts/ops/fhv-service-user-checkout.sh`,
          ],
          { encoding: "utf8" },
        );
        if (sha256Hex(stdin) !== sha256Hex(expected)) {
          return { exitCode: 2, stdout: "", stderr: "stdin bytes != committed checkout blob" };
        }
        recordWrite(repoRoot);
        mkdirSync(join(repoRoot, "scripts/ops"), { recursive: true });
        return {
          exitCode: 0,
          stdout: "classification=FHV_T4_SERVICE_USER_CHECKOUT_OK\n",
          stderr: "",
        };
      }
      if (/fhv-service-user-install-deps\.sh/.test(stdin)) {
        const expected = execFileSync(
          "git",
          [
            "-C",
            options.localReleaseRoot,
            "show",
            `${options.targetSha}:scripts/ops/fhv-service-user-install-deps.sh`,
          ],
          { encoding: "utf8" },
        );
        if (sha256Hex(stdin) !== sha256Hex(expected)) {
          return { exitCode: 2, stdout: "", stderr: "stdin bytes != committed install blob" };
        }
        return {
          exitCode: 0,
          stdout: "classification=FHV_T4_SERVICE_USER_INSTALL_DEPS_OK\n",
          stderr: "",
        };
      }
      const result = spawnSync("bash", ["-s", "--", ...bootstrapArgs], {
        cwd: emptyCwd,
        input: stdin,
        encoding: "utf8",
      });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }

    if (
      /systemctl (start|restart|enable)/.test(remoteCommand) ||
      /enable waia-fhv-/.test(remoteCommand)
    ) {
      return handleSystemctl(remoteCommand);
    }

    if (/fhv-t4-resume-campaign-root\.sh/.test(remoteCommand)) {
      const previousInvocationId = campaign.invocationId || nextInvocation();
      resumeEnforced = true;
      const campaignResult = runHermeticRehearsalCampaignSync("resume");
      if (campaignResult.exitCode !== 0) {
        return campaignResult;
      }
      startUnit(campaign);
      const proof = serializeFhvT4ResumeEnforcementProof({
        schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
        runId: options.runId,
        organizationId: options.organizationId,
        targetSha: options.targetSha,
        resumeCommandId: "hermetic-resume-cmd",
        resumeIdempotencyKey: "hermetic-resume-key",
        bootId,
        campaignUnitName: FHV_SYSTEMD_CAMPAIGN_UNIT,
        previousInvocationId,
        newInvocationId: campaign.invocationId,
        execMainPid: campaign.mainPid,
        execMainStartTimestampMonotonic: campaign.activeEnterMonotonic,
        nRestarts: campaign.nRestarts,
        enforcedAtUtc: new Date().toISOString(),
      });
      writeJson(join(runDir, "control", FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME), proof);
      campaignCompleted = true;
      return { exitCode: 0, stdout: "classification=FHV_T4_RESUME_ENFORCEMENT_OK\n", stderr: "" };
    }

    if (/fhv-t4-campaign-wait-completed\.sh/.test(remoteCommand)) {
      campaign.activeState = "deactivating";
      campaign.activeState = "inactive";
      campaign.result = "success";
      campaignCompleted = true;
      return {
        exitCode: 0,
        stdout: "classification=FHV_T4_CAMPAIGN_COMPLETED_WAIT_OK\n",
        stderr: "",
      };
    }

    if (/fhv-t4-campaign-systemd-identity-read\.sh/.test(remoteCommand)) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(buildHermeticCampaignIdentity())}\n`,
        stderr: "",
      };
    }

    if (/fhv-t4-observer-wait-active\.sh/.test(remoteCommand)) {
      return { exitCode: 0, stdout: "classification=FHV_T4_OBSERVER_ACTIVE\n", stderr: "" };
    }

    if (/fhv-t4-observer-systemd-identity-read\.sh/.test(remoteCommand)) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(buildHermeticObserverIdentity())}\n`,
        stderr: "",
      };
    }

    if (/fhv-t4-host-probe\.sh/.test(remoteCommand)) {
      const outputMatch = remoteCommand.match(/--output\s+'([^']+)'/);
      const rawPath = outputMatch?.[1] ?? join(runDir, "control/fhv-t4-host-probe-raw.v1.json");
      writeJson(rawPath, {
        active: {
          "waia-fhv-campaign.service": "inactive",
          "waia-fhv-observer.service": "inactive",
        },
        enabled: {
          "waia-fhv-campaign.service": "disabled",
          "waia-fhv-observer.service": "disabled",
        },
        unitFiles: {
          "waia-fhv-campaign.service": false,
          "waia-fhv-observer.service": false,
        },
        processes: [],
        legacy: {
          name: FHV_T4A_LEGACY_CONTAINER_NAME,
          image: FHV_T4A_LEGACY_CONTAINER_IMAGE,
          running: true,
        },
        hostBootId: bootId,
      });
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (/fhv-t4-rendered-unit-digests\.sh/.test(remoteCommand)) {
      if (!remoteCommand.includes("--python-bin") || !remoteCommand.includes("--rendered-dir")) {
        return { exitCode: 2, stdout: "", stderr: "rendered-unit-digests argv invalid" };
      }
      return {
        exitCode: 0,
        stdout: '{"waia-fhv-campaign.service":"abc","waia-fhv-observer.service":"def"}\n',
        stderr: "",
      };
    }

    if (/cat > .*fhv-t4-observer-qualification/.test(remoteCommand)) {
      const pathMatch = remoteCommand.match(/cat > '([^']+)'/);
      const qualPath = pathMatch?.[1];
      if (qualPath) {
        const start = remoteCommand.indexOf("<<'FHV_T4A_QUAL_EOF'\n");
        const end = remoteCommand.indexOf("\nFHV_T4A_QUAL_EOF");
        const body =
          start >= 0 && end > start
            ? remoteCommand.slice(start + "<<'FHV_T4A_QUAL_EOF'\n".length, end)
            : "{}";
        recordWrite(qualPath);
        mkdirSync(dirname(qualPath), { recursive: true });
        writeFileSync(qualPath, `${body.trim()}\n`);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (/fhv-t4-service-user-exec\.sh/.test(remoteCommand)) {
      const invocation = extractServiceUserInvocation(remoteCommand);
      const packageScript = invocation?.packageScript ?? "";
      const args = invocation?.args ?? [];
      return handlePackage(packageScript, args);
    }

    if (/rollback-units\.sh/.test(remoteCommand)) {
      if (!remoteCommand.includes("--systemctl-bin") || !remoteCommand.includes("--systemd-dir")) {
        return { exitCode: 2, stdout: "", stderr: "rollback-units.sh argv invalid" };
      }
      if (!remoteCommand.includes("--confirm")) {
        return { exitCode: 0, stdout: "planned rollback\n", stderr: "" };
      }
      recordWrite(join(repoRoot, ".ops/rendered-units/rollback.stamp"));
      return { exitCode: 0, stdout: "classification=FHV_T4_ROLLBACK_OK\n", stderr: "" };
    }

    if (/install-units\.sh/.test(remoteCommand)) {
      if (!remoteCommand.includes("--systemctl-bin") || !remoteCommand.includes("--confirm")) {
        return { exitCode: 0, stdout: "planned install\n", stderr: "" };
      }
      installHermeticUnits();
      return { exitCode: 0, stdout: "classification=FHV_T4_INSTALL_OK\n", stderr: "" };
    }

    if (/render-units\.sh/.test(remoteCommand)) {
      writeHermeticRenderedUnits();
      return { exitCode: 0, stdout: "classification=FHV_T4_RENDER_OK\n", stderr: "" };
    }

    if (/fhv-systemd-record-deploy\.sh/.test(remoteCommand)) {
      if (
        !remoteCommand.includes("--rendered-unit-digests") ||
        remoteCommand.includes("--run-root")
      ) {
        return { exitCode: 2, stdout: "", stderr: "deploy record argv invalid" };
      }
      if (!remoteCommand.includes("--confirm")) {
        return { exitCode: 0, stdout: "planned deploy record\n", stderr: "" };
      }
      mkdirSync(repoRoot, { recursive: true });
      writeHermeticRenderedUnits();
      const renderedDigests = {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: sha256Hex(
          readFileSync(join(repoRoot, ".ops/rendered-units", FHV_SYSTEMD_CAMPAIGN_UNIT), "utf8"),
        ),
        [FHV_SYSTEMD_OBSERVER_UNIT]: sha256Hex(
          readFileSync(join(repoRoot, ".ops/rendered-units", FHV_SYSTEMD_OBSERVER_UNIT), "utf8"),
        ),
      };
      writeFhvSystemdDeployedRevisionAtomic(repoRoot, {
        releaseSha: options.targetSha,
        releaseTag: options.releaseTag,
        runId: options.runId,
        organizationId: options.organizationId,
        renderedUnitDigests: renderedDigests,
        installedAtUtc: new Date().toISOString(),
        operatorId: options.operatorId ?? "hermetic-operator",
        serviceUser: options.serviceUser,
        legacyContainerRunning: true,
      });
      recordWrite(join(repoRoot, ".ops/fhv-systemd-deployed-revision.v1.json"));
      return { exitCode: 0, stdout: "classification=FHV_T4_DEPLOY_RECORD_OK\n", stderr: "" };
    }

    if (/fhv-release-checkout-identity\.sh/.test(remoteCommand)) {
      return { exitCode: 0, stdout: "classification=FHV_T4_CHECKOUT_IDENTITY_OK\n", stderr: "" };
    }

    return { exitCode: 2, stdout: "", stderr: `unknown remote command: ${remoteCommand}` };
  };

  const dispatchWithPersistence = (
    remoteCommand: string,
    stdin: string | undefined,
    asRoot: boolean,
  ): FhvT4aHermeticSshResult => {
    const result = dispatch(remoteCommand, stdin, asRoot);
    persistSimulationState();
    return result;
  };

  const remoteNamespaceRoots = {
    artifactRoot: options.artifactRoot,
    checkoutParent: options.checkoutParent,
    repoRoot,
    runDir,
    installedUnitsDir: join(remoteRoot, "etc/systemd/system"),
  };

  const writeHermeticRenderedUnits = (): void => {
    const units = renderFhvSystemdUnits({
      schemaVersion: "fhv-systemd-unit-config/v1",
      hostOs: "linux",
      qualifiedSupervisor: "SYSTEMD",
      repoRoot,
      workingDirectory: repoRoot,
      serviceUser: options.serviceUser,
      environmentFile: options.environmentFile,
      targetSha: options.targetSha,
      nodeBin: options.nodeBin,
      fhvRunRoot: runDir,
      fhvRunId: options.runId,
      fhvOrganizationId: options.organizationId,
      observerPort: 9471,
    });
    mkdirSync(join(repoRoot, ".ops/rendered-units"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".ops/rendered-units", FHV_SYSTEMD_CAMPAIGN_UNIT),
      units.campaignUnit,
    );
    writeFileSync(
      join(repoRoot, ".ops/rendered-units", FHV_SYSTEMD_OBSERVER_UNIT),
      units.observerUnit,
    );
    recordWrite(join(repoRoot, ".ops/rendered-units"));
  };

  const installHermeticUnits = (): void => {
    writeHermeticRenderedUnits();
    mkdirSync(remoteNamespaceRoots.installedUnitsDir, { recursive: true });
    for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT] as const) {
      const renderedPath = join(repoRoot, ".ops/rendered-units", unit);
      const installedPath = join(remoteNamespaceRoots.installedUnitsDir, unit);
      writeFileSync(installedPath, readFileSync(renderedPath, "utf8"));
      recordWrite(installedPath);
    }
  };

  const resolveRemotePath = (remotePath: string): string => {
    if (remotePath.startsWith("/etc/systemd/system")) {
      return remotePath.replace("/etc/systemd/system", remoteNamespaceRoots.installedUnitsDir);
    }
    return remotePath;
  };

  return {
    repoRoot,
    runDir,
    bootId,
    installedUnitsDir: remoteNamespaceRoots.installedUnitsDir,
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    remoteFileExists: (remotePath: string) => existsSync(resolveRemotePath(remotePath)),
    readRemoteFile: (remotePath: string, byteCap?: number) => {
      const content = readFileSync(resolveRemotePath(remotePath), "utf8");
      if (byteCap !== undefined && Buffer.byteLength(content, "utf8") > byteCap) {
        throw new Error(`FHV_T4A_REMOTE_READ_BYTE_CAP_EXCEEDED:${remotePath}`);
      }
      return content;
    },
    remoteSha256: (remotePath: string) =>
      sha256Hex(readFileSync(resolveRemotePath(remotePath), "utf8")),
    ssh: (
      remoteCommand: string,
      stdin: string | undefined,
      asRoot: boolean,
    ): FhvT4aHermeticSshResult => {
      return dispatchWithPersistence(remoteCommand, stdin, asRoot);
    },
    gitShowBlob: (commitSha: string, path: string): string =>
      execFileSync("git", ["-C", options.localReleaseRoot, "show", `${commitSha}:${path}`], {
        encoding: "utf8",
      }),
    cleanup: (): void => {
      rmSync(remoteRoot, { recursive: true, force: true });
    },
    isCampaignCompleted: (): boolean => campaignCompleted,
    isCampaignPaused: (): boolean => campaignPaused,
    isResumeEnforced: (): boolean => resumeEnforced,
  };
}

export type FhvT4aHermeticSimulation = ReturnType<typeof createFhvT4aHermeticSimulation>;
