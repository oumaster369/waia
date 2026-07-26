/**
 * DEE-436 — released file-based T4A closure CLI (strict argv + verifiers + seal).
 */

import { readFileSync } from "node:fs";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvSystemdDeployedRevision } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import {
  FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS,
  FhvT4BoundedWaitError,
  waitFhvT4FinalTerminal,
  waitFhvT4PausedTerminal,
} from "@/lib/trader/observability/fhv-t4-bounded-wait";
import {
  FhvT4ClosureVerifierError,
  verifyFhvT4Ceremony,
  verifyFhvT4DeploymentTruth,
  verifyFhvT4FinalState,
  verifyFhvT4PausedState,
  verifyFhvT4RollbackState,
  type FhvT4HostProbe,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { writeFhvT4DeploymentProofAtomic } from "@/lib/trader/observability/fhv-t4-deployment-proof";
import {
  FhvT4EvidenceSealError,
  sealFhvT4EvidenceRoot,
  verifyFhvT4EvidenceSeal,
} from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  ingestFhvT4HostProbeProofAtomic,
  readFhvT4HostProbeProof,
  verifyFhvT4HostProbeProofArtifact,
} from "@/lib/trader/observability/fhv-t4-host-probe-proof";
import { buildFhvT4MandatoryEvidenceInventory } from "@/lib/trader/observability/fhv-t4-mandatory-evidence-inventory";
import {
  FHV_T4_FINAL_PROOF_CLASSIFICATION,
  FHV_T4_PAUSED_PROOF_CLASSIFICATION,
  writeFhvT4FinalVerificationProofAtomic,
  writeFhvT4PausedVerificationProofAtomic,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import {
  captureFhvT4RollbackProofFromHost,
  writeFhvT4RollbackProofAtomic,
} from "@/lib/trader/observability/fhv-t4-rollback-proof";
import { writeFhvT4CheckoutIdentityProofAtomic } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import { readFhvT4PauseArmedRecord } from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { readFhvCommandLedgerEntries } from "@/lib/trader/observability/fhv-command-ledger";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

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
  | "build-evidence-inventory"
  | "ingest-host-probe"
  | "write-observer-qualification-proof"
  | "record-checkout-identity";

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
  hostProbeJsonPath: string;
  postRollbackHostProbeJsonPath: string;
  rawHostProbeJsonPath: string;
  hostProbePhase: "DEPLOYMENT" | "POST_ROLLBACK";
  observerQualificationPhase: "PRE_CAMPAIGN" | "POST_RESTART" | "";
  observerQualificationProofJson: string;
  outputPath: string;
  timeoutMs: number | null;
  rawHostProbeJson: string;
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

const SUBCOMMAND_FLAGS: Record<FhvT4ClosureSubcommand, ReadonlySet<string>> = {
  "verify-paused": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
  ]),
  "verify-final": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
  ]),
  "verify-deployment": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
    "--rendered-units-dir",
    "--installed-units-dir",
    "--service-user",
    "--working-directory",
    "--environment-file",
    "--operator-id",
  ]),
  "verify-rollback": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--repo-root",
    "--raw-host-probe-json-path",
  ]),
  "verify-seal": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--seal-destination",
    "--service-user",
  ]),
  "seal-evidence": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
    "--seal-destination",
    "--service-user",
    "--rendered-units-dir",
    "--continuity-before",
    "--continuity-after",
    "--host-probe-json-path",
    "--post-rollback-host-probe-json-path",
  ]),
  "verify-ceremony": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
    "--seal-destination",
    "--continuity-before",
    "--continuity-after",
    "--service-user",
    "--working-directory",
    "--environment-file",
    "--operator-id",
    "--rendered-units-dir",
    "--installed-units-dir",
  ]),
  "wait-paused": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--timeout-ms",
  ]),
  "wait-final": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--timeout-ms",
  ]),
  "build-evidence-inventory": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--repo-root",
    "--rendered-units-dir",
    "--continuity-before",
    "--continuity-after",
    "--host-probe-json-path",
    "--post-rollback-host-probe-json-path",
  ]),
  "ingest-host-probe": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--host-probe-json-path",
    "--raw-host-probe-json-path",
    "--host-probe-phase",
  ]),
  "write-observer-qualification-proof": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--phase",
    "--output",
    "--proof-json",
  ]),
  "record-checkout-identity": new Set([
    "--run-root",
    "--run-id",
    "--organization-id",
    "--target-sha",
    "--release-tag",
    "--repo-root",
  ]),
};

