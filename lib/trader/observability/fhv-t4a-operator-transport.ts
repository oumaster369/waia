/**
 * DEE-436 — T4A operator transport interface (live + test injection).
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { FhvT4aPreauthLedgerEntry } from "@/lib/trader/observability/fhv-t4a-preauth-ledger";
import {
  classifyFhvT4aPreauthRemoteCommand,
  createFhvT4aPreauthLedger,
} from "@/lib/trader/observability/fhv-t4a-preauth-ledger";
import {
  buildRemoteFsExistsCommand,
  buildRemoteFsReadCommand,
  buildRemoteFsSha256Command,
  parseRemoteFsExistsStdout,
  parseRemoteFsReadStdout,
  parseRemoteFsSha256Stdout,
  type FhvT4aRemoteFsExistsOperation,
  type FhvT4aRemoteFsReadOperation,
  type FhvT4aRemoteFsSha256Operation,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-ops";

export type FhvT4aTransportExecResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type FhvT4aSshInvocation = Readonly<{
  remoteCommand: string;
  stdin?: string;
  asRoot: boolean;
  effectiveRemoteCommand: string;
  exitCode: number;
}>;

export const FHV_T4A_REMOTE_READ_BYTE_CAP = 10 * 1024 * 1024;

export type FhvT4aGovernedRemoteMutation = "residual-recovery-confirm";

export type FhvT4aOperatorTransport = Readonly<{
  kind: "hermetic" | "live";
  approvedRemoteRoots: readonly string[];
  remoteReadByteCap: number;
  remoteWriteCount: () => number;
  resetRemoteWrites: () => void;
  sshInvocations: () => readonly FhvT4aSshInvocation[];
  preauthLedgerEntries: () => readonly FhvT4aPreauthLedgerEntry[];
  preauthMutatingCommandCount: () => number;
  ssh: (input: {
    remoteCommand: string;
    stdin?: string;
    args?: readonly string[];
    asRoot?: boolean;
    preauthPhase?: boolean;
    preauthBootstrapPath?: string;
    preauthBootstrapBody?: string;
    governedRemoteMutation?: FhvT4aGovernedRemoteMutation;
  }) => FhvT4aTransportExecResult;
  sudoNoninteractiveProbe: () => FhvT4aTransportExecResult;
  gitShowBlob: (sha: string, path: string) => string;
  localGit: (args: readonly string[]) => FhvT4aTransportExecResult;
  remoteFileExists: (op: FhvT4aRemoteFsExistsOperation) => boolean;
  readRemoteFile: (op: FhvT4aRemoteFsReadOperation) => string;
  remoteSha256: (op: FhvT4aRemoteFsSha256Operation) => string;
  hermeticInstalledUnitsDir?: string;
}>;

let injectedTransport: FhvT4aOperatorTransport | null = null;

export function setFhvT4aOperatorTransportForTests(
  transport: FhvT4aOperatorTransport | null,
): void {
  injectedTransport = transport;
}

export function getFhvT4aOperatorTransportForTests(): FhvT4aOperatorTransport | null {
  return injectedTransport;
}

export function buildEffectiveRemoteCommand(remoteCommand: string, asRoot: boolean): string {
  const trimmed = remoteCommand.trim();
  if (!asRoot) {
    return trimmed;
  }
  if (/^sudo\s+-n\b/.test(trimmed)) {
    return trimmed;
  }
  return `sudo -n ${trimmed}`;
}

export function assertExactlyOneSudoTransition(
  effectiveRemoteCommand: string,
  asRoot: boolean,
): void {
  if (!asRoot) {
    return;
  }
  const matches = effectiveRemoteCommand.match(/\bsudo\s+-n\b/g);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `FHV_T4A_DOUBLE_SUDO: expected exactly one 'sudo -n', got ${matches?.length ?? 0}`,
    );
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function resolveApprovedRemoteRoots(env: NodeJS.ProcessEnv): string[] {
  const artifactRoot = env.FHV_ARTIFACT_ROOT?.trim();
  const checkoutParent = env.FHV_CHECKOUT_PARENT?.trim();
  const targetSha = env.EXECUTION_SERVER_TARGET_SHA?.trim()?.toLowerCase();
  const runId = env.FHV_RUN_ID?.trim();
  const roots = ["/etc/systemd/system"];
  if (artifactRoot) {
    roots.push(artifactRoot);
  }
  if (checkoutParent) {
    roots.push(checkoutParent);
    if (targetSha) {
      roots.push(join(checkoutParent, `waia-${targetSha}`));
    }
  }
  if (artifactRoot && runId) {
    roots.push(join(artifactRoot, "RI-P7/fhv-ops-rehearsal", runId));
  }
  return roots;
}

function countGovernedRemoteMutation(input: {
  remoteCommand: string;
  governedRemoteMutation?: FhvT4aGovernedRemoteMutation;
}): boolean {
  if (input.governedRemoteMutation === "residual-recovery-confirm") {
    return true;
  }
  return /(>>|>\s|tee |mkdir |touch |rm |mv |cp )/.test(input.remoteCommand);
}

export function createFhvT4aLiveTransport(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorTransport {
  let remoteWrites = 0;
  const invocations: FhvT4aSshInvocation[] = [];
  const preauthLedger = createFhvT4aPreauthLedger();
  const execHost = env.EXEC_HOST?.trim() ?? "";
  const sshUser = env.SSH_USER?.trim() ?? "";
  const localReleaseRoot = env.FHV_LOCAL_RELEASE_ROOT?.trim() ?? "";
  const localGitBin = env.FHV_LOCAL_GIT_BIN?.trim() || "git";
  const sshBin = env.FHV_LOCAL_SSH_BIN?.trim() || "ssh";
  const remotePythonBin = env.FHV_PYTHON_BIN?.trim() ?? "";
  const serviceUser = env.FHV_SERVICE_USER?.trim() ?? "";
  const approvedRoots = resolveApprovedRemoteRoots(env);

  const sshBase = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=30",
    "-o",
    "ServerAliveInterval=15",
    `${sshUser}@${execHost}`,
  ];

  const sshExec = (remoteCommand: string): FhvT4aTransportExecResult => {
    const result = spawnSync(sshBin, [...sshBase, remoteCommand], {
      encoding: "utf8",
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  return {
    kind: "live",
    approvedRemoteRoots: approvedRoots,
    remoteReadByteCap: FHV_T4A_REMOTE_READ_BYTE_CAP,
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    sshInvocations: () => invocations,
    preauthLedgerEntries: () => preauthLedger.entries(),
    preauthMutatingCommandCount: () => preauthLedger.mutatingCommandCount(),
    gitShowBlob: (commitSha, path) =>
      execFileSync(localGitBin, ["-C", localReleaseRoot, "show", `${commitSha}:${path}`], {
        encoding: "utf8",
      }),
    localGit: (args) => {
      try {
        const stdout = execFileSync(localGitBin, ["-C", localReleaseRoot, ...args], {
          encoding: "utf8",
        });
        return { exitCode: 0, stdout, stderr: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
    },
    remoteFileExists: (op) => {
      const result = sshExec(buildRemoteFsExistsCommand(op));
      if (result.exitCode !== 0) {
        return false;
      }
      try {
        return parseRemoteFsExistsStdout(result.stdout);
      } catch {
        return false;
      }
    },
    readRemoteFile: (op) => {
      const result = sshExec(buildRemoteFsReadCommand(op));
      if (result.exitCode !== 0) {
        throw new Error(`FHV_T4A_REMOTE_READ_FAILED:${op.remotePath}:${result.stderr}`);
      }
      return parseRemoteFsReadStdout(result.stdout, op.byteCap).bytes;
    },
    remoteSha256: (op) => {
      const result = sshExec(buildRemoteFsSha256Command(op));
      if (result.exitCode !== 0) {
        throw new Error(`FHV_T4A_REMOTE_SHA256_FAILED:${op.remotePath}:${result.stderr}`);
      }
      return parseRemoteFsSha256Stdout(result.stdout);
    },
    sudoNoninteractiveProbe: () => {
      try {
        execFileSync(sshBin, [...sshBase, "sudo", "-n", "true"], { stdio: "pipe" });
        return { exitCode: 0, stdout: "", stderr: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
    },
    ssh: ({
      remoteCommand,
      stdin,
      asRoot = false,
      preauthPhase = false,
      preauthBootstrapPath,
      preauthBootstrapBody,
      governedRemoteMutation,
    }) => {
      const effectiveRemoteCommand = buildEffectiveRemoteCommand(remoteCommand, asRoot);
      assertExactlyOneSudoTransition(effectiveRemoteCommand, asRoot);
      const sequence = preauthLedger.entries().length + 1;
      if (preauthPhase) {
        const classified = classifyFhvT4aPreauthRemoteCommand({
          remoteCommand,
          hasStdinBootstrap: Boolean(stdin),
          bootstrapRepositoryPath: preauthBootstrapPath ?? null,
          bootstrapBody: preauthBootstrapBody ?? null,
        });
        if (classified.classification === "rejected") {
          preauthLedger.record({
            sequence,
            bootstrapRepositoryPath: classified.bootstrapRepositoryPath,
            bootstrapBlobSha256: classified.bootstrapBlobSha256,
            originalRemoteCommand: classified.originalRemoteCommand,
            effectiveRemoteCommand,
            privilegeLocus: asRoot ? "REMOTE_ROOT" : "SSH_USER",
            stdinPresent: classified.stdinPresent,
            classification: classified.classification,
            classificationReason: classified.classificationReason,
            exitStatus: 2,
            stdoutDigest: sha256Hex(""),
            stderrDigest: sha256Hex(classified.classificationReason),
          });
          return {
            exitCode: 2,
            stdout: "",
            stderr: `PRE_AUTH rejected command: ${classified.classificationReason}`,
          };
        }
      }
      const result = spawnSync(sshBin, [...sshBase, effectiveRemoteCommand], {
        input: stdin,
        encoding: "utf8",
      });
      const execResult = {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
      invocations.push({
        remoteCommand,
        stdin,
        asRoot,
        effectiveRemoteCommand,
        exitCode: execResult.exitCode,
      });
      if (preauthPhase) {
        const classified = classifyFhvT4aPreauthRemoteCommand({
          remoteCommand,
          hasStdinBootstrap: Boolean(stdin),
          bootstrapRepositoryPath: preauthBootstrapPath ?? null,
          bootstrapBody: preauthBootstrapBody ?? null,
        });
        preauthLedger.record({
          sequence,
          bootstrapRepositoryPath: classified.bootstrapRepositoryPath,
          bootstrapBlobSha256: classified.bootstrapBlobSha256,
          originalRemoteCommand: classified.originalRemoteCommand,
          effectiveRemoteCommand,
          privilegeLocus: asRoot ? "REMOTE_ROOT" : "SSH_USER",
          stdinPresent: classified.stdinPresent,
          classification: classified.classification,
          classificationReason: classified.classificationReason,
          exitStatus: execResult.exitCode,
          stdoutDigest: sha256Hex(execResult.stdout),
          stderrDigest: sha256Hex(execResult.stderr),
        });
      }
      if (!preauthPhase && countGovernedRemoteMutation({ remoteCommand, governedRemoteMutation })) {
        remoteWrites += 1;
      }
      return execResult;
    },
  };
}

export function assertFhvT4aLocalGitClean(transport: FhvT4aOperatorTransport): void {
  const status = transport.localGit(["status", "--porcelain=v1"]);
  if (status.exitCode !== 0 || status.stdout.trim()) {
    throw new Error("FHV_T4A_LOCAL_RELEASE_DIRTY");
  }
}

export function assertFhvT4aNoGitOperationInProgress(
  transport: FhvT4aOperatorTransport,
  localReleaseRoot: string,
): void {
  for (const flag of ["merge", "rebase", "cherry-pick", "bisect"]) {
    const dir = transport.localGit(["rev-parse", "--git-path", flag]);
    if (dir.exitCode !== 0) {
      continue;
    }
    const path = dir.stdout.trim();
    if (path && existsSync(`${localReleaseRoot}/.git/${path}`)) {
      throw new Error(`FHV_T4A_LOCAL_GIT_STATE_BLOCKED:${flag}`);
    }
  }
}

/** @deprecated use preauthMutatingCommandCount */
export function preauthMeasuredRemoteWriteCount(transport: FhvT4aOperatorTransport): number {
  return transport.preauthMutatingCommandCount();
}
