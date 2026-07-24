/**
 * DEE-436 — released file-based T4A closure CLI (read-only verifiers + seal).
 */

import { readFileSync } from "node:fs";

import {
  FhvT4ClosureVerifierError,
  verifyFhvT4Ceremony,
  verifyFhvT4DeploymentTruth,
  verifyFhvT4FinalState,
  verifyFhvT4PausedState,
  verifyFhvT4RollbackState,
  type FhvT4HostProbe,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  waitFhvT4FinalTerminal,
  waitFhvT4PausedTerminal,
} from "@/lib/trader/observability/fhv-t4-bounded-wait";
import { writeFhvT4DeploymentProofAtomic } from "@/lib/trader/observability/fhv-t4-deployment-proof";
import { buildFhvT4MandatoryEvidenceInventory } from "@/lib/trader/observability/fhv-t4-mandatory-evidence-inventory";
import {
  captureFhvT4RollbackProofFromHost,
  writeFhvT4RollbackProofAtomic,
} from "@/lib/trader/observability/fhv-t4-rollback-proof";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFhvSystemdDeployedRevision } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FhvT4EvidenceSealError,
  sealFhvT4EvidenceRoot,
  verifyFhvT4EvidenceSeal,
} from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

export type FhvT4ClosureSubcommand =
  | "verify-paused"
  | "verify-final"
  | "verify-deployment"
  | "verify-rollback"
  | "verify-seal"
  | "seal-evidence"
  | "verify-ceremony"
  | "wait-paused"
  | "wait-final"
  | "build-evidence-inventory";

export type FhvT4ClosureCliConfig = Readonly<{
  subcommand: FhvT4ClosureSubcommand;
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  releaseTag: string;
  repoRoot: string;
  renderedUnitsDir: string;
  installedUnitsDir: string;
  sealDestination: string;
  serviceUser: string;
  operatorId: string;
  workingDirectory: string;
  environmentFile: string;
  continuityBeforePath: string;
  continuityAfterPath: string;
  evidenceListPath: string;
}>;

export class FhvT4ClosureCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ClosureCliError";
  }
}

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1]?.trim();
}

export function parseFhvT4ClosureSubcommand(argv: readonly string[]): FhvT4ClosureSubcommand {
  const positional = argv.find((arg) => !arg.startsWith("-"));
  const allowed: FhvT4ClosureSubcommand[] = [
    "verify-paused",
    "verify-final",
    "verify-deployment",
    "verify-rollback",
    "verify-seal",
    "seal-evidence",
    "verify-ceremony",
    "wait-paused",
    "wait-final",
    "build-evidence-inventory",
  ];
  if (positional && (allowed as string[]).includes(positional)) {
    return positional as FhvT4ClosureSubcommand;
  }
  throw new FhvT4ClosureCliError(
    "FHV_T4_CLOSURE_SUBCOMMAND_INVALID",
    `Subcommand required: ${allowed.join(" | ")}`,
  );
}

export function resolveFhvT4ClosureCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): FhvT4ClosureCliConfig {
  const subcommand = parseFhvT4ClosureSubcommand(argv);
  return {
    subcommand,
    runRoot: parseFlag(argv, "--run-root") ?? env.FHV_RUN_ROOT?.trim() ?? "",
    runId: parseFlag(argv, "--run-id") ?? env.FHV_RUN_ID?.trim() ?? "",
    organizationId: parseFlag(argv, "--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim() ?? "",
    targetSha: parseFlag(argv, "--target-sha") ?? env.FHV_TARGET_SHA?.trim() ?? "",
    releaseTag: parseFlag(argv, "--release-tag") ?? env.FHV_RELEASE_TAG?.trim() ?? "",
    repoRoot: parseFlag(argv, "--repo-root") ?? env.FHV_REPO_ROOT?.trim() ?? process.cwd(),
    renderedUnitsDir:
      parseFlag(argv, "--rendered-units-dir") ?? env.FHV_RENDERED_UNITS_DIR?.trim() ?? "",
    installedUnitsDir:
      parseFlag(argv, "--installed-units-dir") ??
      env.FHV_INSTALLED_UNITS_DIR?.trim() ??
      "/etc/systemd/system",
    sealDestination:
      parseFlag(argv, "--seal-destination") ?? env.FHV_SEAL_DESTINATION?.trim() ?? "",
    serviceUser: parseFlag(argv, "--service-user") ?? env.FHV_SERVICE_USER?.trim() ?? "",
    operatorId: parseFlag(argv, "--operator-id") ?? env.FHV_OPERATOR_ID?.trim() ?? "t4-operator",
    workingDirectory:
      parseFlag(argv, "--working-directory") ?? env.FHV_WORKING_DIRECTORY?.trim() ?? "",
    environmentFile:
      parseFlag(argv, "--environment-file") ?? env.FHV_ENVIRONMENT_FILE?.trim() ?? "",
    continuityBeforePath:
      parseFlag(argv, "--continuity-before") ?? env.FHV_CONTINUITY_BEFORE?.trim() ?? "",
    continuityAfterPath:
      parseFlag(argv, "--continuity-after") ?? env.FHV_CONTINUITY_AFTER?.trim() ?? "",
    evidenceListPath:
      parseFlag(argv, "--evidence-list") ?? env.FHV_EVIDENCE_LIST_PATH?.trim() ?? "",
  };
}

function requireIdentity(config: FhvT4ClosureCliConfig): void {
  if (!config.runRoot || !config.runId || !config.organizationId || !config.targetSha) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_CLOSURE_CONFIG_INCOMPLETE",
      "FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID, FHV_TARGET_SHA required",
    );
  }
}

