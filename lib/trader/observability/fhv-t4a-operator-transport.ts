/**
 * DEE-436 — T4A operator transport interface (live + test injection).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export type FhvT4aTransportExecResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type FhvT4aOperatorTransport = Readonly<{
  kind: "hermetic" | "live";
  remoteWriteCount: () => number;
  resetRemoteWrites: () => void;
  ssh: (input: {
    remoteCommand: string;
    stdin?: string;
    args?: readonly string[];
    asRoot?: boolean;
  }) => FhvT4aTransportExecResult;
  sudoNoninteractiveProbe: () => FhvT4aTransportExecResult;
  gitShowBlob: (sha: string, path: string) => string;
  localGit: (args: readonly string[]) => FhvT4aTransportExecResult;
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

export function createFhvT4aLiveTransport(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorTransport {
  let remoteWrites = 0;
  const execHost = env.EXEC_HOST?.trim() ?? "";
  const sshUser = env.SSH_USER?.trim() ?? "";
  const localReleaseRoot = env.FHV_LOCAL_RELEASE_ROOT?.trim() ?? "";
  const sshBase = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=30",
    "-o",
    "ServerAliveInterval=15",
    `${sshUser}@${execHost}`,
  ];

  return {
    kind: "live",
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    gitShowBlob: (commitSha, path) =>
      execFileSync("git", ["-C", localReleaseRoot, "show", `${commitSha}:${path}`], {
        encoding: "utf8",
      }),
    localGit: (args) => {
      try {
        const stdout = execFileSync("git", ["-C", localReleaseRoot, ...args], {
          encoding: "utf8",
        });
        return { exitCode: 0, stdout, stderr: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
    },
    sudoNoninteractiveProbe: () => {
      try {
        execFileSync("ssh", [...sshBase, "sudo", "-n", "true"], { stdio: "pipe" });
        return { exitCode: 0, stdout: "", stderr: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return { exitCode: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
    },
    ssh: ({ remoteCommand, stdin, asRoot }) => {
      const remote = asRoot ? `sudo -n ${remoteCommand}` : remoteCommand;
      const result = spawnSync("ssh", [...sshBase, remote], {
        input: stdin,
        encoding: "utf8",
      });
      if (asRoot && result.status === 0 && stdin) {
        remoteWrites += 1;
      }
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
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
