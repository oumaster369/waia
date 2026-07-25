/**
 * DEE-436 — hermetic T4A operator transport (integration + subprocess tests).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createFhvT4aHermeticSimulation } from "@/lib/trader/observability/fhv-t4a-hermetic-simulation";
import {
  assertExactlyOneSudoTransition,
  buildEffectiveRemoteCommand,
  type FhvT4aOperatorTransport,
  type FhvT4aSshInvocation,
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
  runId: string;
  organizationId: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
}>;

export function createFhvT4aHermeticTransport(
  options: FhvT4aHermeticTransportOptions,
): FhvT4aOperatorTransport {
  const simulation = createFhvT4aHermeticSimulation({
    localReleaseRoot: options.localReleaseRoot,
    targetSha: options.targetSha,
    releaseTag: options.releaseTag ?? "local-dev",
    originUrl: options.originUrl ?? "https://github.com/oumaster369/waia.git",
    serviceUser: options.serviceUser,
    serviceUserHome: options.serviceUserHome,
    checkoutParent: options.checkoutParent,
    artifactRoot: options.artifactRoot,
    environmentFile: options.environmentFile,
    runId: options.runId,
    organizationId: options.organizationId,
    nodeBin: options.nodeBin,
    corepackBin: options.corepackBin,
    gitBin: options.gitBin,
    pythonBin: options.pythonBin,
    dockerBin: options.dockerBin,
    systemctlBin: options.systemctlBin,
  });

  writeFileSync(
    options.environmentFile,
    [
      "FHV_HOST_OS_QUALIFIED=true",
      "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
      "FHV_OPERATOR_COMMAND_SECRET=test-command-secret",
      "FHV_OBSERVER_TUNNEL_SECRET=test-tunnel-secret",
    ].join("\n") + "\n",
  );
  mkdirSync(dirname(options.artifactRoot), { recursive: true });
  mkdirSync(options.checkoutParent, { recursive: true });

  const invocations: FhvT4aSshInvocation[] = [];

  return {
    kind: "hermetic",
    remoteWriteCount: () => simulation.remoteWriteCount(),
    resetRemoteWrites: () => simulation.resetRemoteWrites(),
    sshInvocations: () => invocations,
    gitShowBlob: simulation.gitShowBlob,
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
    ssh: ({ remoteCommand, stdin, asRoot = false }) => {
      const effectiveRemoteCommand = buildEffectiveRemoteCommand(remoteCommand, asRoot);
      assertExactlyOneSudoTransition(effectiveRemoteCommand, asRoot);
      const result = simulation.ssh(remoteCommand, stdin, asRoot);
      invocations.push({
        remoteCommand,
        stdin,
        asRoot,
        effectiveRemoteCommand,
        exitCode: result.exitCode,
      });
      return result;
    },
  };
}

export function createFhvT4aHermeticTransportFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FhvT4aOperatorTransport {
  const requireEnv = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`FHV_T4A_HERMETIC_BINDING_MISSING:${name}`);
    }
    return value;
  };
  return createFhvT4aHermeticTransport({
    localReleaseRoot: requireEnv("FHV_LOCAL_RELEASE_ROOT"),
    targetSha: requireEnv("EXECUTION_SERVER_TARGET_SHA").toLowerCase(),
    releaseTag: env.FHV_RELEASE_TAG?.trim(),
    originUrl: env.FHV_ORIGIN_URL?.trim(),
    serviceUser: requireEnv("FHV_SERVICE_USER"),
    serviceUserHome: env.FHV_SERVICE_USER_HOME?.trim() || `/home/${requireEnv("FHV_SERVICE_USER")}`,
    checkoutParent: requireEnv("FHV_CHECKOUT_PARENT"),
    artifactRoot: requireEnv("FHV_ARTIFACT_ROOT"),
    environmentFile: requireEnv("FHV_ENVIRONMENT_FILE"),
    runId: requireEnv("FHV_RUN_ID"),
    organizationId: requireEnv("FHV_ORGANIZATION_ID"),
    nodeBin: requireEnv("FHV_NODE_BIN"),
    corepackBin: requireEnv("FHV_COREPACK_BIN"),
    gitBin: requireEnv("FHV_GIT_BIN"),
    pythonBin: requireEnv("FHV_PYTHON_BIN"),
    dockerBin: requireEnv("FHV_DOCKER_BIN"),
    systemctlBin: requireEnv("FHV_SYSTEMCTL_BIN"),
  });
}
