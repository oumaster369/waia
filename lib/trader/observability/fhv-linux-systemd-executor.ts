import { execFile } from "node:child_process";

import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";
import { writeFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-campaign-control-files";
import {
  createRecordingFhvCampaignControlExecutor,
  type FhvCampaignControlExecutionResult,
  type FhvCampaignControlExecutor,
} from "@/lib/trader/observability/fhv-campaign-control-executor";
import {
  assertFhvSystemdAllowedUnit,
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { resolveFhvSupervisorContract } from "@/lib/trader/observability/fhv-supervisor-contract";

export const FHV_SYSTEMD_ALLOWED_ACTIONS = [
  "start",
  "stop",
  "restart",
  "is-active",
  "show",
] as const;

export type FhvSystemdAllowedAction = (typeof FHV_SYSTEMD_ALLOWED_ACTIONS)[number];

export type FhvLinuxSystemdExecutorConfig = Readonly<{
  hostOsQualified: boolean;
  deploymentEnabled: boolean;
  runRoot: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  spawnSystemctl?: typeof spawnSystemctlBounded;
}>;

export type FhvSystemctlInvocationResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

export class FhvLinuxSystemdExecutorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvLinuxSystemdExecutorError";
  }
}

function assertQualifiedDeployment(config: FhvLinuxSystemdExecutorConfig): void {
  const contract = resolveFhvSupervisorContract(config.hostOsQualified ? "linux" : "unknown");
  if (contract.implementationStatus !== "qualified") {
    throw new FhvLinuxSystemdExecutorError(
      "HOST_QUALIFICATION_REQUIRED",
      "Linux systemd host qualification is required.",
    );
  }
  if (!config.deploymentEnabled) {
    throw new FhvLinuxSystemdExecutorError(
      "DEPLOYMENT_DISABLED",
      "FHV systemd deployment is disabled until explicitly enabled by operator configuration.",
    );
  }
}

