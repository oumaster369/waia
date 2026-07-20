/**
 * DEE-415 / HTR-WP13 — shared Postgres integration helpers.
 */

import postgres from "postgres";
import { eq } from "drizzle-orm";

import { getPostgresDrizzle } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { Bar } from "@/lib/trader/intelligence/types";

export const WP13_PG_USER_A = "00000000-0000-4000-8000-000000041501";
export const WP13_PG_USER_B = "00000000-0000-4000-8000-000000041502";

export function wp13Bars(count = 80): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "1",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1)).toISOString(),
  }));
}

export function buildWp13Bundle(
  organizationId: string,
  runId: string,
  cycleId: string,
): IntelligenceCycleBundle {
  const cycle = runEvaluationCycle({
    organizationId,
    bars: wp13Bars(),
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    runId,
    cycleId,
    newId: createDeterministicReplayIdFactory(415_130),
  });
  return buildIntelligenceCycleBundle({
    organizationId,
    runId,
    cycleId,
    symbol: "BTC/USDT",
    marketStateSnapshot: cycle.marketStateSnapshot!,
    decisionChain: cycle.decisionChain!,
  });
}

export async function cleanupWp13IntelligenceRows(
  url: string,
  organizationId: string,
): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_conviction_record DISABLE TRIGGER trader_intelligence_conviction_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_hypothesis_record DISABLE TRIGGER trader_intelligence_hypothesis_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_cycle_envelope DISABLE TRIGGER trader_intelligence_cycle_envelope_block_delete`,
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_conviction_record WHERE organization_id = $1`,
      [organizationId],
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_hypothesis_record WHERE organization_id = $1`,
      [organizationId],
    );
    await sql.unsafe(`DELETE FROM trader_intelligence_cycle_envelope WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_conviction_record ENABLE TRIGGER trader_intelligence_conviction_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_hypothesis_record ENABLE TRIGGER trader_intelligence_hypothesis_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_cycle_envelope ENABLE TRIGGER trader_intelligence_cycle_envelope_block_delete`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function cleanupWp13Org(url: string, userId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const orgId = personalOrganizationIdFromUserId(userId);
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_conviction_record DISABLE TRIGGER trader_intelligence_conviction_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_hypothesis_record DISABLE TRIGGER trader_intelligence_hypothesis_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_cycle_envelope DISABLE TRIGGER trader_intelligence_cycle_envelope_block_delete`,
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_conviction_record WHERE organization_id = $1`,
      [orgId],
    );
    await sql.unsafe(
      `DELETE FROM trader_intelligence_hypothesis_record WHERE organization_id = $1`,
      [orgId],
    );
    await sql.unsafe(`DELETE FROM trader_intelligence_cycle_envelope WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_conviction_record ENABLE TRIGGER trader_intelligence_conviction_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_hypothesis_record ENABLE TRIGGER trader_intelligence_hypothesis_record_block_delete`,
    );
    await sql.unsafe(
      `ALTER TABLE trader_intelligence_cycle_envelope ENABLE TRIGGER trader_intelligence_cycle_envelope_block_delete`,
    );
    await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM users WHERE id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function countWp13RowsForRun(
  url: string,
  organizationId: string,
  runId: string,
): Promise<{ envelopes: number; hypotheses: number; convictions: number }> {
  const sql = postgres(url, { max: 1 });
  try {
    const envelopes =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_cycle_envelope WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    const hypotheses =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_hypothesis_record WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    const convictions =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_conviction_record WHERE organization_id = $1 AND run_id = $2`,
          [organizationId, runId],
        )
      )[0]?.count ?? 0;
    return { envelopes, hypotheses, convictions };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedWp13User(
  url: string,
  userId: string,
  displayName: string,
): Promise<string> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
      userId,
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const db = getPostgresDrizzle();
  const existing = await db
    .select({ id: pgSchema.users.id })
    .from(pgSchema.users)
    .where(eq(pgSchema.users.id, userId))
    .limit(1);
  if (!existing[0]) {
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: displayName,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
  }
  return ensureUserCoreSeedPostgres(db, { userId, displayName });
}

export async function countWp13Rows(
  url: string,
  organizationId: string,
): Promise<{ envelopes: number; hypotheses: number; convictions: number }> {
  const sql = postgres(url, { max: 1 });
  try {
    const envelopes =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_cycle_envelope WHERE organization_id = $1`,
          [organizationId],
        )
      )[0]?.count ?? 0;
    const hypotheses =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_hypothesis_record WHERE organization_id = $1`,
          [organizationId],
        )
      )[0]?.count ?? 0;
    const convictions =
      (
        await sql.unsafe(
          `SELECT count(*)::int AS count FROM trader_intelligence_conviction_record WHERE organization_id = $1`,
          [organizationId],
        )
      )[0]?.count ?? 0;
    return { envelopes, hypotheses, convictions };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