export function parseFhvT4ClosureSubcommand(argv: readonly string[]): FhvT4ClosureSubcommand {
  const positional = argv.find((arg) => !arg.startsWith("-"));
  const allowed = Object.keys(SUBCOMMAND_FLAGS) as FhvT4ClosureSubcommand[];
  if (positional && (allowed as string[]).includes(positional)) {
    return positional as FhvT4ClosureSubcommand;
  }
  throw new FhvT4ClosureCliError(
    "FHV_T4_CLOSURE_SUBCOMMAND_INVALID",
    `Subcommand required: ${allowed.join(" | ")}`,
  );
}

function collectFlag(argv: readonly string[], flag: string): string | undefined {
  const indexes: number[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) {
      indexes.push(i);
    }
  }
  if (indexes.length > 1) {
    throw new FhvT4ClosureCliError("FHV_T4_CLOSURE_FLAG_DUPLICATE", `Duplicate flag: ${flag}`);
  }
  if (indexes.length === 0) {
    return undefined;
  }
  const index = indexes[0]!;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_CLOSURE_FLAG_VALUE_MISSING",
      `Flag requires value: ${flag}`,
    );
  }
  return value.trim();
}

function parseTimeoutMs(raw: string | undefined, required: boolean): number | null {
  if (raw === undefined) {
    if (required) {
      throw new FhvT4ClosureCliError(
        "FHV_T4_CLOSURE_TIMEOUT_REQUIRED",
        "--timeout-ms is required for wait subcommands.",
      );
    }
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_CLOSURE_TIMEOUT_INVALID",
      "--timeout-ms must be a positive integer.",
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_CLOSURE_TIMEOUT_OUT_OF_RANGE",
      `--timeout-ms must be 1..${FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS}.`,
    );
  }
  return value;
}

