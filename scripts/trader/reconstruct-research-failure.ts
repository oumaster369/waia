/**
 * SEE-A1.5 — Reconstruct DEE-371 failure artifacts for an existing RI candidate.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:see:reconstruct-failure -- \
 *     --org-id=<uuid> \
 *     --candidate-id=<uuid> \
 *     [--vault-dir=./replay-runs/RI-P7/dee-371-artifact-check] \
 *     [--finalize] \
 *     [--symbol=BTC/USDT] \
 *     [--interval=1m]
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { getPostgresDrizzle } from "@/db/postgres-client";
import { reconstructResearchFailureArtifactsPostgres } from "@/lib/trader/research/reconstruct-research-failure-artifacts";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const LOG_PREFIX = "[trader:see:reconstruct-failure]";

export function printReconstructFailureUsage(): void {
  console.log(`SEE-A1.5 — reconstruct research failure artifacts

Usage:
  pnpm trader:see:reconstruct-failure -- \\
    --org-id=<uuid> \\
    --candidate-id=<uuid> \\
    [--vault-dir=./replay-runs/RI-P7/dee-371-artifact-check] \\
    [--finalize] \\
    [--symbol=BTC/USDT] \\
    [--interval=1m]

Environment:
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES
  WAIA_TRADER_CLI=1`);
}

function parseFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, true);
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.has("help")) {
    printReconstructFailureUsage();
    return;
  }

  const organizationId = String(flags.get("org-id") ?? "").trim();
  const candidateId = String(flags.get("candidate-id") ?? "").trim();
  if (!organizationId) {
    throw new Error(`${LOG_PREFIX} --org-id is required`);
  }
  if (!candidateId) {
    throw new Error(`${LOG_PREFIX} --candidate-id is required`);
  }

  const vaultDir = resolve(
    String(flags.get("vault-dir") ?? "./replay-runs/RI-P7/dee-371-artifact-check"),
  );
  const finalize = flags.has("finalize");
  const symbol = (String(flags.get("symbol") ?? "BTC/USDT").trim() || "BTC/USDT") as InstrumentId;
  const interval = (String(flags.get("interval") ?? "1m").trim() || "1m") as BarInterval;
  const builderGitSha = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  mkdirSync(vaultDir, { recursive: true });

  const db = getPostgresDrizzle();
  const context = requireOrgContext(organizationId);

  const result = await reconstructResearchFailureArtifactsPostgres(db, context, {
    candidateId,
    vaultDir,
    symbol,
    interval,
    finalize,
    builderGitSha,
    vaultNaming: "flat",
  });

  console.error(
    `${LOG_PREFIX} validationMetricsSource=${result.validationMetricsSource} ` +
      `finalized=${result.finalized} rejection=${result.rejectionRecordPath} ` +
      `evolution=${result.evolutionCyclePath}`,
  );
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
