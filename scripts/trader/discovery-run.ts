/**
 * DEE-383 / M8 — Operator-invoked discovery evolution orchestrator CLI stub.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:discovery:run -- \
 *     --org-id=<uuid> \
 *     --campaign-id=<uuid> \
 *     [--enable=1]
 *
 * Default posture: disabled — pass --enable=1 with operator authorization.
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import { getPostgresDrizzle } from "@/db/postgres-client";
import {
  DEFAULT_DISCOVERY_RUN_CONFIG,
  DISCOVERY_SCHEMA_VERSION,
} from "@/lib/trader/discovery/discovery.types";
import { runDiscoveryEvolutionPass } from "@/lib/trader/discovery/evolution-orchestrator";
import type { DiscoveryEvolutionPassResult } from "@/lib/trader/discovery/evolution-orchestrator";
import { assertOperatorActionAllowed } from "@/lib/trader/operator/operator-authority";
import {
  buildCampaignRunFrontmatter,
  type CampaignRunFrontmatter,
} from "@/lib/trader/research/campaign-run-frontmatter";
import { prepareResearchDevelopmentSourcePostgresV1 } from
  "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { captureResearchDevelopmentSourceRequestV1 } from
  "@/lib/trader/research/research-development-source-contract-v1";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const LOG_PREFIX = "[trader:discovery:run]";

export type DiscoveryRunRecord = {
  /** Additive provenance block (DEE-407) — does not alter discovery pipeline semantics. */
  frontmatter: CampaignRunFrontmatter;
  result: DiscoveryEvolutionPassResult;
};

export function buildDiscoveryRunRecord(
  result: DiscoveryEvolutionPassResult,
  input?: { runId?: string },
): DiscoveryRunRecord {
  return {
    frontmatter: buildCampaignRunFrontmatter({
      runId: input?.runId,
    }),
    result,
  };
}

export function resolveDiscoveryRunExitCode(input: {
  enabled: boolean;
  barsCount: number;
  closedTradeCount: number;
  result: Pick<DiscoveryEvolutionPassResult, "reason" | "skipped" | "status">;
}): number {
  if (
    input.result.reason === "research_v2_admission_incomplete" ||
    input.result.reason === "research_v2_outcomes_required" ||
    input.result.reason === "admission_journal_unavailable" ||
    input.result.reason === "used_for_discovery_required"
  ) {
    return 1;
  }
  if (input.enabled && (input.barsCount === 0 || input.closedTradeCount === 0)) {
    return 1;
  }
  return 0;
}

export function printDiscoveryRunUsage(): void {
  console.log(`M8 discovery evolution orchestrator (operator-invoked, default disabled)

Usage:
  pnpm trader:discovery:run -- \\
    --org-id=<uuid> \\
    --campaign-id=<uuid> \\
    [--campaign-digest=<hex>] \\
    [--enable=1] \\
    [--operator-attestation=<digest>]

Environment:
  WAIA_TRADER_CLI=1
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES=...
`);
}

function parseFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      flags.set(body, true);
      continue;
    }
    flags.set(body.slice(0, eq), body.slice(eq + 1));
  }
  return flags;
}

const SOURCE_PREPARATION_FLAGS = new Set([
  "prepare-source",
  "org-id",
  "command-id",
  "symbol",
  "initial-record-index",
  "observation-bar-count",
  "gap-bar-count",
  "training-bar-count",
]);

function hasSourcePreparationFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--prepare-source" || arg.startsWith("--prepare-source="));
}

function parseStrictInteger(value: string | boolean | undefined, flag: string): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:" + flag);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:" + flag);
  }
  return number;
}

export function parseDiscoverySourcePreparationArgs(argv: readonly string[]) {
  if (!hasSourcePreparationFlag(argv)) return null;
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:POSITIONAL");
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals <= 0) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:FLAG_FORMAT");
    const name = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (!SOURCE_PREPARATION_FLAGS.has(name)) {
      throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:UNKNOWN_FLAG");
    }
    if (seen.has(name)) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:DUPLICATE_FLAG");
    seen.add(name);
    values.set(name, value);
  }
  if (values.get("prepare-source") !== "1") {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:PREPARE_FLAG");
  }
  return captureResearchDevelopmentSourceRequestV1({
    organizationId: values.get("org-id"),
    commandId: values.get("command-id"),
    symbol: values.get("symbol"),
    initialRecordIndex: parseStrictInteger(values.get("initial-record-index"), "initial-record-index"),
    observationBarCount: parseStrictInteger(values.get("observation-bar-count"), "observation-bar-count"),
    gapBarCount: parseStrictInteger(values.get("gap-bar-count"), "gap-bar-count"),
    trainingBarCount: parseStrictInteger(values.get("training-bar-count"), "training-bar-count"),
  });
}

export async function runDiscoverySourcePreparationBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    prepare(request: ReturnType<typeof captureResearchDevelopmentSourceRequestV1>): Promise<{
      status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY" | "COMMIT_UNCERTAIN";
      issuance: unknown;
      observation: unknown;
    }>;
    print(value: { status: string; issuance: unknown; observation: unknown }): void;
  },
): Promise<{ handled: boolean; exitCode: number; error?: string }> {
  if (!hasSourcePreparationFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) {
    return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  }
  let request: ReturnType<typeof captureResearchDevelopmentSourceRequestV1>;
  try {
    request = parseDiscoverySourcePreparationArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "SOURCE_PREPARATION_ARGUMENTS_INVALID" };
  }
  try {
    input.authorize();
    const result = await input.prepare(request);
    input.print({
      status: result.status,
      issuance: result.issuance,
      observation: result.observation,
    });
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "SOURCE_PREPARATION_FAILED" };
  }
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    console.error(`${LOG_PREFIX} WAIA_TRADER_CLI=1 is required`);
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  if (hasSourcePreparationFlag(argv)) {
    const outcome = await runDiscoverySourcePreparationBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      prepare: prepareResearchDevelopmentSourcePostgresV1,
      print: (value) => console.log(LOG_PREFIX + " source " + JSON.stringify(value)),
    });
    if (outcome.error) console.error(LOG_PREFIX + " " + outcome.error);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }

  const flags = parseFlags(argv);
  if (flags.has("help")) {
    printDiscoveryRunUsage();
    return;
  }

  const orgId = flags.get("org-id");
  const campaignId = flags.get("campaign-id");
  if (typeof orgId !== "string" || typeof campaignId !== "string") {
    printDiscoveryRunUsage();
    process.exit(1);
  }

  const enabled = flags.get("enable") === "1" || flags.get("enable") === true;
  const operatorAttestation =
    typeof flags.get("operator-attestation") === "string"
      ? (flags.get("operator-attestation") as string)
      : "";

  if (enabled) {
    assertOperatorActionAllowed("authorize_discovery_run");
    if (!operatorAttestation.trim()) {
      console.error(`${LOG_PREFIX} --operator-attestation is required when --enable=1`);
      process.exit(1);
    }
  }

  const context = requireOrgContext(orgId);
  const db = getPostgresDrizzle();

  const bars: [] = [];
  const closedTrades: [] = [];
  const result = await runDiscoveryEvolutionPass(db, {
    runContext: {
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      config: {
        ...DEFAULT_DISCOVERY_RUN_CONFIG,
        enabled,
        campaignId,
      },
      context,
      campaignRef: {
        campaignId,
        campaignDigest:
          typeof flags.get("campaign-digest") === "string"
            ? (flags.get("campaign-digest") as string)
            : "pending",
        state: enabled ? "ACTIVE" : "PROPOSED",
      },
      operatorAttestationDigest: operatorAttestation,
    },
    config: {
      ...DEFAULT_DISCOVERY_RUN_CONFIG,
      enabled,
      campaignId,
    },
    bars,
    closedTrades,
  });

  const record = buildDiscoveryRunRecord(result, { runId: campaignId });
  console.log(`${LOG_PREFIX} record`, JSON.stringify(record, null, 2));
  const exitCode = resolveDiscoveryRunExitCode({
    enabled,
    barsCount: bars.length,
    closedTradeCount: closedTrades.length,
    result,
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (process.env.WAIA_TRADER_CLI === "1" || hasSourcePreparationFlag(process.argv.slice(2))) {
  main().catch((error: unknown) => {
    console.error(`${LOG_PREFIX} failed`, error);
    process.exit(1);
  });
}
