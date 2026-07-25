/**
 * DEE-436 — released file-based T4A continuity capture CLI.
 */

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  captureFhvT4ContinuitySnapshot,
  FhvT4ContinuityCaptureError,
  parseFhvT4ContinuitySnapshot,
  writeFhvT4ContinuityVerificationProofAtomic,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { readFhvT4CompletedCampaignSystemdIdentity } from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import { readFhvT4SystemdUnitIdentity } from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";

export type FhvT4ContinuitySubcommand = "capture-before" | "capture-after" | "verify";

export type FhvT4ContinuityCliConfig = Readonly<{
  subcommand: FhvT4ContinuitySubcommand;
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  repoRoot: string;
  systemctlBin: string;
  pythonBin: string;
  outputPath: string;
  beforePath: string;
  afterPath: string;
}>;

export class FhvT4ContinuityCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ContinuityCliError";
  }
}

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1]?.trim();
}

export function parseFhvT4ContinuitySubcommand(argv: readonly string[]): FhvT4ContinuitySubcommand {
  const positional = argv.find((arg) => !arg.startsWith("-"));
  const allowed: FhvT4ContinuitySubcommand[] = ["capture-before", "capture-after", "verify"];
  if (positional && (allowed as string[]).includes(positional)) {
    return positional as FhvT4ContinuitySubcommand;
  }
  throw new FhvT4ContinuityCliError(
    "FHV_T4_CONTINUITY_SUBCOMMAND_INVALID",
    `Subcommand required: ${allowed.join(" | ")}`,
  );
}

export function resolveFhvT4ContinuityCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): FhvT4ContinuityCliConfig {
  const subcommand = parseFhvT4ContinuitySubcommand(argv);
  return {
    subcommand,
    runRoot: parseFlag(argv, "--run-root") ?? env.FHV_RUN_ROOT?.trim() ?? "",
    runId: parseFlag(argv, "--run-id") ?? env.FHV_RUN_ID?.trim() ?? "",
    organizationId: parseFlag(argv, "--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim() ?? "",
    targetSha: parseFlag(argv, "--target-sha") ?? env.FHV_TARGET_SHA?.trim() ?? "",
    repoRoot: parseFlag(argv, "--repo-root") ?? env.FHV_REPO_ROOT?.trim() ?? process.cwd(),
    systemctlBin: parseFlag(argv, "--systemctl-bin") ?? env.FHV_SYSTEMCTL_BIN?.trim() ?? "",
    pythonBin: parseFlag(argv, "--python-bin") ?? env.FHV_PYTHON_BIN?.trim() ?? "",
    outputPath: parseFlag(argv, "--output") ?? env.FHV_CONTINUITY_OUTPUT?.trim() ?? "",
    beforePath: parseFlag(argv, "--before") ?? env.FHV_CONTINUITY_BEFORE?.trim() ?? "",
    afterPath: parseFlag(argv, "--after") ?? env.FHV_CONTINUITY_AFTER?.trim() ?? "",
  };
}

function requireIdentity(config: FhvT4ContinuityCliConfig): void {
  if (
    !config.runRoot ||
    !config.runId ||
    !config.organizationId ||
    !config.targetSha ||
    !config.systemctlBin ||
    !config.pythonBin
  ) {
    throw new FhvT4ContinuityCliError(
      "FHV_T4_CONTINUITY_CONFIG_INCOMPLETE",
      "FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_TARGET_SHA, --systemctl-bin, --python-bin required",
    );
  }
}

export type FhvT4ContinuityCliResult = Readonly<{
  exitCode: number;
  lines: readonly string[];
  payload?: unknown;
}>;

export async function runFhvT4ContinuityCli(
  config: FhvT4ContinuityCliConfig,
): Promise<FhvT4ContinuityCliResult> {
  const lines: string[] = [];
  try {
    requireIdentity(config);
    switch (config.subcommand) {
      case "capture-before":
      case "capture-after": {
        if (!config.outputPath) {
          throw new FhvT4ContinuityCliError(
            "FHV_T4_CONTINUITY_OUTPUT_REQUIRED",
            "--output required for continuity capture",
          );
        }
        const snapshot = captureFhvT4ContinuitySnapshot({
          runRoot: config.runRoot,
          repoRoot: config.repoRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          capturePhase:
            config.subcommand === "capture-before" ? "before_disconnect" : "after_reconnect",
          observerSystemdIdentity: readFhvT4SystemdUnitIdentity(
            config.repoRoot,
            FHV_SYSTEMD_OBSERVER_UNIT,
            process.env,
            {
              systemctlBin: config.systemctlBin,
              pythonBin: config.pythonBin,
            },
          ),
          campaignSystemdIdentity: readFhvT4CompletedCampaignSystemdIdentity(
            config.repoRoot,
            FHV_SYSTEMD_CAMPAIGN_UNIT,
            process.env,
            {
              systemctlBin: config.systemctlBin,
              pythonBin: config.pythonBin,
            },
          ),
        });
        writeFileAtomic(config.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
        lines.push(
          `classification=${
            config.subcommand === "capture-before"
              ? "FHV_T4_CONTINUITY_CAPTURE_BEFORE_OK"
              : "FHV_T4_CONTINUITY_CAPTURE_AFTER_OK"
          }`,
        );
        return { exitCode: 0, lines, payload: snapshot };
      }
      case "verify": {
        if (!config.beforePath || !config.afterPath) {
          throw new FhvT4ContinuityCliError(
            "FHV_T4_CONTINUITY_VERIFY_PATHS_REQUIRED",
            "--before and --after required for verify",
          );
        }
        const before = parseFhvT4ContinuitySnapshot(
          JSON.parse(readFileSync(config.beforePath, "utf8")) as unknown,
        );
        const after = parseFhvT4ContinuitySnapshot(
          JSON.parse(readFileSync(config.afterPath, "utf8")) as unknown,
        );
        const proof = writeFhvT4ContinuityVerificationProofAtomic({
          runRoot: config.runRoot,
          before,
          after,
        });
        lines.push(`classification=${proof.classification}`);
        return { exitCode: 0, lines, payload: proof };
      }
      default:
        throw new FhvT4ContinuityCliError(
          "FHV_T4_CONTINUITY_SUBCOMMAND_INVALID",
          `Unsupported subcommand: ${config.subcommand as string}`,
        );
    }
  } catch (error) {
    const code =
      error instanceof FhvT4ContinuityCliError || error instanceof FhvT4ContinuityCaptureError
        ? error.code
        : "FHV_T4_CONTINUITY_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`${code}: ${message}`);
    return { exitCode: 1, lines };
  }
}

async function main(): Promise<void> {
  const config = resolveFhvT4ContinuityCliConfig();
  const result = await runFhvT4ContinuityCli(config);
  if (result.exitCode === 0 && result.payload !== undefined) {
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
  }
  for (const line of result.lines) {
    process.stdout.write(`[fhv-t4-continuity] ${line}\n`);
  }
  process.exitCode = result.exitCode;
}

if (process.env.VITEST !== "true") {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-t4-continuity] failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
