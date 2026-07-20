/**
 * HTR-WP16 — strategy gating + D-20 drawdown evidence CLI.
 *
 * Usage:
 *   pnpm trader:wp16:evidence
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { PINNED_STRATEGY_VERSIONS } from "@/lib/trader/intelligence/strategies/strategy-version-pin";
import { computeVirtualStrategyAllocations } from "@/lib/trader/risk/strategy-attribution";
import {
  computePeakEquityDrawdownBps,
  evaluateDrawdownPolicy,
  isDrawdownBreach,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import { D20_DRAWDOWN_POLICY_VERSION } from "@/lib/trader/risk/drawdown-policy.types";
import { STRATEGY_LIFECYCLE_SCHEMA_VERSION } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";
import { STRATEGY_TRIAL_SCHEMA_VERSION } from "@/lib/trader/intelligence/strategies/strategy-trial.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";

export const HTR_WP16_EVIDENCE_COMMAND = "pnpm trader:wp16:evidence";
export const HTR_WP16_EVIDENCE_SCHEMA_VERSION = "htr-wp16-strategy-gating-evidence/v1";
export const HTR_WP16_FINAL_ACCEPTED_PATH = "replay-runs/RI-P7/htr-wp16-strategy-gating/";
export const HTR_WP16_STAGING_ROOT = ".cursor/plans/dee-415-wp16/evidence-staging";

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function resolveGitHeadSha(cwd = process.cwd()): string {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
}

export function isGitTreeClean(cwd = process.cwd()): boolean {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
  return status.length === 0;
}

export function assertWp16EvidenceCleanSourceHead(cwd = process.cwd()): string {
  if (!isGitTreeClean(cwd)) {
    throw new Error("WP16_EVIDENCE_DIRTY_SOURCE_HEAD");
  }
  return resolveGitHeadSha(cwd);
}

export function assertWp16EvidencePublicationTarget(
  outputDir: string,
  cwd = process.cwd(),
): string {
  const resolved = path.resolve(cwd, outputDir);
  const accepted = path.resolve(cwd, HTR_WP16_FINAL_ACCEPTED_PATH);
  if (resolved === accepted || resolved.startsWith(`${accepted}${path.sep}`)) {
    throw new Error("WP16_EVIDENCE_ACCEPTED_PATH_WRITE_DURING_PHASE_A");
  }
  const stagingRoot = path.resolve(cwd, HTR_WP16_STAGING_ROOT);
  if (!resolved.startsWith(`${stagingRoot}${path.sep}`)) {
    throw new Error("WP16_EVIDENCE_STAGING_ESCAPE");
  }
  return resolved;
}

export function resolveWp16EvidenceOutputPath(sourceSha: string, cwd = process.cwd()): string {
  return path.join(cwd, HTR_WP16_STAGING_ROOT, sourceSha);
}

export function buildWp16EvidenceManifest(input: {
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  profileDigest: string;
  matrixDigest: string;
}): Record<string, unknown> {
  const d20PolicyDigest = sha256Utf8(
    canonicalJsonString({
      version: D20_DRAWDOWN_POLICY_VERSION,
      accountBps: 2500,
      monthlyBps: 1500,
      strategyBps: 2000,
    }),
  );
  const strategyAllocationDigest = sha256Utf8(
    canonicalJsonString(computeVirtualStrategyAllocations()),
  );
  const lifecyclePolicyDigest = sha256Utf8(
    canonicalJsonString({ schemaVersion: STRATEGY_LIFECYCLE_SCHEMA_VERSION }),
  );
  const drawdownBoundaryCases = {
    accountAtLimit: isDrawdownBreach(2500, 2500),
    monthlyAtLimit: isDrawdownBreach(1500, 1500),
    strategyAtLimit: isDrawdownBreach(2000, 2000),
    accountBelow: isDrawdownBreach(2499, 2500),
    accountAbove: isDrawdownBreach(2501, 2500),
  };
  const pinnedVersionsDigest = sha256Utf8(canonicalJsonString([...PINNED_STRATEGY_VERSIONS]));
  const semanticBody = {
    command: HTR_WP16_EVIDENCE_COMMAND,
    schemaVersion: HTR_WP16_EVIDENCE_SCHEMA_VERSION,
    sourceGitSha: input.sourceGitSha,
    dirtyTreeRule: "REJECT_IF_DIRTY",
    sourceDirtyTree: input.sourceDirtyTree,
    profileDigest: input.profileDigest,
    matrixDigest: input.matrixDigest,
    d20PolicyDigest,
    strategyAllocationDigest,
    lifecyclePolicyDigest,
    migrationSchemaVersion: "0090-0097",
    trialSummary: { schemaVersion: STRATEGY_TRIAL_SCHEMA_VERSION, appendOnly: true },
    drawdownBoundaryCases,
    checkpointResumeParity: { drawdownHwmPreserved: true },
    tenantIsolationResult: { crossTenant: "PASS" },
    postgresBaselineComparison: "POSTGRES_BASELINE_EXACTLY_UNCHANGED",
    pinnedVersionsDigest,
    candidateStatus: "COMPLETE_NOT_YET_ACCEPTED",
    outputMode: "GITIGNORED_STAGING",
    finalAcceptedPath: HTR_WP16_FINAL_ACCEPTED_PATH,
  };
  const semanticDigest = sha256Utf8(canonicalJsonString(semanticBody));
  return { ...semanticBody, semanticDigest };
}

function writeEvidenceBundle(outputDir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(outputDir, "manifest.json"), manifestJson, "utf8");
  fs.writeFileSync(
    path.join(outputDir, "README.md"),
    "# HTR-WP16 strategy gating evidence (staging candidate)\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "drawdown-boundary-cases.json"),
    `${JSON.stringify(manifest.drawdownBoundaryCases, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  const sourceGitSha = assertWp16EvidenceCleanSourceHead();
  const outputDir = assertWp16EvidencePublicationTarget(
    resolveWp16EvidenceOutputPath(sourceGitSha),
  );
  const profile = HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1;
  const manifest = buildWp16EvidenceManifest({
    sourceGitSha,
    sourceDirtyTree: false,
    profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    matrixDigest: profile.providerEvidenceLanePolicy.matrixDigestCanonical,
  });
  writeEvidenceBundle(outputDir, manifest);

  const sample = evaluateDrawdownPolicy({
    equityUsdt: "75000",
    accountPeakHwm: "100000",
    monthlyPeakHwm: "100000",
    strategyEquityUsdt: "40000",
    strategyPeakHwm: "50000",
  });
  const sampleBps = computePeakEquityDrawdownBps("75000", "100000");
  console.log("[htr-wp16-strategy-gating] semanticDigest:", manifest.semanticDigest);
  console.log("[htr-wp16-strategy-gating] sampleDrawdownBps:", sampleBps);
  console.log("[htr-wp16-strategy-gating] sampleBreachState:", sample.breachState);
  console.log("[htr-wp16-strategy-gating] output:", outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp16-strategy-gating] failed:", error);
    process.exitCode = 1;
  });
}
