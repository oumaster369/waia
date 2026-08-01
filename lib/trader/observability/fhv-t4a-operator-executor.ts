/**
 * DEE-436 — real T4A operator step executor (live-executable argv + remote FS only).
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { captureFhvT4aObserverQualification } from "@/lib/trader/observability/fhv-t4a-observer-qualification";
import { validateFhvT4aCeremonyStdout } from "@/lib/trader/observability/fhv-t4a-ceremony-results";
import {
  parseFhvT4ContinuitySnapshot,
  parseFhvT4ContinuityVerificationProof,
  resolveFhvT4ContinuityVerificationProofPath,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS } from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  buildFhvT4aRemotePathContext,
  isFhvT4aRemotePath,
} from "@/lib/trader/observability/fhv-t4a-remote-fs";
import type { FhvT4aPostBeforeReceiptV1 } from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import type { FhvT4aReconnectBaseline } from "@/lib/trader/observability/fhv-t4a-reconnect-baseline";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import {
  buildFhvT4aRemoteFsExistsOp,
  buildFhvT4aRemoteFsReadOp,
  buildFhvT4aRemoteFsSha256Op,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-transport-helpers";

export type FhvT4aExecContext = {
  bindings: FhvT4aOperatorBindings;
  transport: FhvT4aOperatorTransport;
  repoRoot: string;
  runDir: string;
  renderedUnitsDir: string;
  installedUnitsDir: string;
  continuityBefore: string;
  continuityAfter: string;
  sealDestination: string;
  hostProbePath: string;
  rawHostProbePath: string;
  postRollbackHostProbePath: string;
  postRollbackRawHostProbePath: string;
  workstationTracePath: string;
  localStateDir: string;
  remotePathContext: ReturnType<typeof buildFhvT4aRemotePathContext>;
  postBeforeReceipt?: FhvT4aPostBeforeReceiptV1;
  reconnectBaseline?: FhvT4aReconnectBaseline;
};

export type FhvT4aStepResult = Readonly<{
  step: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: string;
  prerequisiteProofDigests: readonly string[];
  resultingProofDigests: readonly string[];
  sealEvidenceRootDigest?: string;
  verifySealClassification?: string;
  ceremonyClassifications?: Readonly<Record<string, string>>;
  continuityVerificationProofPath?: string;
  continuityVerificationProofDigest?: string;
}>;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseFhvT4aTaggedKeyValueLines(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim().replace(/^\[[^\]]+\]\s*/, "");
    if (!line || line.startsWith("{")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function parseClassification(stdout: string): string {
  return parseFhvT4aTaggedKeyValueLines(stdout).classification ?? "";
}

function parseCeremony(stdout: string): Record<string, string> {
  return parseFhvT4aTaggedKeyValueLines(stdout);
}

function requireOk(
  result: { exitCode: number; stdout: string; stderr: string },
  step: number,
  label: string,
): void {
  if (result.exitCode !== 0) {
    throw new FhvT4aOperatorError(
      `FHV_T4A_STEP_${step}_FAILED`,
      `${label} failed: ${result.stderr || result.stdout}`,
    );
  }
}

function requireRemoteProof(
  ctx: FhvT4aExecContext,
  remotePath: string,
  step: number,
  label: string,
): string {
  if (!isFhvT4aRemotePath(remotePath, ctx.remotePathContext)) {
    throw new FhvT4aOperatorError(
      "REMOTE_PATH_ACCESSED_BY_LOCAL_FS",
      `Expected remote path for ${label}: ${remotePath}`,
    );
  }
  if (!ctx.transport.remoteFileExists(buildFhvT4aRemoteFsExistsOp(ctx, remotePath))) {
    throw new FhvT4aOperatorError(`FHV_T4A_STEP_${step}_${label}_MISSING`, `${label} missing`);
  }
  return ctx.transport.remoteSha256(buildFhvT4aRemoteFsSha256Op(ctx, remotePath));
}

export function buildFhvT4aExecContext(
  bindings: FhvT4aOperatorBindings,
  transport: FhvT4aOperatorTransport,
): FhvT4aExecContext {
  const repoRoot = join(bindings.checkoutParent, `waia-${bindings.targetSha}`);
  const runDir = join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal", bindings.runId);
  const remotePathContext = buildFhvT4aRemotePathContext(bindings, repoRoot, runDir);
  return {
    bindings,
    transport,
    repoRoot,
    runDir,
    renderedUnitsDir: join(repoRoot, ".ops/rendered-units"),
    installedUnitsDir: transport.hermeticInstalledUnitsDir ?? "/etc/systemd/system",
    continuityBefore: join(runDir, "control/fhv-t4-continuity-before.v1.json"),
    continuityAfter: join(runDir, "control/fhv-t4-continuity-after.v1.json"),
    sealDestination: join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal-seals", bindings.runId),
    hostProbePath: join(runDir, "control/fhv-t4-host-probe-proof.v1.json"),
    rawHostProbePath: join(runDir, "control/fhv-t4-host-probe-raw.v1.json"),
    postRollbackHostProbePath: join(
      runDir,
      "control/fhv-t4-post-rollback-host-probe-proof.v1.json",
    ),
    postRollbackRawHostProbePath: join(
      runDir,
      "control/fhv-t4-post-rollback-host-probe-raw.v1.json",
    ),
    workstationTracePath: bindings.workstationTracePath,
    localStateDir: bindings.localStateDir,
    remotePathContext,
  };
}

function runSsh(
  ctx: FhvT4aExecContext,
  remoteCommand: string,
  asRoot: boolean,
  stdin?: string,
): { exitCode: number; stdout: string; stderr: string } {
  return ctx.transport.ssh({ remoteCommand, stdin, asRoot });
}

function serviceUserExec(
  ctx: FhvT4aExecContext,
  packageScript: string,
  args: readonly string[],
): { exitCode: number; stdout: string; stderr: string } {
  const b = ctx.bindings;
  const cmd = [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-service-user-exec.sh"`,
    `--service-user ${shellQuote(b.serviceUser)}`,
    `--environment-file ${shellQuote(b.environmentFile)}`,
    `--repo-root ${shellQuote(ctx.repoRoot)}`,
    `--node-bin ${shellQuote(b.nodeBin)}`,
    `--corepack-bin ${shellQuote(b.corepackBin)}`,
    `-- ${packageScript}`,
    ...args.map(shellQuote),
  ].join(" ");
  return runSsh(ctx, cmd, true);
}

function streamBootstrap(
  ctx: FhvT4aExecContext,
  scriptPath: string,
  remoteArgs: readonly string[],
  asRoot: boolean,
): { exitCode: number; stdout: string; stderr: string } {
  const scriptBody = ctx.transport.gitShowBlob(ctx.bindings.targetSha, scriptPath);
  const remoteCommand = `bash -s -- ${remoteArgs.map(shellQuote).join(" ")}`;
  return runSsh(ctx, remoteCommand, asRoot, scriptBody);
}

function identityArgs(ctx: FhvT4aExecContext): readonly string[] {
  const b = ctx.bindings;
  return [
    "--run-root",
    ctx.runDir,
    "--run-id",
    b.runId,
    "--organization-id",
    b.organizationId,
    "--target-sha",
    b.targetSha,
  ];
}

function installUnitsArgs(
  ctx: FhvT4aExecContext,
  confirm: boolean,
  options?: { skipEnable?: boolean },
): string {
  const b = ctx.bindings;
  const parts = [
    `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/install-units.sh"`,
    `--target-sha ${shellQuote(b.targetSha)}`,
    `--repo-path ${shellQuote(ctx.repoRoot)}`,
    `--working-directory ${shellQuote(ctx.repoRoot)}`,
    `--service-user ${shellQuote(b.serviceUser)}`,
    `--environment-file ${shellQuote(b.environmentFile)}`,
    `--fhv-run-root ${shellQuote(ctx.runDir)}`,
    `--fhv-run-id ${shellQuote(b.runId)}`,
    `--fhv-organization-id ${shellQuote(b.organizationId)}`,
    `--node-bin ${shellQuote(b.nodeBin)}`,
    `--git-bin ${shellQuote(b.gitBin)}`,
    `--systemd-dir ${shellQuote(ctx.installedUnitsDir)}`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--systemd-analyze ${shellQuote(b.systemdAnalyzeBin)}`,
  ];
  if (options?.skipEnable) {
    parts.push("--skip-enable");
  }
  if (confirm) {
    parts.push("--confirm");
  }
  return parts.join(" ");
}

function hostProbeArgs(ctx: FhvT4aExecContext, outputPath: string): string {
  const b = ctx.bindings;
  return [
    `"${ctx.repoRoot}/scripts/ops/fhv-t4-host-probe.sh"`,
    `--python-bin ${shellQuote(b.pythonBin)}`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--docker-bin ${shellQuote(b.dockerBin)}`,
    `--installed-units-dir ${shellQuote(ctx.installedUnitsDir)}`,
    `--legacy-container-name ${shellQuote(FHV_T4A_LEGACY_CONTAINER_NAME)}`,
    `--output ${shellQuote(outputPath)}`,
  ].join(" ");
}

function rollbackArgs(ctx: FhvT4aExecContext, confirm: boolean): string {
  const b = ctx.bindings;
  const parts = [
    `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/rollback-units.sh"`,
    `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
    `--systemd-dir ${shellQuote(ctx.installedUnitsDir)}`,
  ];
  if (confirm) {
    parts.push("--confirm");
  }
  return parts.join(" ");
}

function continuityCaptureArgs(
  ctx: FhvT4aExecContext,
  subcommand: "capture-continuity-before" | "capture-continuity-after",
  outputPath: string,
): readonly string[] {
  const b = ctx.bindings;
  return [
    ...identityArgs(ctx),
    "--repo-root",
    ctx.repoRoot,
    "--systemctl-bin",
    b.systemctlBin,
    "--python-bin",
    b.pythonBin,
    "--output",
    outputPath,
  ];
}

export function executeFhvT4aStep(ctx: FhvT4aExecContext, step: number): FhvT4aStepResult {
  const b = ctx.bindings;
  const prereq: string[] = [];
  let result: { exitCode: number; stdout: string; stderr: string };
  const proofs: string[] = [];

  switch (step) {
    case 1: {
      result = runSsh(ctx, 'test "$(id -u)" -eq 0', true);
      requireOk(result, step, "root check");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_1_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: [],
      };
    }
    case 2: {
      result = streamBootstrap(
        ctx,
        "scripts/ops/fhv-validate-origin-url.sh",
        ["--origin-url", b.originUrl],
        false,
      );
      requireOk(result, step, "origin validation");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_2_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 3: {
      result = streamBootstrap(
        ctx,
        "scripts/ops/fhv-service-user-checkout.sh",
        [
          "--service-user",
          b.serviceUser,
          "--checkout-parent",
          b.checkoutParent,
          "--checkout-dir",
          `waia-${b.targetSha}`,
          "--target-sha",
          b.targetSha,
          "--release-tag",
          b.releaseTag,
          "--git-bin",
          b.gitBin,
          "--python-bin",
          b.pythonBin,
          "--origin-url",
          b.originUrl,
        ],
        true,
      );
      requireOk(result, step, "checkout");
      proofs.push(sha256Hex(ctx.repoRoot));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_3_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 4: {
      const cmd = [
        `"${ctx.repoRoot}/scripts/ops/fhv-release-checkout-identity.sh"`,
        `--repo-path ${shellQuote(ctx.repoRoot)}`,
        `--target-sha ${shellQuote(b.targetSha)}`,
        `--release-tag ${shellQuote(b.releaseTag)}`,
        `--git-bin ${shellQuote(b.gitBin)}`,
        `--python-bin ${shellQuote(b.pythonBin)}`,
      ].join(" ");
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "checkout identity");
      return {
        step,
        ...result,
        classification: parseClassification(result.stdout) || "FHV_T4A_STEP_4_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 5: {
      result = streamBootstrap(
        ctx,
        "scripts/ops/fhv-service-user-install-deps.sh",
        [
          "--service-user",
          b.serviceUser,
          "--repo-root",
          ctx.repoRoot,
          "--node-bin",
          b.nodeBin,
          "--corepack-bin",
          b.corepackBin,
          "--git-bin",
          b.gitBin,
          "--python-bin",
          b.pythonBin,
        ],
        true,
      );
      requireOk(result, step, "install deps");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_5_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 6: {
      result = serviceUserExec(ctx, "trader:fhv:rehearsal", [
        "--target-sha",
        b.targetSha,
        "--run-id",
        b.runId,
        "--organization-id",
        b.organizationId,
        "--artifact-root",
        b.artifactRoot,
        "--fixture",
        "HTR_WP03_BENCHMARK",
        "--t4-deterministic-pause",
      ]);
      requireOk(result, step, "manifest");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_6_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: [sha256Hex(result.stdout)],
      };
    }
    case 7: {
      result = serviceUserExec(ctx, "trader:fhv:t4:record-checkout-identity", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
      ]);
      requireOk(result, step, "record checkout identity");
      return {
        step,
        ...result,
        classification: parseClassification(result.stdout) || "FHV_T4A_STEP_7_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 8: {
      const cmd = [
        `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/render-units.sh"`,
        `--target-sha ${shellQuote(b.targetSha)}`,
        `--working-directory ${shellQuote(ctx.repoRoot)}`,
        `--service-user ${shellQuote(b.serviceUser)}`,
        `--environment-file ${shellQuote(b.environmentFile)}`,
        `--fhv-run-root ${shellQuote(ctx.runDir)}`,
        `--fhv-run-id ${shellQuote(b.runId)}`,
        `--fhv-organization-id ${shellQuote(b.organizationId)}`,
        `--repo-path ${shellQuote(ctx.repoRoot)}`,
        `--output-dir ${shellQuote(ctx.renderedUnitsDir)}`,
        `--node-bin ${shellQuote(b.nodeBin)}`,
        `--git-bin ${shellQuote(b.gitBin)}`,
      ].join(" ");
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "render units");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_8_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 9: {
      result = runSsh(ctx, installUnitsArgs(ctx, false), true);
      requireOk(result, step, "install preview");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_9_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 10: {
      result = runSsh(ctx, installUnitsArgs(ctx, true, { skipEnable: true }), true);
      requireOk(result, step, "install units");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_10_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 11: {
      const digestsCmd = [
        `"${ctx.repoRoot}/scripts/ops/fhv-t4-rendered-unit-digests.sh"`,
        `--rendered-dir ${shellQuote(ctx.renderedUnitsDir)}`,
        `--python-bin ${shellQuote(b.pythonBin)}`,
      ].join(" ");
      const digestsResult = runSsh(ctx, digestsCmd, true);
      requireOk(digestsResult, step, "rendered unit digests");
      const cmd = [
        `"${ctx.repoRoot}/scripts/ops/fhv-systemd-record-deploy.sh"`,
        `--target-sha ${shellQuote(b.targetSha)}`,
        `--release-tag ${shellQuote(b.releaseTag)}`,
        `--run-id ${shellQuote(b.runId)}`,
        `--organization-id ${shellQuote(b.organizationId)}`,
        `--operator ${shellQuote(b.operatorId)}`,
        `--service-user ${shellQuote(b.serviceUser)}`,
        `--rendered-unit-digests ${shellQuote(digestsResult.stdout.trim())}`,
        `--repo-path ${shellQuote(ctx.repoRoot)}`,
        `--node-bin ${shellQuote(b.nodeBin)}`,
        `--git-bin ${shellQuote(b.gitBin)}`,
        `--docker-bin ${shellQuote(b.dockerBin)}`,
        `--confirm`,
      ].join(" ");
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "deployment record");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_11_OK",
        prerequisiteProofDigests: [sha256Hex(digestsResult.stdout.trim())],
        resultingProofDigests: proofs,
      };
    }
    case 12: {
      result = runSsh(ctx, hostProbeArgs(ctx, ctx.rawHostProbePath), true);
      requireOk(result, step, "host probe capture");
      if (!ctx.transport.remoteFileExists(buildFhvT4aRemoteFsExistsOp(ctx, ctx.rawHostProbePath))) {
        throw new FhvT4aOperatorError(
          "HOST_PROBE_RAW_SOURCE_MISSING",
          "Raw host probe JSON missing after capture.",
        );
      }
      result = serviceUserExec(ctx, "trader:fhv:t4:ingest-host-probe", [
        ...identityArgs(ctx),
        "--raw-host-probe-json-path",
        ctx.rawHostProbePath,
      ]);
      requireOk(result, step, "host probe ingest");
      proofs.push(requireRemoteProof(ctx, ctx.hostProbePath, step, "HOST_PROBE_PROOF"));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_12_OK",
        prerequisiteProofDigests: [
          ctx.transport.remoteSha256(buildFhvT4aRemoteFsSha256Op(ctx, ctx.rawHostProbePath)),
        ],
        resultingProofDigests: proofs,
      };
    }
    case 13: {
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-deployment", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
        "--rendered-units-dir",
        ctx.renderedUnitsDir,
        "--installed-units-dir",
        ctx.installedUnitsDir,
        "--service-user",
        b.serviceUser,
        "--working-directory",
        ctx.repoRoot,
        "--environment-file",
        b.environmentFile,
        "--operator-id",
        b.operatorId,
      ]);
      requireOk(result, step, "verify deployment");
      proofs.push(requireRemoteProof(ctx, ctx.hostProbePath, step, "HOST_PROBE_PROOF"));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_13_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 14: {
      result = runSsh(
        ctx,
        `${b.systemctlBin} enable waia-fhv-observer.service && ${b.systemctlBin} start waia-fhv-observer.service`,
        true,
      );
      requireOk(result, step, "observer enable and start");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_14_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 15: {
      const qual = captureFhvT4aObserverQualification(ctx, "PRE_CAMPAIGN");
      proofs.push(qual.proofDigest);
      return {
        step,
        exitCode: 0,
        stdout: `classification=FHV_T4A_STEP_15_OK\n`,
        stderr: "",
        classification: "FHV_T4A_STEP_15_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 16: {
      result = serviceUserExec(ctx, "trader:fhv:t4:arm-pause", identityArgs(ctx));
      requireOk(result, step, "arm pause");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_16_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 17: {
      result = serviceUserExec(ctx, "trader:fhv:t4:verify", identityArgs(ctx));
      requireOk(result, step, "verify pre-arm");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_17_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 18: {
      result = runSsh(
        ctx,
        `${b.systemctlBin} enable waia-fhv-campaign.service && ${b.systemctlBin} start waia-fhv-campaign.service`,
        true,
      );
      requireOk(result, step, "campaign enable and start");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_18_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 19: {
      result = serviceUserExec(ctx, "trader:fhv:t4:wait-paused", [
        ...identityArgs(ctx),
        "--timeout-ms",
        "300000",
      ]);
      requireOk(result, step, "wait paused");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_19_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 20: {
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-paused", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
      ]);
      requireOk(result, step, "verify paused");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_20_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 21: {
      result = serviceUserExec(ctx, "trader:fhv:t4:resume", identityArgs(ctx));
      requireOk(result, step, "resume");
      if (!result.stdout.includes("status=accepted")) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_STEP_21_RESUME_NOT_ACCEPTED",
          "RESUME must return status=accepted",
        );
      }
      const rootCmd = [
        `"${ctx.repoRoot}/scripts/ops/fhv-t4-resume-campaign-root.sh"`,
        `--run-root ${shellQuote(ctx.runDir)}`,
        `--run-id ${shellQuote(b.runId)}`,
        `--organization-id ${shellQuote(b.organizationId)}`,
        `--target-sha ${shellQuote(b.targetSha)}`,
        `--systemctl-bin ${shellQuote(b.systemctlBin)}`,
        `--node-bin ${shellQuote(b.nodeBin)}`,
        `--repo-root ${shellQuote(ctx.repoRoot)}`,
      ].join(" ");
      result = runSsh(ctx, rootCmd, true);
      requireOk(result, step, "resume root enforcement");
      const proofPath = join(ctx.runDir, "control/fhv-t4-resume-enforcement-proof.v1.json");
      const remoteBody = ctx.transport.readRemoteFile(buildFhvT4aRemoteFsReadOp(ctx, proofPath));
      const parsed = JSON.parse(remoteBody) as {
        runId?: string;
        organizationId?: string;
        targetSha?: string;
      };
      if (
        parsed.runId !== b.runId ||
        parsed.organizationId !== b.organizationId ||
        parsed.targetSha?.toLowerCase() !== b.targetSha
      ) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_STEP_21_ENFORCEMENT_PROOF_IDENTITY",
          "Resume enforcement proof identity mismatch.",
        );
      }
      proofs.push(ctx.transport.remoteSha256(buildFhvT4aRemoteFsSha256Op(ctx, proofPath)));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_21_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 22: {
      result = serviceUserExec(ctx, "trader:fhv:t4:wait-final", [
        ...identityArgs(ctx),
        "--timeout-ms",
        "300000",
      ]);
      requireOk(result, step, "wait final");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_22_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 23: {
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-final", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
      ]);
      requireOk(result, step, "verify final");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_23_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 24: {
      const cmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-campaign-wait-completed.sh" --systemctl-bin ${shellQuote(b.systemctlBin)} --python-bin ${shellQuote(b.pythonBin)} waia-fhv-campaign.service 120000 ${shellQuote(ctx.runDir)} REHEARSAL_OK`;
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "campaign completed wait");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_24_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 25: {
      const cmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-campaign-systemd-identity-read.sh" --systemctl-bin ${shellQuote(b.systemctlBin)} --python-bin ${shellQuote(b.pythonBin)} waia-fhv-campaign.service`;
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "completed campaign identity");
      proofs.push(sha256Hex(result.stdout));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_25_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 26: {
      result = serviceUserExec(
        ctx,
        "trader:fhv:t4:capture-continuity-before",
        continuityCaptureArgs(ctx, "capture-continuity-before", ctx.continuityBefore),
      );
      requireOk(result, step, "continuity before");
      proofs.push(requireRemoteProof(ctx, ctx.continuityBefore, step, "CONTINUITY_BEFORE"));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_26_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 28: {
      result = runSsh(ctx, `${b.systemctlBin} restart waia-fhv-observer.service`, true);
      requireOk(result, step, "observer restart");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_28_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 29: {
      if (!ctx.reconnectBaseline) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_RECONNECT_BASELINE_MISSING",
          "Reconnect baseline required for post-restart qualification.",
        );
      }
      const priorObserverInvocationId =
        ctx.reconnectBaseline.preQualificationProof.identityAfterCapture.invocationId;
      const qual = captureFhvT4aObserverQualification(
        ctx,
        "POST_RESTART",
        priorObserverInvocationId,
      );
      if (
        qual.completedCampaignIdentity &&
        qual.completedCampaignIdentity.contentDigest !==
          ctx.reconnectBaseline.campaignIdentityDigest
      ) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_CAMPAIGN_IDENTITY_CHANGED_POST_RESTART",
          "Completed campaign identity must remain unchanged post-restart.",
        );
      }
      proofs.push(qual.proofDigest);
      return {
        step,
        exitCode: 0,
        stdout: `classification=FHV_T4A_STEP_29_OK\n`,
        stderr: "",
        classification: "FHV_T4A_STEP_29_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 30: {
      result = serviceUserExec(
        ctx,
        "trader:fhv:t4:capture-continuity-after",
        continuityCaptureArgs(ctx, "capture-continuity-after", ctx.continuityAfter),
      );
      requireOk(result, step, "continuity after");
      proofs.push(requireRemoteProof(ctx, ctx.continuityAfter, step, "CONTINUITY_AFTER"));
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_30_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 31: {
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-continuity", [
        ...identityArgs(ctx),
        "--before",
        ctx.continuityBefore,
        "--after",
        ctx.continuityAfter,
        "--systemctl-bin",
        b.systemctlBin,
        "--python-bin",
        b.pythonBin,
      ]);
      requireOk(result, step, "verify continuity");
      const continuityVerificationProofPath = resolveFhvT4ContinuityVerificationProofPath(
        ctx.runDir,
      );
      const continuityVerificationProofDigest = requireRemoteProof(
        ctx,
        continuityVerificationProofPath,
        step,
        "CONTINUITY_VERIFICATION_PROOF",
      );
      const proofRaw = ctx.transport.readRemoteFile(
        buildFhvT4aRemoteFsReadOp(ctx, continuityVerificationProofPath),
      );
      const parsedProof = parseFhvT4ContinuityVerificationProof(JSON.parse(proofRaw));
      const continuityBeforeSnapshot = parseFhvT4ContinuitySnapshot(
        JSON.parse(
          ctx.transport.readRemoteFile(buildFhvT4aRemoteFsReadOp(ctx, ctx.continuityBefore)),
        ),
      );
      const continuityAfterSnapshot = parseFhvT4ContinuitySnapshot(
        JSON.parse(
          ctx.transport.readRemoteFile(buildFhvT4aRemoteFsReadOp(ctx, ctx.continuityAfter)),
        ),
      );
      if (
        parsedProof.runId !== b.runId ||
        parsedProof.organizationId !== b.organizationId ||
        parsedProof.targetSha !== b.targetSha ||
        parsedProof.beforeDigest !== continuityBeforeSnapshot.contentDigest ||
        parsedProof.afterDigest !== continuityAfterSnapshot.contentDigest
      ) {
        throw new FhvT4aOperatorError(
          "CONTINUITY_VERIFICATION_PROOF_NOT_REVALIDATED",
          "Continuity verification proof identity mismatch at Step 31.",
        );
      }
      proofs.push(continuityVerificationProofDigest);
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_31_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
        continuityVerificationProofPath,
        continuityVerificationProofDigest,
      };
    }
    case 32: {
      const rollbackPreview = rollbackArgs(ctx, false);
      result = runSsh(ctx, rollbackPreview, true);
      requireOk(result, step, "rollback preview");
      result = runSsh(ctx, rollbackArgs(ctx, true), true);
      requireOk(result, step, "rollback");
      result = runSsh(ctx, hostProbeArgs(ctx, ctx.postRollbackRawHostProbePath), true);
      requireOk(result, step, "post-rollback host probe capture");
      if (
        !ctx.transport.remoteFileExists(
          buildFhvT4aRemoteFsExistsOp(ctx, ctx.postRollbackRawHostProbePath),
        )
      ) {
        throw new FhvT4aOperatorError(
          "HOST_PROBE_RAW_SOURCE_MISSING",
          "Post-rollback raw host probe JSON missing after capture.",
        );
      }
      result = serviceUserExec(ctx, "trader:fhv:t4:ingest-host-probe", [
        ...identityArgs(ctx),
        "--raw-host-probe-json-path",
        ctx.postRollbackRawHostProbePath,
        "--host-probe-phase",
        "POST_ROLLBACK",
      ]);
      requireOk(result, step, "post-rollback host probe ingest");
      proofs.push(
        requireRemoteProof(ctx, ctx.postRollbackHostProbePath, step, "POST_ROLLBACK_HOST_PROBE"),
      );
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-rollback", [
        ...identityArgs(ctx),
        "--repo-root",
        ctx.repoRoot,
        "--raw-host-probe-json-path",
        ctx.postRollbackRawHostProbePath,
      ]);
      requireOk(result, step, "verify rollback");
      result = serviceUserExec(ctx, "trader:fhv:t4:build-evidence-inventory", [
        ...identityArgs(ctx),
        "--repo-root",
        ctx.repoRoot,
        "--rendered-units-dir",
        ctx.renderedUnitsDir,
        "--continuity-before",
        ctx.continuityBefore,
        "--continuity-after",
        ctx.continuityAfter,
        "--host-probe-json-path",
        ctx.hostProbePath,
        "--post-rollback-host-probe-json-path",
        ctx.postRollbackHostProbePath,
      ]);
      requireOk(result, step, "evidence inventory");
      let stepStdout = `${result.stdout}\n`;
      const sealResult = serviceUserExec(ctx, "trader:fhv:t4:seal-evidence", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
        "--seal-destination",
        ctx.sealDestination,
        "--service-user",
        b.serviceUser,
        "--rendered-units-dir",
        ctx.renderedUnitsDir,
        "--continuity-before",
        ctx.continuityBefore,
        "--continuity-after",
        ctx.continuityAfter,
        "--host-probe-json-path",
        ctx.hostProbePath,
        "--post-rollback-host-probe-json-path",
        ctx.postRollbackHostProbePath,
      ]);
      requireOk(sealResult, step, "seal evidence");
      stepStdout += `${sealResult.stdout}\n`;
      const sealTagged = parseCeremony(sealResult.stdout);
      const sealEvidenceRootDigest = sealTagged.rootDigest?.trim();
      if (!sealEvidenceRootDigest) {
        throw new FhvT4aOperatorError(
          "FINAL_RECEIPT_SEAL_ROOT_MISSING",
          "seal-evidence rootDigest missing from seal stdout.",
        );
      }
      const verifySealResult = serviceUserExec(ctx, "trader:fhv:t4:verify-seal", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--seal-destination",
        ctx.sealDestination,
        "--service-user",
        b.serviceUser,
      ]);
      requireOk(verifySealResult, step, "verify seal");
      stepStdout += `${verifySealResult.stdout}\n`;
      const verifySealTagged = parseCeremony(verifySealResult.stdout);
      const verifySealClassification = verifySealTagged.classification?.trim();
      if (verifySealClassification !== FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS) {
        throw new FhvT4aOperatorError(
          "FINAL_RECEIPT_VERIFY_SEAL_CLASSIFICATION_EMPTY",
          `verify-seal classification must be ${FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS}.`,
        );
      }
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-ceremony", [
        ...identityArgs(ctx),
        "--release-tag",
        b.releaseTag,
        "--repo-root",
        ctx.repoRoot,
        "--seal-destination",
        ctx.sealDestination,
        "--continuity-before",
        ctx.continuityBefore,
        "--continuity-after",
        ctx.continuityAfter,
        "--service-user",
        b.serviceUser,
        "--working-directory",
        ctx.repoRoot,
        "--environment-file",
        b.environmentFile,
        "--operator-id",
        b.operatorId,
        "--rendered-units-dir",
        ctx.renderedUnitsDir,
        "--installed-units-dir",
        ctx.installedUnitsDir,
      ]);
      requireOk(result, step, "verify ceremony");
      stepStdout += `${result.stdout}\n`;
      let ceremonyClassifications: Record<string, string>;
      try {
        ceremonyClassifications = validateFhvT4aCeremonyStdout(result.stdout);
      } catch (error) {
        const code =
          error instanceof Error && "code" in error
            ? String((error as { code?: string }).code)
            : "FHV_T4A_STEP_32_CEREMONY_INVALID";
        throw new FhvT4aOperatorError(code, error instanceof Error ? error.message : String(error));
      }
      return {
        step,
        exitCode: result.exitCode,
        stdout: stepStdout,
        stderr: result.stderr,
        classification: "FHV_T4A_STEP_32_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: [sha256Hex(stepStdout)],
        sealEvidenceRootDigest,
        verifySealClassification,
        ceremonyClassifications,
      };
    }
    default:
      throw new FhvT4aOperatorError("FHV_T4A_STEP_UNKNOWN", `Unknown step ${step}`);
  }
}

export function executeFhvT4aSteps(
  ctx: FhvT4aExecContext,
  steps: readonly number[],
): FhvT4aStepResult[] {
  return steps.map((step) => executeFhvT4aStep(ctx, step));
}
