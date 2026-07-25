/**
 * DEE-436 — real T4A operator step executor (no trace-only loops).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FHV_T4A_LEGACY_CONTAINER_IMAGE,
  FHV_T4A_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import { digestFile } from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import type { FhvT4aOperatorBindings } from "@/scripts/ops/fhv-t4a-operator";
import { FhvT4aOperatorError } from "@/scripts/ops/fhv-t4a-operator";

export type FhvT4aExecContext = Readonly<{
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
  workstationTracePath: string;
  localStateDir: string;
}>;

export type FhvT4aStepResult = Readonly<{
  step: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  classification: string;
  prerequisiteProofDigests: readonly string[];
  resultingProofDigests: readonly string[];
}>;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseClassification(stdout: string): string {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("classification="));
  return line?.slice("classification=".length) ?? "";
}

function parseCeremony(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
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

export function buildFhvT4aExecContext(
  bindings: FhvT4aOperatorBindings,
  transport: FhvT4aOperatorTransport,
): FhvT4aExecContext {
  const repoRoot = join(bindings.checkoutParent, `waia-${bindings.targetSha}`);
  const runDir = join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal", bindings.runId);
  return {
    bindings,
    transport,
    repoRoot,
    runDir,
    renderedUnitsDir: join(repoRoot, ".ops/rendered-units"),
    installedUnitsDir: "/etc/systemd/system",
    continuityBefore: join(runDir, "control/fhv-t4-continuity-before.v1.json"),
    continuityAfter: join(runDir, "control/fhv-t4-continuity-after.v1.json"),
    sealDestination: join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal-seals", bindings.runId),
    hostProbePath: join(runDir, "control/fhv-t4-host-probe-proof.v1.json"),
    workstationTracePath: bindings.workstationTracePath,
    localStateDir: bindings.localStateDir,
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
        ...identityArgs(ctx).slice(0, 6),
        "--artifact-root",
        b.artifactRoot,
        "--t4-deterministic-pause",
        "--fixture",
        "HTR_WP03_BENCHMARK",
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
      const cmd = `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/install-units.sh" --rendered-units-dir ${shellQuote(ctx.renderedUnitsDir)} --installed-units-dir ${shellQuote(ctx.installedUnitsDir)}`;
      result = runSsh(ctx, cmd, true);
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
      const cmd = `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/install-units.sh" --rendered-units-dir ${shellQuote(ctx.renderedUnitsDir)} --installed-units-dir ${shellQuote(ctx.installedUnitsDir)} --confirm`;
      result = runSsh(ctx, cmd, true);
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
      const cmd = `"${ctx.repoRoot}/scripts/ops/fhv-systemd-record-deploy.sh" --run-root ${shellQuote(ctx.runDir)} --target-sha ${shellQuote(b.targetSha)} --confirm`;
      result = runSsh(ctx, cmd, true);
      requireOk(result, step, "deployment record");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_11_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 12: {
      result = serviceUserExec(ctx, "trader:fhv:t4:ingest-host-probe", [
        ...identityArgs(ctx),
        "--host-probe-json-path",
        ctx.hostProbePath,
      ]);
      requireOk(result, step, "host probe ingest");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_12_OK",
        prerequisiteProofDigests: prereq,
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
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_13_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 14: {
      result = runSsh(ctx, `${b.systemctlBin} start waia-fhv-observer.service`, true);
      requireOk(result, step, "observer start");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_14_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 15: {
      const waitCmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-observer-wait-active.sh" --systemctl-bin ${shellQuote(b.systemctlBin)} --python-bin ${shellQuote(b.pythonBin)} waia-fhv-observer.service 60000`;
      result = runSsh(ctx, waitCmd, true);
      requireOk(result, step, "observer wait");
      result = serviceUserExec(ctx, "trader:fhv:t4:status", identityArgs(ctx));
      requireOk(result, step, "observer status");
      const qualPath = join(
        ctx.runDir,
        "control/fhv-t4-observer-qualification-pre-campaign.v1.json",
      );
      if (existsSync(qualPath)) {
        proofs.push(digestFile(qualPath));
      }
      return {
        step,
        ...result,
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
      result = runSsh(ctx, `${b.systemctlBin} start waia-fhv-campaign.service`, true);
      requireOk(result, step, "campaign start");
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
      ].join(" ");
      result = runSsh(ctx, rootCmd, true);
      requireOk(result, step, "resume root enforcement");
      const proof = join(ctx.runDir, "control/fhv-t4-resume-enforcement-proof.v1.json");
      if (!existsSync(proof)) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_STEP_21_ENFORCEMENT_PROOF_MISSING",
          "resume enforcement proof missing",
        );
      }
      proofs.push(digestFile(proof));
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
      result = serviceUserExec(ctx, "trader:fhv:t4:capture-continuity-before", [
        ...identityArgs(ctx),
        "--repo-root",
        ctx.repoRoot,
        "--output",
        ctx.continuityBefore,
      ]);
      requireOk(result, step, "continuity before");
      if (!existsSync(ctx.continuityBefore)) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_STEP_26_CONTINUITY_MISSING",
          "continuity-before artifact missing",
        );
      }
      proofs.push(digestFile(ctx.continuityBefore));
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
      const waitCmd = `"${ctx.repoRoot}/scripts/ops/fhv-t4-observer-wait-active.sh" --systemctl-bin ${shellQuote(b.systemctlBin)} --python-bin ${shellQuote(b.pythonBin)} waia-fhv-observer.service 60000`;
      result = runSsh(ctx, waitCmd, true);
      requireOk(result, step, "post-restart observer wait");
      result = serviceUserExec(ctx, "trader:fhv:t4:status", identityArgs(ctx));
      requireOk(result, step, "post-restart status");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_29_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 30: {
      result = serviceUserExec(ctx, "trader:fhv:t4:capture-continuity-after", [
        ...identityArgs(ctx),
        "--repo-root",
        ctx.repoRoot,
        "--output",
        ctx.continuityAfter,
      ]);
      requireOk(result, step, "continuity after");
      if (!existsSync(ctx.continuityAfter)) {
        throw new FhvT4aOperatorError(
          "FHV_T4A_STEP_30_CONTINUITY_MISSING",
          "continuity-after artifact missing",
        );
      }
      proofs.push(digestFile(ctx.continuityAfter));
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
      ]);
      requireOk(result, step, "verify continuity");
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_31_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: proofs,
      };
    }
    case 32: {
      const rollbackPreview = `"${ctx.repoRoot}/scripts/ops/fhv-supervisor/rollback-units.sh" --rendered-units-dir ${shellQuote(ctx.renderedUnitsDir)} --installed-units-dir ${shellQuote(ctx.installedUnitsDir)}`;
      result = runSsh(ctx, rollbackPreview, true);
      requireOk(result, step, "rollback preview");
      result = runSsh(ctx, `${rollbackPreview} --confirm`, true);
      requireOk(result, step, "rollback");
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-rollback", [
        ...identityArgs(ctx),
        "--rendered-units-dir",
        ctx.renderedUnitsDir,
        "--installed-units-dir",
        ctx.installedUnitsDir,
      ]);
      requireOk(result, step, "verify rollback");
      result = serviceUserExec(ctx, "trader:fhv:t4:build-evidence-inventory", identityArgs(ctx));
      requireOk(result, step, "evidence inventory");
      result = serviceUserExec(ctx, "trader:fhv:t4:seal-evidence", [
        ...identityArgs(ctx),
        "--seal-destination",
        ctx.sealDestination,
      ]);
      requireOk(result, step, "seal evidence");
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-seal", [
        ...identityArgs(ctx),
        "--seal-destination",
        ctx.sealDestination,
      ]);
      requireOk(result, step, "verify seal");
      result = serviceUserExec(ctx, "trader:fhv:t4:verify-ceremony", [
        ...identityArgs(ctx),
        "--continuity-before",
        ctx.continuityBefore,
        "--continuity-after",
        ctx.continuityAfter,
        "--seal-destination",
        ctx.sealDestination,
      ]);
      requireOk(result, step, "verify ceremony");
      const ceremony = parseCeremony(result.stdout);
      const required = [
        "T4A_RESULT",
        "GATE8_RESULT",
        "T4B_RESULT",
        "PAUSE_RESULT",
        "RESUME_RESULT",
        "FULL_HISTORY_RESCAN_DELTA",
        "CONTINUITY_RESULT",
        "ROLLBACK_RESULT",
        "EVIDENCE_SEAL_RESULT",
      ];
      for (const key of required) {
        if (!ceremony[key]) {
          throw new FhvT4aOperatorError("FHV_T4A_STEP_32_CEREMONY_MISSING", `Missing ${key}`);
        }
      }
      return {
        step,
        ...result,
        classification: "FHV_T4A_STEP_32_OK",
        prerequisiteProofDigests: prereq,
        resultingProofDigests: [sha256Hex(result.stdout)],
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