export function resolveFhvT4ClosureCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): FhvT4ClosureCliConfig {
  const subcommand = parseFhvT4ClosureSubcommand(argv);
  const allowed = SUBCOMMAND_FLAGS[subcommand];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      continue;
    }
    if (!allowed.has(arg)) {
      throw new FhvT4ClosureCliError(
        "FHV_T4_CLOSURE_FLAG_UNSUPPORTED",
        `Unsupported flag for ${subcommand}: ${arg}`,
      );
    }
  }

  const timeoutRequired = subcommand === "wait-paused" || subcommand === "wait-final";
  return {
    subcommand,
    runRoot: collectFlag(argv, "--run-root") ?? env.FHV_RUN_ROOT?.trim() ?? "",
    runId: collectFlag(argv, "--run-id") ?? env.FHV_RUN_ID?.trim() ?? "",
    organizationId: collectFlag(argv, "--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim() ?? "",
    targetSha: collectFlag(argv, "--target-sha") ?? env.FHV_TARGET_SHA?.trim() ?? "",
    releaseTag: collectFlag(argv, "--release-tag") ?? env.FHV_RELEASE_TAG?.trim() ?? "",
    repoRoot: collectFlag(argv, "--repo-root") ?? env.FHV_REPO_ROOT?.trim() ?? process.cwd(),
    renderedUnitsDir:
      collectFlag(argv, "--rendered-units-dir") ?? env.FHV_RENDERED_UNITS_DIR?.trim() ?? "",
    installedUnitsDir:
      collectFlag(argv, "--installed-units-dir") ??
      env.FHV_INSTALLED_UNITS_DIR?.trim() ??
      "/etc/systemd/system",
    sealDestination:
      collectFlag(argv, "--seal-destination") ?? env.FHV_SEAL_DESTINATION?.trim() ?? "",
    serviceUser: collectFlag(argv, "--service-user") ?? env.FHV_SERVICE_USER?.trim() ?? "",
    operatorId: collectFlag(argv, "--operator-id") ?? env.FHV_OPERATOR_ID?.trim() ?? "t4-operator",
    workingDirectory:
      collectFlag(argv, "--working-directory") ?? env.FHV_WORKING_DIRECTORY?.trim() ?? "",
    environmentFile:
      collectFlag(argv, "--environment-file") ?? env.FHV_ENVIRONMENT_FILE?.trim() ?? "",
    continuityBeforePath:
      collectFlag(argv, "--continuity-before") ?? env.FHV_CONTINUITY_BEFORE?.trim() ?? "",
    continuityAfterPath:
      collectFlag(argv, "--continuity-after") ?? env.FHV_CONTINUITY_AFTER?.trim() ?? "",
    hostProbeJsonPath:
      collectFlag(argv, "--host-probe-json-path") ?? env.FHV_HOST_PROBE_PATH?.trim() ?? "",
    postRollbackHostProbeJsonPath: collectFlag(argv, "--post-rollback-host-probe-json-path") ?? "",
    rawHostProbeJsonPath: collectFlag(argv, "--raw-host-probe-json-path") ?? "",
    hostProbePhase:
      (collectFlag(argv, "--host-probe-phase") as "DEPLOYMENT" | "POST_ROLLBACK" | undefined) ??
      "DEPLOYMENT",
    observerQualificationPhase:
      (collectFlag(argv, "--phase") as "PRE_CAMPAIGN" | "POST_RESTART" | undefined) ?? "",
    observerQualificationProofJson: collectFlag(argv, "--proof-json") ?? "",
    outputPath: collectFlag(argv, "--output") ?? "",
    timeoutMs: parseTimeoutMs(collectFlag(argv, "--timeout-ms"), timeoutRequired),
    rawHostProbeJson: env.FHV_T4_HOST_PROBE_JSON?.trim() ?? "",
  };
}

function requireIdentity(config: FhvT4ClosureCliConfig): void {
  if (!config.runRoot || !config.runId || !config.organizationId || !config.targetSha) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_CLOSURE_CONFIG_INCOMPLETE",
      "--run-root, --run-id, --organization-id, --target-sha required",
    );
  }
}

function assertManifestIdentity(config: FhvT4ClosureCliConfig): void {
  const manifest = readFhvRehearsalManifest(config.runRoot);
  if (
    manifest.runId !== config.runId ||
    manifest.organizationId !== config.organizationId ||
    manifest.targetSha !== config.targetSha
  ) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_WAIT_IDENTITY_MISMATCH",
      "Manifest identity does not match wait/verify identity flags.",
    );
  }
}

