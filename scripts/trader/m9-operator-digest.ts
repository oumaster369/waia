/**
 * M9 operator digest helper — scope verification and digest generation only.
 * Does NOT run campaign, blind, HTX backfill, or write evidence artifacts.
 *
 * Usage:
 *   pnpm trader:m9:digest -- --verify-scope
 *   pnpm trader:m9:digest -- --generate-digests   # only after explicit operator go/no-go
 */

import { resolve } from "node:path";

import {
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  type M9BlindAuthorizationScope,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import {
  M9_DEFAULT_DATASET_NAME,
  M9_DEFAULT_VAULT_DIR,
  parseM9Flags,
} from "@/lib/trader/research/m9-campaign-flags";
import { applyCampaignSuffixToStrategyVersion } from "@/lib/trader/research/m9-candidate-preflight";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";

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

Only run --generate-digests after explicit operator go/no-go in chat.`);
}

/** Exported for unit tests — must stay aligned with `m9-v2-research-campaign.ts` scope building. */
export function buildM9OperatorDigestScope(flags: Map<string, string>): {
  campaignScope: M9CampaignAuthorizationScope;
  blindScope: M9BlindAuthorizationScope;
} {
  const organizationId = flags.get("org-id")?.trim() || DEFAULT_ORG0;
  const strategyId = flags.get("strategy-id")?.trim() || "mean_reversion_v0";
  const baseVersion = flags.get("strategy-version")?.trim() || "0.1.1";
  const campaignSuffix = flags.get("campaign-suffix")?.trim();
  const strategyVersion = applyCampaignSuffixToStrategyVersion(baseVersion, campaignSuffix);
  const symbol = flags.get("symbol")?.trim() || "BTC/USDT";
  const interval = flags.get("interval")?.trim() || "1m";
  const vaultDir = resolve(flags.get("vault-dir")?.trim() || M9_DEFAULT_VAULT_DIR);
  const datasetName = flags.get("dataset-name")?.trim() || M9_DEFAULT_DATASET_NAME;

  const campaignScope: M9CampaignAuthorizationScope = {
    organizationId,
    strategyId,
    strategyVersion,
    symbol,
    interval,
    vaultDir,
    metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    campaignSuffix,
  };

  return {
    campaignScope,
    blindScope: { ...campaignScope, datasetName },
  };
}

function main(): void {
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

  const { campaignScope, blindScope } = buildM9OperatorDigestScope(flags);

  if (verifyScope) {
    console.log(
      JSON.stringify(
        {
          campaignScope,
          blindScope,
          note: "Review vaultDir (absolute). Re-run with --generate-digests only after operator go/no-go.",
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
  main();
}