function defaultHostProbe(): FhvT4HostProbe {
  // Production host probes are shell-mediated by the operator packet; CLI default is fail-closed
  // unless overridden via env JSON for hermetic tests.
  const raw = process.env.FHV_T4_HOST_PROBE_JSON?.trim();
  if (!raw) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_HOST_PROBE_REQUIRED",
      "FHV_T4_HOST_PROBE_JSON required for verify-rollback / verify-ceremony host proofs.",
    );
  }
  const parsed = JSON.parse(raw) as {
    active: Record<string, string>;
    enabled: Record<string, string>;
    unitFiles: Record<string, boolean>;
    processes: string[];
    legacy: { name: string; image: string; running: boolean } | null;
  };
  return {
    systemctlIsActive: (unit) => ({ state: parsed.active[unit] ?? "unknown" }),
    systemctlIsEnabled: (unit) => ({ state: parsed.enabled[unit] ?? "unknown" }),
    unitFileExists: (unit) => parsed.unitFiles[unit] === true,
    listMatchingProcesses: (pattern) =>
      (parsed.processes ?? []).filter((line) => line.includes(pattern)),
    inspectLegacyContainer: () => parsed.legacy,
  };
}

export type FhvT4ClosureCliResult = Readonly<{
  exitCode: number;
  lines: readonly string[];
  payload?: unknown;
}>;

