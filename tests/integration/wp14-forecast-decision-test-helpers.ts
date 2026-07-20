/**
 * DEE-415 / HTR-WP14 — shared Postgres integration helpers.
 */

import postgres from "postgres";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { buildForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import { WP13_PG_USER_A } from "./wp13-intelligence-test-helpers";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import {
  cleanupWp13IntelligenceRows,
  cleanupWp13Org,
  seedWp13User,
  wp13Bars,
} from "./wp13-intelligence-test-helpers";

export { WP13_PG_USER_A as WP14_PG_USER_A, seedWp13User as seedWp14User, wp13Bars as wp14Bars };

export function buildWp14Bundle(
  organizationId: string,
  runId: string,
  cycleId: string,
): ForecastDecisionBundle {
  const cycle = runEvaluationCycle({
    organizationId,
    bars: wp13Bars(),
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    runId,
    cycleId,
    newId: createDeterministicReplayIdFactory(415_140),
    costModel: createCostModelV1("10", "5"),
  });
  const intelligenceCycleBundle = buildIntelligenceCycleBundle({
    organizationId,
    runId,
    cycleId,
    symbol: "BTC/USDT",
    marketStateSnapshot: cycle.marketStateSnapshot!,
    decisionChain: cycle.decisionChain!,
  });
  return buildForecastDecisionBundle({
    intelligenceCycleBundle,
    hypothesisSet: cycle.hypothesisSet!,
    decisionChain: cycle.decisionChain!,
    msv: cycle.msv,
    signal: cycle.signal,
    costModel: createCostModelV1("10", "5"),
  });
}

export async function cleanupWp14ForecastDecisionRows(
  url: string,
  organizationId: string,
): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_entry_purpose_record DISABLE TRIGGER trader_intelligence_entry_purpose_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_decision_forecast_link DISABLE TRIGGER trader_intelligence_decision_forecast_link_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_decision_record DISABLE TRIGGER trader_intelligence_decision_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_forecast_record DISABLE TRIGGER trader_intelligence_forecast_record_block_delete`,
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_entry_purpose_record WHERE organization_id = $1`,
      [organizationId],
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_decision_forecast_link WHERE organization_id = $1`,
      [organizationId],
    );
    await sql.unsafe(`DELETE FROM trader_intelligence_decision_record WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_intelligence_forecast_record WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_entry_purpose_record ENABLE TRIGGER trader_intelligence_entry_purpose_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_decision_forecast_link ENABLE TRIGGER trader_intelligence_decision_forecast_link_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_decision_record ENABLE TRIGGER trader_intelligence_decision_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_forecast_record ENABLE TRIGGER trader_intelligence_forecast_record_block_delete`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function cleanupWp14Org(url: string, userId: string): Promise<void> {
  const orgId = personalOrganizationIdFromUserId(userId);
  await cleanupWp14ForecastDecisionRows(url, orgId);
  await cleanupWp13Org(url, userId);
}

export async function cleanupWp14AllRows(url: string, organizationId: string): Promise<void> {
  await cleanupWp14ForecastDecisionRows(url, organizationId);
  await cleanupWp13IntelligenceRows(url, organizationId);
}

export async function countWp14RowsForRun(
  url: string,
  organizationId: string,
  runId: string,
): Promise<{
  forecasts: number;
  decisions: number;
  links: number;
  entryPurposes: number;
}> {
  const sql = postgres(url, { max: 1 });
  try {
    const forecasts =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_forecast_record WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    const decisions =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_decision_record WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    const links =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_decision_forecast_link WHERE organization_id = $1 AND decision_record_id IN (SELECT id FROM trader_intelligence_decision_record WHERE organization_id = $1 AND run_id = $2)`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    const entryPurposes =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_entry_purpose_record WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    return { forecasts, decisions, links, entryPurposes };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
