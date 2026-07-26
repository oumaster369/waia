/**
 * DEE-435 / DEE-436 — signed T4 operator CLI (localhost observer bridge).
 */

import { randomBytes } from "node:crypto";

import { createAbortTimeout } from "@/lib/http/create-abort-timeout";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import type { FhvCommandResultV1 } from "@/lib/trader/observability/fhv-command-ledger";
import {
  createFhvCommandNonce,
  signFhvOperatorCommandV1,
  type FhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  FHV_OBSERVER_AUTH_HEADER,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FhvSystemdDeployedRevisionError,
  verifyFhvSystemdDeployedRevisionMatchesTarget,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  assertFhvT4PauseArmedBeforeCampaignStart,
  assertFhvT4PreArmEnvironment,
  FhvT4DeterministicPauseError,
  isFhvT4DeterministicPauseManifest,
  readFhvT4PauseArmedRecord,
  resolveFhvT4PreArmExpectedPhase,
  validateFhvT4PauseArmedMatchesControlRequest,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FHV_RESPONSE_BYTE_CAPS,
  parseBoundedJsonResponse,
  validateFhvCommandResultV1Response,
  validateFhvOperatorStatusV1Response,
} from "@/lib/trader/observability/fhv-runtime-response-validators";

export type FhvT4OperatorSubcommand = "status" | "arm-pause" | "resume" | "verify";

export type FhvT4OperatorCliConfig = Readonly<{
  subcommand: FhvT4OperatorSubcommand;
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  commandSecret: string;
  observerTunnelSecret: string;
  operatorId: string;
  observerHost: string;
  observerPort: number;
  repoRoot: string;
}>;

export class FhvT4OperatorCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4OperatorCliError";
  }
}

const DEFAULT_OBSERVER_HOST = "127.0.0.1";
const DEFAULT_OBSERVER_PORT = 9471;
export const FHV_T4_OPERATOR_HTTP_TIMEOUT_DEFAULT_MS = 10_000;

export function resolveFhvT4OperatorHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw =
    env.FHV_T4_OPERATOR_HTTP_TIMEOUT_MS?.trim() ||
    env.FHV_OBSERVER_TUNNEL_TIMEOUT_MS?.trim() ||
    String(FHV_T4_OPERATOR_HTTP_TIMEOUT_DEFAULT_MS);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return FHV_T4_OPERATOR_HTTP_TIMEOUT_DEFAULT_MS;
  }
  return parsed;
}

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1]?.trim();
}

export function parseFhvT4OperatorSubcommand(argv: readonly string[]): FhvT4OperatorSubcommand {
  const positional = argv.find((arg) => !arg.startsWith("-"));
  if (
    positional === "status" ||
    positional === "arm-pause" ||
    positional === "resume" ||
    positional === "verify"
  ) {
    return positional;
  }
  throw new FhvT4OperatorCliError(
    "FHV_T4_CLI_SUBCOMMAND_INVALID",
    "Subcommand required: status | arm-pause | resume | verify",
  );
}