export function assertFhvSystemdAllowedAction(action: string): void {
  if (!(FHV_SYSTEMD_ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    throw new FhvLinuxSystemdExecutorError("UNKNOWN_ACTION", `Action not allowlisted: ${action}`);
  }
}

export function buildSystemctlArgumentArray(
  action: FhvSystemdAllowedAction,
  unit: string,
): readonly string[] {
  assertFhvSystemdAllowedUnit(unit);
  assertFhvSystemdAllowedAction(action);
  if (/[;&|`$(){}<>]|\.\./.test(unit)) {
    throw new FhvLinuxSystemdExecutorError(
      "INVALID_UNIT",
      "Unit name contains forbidden characters.",
    );
  }
  return ["systemctl", action, unit];
}

export async function spawnSystemctlBounded(
  args: readonly string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<FhvSystemctlInvocationResult> {
  if (args[0] !== "systemctl") {
    throw new FhvLinuxSystemdExecutorError(
      "INVALID_INVOCATION",
      "Only systemctl invocations are allowed.",
    );
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? 8_192;
  const command = args[0]!;
  const commandArgs = [...args.slice(1)];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };

  return await new Promise((resolve, reject) => {
    execFile(
      command,
      commandArgs,
      { env, maxBuffer: maxOutputBytes, timeout: timeoutMs },
      (error, stdout, stderr) => {
        const boundedStdout = String(stdout).slice(0, maxOutputBytes).trim();
        const boundedStderr = String(stderr).slice(0, maxOutputBytes).trim();
        if (error) {
          const timedOut =
            (error as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
            ("killed" in error && Boolean(error.killed));
          if (timedOut) {
            resolve({
              exitCode: typeof error.code === "number" ? error.code : 1,
              stdout: boundedStdout,
              stderr: boundedStderr,
              timedOut: true,
            });
            return;
          }
          resolve({
            exitCode: typeof error.code === "number" ? error.code : 1,
            stdout: boundedStdout,
            stderr: boundedStderr,
            timedOut: false,
          });
          return;
        }
        resolve({
          exitCode: 0,
          stdout: boundedStdout,
          stderr: boundedStderr,
          timedOut: false,
        });
      },
    ).on("error", reject);
  });
}

function mapOperatorActionToSystemd(
  action: FhvOperatorAction,
):
  | { kind: "systemctl"; systemdAction: FhvSystemdAllowedAction; unit: string }
  | { kind: "control_file" }
  | { kind: "resume_from_checkpoint" } {
  switch (action) {
    case "GRACEFUL_STOP":
      return { kind: "systemctl", systemdAction: "stop", unit: FHV_SYSTEMD_CAMPAIGN_UNIT };
    case "EMERGENCY_STOP":
      return { kind: "systemctl", systemdAction: "stop", unit: FHV_SYSTEMD_CAMPAIGN_UNIT };
    case "RESUME_FROM_CHECKPOINT":
      return { kind: "resume_from_checkpoint" };
    case "PAUSE_AT_CHECKPOINT":
    case "CREATE_DIAGNOSTIC_BUNDLE":
      return { kind: "control_file" };
    default:
      throw new FhvLinuxSystemdExecutorError(
        "UNKNOWN_OPERATOR_ACTION",
        `Unsupported action: ${action}`,
      );
  }
}

export function createLinuxSystemdCampaignControlExecutor(
  config: FhvLinuxSystemdExecutorConfig,
): FhvCampaignControlExecutor {
  const spawnFn = config.spawnSystemctl ?? spawnSystemctlBounded;
  return {
    async execute(input): Promise<FhvCampaignControlExecutionResult> {
      try {
        assertQualifiedDeployment(config);
      } catch (error) {
        const message =
          error instanceof FhvLinuxSystemdExecutorError ? error.code : "SUPERVISOR_NOT_CONFIGURED";
        return { outcome: "failed", message, enforcementApplied: false };
      }

      const mapped = mapOperatorActionToSystemd(input.action);
      if (mapped.kind === "control_file") {
        writeFhvCampaignControlRequest(config.runRoot, {
          schemaVersion: "fhv-campaign-control-request/v1",
          action: input.action,
          runId: input.runId,
          organizationId: input.organizationId,
          operatorId: input.operatorId,
          reason: input.reason,
          requestedAtUtc: new Date().toISOString(),
        });
        return {
          outcome: "executed",
          message: `Control request recorded for ${input.action}`,
          enforcementApplied: true,
        };
      }

      if (mapped.kind === "resume_from_checkpoint") {
        try {
          writeFhvCampaignControlRequest(config.runRoot, {
            schemaVersion: "fhv-campaign-control-request/v1",
            action: "RESUME_FROM_CHECKPOINT",
            runId: input.runId,
            organizationId: input.organizationId,
            operatorId: input.operatorId,
            reason: input.reason,
            requestedAtUtc: new Date().toISOString(),
          });
        } catch {
          return {
            outcome: "failed",
            message: "RESUME_CONTROL_WRITE_FAILED",
            enforcementApplied: false,
          };
        }
        const args = buildSystemctlArgumentArray("start", FHV_SYSTEMD_CAMPAIGN_UNIT);
        const result = await spawnFn(args, {
          timeoutMs: config.timeoutMs,
          maxOutputBytes: config.maxOutputBytes,
        });
        if (result.timedOut) {
          return {
            outcome: "failed",
            message: "SYSTEMCTL_TIMEOUT",
            enforcementApplied: false,
          };
        }
        if (result.exitCode !== 0) {
          return {
            outcome: "failed",
            message: "SYSTEMCTL_START_FAILED",
            enforcementApplied: false,
          };
        }
        return {
          outcome: "executed",
          message: "resume marker recorded; start waia-fhv-campaign.service",
          enforcementApplied: true,
        };
      }

      const args = buildSystemctlArgumentArray(mapped.systemdAction, mapped.unit);
      const result = await spawnFn(args, {
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
      });
      if (result.timedOut) {
        return {
          outcome: "failed",
          message: "SYSTEMCTL_TIMEOUT",
          enforcementApplied: false,
        };
      }
      if (result.exitCode !== 0) {
        return {
          outcome: "failed",
          message: `SYSTEMCTL_${mapped.systemdAction.toUpperCase()}_FAILED`,
          enforcementApplied: false,
        };
      }
      return {
        outcome: "executed",
        message: `${mapped.systemdAction} ${mapped.unit}`,
        enforcementApplied: true,
      };
    },
  };
}

export function createRecordingLinuxSystemdCampaignControlExecutor(
  config: FhvLinuxSystemdExecutorConfig & {
    spawnSystemctl?: typeof spawnSystemctlBounded;
  },
): FhvCampaignControlExecutor & {
  records: Array<Parameters<FhvCampaignControlExecutor["execute"]>[0]>;
  systemctlCalls: Array<{ args: readonly string[]; result: FhvSystemctlInvocationResult }>;
} {
  const systemctlCalls: Array<{ args: readonly string[]; result: FhvSystemctlInvocationResult }> =
    [];
  const spawnFn =
    config.spawnSystemctl ??
    (async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }));
  const inner = createLinuxSystemdCampaignControlExecutor({
    ...config,
    spawnSystemctl: async (args, options) => {
      const result = await spawnFn(args, options);
      systemctlCalls.push({ args, result });
      return result;
    },
  });
  const recording = createRecordingFhvCampaignControlExecutor(inner);
  return Object.assign(recording, { systemctlCalls });
}

export async function restartFhvObserverViaSystemd(
  config: FhvLinuxSystemdExecutorConfig,
): Promise<FhvSystemctlInvocationResult> {
  assertQualifiedDeployment(config);
  const args = buildSystemctlArgumentArray("restart", FHV_SYSTEMD_OBSERVER_UNIT);
  return (config.spawnSystemctl ?? spawnSystemctlBounded)(args, {
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
  });
}
