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

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    console.error(`${LOG_PREFIX} WAIA_TRADER_CLI=1 is required`);
    process.exit(1);
  }

  const flags = parseFlags(process.argv.slice(2));
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
    bars: [],
    closedTrades: [],
  });

  const record = buildDiscoveryRunRecord(result, { runId: campaignId });
  console.log(`${LOG_PREFIX} record`, JSON.stringify(record, null, 2));
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(`${LOG_PREFIX} failed`, error);
    process.exit(1);
  });
}