export async function runFhvT4ClosureCli(
  config: FhvT4ClosureCliConfig,
  deps?: { host?: FhvT4HostProbe },
): Promise<FhvT4ClosureCliResult> {
  const lines: string[] = [];
  try {
    switch (config.subcommand) {
      case "verify-paused": {
        requireIdentity(config);
        const result = verifyFhvT4PausedState({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag || undefined,
          repoRoot: config.repoRoot,
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-final": {
        requireIdentity(config);
        const result = verifyFhvT4FinalState({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag || undefined,
          repoRoot: config.repoRoot,
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-deployment": {
        requireIdentity(config);
        if (
          !config.releaseTag ||
          !config.renderedUnitsDir ||
          !config.serviceUser ||
          !config.workingDirectory ||
          !config.environmentFile
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_DEPLOYMENT_CONFIG_INCOMPLETE",
            "release-tag, rendered-units-dir, service-user, working-directory, environment-file required",
          );
        }
        const result = verifyFhvT4DeploymentTruth({
          repoRoot: config.repoRoot,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
          operatorId: config.operatorId,
          serviceUser: config.serviceUser,
          workingDirectory: config.workingDirectory,
          environmentFile: config.environmentFile,
          renderedUnitsDir: config.renderedUnitsDir,
          installedUnitsDir: config.installedUnitsDir,
        });
        const record = readFhvSystemdDeployedRevision(config.repoRoot);
        if (!record) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_DEPLOYMENT_RECORD_MISSING",
            "Deployment record missing after verification.",
          );
        }
        writeFhvT4DeploymentProofAtomic(config.runRoot, {
          releaseSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
          operatorId: config.operatorId,
          serviceUser: config.serviceUser,
          workingDirectory: config.workingDirectory,
          environmentFile: config.environmentFile,
          renderedUnitDigests: result.installedDigests,
          installedUnitDigests: result.installedDigests,
          deploymentRecordDigest: computePayloadDigest(record),
          legacyContainerName: record.legacyContainerName,
          legacyContainerImage: record.legacyContainerImage,
          legacyContainerRunning: true,
          capturedAtUtc: new Date().toISOString(),
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-rollback": {
        requireIdentity(config);
        const host = deps?.host ?? defaultHostProbe();
        const result = verifyFhvT4RollbackState({
          runRoot: config.runRoot,
          repoRoot: config.repoRoot,
          targetSha: config.targetSha,
          requiredEvidencePaths: [
            `${config.runRoot}/fhv-rehearsal-manifest.v1.json`,
            `${config.runRoot}/fhv-rehearsal-terminal.v1.json`,
            `${config.runRoot}/control/command-ledger.jsonl`,
            `${config.runRoot}/control/fhv-t4-pause-armed.v1.json`,
            `${config.runRoot}/fhv-resume-runtime-proof.v1.json`,
          ],
          host,
        });
        const record = readFhvSystemdDeployedRevision(config.repoRoot);
        if (!record) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_ROLLBACK_DEPLOYMENT_RECORD_MISSING",
            "Deployment record missing for rollback proof.",
          );
        }
        writeFhvT4RollbackProofAtomic(
          config.runRoot,
          captureFhvT4RollbackProofFromHost({
            targetSha: config.targetSha,
            runId: config.runId,
            organizationId: config.organizationId,
            deploymentRecordDigest: computePayloadDigest(record),
            host,
          }),
        );
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-seal": {
        requireIdentity(config);
        if (!config.sealDestination) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_SEAL_DESTINATION_REQUIRED",
            "seal-destination required",
          );
        }
        const result = verifyFhvT4EvidenceSeal({
          sealDestination: config.sealDestination,
          releaseSha: config.targetSha,
          runId: config.runId,
          organizationId: config.organizationId,
          releaseTag: config.releaseTag || undefined,
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "seal-evidence": {
        requireIdentity(config);
        if (!config.sealDestination || !config.releaseTag || !config.serviceUser) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_SEAL_CONFIG_INCOMPLETE",
            "seal-destination, release-tag, and service-user required",
          );
        }
        const evidenceFiles = buildFhvT4MandatoryEvidenceInventory({
          runRoot: config.runRoot,
          repoRoot: config.repoRoot,
          renderedUnitsDir: config.renderedUnitsDir,
          continuityBeforePath: config.continuityBeforePath,
          continuityAfterPath: config.continuityAfterPath,
        }).map((entry) => ({
          absolutePath: entry.absolutePath,
          relativePath: entry.relativePath,
        }));
        const result = sealFhvT4EvidenceRoot({
          sealDestination: config.sealDestination,
          evidenceFiles,
          releaseSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
          serviceUser: config.serviceUser,
        });
        lines.push(`classification=${result.classification}`);
        lines.push(`rootDigest=${result.rootDigest}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-ceremony": {
        requireIdentity(config);
        if (
          !config.releaseTag ||
          !config.sealDestination ||
          !config.continuityBeforePath ||
          !config.continuityAfterPath
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_CEREMONY_CONFIG_INCOMPLETE",
            "ceremony requires release-tag, seal destination, and continuity paths",
          );
        }
        const result = verifyFhvT4Ceremony({
          identity: {
            runRoot: config.runRoot,
            runId: config.runId,
            organizationId: config.organizationId,
            targetSha: config.targetSha,
            releaseTag: config.releaseTag,
            repoRoot: config.repoRoot,
          },
          sealDestination: config.sealDestination,
          continuityBeforePath: config.continuityBeforePath,
          continuityAfterPath: config.continuityAfterPath,
        });
        lines.push(`classification=${result.classification}`);
        for (const [key, value] of Object.entries(result.passFields)) {
          lines.push(`${key}=${value}`);
        }
        // Ensure unit names appear in ceremony payload for operators
        lines.push(`units=${FHV_SYSTEMD_CAMPAIGN_UNIT},${FHV_SYSTEMD_OBSERVER_UNIT}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "wait-paused": {
        requireIdentity(config);
        const result = await waitFhvT4PausedTerminal({ runRoot: config.runRoot });
        lines.push(`classification=${result.classification}`);
        lines.push(`actualPauseCycle=${result.actualPauseCycle}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "wait-final": {
        requireIdentity(config);
        const result = await waitFhvT4FinalTerminal({ runRoot: config.runRoot });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "build-evidence-inventory": {
        requireIdentity(config);
        if (
          !config.renderedUnitsDir ||
          !config.continuityBeforePath ||
          !config.continuityAfterPath
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_INVENTORY_CONFIG_INCOMPLETE",
            "rendered-units-dir, continuity-before, continuity-after required",
          );
        }
        const inventory = buildFhvT4MandatoryEvidenceInventory({
          runRoot: config.runRoot,
          repoRoot: config.repoRoot,
          renderedUnitsDir: config.renderedUnitsDir,
          continuityBeforePath: config.continuityBeforePath,
          continuityAfterPath: config.continuityAfterPath,
          hostProbeJsonPath: parseFlag(process.argv.slice(2), "--host-probe-json-path"),
        });
        lines.push(`inventoryCount=${inventory.length}`);
        return { exitCode: 0, lines, payload: inventory };
      }
      default:
        throw new FhvT4ClosureCliError(
          "FHV_T4_CLOSURE_SUBCOMMAND_INVALID",
          `Unsupported subcommand: ${config.subcommand as string}`,
        );
    }
  } catch (error) {
    const code =
      error instanceof FhvT4ClosureCliError ||
      error instanceof FhvT4ClosureVerifierError ||
      error instanceof FhvT4EvidenceSealError
        ? error.code
        : "FHV_T4_CLOSURE_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`${code}: ${message}`);
    return { exitCode: 1, lines };
  }
}

async function main(): Promise<void> {
  const config = resolveFhvT4ClosureCliConfig();
  const result = await runFhvT4ClosureCli(config);
  if (result.payload !== undefined) {
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
  }
  for (const line of result.lines) {
    process.stdout.write(`[fhv-t4-closure] ${line}\n`);
  }
  process.exitCode = result.exitCode;
}

if (process.env.VITEST !== "true") {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-t4-closure] failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
