/**
 * DEE-436 — T4A operator transport interface (live + test injection).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import type { FhvT4aPreauthLedgerEntry } from "@/lib/trader/observability/fhv-t4a-preauth-ledger";
import {
  classifyFhvT4aPreauthRemoteCommand,
  createFhvT4aPreauthLedger,
} from "@/lib/trader/observability/fhv-t4a-preauth-ledger";

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

export type FhvT4aOperatorTransport = Readonly<{
  kind: "hermetic" | "live";
  remoteWriteCount: () => number;
  resetRemoteWrites: () => void;
  sshInvocations: () => readonly FhvT4aSshInvocation[];
  preauthLedgerEntries: () => readonly FhvT4aPreauthLedgerEntry[];
  preauthMeasuredRemoteWriteCount: () => number;
  ssh: (input: {
    remoteCommand: string;
    stdin?: string;
    args?: readonly string[];
    asRoot?: boolean;
    preauthPhase?: boolean;
  }) => FhvT4aTransportExecResult;
  sudoNoninteractiveProbe: () => FhvT4aTransportExecResult;
  gitShowBlob: (sha: string, path: string) => string;
  localGit: (args: readonly string[]) => FhvT4aTransportExecResult;
  remoteFileExists: (remotePath: string) => boolean;
  readRemoteFile: (remotePath: string) => string;
  remoteSha256: (remotePath: string) => string;
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const REMOTE_READ_BYTE_CAP = 10 * 1024 * 1024;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type FhvT4aRemoteFsTools = Readonly<{
  testBin: string;
  catBin: string;
  sha256sumBin: string;
}>;

export function resolveFhvT4aRemoteFsTools(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aRemoteFsTools {
  return {
    testBin: env.FHV_REMOTE_TEST_BIN?.trim() || "/usr/bin/test",
    catBin: env.FHV_REMOTE_CAT_BIN?.trim() || "/bin/cat",
    sha256sumBin: env.FHV_REMOTE_SHA256SUM_BIN?.trim() || "/usr/bin/sha256sum",
  };
}

export function createFhvT4aLiveTransport(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorTransport {
  let remoteWrites = 0;
  const invocations: FhvT4aSshInvocation[] = [];
  const preauthLedger = createFhvT4aPreauthLedger();
  const remoteFs = resolveFhvT4aRemoteFsTools(env);
  const execHost = env.EXEC_HOST?.trim() ?? "";
  const sshUser = env.SSH_USER?.trim() ?? "";
  const localReleaseRoot = env.FHV_LOCAL_RELEASE_ROOT?.trim() ?? "";
  const localGitBin = env.FHV_LOCAL_GIT_BIN?.trim() || "git";
  const sshBin = env.FHV_LOCAL_SSH_BIN?.trim() || "ssh";
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
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    sshInvocations: () => invocations,
    preauthLedgerEntries: () => preauthLedger.entries(),
    preauthMeasuredRemoteWriteCount: () => preauthLedger.measuredRemoteWriteCount(),
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
    remoteFileExists: (remotePath) => {
      const result = sshExec(`${shellQuote(remoteFs.testBin)} -f ${shellQuote(remotePath)}`);
      return result.exitCode === 0;
    },
    readRemoteFile: (remotePath) => {
      const result = sshExec(
        `${shellQuote(remoteFs.catBin)} ${shellQuote(remotePath)} | head -c ${REMOTE_READ_BYTE_CAP}`,
      );
      if (result.exitCode !== 0) {
        throw new Error(`FHV_T4A_REMOTE_READ_FAILED:${remotePath}`);
      }
      if (result.stdout.length >= REMOTE_READ_BYTE_CAP) {
        throw new Error(`FHV_T4A_REMOTE_READ_BYTE_CAP:${remotePath}`);
      }
      return result.stdout;
    },
    remoteSha256: (remotePath) => {
      const result = sshExec(
        `${shellQuote(remoteFs.sha256sumBin)} ${shellQuote(remotePath)} | awk '{print $1}'`,
      );
      if (result.exitCode !== 0) {
        throw new Error(`FHV_T4A_REMOTE_SHA256_FAILED:${remotePath}`);
      }
      const digest = result.stdout.trim().toLowerCase();
      if (!SHA256_HEX_PATTERN.test(digest)) {
        throw new Error(`FHV_T4A_REMOTE_SHA256_INVALID:${remotePath}`);
      }
      return digest;
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
    ssh: ({ remoteCommand, stdin, asRoot = false, preauthPhase = false }) => {
      const effectiveRemoteCommand = buildEffectiveRemoteCommand(remoteCommand, asRoot);
      assertExactlyOneSudoTransition(effectiveRemoteCommand, asRoot);
      if (preauthPhase) {
        const classified = classifyFhvT4aPreauthRemoteCommand(remoteCommand, Boolean(stdin));
        preauthLedger.record(classified);
        if (classified.classification === "rejected") {
          return {
            exitCode: 2,
            stdout: "",
            stderr: `PRE_AUTH rejected command: ${classified.reason}`,
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
      if (!preauthPhase && /(>>|>\s|tee |mkdir |touch |rm |mv |cp )/.test(remoteCommand)) {
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