function resolveRollbackHostProbe(config: FhvT4ClosureCliConfig): FhvT4HostProbe {
  const rawPath = config.rawHostProbeJsonPath.trim();
  if (!rawPath) {
    throw new FhvT4ClosureCliError(
      "FHV_T4_ROLLBACK_HOST_PROBE_REQUIRED",
      "verify-rollback requires --raw-host-probe-json-path (POST_ROLLBACK probe).",
    );
  }
  const raw = config.rawHostProbeJson || readFileSync(rawPath, "utf8");
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

function defaultHostProbe(config: FhvT4ClosureCliConfig): FhvT4HostProbe {
  // Prefer live observation JSON when provided (post-rollback). Otherwise use
  // the immutable deployment-time host-probe proof.
  if (config.rawHostProbeJson) {
    const parsed = JSON.parse(config.rawHostProbeJson) as {
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
  const proof = readFhvT4HostProbeProof(config.runRoot);
  if (proof) {
    return {
      systemctlIsActive: (unit) => ({ state: proof.active[unit] ?? "unknown" }),
      systemctlIsEnabled: (unit) => ({ state: proof.enabled[unit] ?? "unknown" }),
      unitFileExists: (unit) => proof.unitFiles[unit] === true,
      listMatchingProcesses: (pattern) => proof.processes.filter((line) => line.includes(pattern)),
      inspectLegacyContainer: () => proof.legacy,
    };
  }
  throw new FhvT4ClosureCliError(
    "FHV_T4_HOST_PROBE_REQUIRED",
    "Host probe proof or FHV_T4_HOST_PROBE_JSON required.",
  );
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
      case "record-checkout-identity": {
        requireIdentity(config);
        if (!config.releaseTag) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_RELEASE_TAG_REQUIRED",
            "release-tag required",
          );
        }
        const proof = writeFhvT4CheckoutIdentityProofAtomic({
          runRoot: config.runRoot,
          repoPath: config.repoRoot,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
        });
        lines.push("classification=FHV_T4_CHECKOUT_IDENTITY_PROOF_OK");
        return { exitCode: 0, lines, payload: proof };
      }
      case "ingest-host-probe": {
        requireIdentity(config);
        const raw =
          config.rawHostProbeJson ||
          (config.rawHostProbeJsonPath ? readFileSync(config.rawHostProbeJsonPath, "utf8") : "");
        if (!raw) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_HOST_PROBE_SOURCE_REQUIRED",
            "--raw-host-probe-json-path or FHV_T4_HOST_PROBE_JSON required",
          );
        }
        const proof = ingestFhvT4HostProbeProofAtomic({
          runRoot: config.runRoot,
          releaseSha: config.targetSha,
          runId: config.runId,
          organizationId: config.organizationId,
          rawProbeJson: raw,
          hostProbePhase: config.hostProbePhase,
          requireLegacyRunning: config.hostProbePhase === "DEPLOYMENT",
        });
        lines.push("classification=FHV_T4_HOST_PROBE_PROOF_OK");
        return { exitCode: 0, lines, payload: proof };
      }
      case "write-observer-qualification-proof": {
        requireIdentity(config);
        if (!config.observerQualificationPhase || !config.observerQualificationProofJson) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_OBSERVER_QUALIFICATION_WRITE_INCOMPLETE",
            "--phase and --proof-json required",
          );
        }
        if (!config.outputPath) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_OBSERVER_QUALIFICATION_OUTPUT_REQUIRED",
            "--output required",
          );
        }
        const {
          writeFhvT4ObserverQualificationProofAtomic,
          parseFhvT4ObserverQualificationProofUnsigned,
        } = await import("@/lib/trader/observability/fhv-t4-observer-qualification-proof");
        const parsed = parseFhvT4ObserverQualificationProofUnsigned(
          JSON.parse(config.observerQualificationProofJson),
        );
        const proof = writeFhvT4ObserverQualificationProofAtomic(config.outputPath, parsed);
        lines.push("classification=FHV_T4_OBSERVER_QUALIFICATION_PROOF_OK");
        return { exitCode: 0, lines, payload: proof };
      }
      case "verify-paused": {
        requireIdentity(config);
        assertManifestIdentity(config);
        const result = verifyFhvT4PausedState({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag || undefined,
          repoRoot: config.repoRoot,
        });
        const armed = readFhvT4PauseArmedRecord(config.runRoot);
        const ledger = readFhvCommandLedgerEntries(config.runRoot);
        const pause = ledger.find(
          (entry) =>
            entry.command.action === "PAUSE_AT_CHECKPOINT" &&
            entry.command.commandId === armed?.commandId,
        );
        const checkpoint = readReplayCheckpoint(config.runRoot);
        const manifest = readFhvRehearsalManifest(config.runRoot);
        writeFhvT4PausedVerificationProofAtomic(config.runRoot, {
          releaseSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
          actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
          classification: FHV_T4_PAUSED_PROOF_CLASSIFICATION,
          pauseCommandId: pause?.command.commandId ?? armed?.commandId ?? "",
          pauseIdempotencyKey: pause?.command.idempotencyKey ?? armed?.idempotencyKey ?? "",
          checkpointSafeResumeThroughCycleIndex: checkpoint?.safeResumeThroughCycleIndex ?? -1,
          partialEvidenceTerminal: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          alertPolicyDigest: manifest.alertPolicyDigest,
          checks: result.checks,
          capturedAtUtc: new Date().toISOString(),
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-final": {
        requireIdentity(config);
        assertManifestIdentity(config);
        const result = verifyFhvT4FinalState({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          releaseTag: config.releaseTag || undefined,
          repoRoot: config.repoRoot,
        });
        const ledger = readFhvCommandLedgerEntries(config.runRoot);
        const resume = [...ledger]
          .reverse()
          .find((entry) => entry.command.action === "RESUME_FROM_CHECKPOINT");
        writeFhvT4FinalVerificationProofAtomic(config.runRoot, {
          releaseSha: config.targetSha,
          releaseTag: config.releaseTag,
          runId: config.runId,
          organizationId: config.organizationId,
          classification: FHV_T4_FINAL_PROOF_CLASSIFICATION,
          resumeCommandId: resume?.command.commandId ?? "",
          resumeIdempotencyKey: resume?.command.idempotencyKey ?? "",
          fullHistoryRescanDelta: 0,
          canonicalRunChainResult: "PASS",
          runtimeBudgetResult: "PASS",
          finalTerminal: "REHEARSAL_OK",
          checks: result.checks,
          capturedAtUtc: new Date().toISOString(),
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
        const hostProbe = verifyFhvT4HostProbeProofArtifact({
          runRoot: config.runRoot,
          targetSha: config.targetSha,
          runId: config.runId,
          organizationId: config.organizationId,
          requireLegacyRunning: true,
        });
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
        if (record.legacyContainerRunning !== true || hostProbe.legacy.running !== true) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_DEPLOYMENT_LEGACY_OBSERVED_NOT_RUNNING",
            "Observed host probe legacy running state must be true.",
          );
        }
        if (
          record.legacyContainerName !== hostProbe.legacy.name ||
          record.legacyContainerImage !== hostProbe.legacy.image
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_DEPLOYMENT_LEGACY_RECORD_PROBE_MISMATCH",
            "Deployment record legacy identity must match observed host probe.",
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
          unitUser: config.serviceUser,
          unitWorkingDirectory: config.workingDirectory,
          unitEnvironmentFile: config.environmentFile,
          renderedUnitDigests: result.installedDigests,
          installedUnitDigests: result.installedDigests,
          deploymentRecordDigest: computePayloadDigest(record),
          legacyContainerName: hostProbe.legacy.name as typeof record.legacyContainerName,
          legacyContainerImage: hostProbe.legacy.image as typeof record.legacyContainerImage,
          legacyContainerRunning: hostProbe.legacy.running,
          hostBootId: hostProbe.hostBootId,
          hostProbeProofDigest: hostProbe.contentDigest,
          capturedAtUtc: new Date().toISOString(),
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "verify-rollback": {
        requireIdentity(config);
        const host = deps?.host ?? resolveRollbackHostProbe(config);
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
        const postRollbackProof = verifyFhvT4HostProbeProofArtifact({
          runRoot: config.runRoot,
          targetSha: config.targetSha,
          runId: config.runId,
          organizationId: config.organizationId,
          hostProbePhase: "POST_ROLLBACK",
          requireLegacyRunning: true,
        });
        writeFhvT4RollbackProofAtomic(
          config.runRoot,
          captureFhvT4RollbackProofFromHost({
            targetSha: config.targetSha,
            runId: config.runId,
            organizationId: config.organizationId,
            deploymentRecordDigest: computePayloadDigest(record),
            postRollbackHostProbeDigest: postRollbackProof.contentDigest,
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
          serviceUser: config.serviceUser || undefined,
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "seal-evidence":
      case "build-evidence-inventory": {
        requireIdentity(config);
        if (
          !config.renderedUnitsDir ||
          !config.continuityBeforePath ||
          !config.continuityAfterPath ||
          !config.hostProbeJsonPath ||
          !config.postRollbackHostProbeJsonPath
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_INVENTORY_CONFIG_INCOMPLETE",
            "rendered-units-dir, continuity-before, continuity-after, host-probe-json-path, post-rollback-host-probe-json-path required",
          );
        }
        const inventory = buildFhvT4MandatoryEvidenceInventory({
          runRoot: config.runRoot,
          repoRoot: config.repoRoot,
          renderedUnitsDir: config.renderedUnitsDir,
          continuityBeforePath: config.continuityBeforePath,
          continuityAfterPath: config.continuityAfterPath,
          hostProbeJsonPath: config.hostProbeJsonPath,
          postRollbackHostProbeJsonPath: config.postRollbackHostProbeJsonPath,
        });
        if (config.subcommand === "build-evidence-inventory") {
          lines.push(`inventoryCount=${inventory.length}`);
          return { exitCode: 0, lines, payload: inventory };
        }
        if (!config.sealDestination || !config.releaseTag || !config.serviceUser) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_SEAL_CONFIG_INCOMPLETE",
            "seal-destination, release-tag, and service-user required",
          );
        }
        const result = sealFhvT4EvidenceRoot({
          sealDestination: config.sealDestination,
          evidenceFiles: inventory.map((entry) => ({
            absolutePath: entry.absolutePath,
            relativePath: entry.relativePath,
          })),
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
          !config.continuityAfterPath ||
          !config.serviceUser ||
          !config.workingDirectory ||
          !config.environmentFile
        ) {
          throw new FhvT4ClosureCliError(
            "FHV_T4_CLOSURE_CEREMONY_CONFIG_INCOMPLETE",
            "ceremony requires release-tag, seal, continuity, service-user, working-directory, environment-file",
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
          serviceUser: config.serviceUser,
          workingDirectory: config.workingDirectory,
          environmentFile: config.environmentFile,
        });
        lines.push(`classification=${result.classification}`);
        for (const [key, value] of Object.entries(result.passFields)) {
          lines.push(`${key}=${value}`);
        }
        lines.push(`units=${FHV_SYSTEMD_CAMPAIGN_UNIT},${FHV_SYSTEMD_OBSERVER_UNIT}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "wait-paused": {
        requireIdentity(config);
        assertManifestIdentity(config);
        const result = await waitFhvT4PausedTerminal({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          timeoutMs: config.timeoutMs ?? undefined,
        });
        lines.push(`classification=${result.classification}`);
        lines.push(`actualPauseCycle=${result.actualPauseCycle}`);
        return { exitCode: 0, lines, payload: result };
      }
      case "wait-final": {
        requireIdentity(config);
        assertManifestIdentity(config);
        const result = await waitFhvT4FinalTerminal({
          runRoot: config.runRoot,
          runId: config.runId,
          organizationId: config.organizationId,
          targetSha: config.targetSha,
          timeoutMs: config.timeoutMs ?? undefined,
        });
        lines.push(`classification=${result.classification}`);
        return { exitCode: 0, lines, payload: result };
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
      error instanceof FhvT4EvidenceSealError ||
      error instanceof FhvT4BoundedWaitError
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
  if (result.exitCode === 0 && result.payload !== undefined) {
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
