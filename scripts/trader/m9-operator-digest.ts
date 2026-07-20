/**
 * M9 operator digest helper — scope verification and digest generation only.
 * Does NOT run campaign, blind, HTX backfill, or write evidence artifacts. It performs a
 * read-only Postgres bar lookup to compute the content-bound `blindDigest` (DEE-398 /
 * ADR-0022) so the digest it prints matches exactly what the campaign will authorize —
 * never mutates the database or the vault.
 *
 * Usage:
 *   pnpm trader:m9:digest -- --verify-scope
 *   pnpm trader:m9:digest -- --generate-digests   # only after explicit operator go/no-go
 */

import { resolve } from "node:path";

import { getPostgresDrizzle } from "@/db/postgres-client";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  type M9BlindAuthorizationScopeV2,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import {
  loadM9ProviderSidecar,
  M9_DEFAULT_DATASET_NAME,
  M9_DEFAULT_VAULT_DIR,
  parseM9Flags,
  resolveM9ProviderSidecarPath,
} from "@/lib/trader/research/m9-campaign-flags";
import { applyCampaignSuffixToStrategyVersion } from "@/lib/trader/research/m9-candidate-preflight";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const LOG_PREFIX = "[trader:m9:digest]";
const DEFAULT_ORG0 = "3c50b4e9-1138-43a5-a29f-e65088124cfc";

function printUsage(): void {
  console.log(`M9 operator digest helper (no campaign execution)

Usage:
  pnpm trader:m9:digest -- --verify-scope
  pnpm trader:m9:digest -- --generate-digests

Scope flags (defaults match first M9 institutional campaign):
  --org-id=${DEFAULT_ORG0}
  --strategy-id=mean_reversion_v0
  --strategy-version=0.1.1
  --symbol=BTC/USDT
  --interval=1m
  --vault-dir=./${M9_DEFAULT_VAULT_DIR}
  --dataset-name=${M9_DEFAULT_DATASET_NAME}
  [--campaign-suffix=<suffix>]
  [--provider-sidecar-path=<path>]

Reads stored bars (read-only) to compute the content-bound blindDigest; only run
--generate-digests after explicit operator go/no-go in chat.`);
}

/** Exported for unit tests — must stay aligned with `m9-v2-research-campaign.ts` scope building. */
export function buildM9OperatorDigestCampaignScope(
  flags: Map<string, string>,
): M9CampaignAuthorizationScope {
  const organizationId = flags.get("org-id")?.trim() || DEFAULT_ORG0;
  const strategyId = flags.get("strategy-id")?.trim() || "mean_reversion_v0";
  const baseVersion = flags.get("strategy-version")?.trim() || "0.1.1";
  const campaignSuffix = flags.get("campaign-suffix")?.trim();
  const strategyVersion = applyCampaignSuffixToStrategyVersion(baseVersion, campaignSuffix);
  const symbol = flags.get("symbol")?.trim() || "BTC/USDT";
  const interval = flags.get("interval")?.trim() || "1m";
  const vaultDir = resolve(flags.get("vault-dir")?.trim() || M9_DEFAULT_VAULT_DIR);

  return {
    organizationId,
    strategyId,
    strategyVersion,
    symbol,
    interval,
    vaultDir,
    metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    campaignSuffix,
  };
}

/**
 * Single canonical scope builder consumer (DEE-398 / ADR-0022) — resolves the real
 * content-bound `blindDigest` via a read-only Postgres bar lookup and delegates the actual
 * scope shape to `buildM9BlindAuthorizationScope`, the same function
 * `scripts/trader/m9-v2-research-campaign.ts` uses. No duplicated scope construction.
 */
export async function buildM9OperatorDigestScope(flags: Map<string, string>): Promise<{
  campaignScope: M9CampaignAuthorizationScope;
  blindScope: M9BlindAuthorizationScopeV2;
}> {
  const campaignScope = buildM9OperatorDigestCampaignScope(flags);
  const datasetName = flags.get("dataset-name")?.trim() || M9_DEFAULT_DATASET_NAME;
  const vaultDir = campaignScope.vaultDir;

  const providerSidecarPath = resolveM9ProviderSidecarPath(flags, vaultDir);
  const providerSidecar = loadM9ProviderSidecar(providerSidecarPath);
  const sidecarContentDigest = providerSidecar
    ? computeSidecarContentDigest(providerSidecar)
    : null;

  const db = getPostgresDrizzle();
  const context = requireOrgContext(campaignScope.organizationId);
  const sealPreview = await computeM9DatasetSealPreviewPostgres(db, context, {
    symbol: campaignScope.symbol as InstrumentId,
    interval: campaignScope.interval as BarInterval,
  });

  const blindScope = buildM9BlindAuthorizationScope({
    campaignScope,
    datasetName,
    blindDigest: sealPreview.sealed.blindDigest,
    sidecarContentDigest,
  });

  return { campaignScope, blindScope };
}

async function main(): Promise<void> {
  const flags = parseM9Flags(process.argv.slice(2));
  if (flags.has("help")) {
    printUsage();
    return;
  }

  const verifyScope = flags.has("verify-scope");
  const generateDigests = flags.has("generate-digests");
  if (!verifyScope && !generateDigests) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { campaignScope, blindScope } = await buildM9OperatorDigestScope(flags);

  if (verifyScope) {
    console.log(
      JSON.stringify(
        {
          campaignScope,
          blindScope,
          note: "Review vaultDir (absolute) and blindDigest (from stored bars). Re-run with --generate-digests only after operator go/no-go.",
        },
        null,
        2,
      ),
    );
  }

  if (generateDigests) {
    const campaignDigest = computeM9CampaignAuthorizationDigest(campaignScope);
    const blindDigest = computeM9BlindAuthorizationDigest(blindScope);
    console.log(`${LOG_PREFIX} CAMPAIGN_DIGEST=${campaignDigest}`);
    console.log(`${LOG_PREFIX} BLIND_DIGEST=${blindDigest}`);
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