export function resolveFhvT4OperatorCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): FhvT4OperatorCliConfig {
  const subcommand = parseFhvT4OperatorSubcommand(argv);
  if (argv.includes("--command-secret") || argv.includes("--tunnel-secret")) {
    throw new FhvT4OperatorCliError(
      "FHV_T4_CLI_SECRET_ARGV_FORBIDDEN",
      "Secrets must not be supplied via argv; use EnvironmentFile/environment only.",
    );
  }
  const runRoot = parseFlag(argv, "--run-root") ?? env.FHV_RUN_ROOT?.trim() ?? "";
  const runId = parseFlag(argv, "--run-id") ?? env.FHV_RUN_ID?.trim() ?? "";
  const organizationId =
    parseFlag(argv, "--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim() ?? "";
  const targetSha = parseFlag(argv, "--target-sha") ?? env.FHV_TARGET_SHA?.trim() ?? "";
  const commandSecret = env.FHV_OPERATOR_COMMAND_SECRET?.trim() ?? "";
  const observerTunnelSecret = env.FHV_OBSERVER_TUNNEL_SECRET?.trim() ?? "";
  const operatorId =
    parseFlag(argv, "--operator-id") ?? env.FHV_OPERATOR_ID?.trim() ?? "t4-operator";
  const observerHost =
    parseFlag(argv, "--observer-host") ??
    env.FHV_OBSERVER_BIND_HOST?.trim() ??
    DEFAULT_OBSERVER_HOST;
  const observerPortRaw =
    parseFlag(argv, "--observer-port") ??
    env.FHV_OBSERVER_PORT?.trim() ??
    String(DEFAULT_OBSERVER_PORT);
  const observerPort = Number(observerPortRaw);
  const repoRoot = parseFlag(argv, "--repo-root") ?? env.FHV_REPO_ROOT?.trim() ?? process.cwd();

  if (
    !runRoot ||
    !runId ||
    !organizationId ||
    !targetSha ||
    !commandSecret ||
    !observerTunnelSecret
  ) {
    throw new FhvT4OperatorCliError(
      "FHV_T4_CLI_CONFIG_INCOMPLETE",
      "FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_TARGET_SHA, FHV_OPERATOR_COMMAND_SECRET, FHV_OBSERVER_TUNNEL_SECRET required",
    );
  }
  if (!Number.isFinite(observerPort) || observerPort <= 0 || observerPort > 65535) {
    throw new FhvT4OperatorCliError(
      "FHV_T4_CLI_OBSERVER_PORT_INVALID",
      "Observer port must be a valid TCP port.",
    );
  }

  return {
    subcommand,
    runRoot,
    runId,
    organizationId,
    targetSha,
    commandSecret,
    observerTunnelSecret,
    operatorId,
    observerHost,
    observerPort,
    repoRoot,
  };
}

function observerBaseUrl(config: FhvT4OperatorCliConfig): string {
  return `http://${config.observerHost}:${config.observerPort}`;
}

export async function signedFhvT4ObserverFetch(
  config: FhvT4OperatorCliConfig,
  input: { method: string; path: string; body?: unknown },
  deps?: { fetchFn?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<Response> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const bodyText = input.body === undefined ? "" : JSON.stringify(input.body);
  const authToken = buildFhvObserverAuthToken(
    {
      method: input.method,
      path: input.path,
      organizationId: config.organizationId,
      campaignRunId: config.runId,
      timestampMs: Date.now(),
      nonce: createFhvObserverAuthNonce(),
      bodySha256: sha256Hex(bodyText),
    },
    config.observerTunnelSecret,
  );
  const timeoutMs = deps?.timeoutMs ?? resolveFhvT4OperatorHttpTimeoutMs(deps?.env);
  const abort = createAbortTimeout(timeoutMs);
  try {
    return await fetchFn(`${observerBaseUrl(config)}${input.path}`, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        [FHV_OBSERVER_AUTH_HEADER]: authToken,
        "x-fhv-organization-id": config.organizationId,
        "x-fhv-campaign-run-id": config.runId,
      },
      body: bodyText.length > 0 ? bodyText : undefined,
      signal: abort.signal,
    });
  } catch (error) {
    if ((error instanceof Error && error.name === "AbortError") || abort.signal.aborted) {
      throw new FhvT4OperatorCliError(
        "FHV_T4_OPERATOR_HTTP_TIMEOUT",
        `Observer HTTP call exceeded ${timeoutMs}ms bounded timeout.`,
      );
    }
    throw error;
  } finally {
    abort.clearTimer();
  }
}

export function buildFhvT4SignedOperatorCommand(
  config: FhvT4OperatorCliConfig,
  input: {
    action: "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT";
    expectedPhase: string;
    checkpointSeq?: number;
  },
): FhvOperatorCommandV1 {
  const issuedAtUtc = new Date().toISOString();
  const expiresAtUtc = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const suffix = randomBytes(8).toString("hex");
  return signFhvOperatorCommandV1(
    {
      schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
      commandId: `t4-${input.action.toLowerCase()}-${suffix}`,
      campaignRunId: config.runId,
      organizationId: config.organizationId,
      operatorId: config.operatorId,
      action: input.action,
      reason: `T4 operator CLI ${input.action}`,
      issuedAtUtc,
      expiresAtUtc,
      nonce: createFhvCommandNonce(),
      idempotencyKey: `t4-${input.action}-${suffix}`,
      expectedCampaignState: {
        phase: input.expectedPhase,
        ...(input.checkpointSeq !== undefined ? { checkpointSeq: input.checkpointSeq } : {}),
      },
      confirmationPhraseClass: input.action === "PAUSE_AT_CHECKPOINT" ? "PAUSE" : "RESUME",
    },
    config.commandSecret,
  );
}

export async function fetchFhvT4OperatorStatus(
  config: FhvT4OperatorCliConfig,
  deps?: { fetchFn?: typeof fetch },
): Promise<FhvOperatorStatusV1> {
  const path = `/v1/status?organization_id=${encodeURIComponent(config.organizationId)}&campaign_run_id=${encodeURIComponent(config.runId)}`;
  const response = await signedFhvT4ObserverFetch(config, { method: "GET", path }, deps);
  if (!response.ok) {
    throw new FhvT4OperatorCliError(
      "FHV_T4_OBSERVER_STATUS_UNAVAILABLE",
      `Observer status unavailable (${response.status}).`,
    );
  }
  const text = await response.text();
  const payload = parseBoundedJsonResponse({
    text,
    maxBytes: FHV_RESPONSE_BYTE_CAPS.status,
    contentType: response.headers.get("content-type"),
  });
  return validateFhvOperatorStatusV1Response({
    payload,
    organizationId: config.organizationId,
    campaignRunId: config.runId,
  });
}

