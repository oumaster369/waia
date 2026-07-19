import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Bar } from "@/lib/trader/intelligence/types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";

/** Macro-I activation commit — flag-OFF comparison parent. */
export const WP21_FLAG_OFF_PARENT_SHA = "5e9fb1061723614b22604aee86ee129e8f226616";

export const WP21_PROOF_FIXTURE_PATH = "tests/fixtures/trader/btcusdt-1m-mean-reversion.json";
export const WP21_PROOF_USER_ID = "00000000-0000-4000-8021-0000000000p1";
export const WP21_PROOF_STRATEGY_VERSION = "0.1.0";

export type Wp21MeasuredProofOutput = Readonly<{
  metricsSchemaVersion: string;
  capitalPathDigest: string;
  fullResearchPathDigest: string;
  serializedCapitalPath: string;
  metrics: unknown;
}>;

export function loadWp21ProofFixtureBars(): Bar[] {
  const filePath = path.join(process.cwd(), WP21_PROOF_FIXTURE_PATH);
  return (JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[] }).bars;
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function serializeResearchValidationCapitalPath(input: {
  metricsSchemaVersion: string;
  metrics: unknown;
  cycleResults: readonly PaperCycleResult[];
  portfolioContext?: unknown;
}): string {
  return canonicalJsonString({
    metricsSchemaVersion: input.metricsSchemaVersion,
    metrics: input.metrics,
    portfolioContext: input.portfolioContext ?? null,
    cycles: input.cycleResults.map((cycle) => ({
      regime: cycle.evaluation.msv.derived.regime,
      signals: cycle.evaluation.signals,
      decisionChain: cycle.evaluation.decisionChain ?? null,
      forecastDecisionBundle: cycle.evaluation.forecastDecisionBundle ?? null,
      submitBlocked: cycle.submitBlocked,
      skipReason: cycle.skipReason ?? null,
      executions: cycle.strategyExecutions.map((entry) => ({
        strategyId: entry.signal.strategyId,
        status: entry.execution?.status ?? null,
        orderId:
          entry.execution && "order" in entry.execution && entry.execution.order
            ? entry.execution.order.id
            : entry.execution && "orderId" in entry.execution
              ? entry.execution.orderId
              : null,
        quantity:
          entry.execution && "order" in entry.execution && entry.execution.order
            ? entry.execution.order.quantity
            : null,
        submitBlocked: entry.submitBlocked,
        skipReason: entry.skipReason ?? null,
      })),
      guardian: cycle.htrGuardian ?? cycle.guardian ?? null,
      reconciliation: cycle.reconciliation,
    })),
  });
}

export function digestResearchValidationCapitalPath(input: {
  metricsSchemaVersion: string;
  metrics: unknown;
  cycleResults: readonly PaperCycleResult[];
  portfolioContext?: unknown;
}): { capitalPathDigest: string; fullResearchPathDigest: string; serializedCapitalPath: string } {
  const serializedCapitalPath = serializeResearchValidationCapitalPath(input);
  const capitalPathDigest = sha256Utf8(serializedCapitalPath);
  const fullResearchPathDigest = sha256Utf8(
    canonicalJsonString({
      metricsSchemaVersion: input.metricsSchemaVersion,
      capitalPathDigest,
      metrics: input.metrics,
      portfolioContext: input.portfolioContext ?? null,
    }),
  );
  return { capitalPathDigest, fullResearchPathDigest, serializedCapitalPath };
}

export function runMeasuredFlagOffRunnerInWorktree(input: {
  worktreePath: string;
  repoRoot: string;
  metricsSchemaVersion: "1.0.0" | "2.0.0";
  outputPath: string;
}): Wp21MeasuredProofOutput {
  const runnerPath = path.join(input.repoRoot, "scripts/trader/wp21-measured-flag-off-runner.ts");
  execSync(
    `pnpm exec node --import tsx --conditions=react-server "${runnerPath}" --metrics-schema-version=${input.metricsSchemaVersion} --out="${input.outputPath}"`,
    {
      cwd: input.worktreePath,
      env: {
        ...process.env,
        WAIA_TRADER_CLI: "1",
        NODE_ENV: "test",
      },
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  return JSON.parse(readFileSync(input.outputPath, "utf8")) as Wp21MeasuredProofOutput;
}

export function withTemporaryWorktree<T>(sha: string, fn: (worktreePath: string) => T): T {
  const repoRoot = process.cwd();
  const worktreeRoot = path.join(repoRoot, ".cursor/proof-worktrees");
  mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = path.join(worktreeRoot, sha.slice(0, 12));
  if (existsSync(worktreePath)) {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    rmSync(worktreePath, { recursive: true, force: true });
  }
  execSync(`git worktree add --detach "${worktreePath}" ${sha}`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
  try {
    return fn(worktreePath);
  } finally {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

export function writeMeasuredProofJson(outputPath: string, payload: Wp21MeasuredProofOutput): void {
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export const WP21_PROOF_METRICS_V1 = RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;
export const WP21_PROOF_METRICS_V2 = RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;

export {
  generateWp21G2ParentSeal,
  assertExpectedParentSealDigests,
  WP21_ZERO_FILL_SEMANTIC_DIGEST,
  WP21_PARENT_ORACLE_SEMANTIC_DIGEST,
} from "@/lib/trader/research/wp21-g2-parent-seal-orchestrator";
export {
  compareWp21ZeroFillStructuralSemantics,
  exportWp21ZeroFillStructuralCandidate,
  createWp21ZeroFillStructuralSession,
} from "@/lib/trader/research/wp21-g2-zero-fill-structural-comparison";
export { runWp21G2CostVectorComparison } from "@/lib/trader/research/wp21-g2-cost-vector-comparison";
export { runGuardianCostCausalScenarioComparison } from "@/lib/trader/research/wp21-g2-guardian-cost-causal-harness";
