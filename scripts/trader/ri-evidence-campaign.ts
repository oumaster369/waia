#!/usr/bin/env node
/**
 * RI-P7 evidence campaign helper — prepares HC-3.5 re-run package metadata.
 * Does NOT perform promotion or live enable (human ceremony only).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TREND_MOMENTUM_V0, TREND_MOMENTUM_V0_VERSION } from "@/lib/trader/intelligence/types";

const outputPath =
  process.argv[2] ?? resolve(process.cwd(), "replay-runs/RI-P7-trend-evidence-campaign.json");

const campaign = {
  schemaVersion: "ri_evidence_campaign_v1",
  strategyId: TREND_MOMENTUM_V0,
  strategyVersion: TREND_MOMENTUM_V0_VERSION,
  note: "Human HC-3.5 ceremony required. Composer cannot promote or live-enable.",
  requiredEvidence: [
    "real_backtest_net_of_costs",
    "walk_forward_validated",
    "single_shot_blind",
    "multi_regime_non_trending_and_down",
  ],
  liveGatesPaused: ["HC-3.5", "HC-4", "L4"],
  generatedAt: new Date().toISOString(),
};

writeFileSync(outputPath, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");
console.info(`[ri-evidence-campaign] wrote ${outputPath}`);