export async function forwardFhvT4OperatorCommand(
  config: FhvT4OperatorCliConfig,
  command: FhvOperatorCommandV1,
  deps?: { fetchFn?: typeof fetch },
): Promise<FhvCommandResultV1> {
  const path = `/v1/commands?organization_id=${encodeURIComponent(config.organizationId)}&campaign_run_id=${encodeURIComponent(config.runId)}`;
  const response = await signedFhvT4ObserverFetch(
    config,
    {
      method: "POST",
      path,
      body: { command, operatorId: config.operatorId },
    },
    deps,
  );
  if (!response.ok) {
    throw new FhvT4OperatorCliError(
      "FHV_T4_OBSERVER_COMMAND_FAILED",
      `Observer command forwarding failed (${response.status}).`,
    );
  }
  const text = await response.text();
  const payload = parseBoundedJsonResponse({
    text,
    maxBytes: FHV_RESPONSE_BYTE_CAPS.commandResult,
    contentType: response.headers.get("content-type"),
  });
  return validateFhvCommandResultV1Response({ payload });
}

export async function runFhvT4OperatorVerify(config: FhvT4OperatorCliConfig): Promise<void> {
  const manifest = readFhvRehearsalManifest(config.runRoot);
  if (!isFhvT4DeterministicPauseManifest(manifest)) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_MANIFEST_NOT_DETERMINISTIC",
      "Manifest is not configured for T4 deterministic pause.",
    );
  }
  assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: config.runRoot, manifest });
  validateFhvT4PauseArmedMatchesControlRequest({
    runRoot: config.runRoot,
    runId: config.runId,
    organizationId: config.organizationId,
  });
  const armed = readFhvT4PauseArmedRecord(config.runRoot);
  if (!armed) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_NOT_ARMED",
      "T4 deterministic pause must be armed before verify.",
    );
  }
  verifyFhvSystemdDeployedRevisionMatchesTarget({
    repoRoot: config.repoRoot,
    targetSha: config.targetSha,
  });
}

export type FhvT4OperatorCliResult = Readonly<{
  exitCode: number;
  lines: readonly string[];
}>;

export async function runFhvT4OperatorCli(
  config: FhvT4OperatorCliConfig,
  deps?: { fetchFn?: typeof fetch },
): Promise<FhvT4OperatorCliResult> {
  const lines: string[] = [];
  try {
    switch (config.subcommand) {
      case "status": {
        const status = await fetchFhvT4OperatorStatus(config, deps);
        lines.push(`phase=${status.campaign.phase}`);
        lines.push(`terminalState=${status.campaign.terminalState}`);
        return { exitCode: 0, lines };
      }
      case "arm-pause": {
        assertFhvT4PreArmEnvironment();
        const expectedPhase = resolveFhvT4PreArmExpectedPhase(
          config.runRoot,
          config.runId,
          config.organizationId,
        );
        const command = buildFhvT4SignedOperatorCommand(config, {
          action: "PAUSE_AT_CHECKPOINT",
          expectedPhase,
        });
        const result = await forwardFhvT4OperatorCommand(config, command, deps);
        lines.push(`status=${result.status}`);
        lines.push(`message=${result.message}`);
        return { exitCode: result.status === "executed" ? 0 : 1, lines };
      }
      case "resume": {
        const snapshot = resolveFhvCampaignState({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
        });
        const command = buildFhvT4SignedOperatorCommand(config, {
          action: "RESUME_FROM_CHECKPOINT",
          expectedPhase: snapshot.phase,
          checkpointSeq: snapshot.checkpointSeq,
        });
        const result = await forwardFhvT4OperatorCommand(config, command, deps);
        lines.push(`status=${result.status}`);
        lines.push(`message=${result.message}`);
        return { exitCode: result.status === "executed" ? 0 : 1, lines };
      }
      case "verify": {
        await runFhvT4OperatorVerify(config);
        lines.push("classification=T4_VERIFY_OK");
        return { exitCode: 0, lines };
      }
      default:
        throw new FhvT4OperatorCliError(
          "FHV_T4_CLI_SUBCOMMAND_INVALID",
          `Unsupported subcommand: ${config.subcommand as string}`,
        );
    }
  } catch (error) {
    const code =
      error instanceof FhvT4OperatorCliError ||
      error instanceof FhvT4DeterministicPauseError ||
      error instanceof FhvSystemdDeployedRevisionError
        ? error.code
        : "FHV_T4_CLI_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`${code}: ${message}`);
    return { exitCode: 1, lines };
  }
}

async function main(): Promise<void> {
  const config = resolveFhvT4OperatorCliConfig();
  const result = await runFhvT4OperatorCli(config);
  for (const line of result.lines) {
    process.stdout.write(`[fhv-t4-operator] ${line}\n`);
  }
  process.exitCode = result.exitCode;
}

if (process.env.VITEST !== "true") {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-t4-operator] failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
