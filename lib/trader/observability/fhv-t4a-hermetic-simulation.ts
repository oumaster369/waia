/**
 * DEE-436 — hermetic Execution Server simulation for T4A operator integration tests.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { buildEffectiveRemoteCommand } from "@/lib/trader/observability/fhv-t4a-operator-transport";

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

export function createFhvT4aHermeticSimulation(options: FhvT4aHermeticSimulationOptions) {
  const remoteRoot = mkdtempSync(join(tmpdir(), "fhv-t4a-remote-"));
  const emptyCwd = join(remoteRoot, "empty-cwd");
  mkdirSync(emptyCwd, { recursive: true });
  mkdirSync(options.checkoutParent, { recursive: true });
  mkdirSync(dirname(options.artifactRoot), { recursive: true });

  const repoRoot = join(options.checkoutParent, `waia-${options.targetSha}`);
  const runDir = join(options.artifactRoot, "RI-P7/fhv-ops-rehearsal", options.runId);
  const bootId = "11111111-2222-4333-8444-555555555555";

  let remoteWrites = 0;
  let invocationCounter = 0;
  let campaignPaused = false;
  let campaignCompleted = false;
  let resumeEnforced = false;

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

  const ensureRunLayout = (): void => {
    recordWrite(runDir);
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeJson(join(runDir, "fhv-rehearsal-manifest.v1.json"), {
      schemaVersion: "fhv-rehearsal-manifest/v1",
      runId: options.runId,
      organizationId: options.organizationId,
      targetSha: options.targetSha,
      runDir,
    });
  };

  const handleSystemctl = (cmd: string): FhvT4aHermeticSshResult => {
    if (/start waia-fhv-observer\.service/.test(cmd)) {
      startUnit(observer);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/restart waia-fhv-observer\.service/.test(cmd)) {
      observer.activeState = "deactivating";
      observer.invocationId = nextInvocation();
      observer.mainPid = 2000 + invocationCounter;
      observer.activeState = "active";
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/start waia-fhv-campaign\.service/.test(cmd) && !resumeEnforced) {
      startUnit(campaign);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (/start waia-fhv-campaign\.service/.test(cmd) && resumeEnforced) {
      campaign.activeState = "inactive";
      startUnit(campaign);
      campaignCompleted = false;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "systemctl: unit not handled" };
  };

  const handlePackage = (packageScript: string, args: string[]): FhvT4aHermeticSshResult => {
    ensureRunLayout();
    if (packageScript === "trader:fhv:rehearsal") {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ runDir, manifestPath: join(runDir, "fhv-rehearsal-manifest.v1.json") })}\n`,
        stderr: "",
      };
    }
    if (packageScript === "trader:fhv:t4:record-checkout-identity") {
      writeJson(join(runDir, "control/fhv-t4-checkout-identity-proof.v1.json"), {
        schemaVersion: "fhv-t4-checkout-identity-proof/v1",
        targetSha: options.targetSha,
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
      return { exitCode: 0, stdout: "classification=FHV_T4_PAUSE_ARMED\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:verify") {
      return { exitCode: 0, stdout: "classification=FHV_T4_VERIFY_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:wait-paused") {
      campaignPaused = true;
      campaign.activeState = "inactive";
      campaign.result = "success";
      writeJson(join(runDir, "fhv-rehearsal-terminal.v1.json"), {
        classification: "REHEARSAL_PAUSED_AT_CYCLE_40",
      });
      writeJson(join(runDir, "control/fhv-t4-paused-verification-proof.v1.json"), {
        schemaVersion: "fhv-t4-paused-verification-proof/v1",
        classification: "REHEARSAL_PAUSED_AT_CYCLE_40",
      });
      return { exitCode: 0, stdout: "PAUSE_RESULT=REHEARSAL_PAUSED_AT_CYCLE_40\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:verify-paused") {
      return { exitCode: 0, stdout: "classification=FHV_T4_PAUSED_VERIFY_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:resume") {
      return {
        exitCode: 0,
        stdout: "status=accepted\nclassification=FHV_T4_RESUME_ACCEPTED\n",
        stderr: "",
      };
    }
    if (packageScript === "trader:fhv:t4:wait-final") {
      if (!resumeEnforced) {
        return { exitCode: 2, stdout: "", stderr: "resume enforcement missing" };
      }
      campaign.activeState = "active";
      writeJson(join(runDir, "fhv-t4-campaign-runtime.v1.json"), {
        schemaVersion: "fhv-t4-campaign-runtime/v1",
        bootId,
        invocationId: campaign.invocationId,
      });
      return { exitCode: 0, stdout: "classification=FHV_T4_FINAL_WAIT_OK\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:verify-final") {
      return { exitCode: 0, stdout: "classification=FHV_T4_FINAL_VERIFY_OK\n", stderr: "" };
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
    if (packageScript === "trader:fhv:t4:verify-continuity") {
      return { exitCode: 0, stdout: "CONTINUITY_RESULT=PASS\n", stderr: "" };
    }
    if (packageScript === "trader:fhv:t4:verify-ceremony") {
      return {
        exitCode: 0,
        stdout:
          [
            "T4A_RESULT=PASS",
            "GATE8_RESULT=PASS",
            "T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE",
            "PAUSE_RESULT=REHEARSAL_PAUSED_AT_CYCLE_40",
            "RESUME_RESULT=REHEARSAL_OK",
            "FULL_HISTORY_RESCAN_DELTA=0",
            "CONTINUITY_RESULT=PASS",
            "ROLLBACK_RESULT=PASS",
            "EVIDENCE_SEAL_RESULT=PASS",
          ].join("\n") + "\n",
        stderr: "",
      };
    }
    if (packageScript.startsWith("trader:fhv:t4:")) {
      return {
        exitCode: 0,
        stdout: `classification=FHV_T4_${packageScript.split(":").pop()?.toUpperCase()}_OK\n`,
        stderr: "",
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
          stdout:
            '{"schemaVersion":"fhv-t4-host-preflight/v2","classification":"FHV_T4_HOST_PREFLIGHT_OK"}\nclassification=FHV_T4_HOST_PREFLIGHT_OK\n',
          stderr: "",
        };
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

    if (/systemctl (start|restart)/.test(remoteCommand)) {
      return handleSystemctl(remoteCommand);
    }

    if (/fhv-t4-resume-campaign-root\.sh/.test(remoteCommand)) {
      resumeEnforced = true;
      writeJson(join(runDir, "control/fhv-t4-resume-enforcement-proof.v1.json"), {
        schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
        newInvocationId: nextInvocation(),
        nRestarts: campaign.nRestarts,
      });
      startUnit(campaign);
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
        stdout: `${JSON.stringify({ bootId, invocationId: campaign.invocationId, activeState: campaign.activeState })}\n`,
        stderr: "",
      };
    }

    if (/fhv-t4-observer-wait-active\.sh/.test(remoteCommand)) {
      return { exitCode: 0, stdout: "classification=FHV_T4_OBSERVER_ACTIVE\n", stderr: "" };
    }

    if (/fhv-t4-observer-systemd-identity-read\.sh/.test(remoteCommand)) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ bootId, invocationId: observer.invocationId, mainPid: observer.mainPid, activeState: observer.activeState })}\n`,
        stderr: "",
      };
    }

    if (/fhv-t4-service-user-exec\.sh/.test(remoteCommand)) {
      const invocation = extractServiceUserInvocation(remoteCommand);
      const packageScript = invocation?.packageScript ?? "";
      const args = invocation?.args ?? [];
      return handlePackage(packageScript, args);
    }

    if (
      /render-units\.sh|install-units\.sh|fhv-systemd-record-deploy\.sh|rollback-units\.sh/.test(
        remoteCommand,
      )
    ) {
      recordWrite(join(repoRoot, ".ops/rendered-units/units.stamp"));
      mkdirSync(join(repoRoot, ".ops/rendered-units"), { recursive: true });
      writeFileSync(join(repoRoot, ".ops/rendered-units/units.stamp"), "ok\n");
      return { exitCode: 0, stdout: "classification=FHV_T4_SYSTEMD_OK\n", stderr: "" };
    }

    if (/fhv-release-checkout-identity\.sh/.test(remoteCommand)) {
      return { exitCode: 0, stdout: "classification=FHV_T4_CHECKOUT_IDENTITY_OK\n", stderr: "" };
    }

    return { exitCode: 0, stdout: "", stderr: "" };
  };

  return {
    repoRoot,
    runDir,
    bootId,
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    ssh: (
      remoteCommand: string,
      stdin: string | undefined,
      asRoot: boolean,
    ): FhvT4aHermeticSshResult => {
      const effective = buildEffectiveRemoteCommand(remoteCommand, asRoot);
      return dispatch(remoteCommand, stdin, asRoot);
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
