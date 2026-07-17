/**
 * HTR-WP22 / shared Macro-J Postgres fixture prelude.
 */

import postgres from "postgres";
import { eq } from "drizzle-orm";

import { getPostgresDrizzle } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export const HTR_PG_USER_A = "00000000-0000-4000-8022-0000000000a1";
export const HTR_PG_USER_B = "00000000-0000-4000-8022-0000000000b2";

export function createHtrPostgresUuidFactory(seed: number): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8022-${(seed + counter).toString(16).padStart(12, "0")}`;
  };
}

export async function ensureAuthUsersSeed(url: string, userIds: readonly string[]): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    for (const userId of userIds) {
      await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        userId,
      ]);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedHtrPostgresUser(
  url: string,
  userId: string,
  displayName: string,
): Promise<string> {
  await ensureAuthUsersSeed(url, [userId]);

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

export async function cleanupHtrPostgresOrg(url: string, userId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  const orgId = personalOrganizationIdFromUserId(userId);
  try {
    await sql.unsafe(`DELETE FROM trader_knowledge_edges WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_market_events WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_blind_validation_results WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_walk_forward_windows WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_strategy_candidates WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_backtest_results WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_backtest_runs WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM research_dataset WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_strategy_promotion_records WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_market_bars WHERE organization_id = $1`, [orgId]);
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
