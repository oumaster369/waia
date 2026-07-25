/**
 * DEE-436 — hermetic ssh/sudo/systemctl/git shims for T4A operator integration tests.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";

export type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
export {
  createFhvT4aLiveTransport,
  getFhvT4aOperatorTransportForTests,
  setFhvT4aOperatorTransportForTests,
} from "@/lib/trader/observability/fhv-t4a-operator-transport";

export type FhvT4aHermeticTransportOptions = Readonly<{
  localReleaseRoot: string;
  targetSha: string;
  releaseTag?: string;
  originUrl?: string;
  serviceUser: string;
  serviceUserHome: string;
  checkoutParent: string;
  artifactRoot: string;
  environmentFile: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  onRemoteWrite?: () => void;
}>;

export function createFhvT4aHermeticTransport(
  options: FhvT4aHermeticTransportOptions,
): FhvT4aOperatorTransport {
  const remoteRoot = mkdtempSync(join(tmpdir(), "fhv-t4a-remote-"));
  const remoteCwd = join(remoteRoot, "empty-cwd");
  mkdirSync(remoteCwd, { recursive: true });
  mkdirSync(dirname(options.artifactRoot), { recursive: true });
  mkdirSync(options.checkoutParent, { recursive: true });
  let remoteWrites = 0;

  writeFileSync(
    options.environmentFile,
    [
      "FHV_HOST_OS_QUALIFIED=true",
      "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
      "FHV_OPERATOR_COMMAND_SECRET=test-command-secret",
      "FHV_OBSERVER_TUNNEL_SECRET=test-tunnel-secret",
    ].join("\n") + "\n",
  );

  const recordWrite = (): void => {
    remoteWrites += 1;
    options.onRemoteWrite?.();
  };

  return {
    kind: "hermetic",
    remoteWriteCount: () => remoteWrites,
    resetRemoteWrites: () => {
      remoteWrites = 0;
    },
    gitShowBlob: (commitSha, path) =>
      execFileSync("git", ["-C", options.localReleaseRoot, "show", `${commitSha}:${path}`], {
        encoding: "utf8",
      }),
    localGit: (args) => {
      if (
        args[0] === "remote" &&
        args[1] === "get-url" &&
        args[2] === "origin" &&
        options.originUrl
      ) {
        return { exitCode: 0, stdout: `${options.originUrl}\n`, stderr: "" };
      }
      if (
        args[0] === "rev-parse" &&
        args[1]?.endsWith("^{}") &&
        options.releaseTag &&
        args[1].startsWith(`${options.releaseTag}^{}`)
      ) {
        return { exitCode: 0, stdout: `${options.targetSha}\n`, stderr: "" };
      }
      try {
        const stdout = execFileSync("git", ["-C", options.localReleaseRoot, ...args], {
          encoding: "utf8",
        });
        return { exitCode: 0, stdout, stderr: "" };
      } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return {
          exitCode: err.status ?? 1,
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? "",
        };
      }
    },
    sudoNoninteractiveProbe: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    ssh: ({ remoteCommand, stdin, asRoot }) => {
      if (stdin?.includes("checkout") || stdin?.includes("install-deps")) {
        recordWrite();
      }
      const env = {
        ...process.env,
        FHV_SHIM_AS_ROOT: asRoot ? "1" : "0",
        HOME: asRoot ? "/root" : options.serviceUserHome,
        USER: asRoot ? "root" : options.serviceUser,
        FHV_SERVICE_USER: options.serviceUser,
        FHV_CHECKOUT_PARENT: options.checkoutParent,
        FHV_ARTIFACT_ROOT: options.artifactRoot,
        FHV_NODE_BIN: options.nodeBin,
        FHV_COREPACK_BIN: options.corepackBin,
        FHV_GIT_BIN: options.gitBin,
        FHV_PYTHON_BIN: options.pythonBin,
        FHV_DOCKER_BIN: options.dockerBin,
        SYSTEMCTL: options.systemctlBin,
        PYTHON_BIN: options.pythonBin,
      };
      const result = spawnSync("bash", ["-c", remoteCommand], {
        cwd: remoteCwd,
        input: stdin,
        encoding: "utf8",
        env,
      });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
