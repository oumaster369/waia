/**
 * DEE-415 / HTR-WP13 — intelligence bundle idempotency (opt-in).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import type { Bar } from "@/lib/trader/intelligence/types";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-0000000415p2";

function bars(): Bar[] {
  return Array.from({ length: 80 }, (_, i) => ({
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

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader intelligence bundle idempotency (DEE-415 / HTR-WP13)",
  () => {
    let orgA: string;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await sql.unsafe(
          `DELETE FROM trader_intelligence_conviction_record WHERE organization_id = $1`,
          [orgId],
        );
        await sql.unsafe(
          `DELETE FROM trader_intelligence_hypothesis_record WHERE organization_id = $1`,
          [orgId],
        );
        await sql.unsafe(
          `DELETE FROM trader_intelligence_cycle_envelope WHERE organization_id = $1`,
          [orgId],
        );
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      await cleanup();
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
          USER_A,
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "WP13 Intelligence Bundle Idempotency",
      });
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("accepts identical replay twice idempotently", async () => {
      const db = getPostgresDrizzle();
      const cycle = runEvaluationCycle({
        organizationId: orgA,
        bars: bars(),
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
        runId: "wp13-idem-run",
        cycleId: "0",
        newId: createDeterministicReplayIdFactory(415_130),
      });
      const bundle = buildIntelligenceCycleBundle({
        organizationId: orgA,
        runId: "wp13-idem-run",
        cycleId: "0",
        symbol: "BTC/USDT",
        marketStateSnapshot: cycle.marketStateSnapshot!,
        decisionChain: cycle.decisionChain!,
      });
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
    });

    it("fails closed on same key with changed terminal reason digest", async () => {
      const db = getPostgresDrizzle();
      const cycle = runEvaluationCycle({
        organizationId: orgA,
        bars: bars(),
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
        runId: "wp13-conflict-run",
        cycleId: "1",
        newId: createDeterministicReplayIdFactory(415_130),
      });
      const bundle = buildIntelligenceCycleBundle({
        organizationId: orgA,
        runId: "wp13-conflict-run",
        cycleId: "1",
        symbol: "BTC/USDT",
        marketStateSnapshot: cycle.marketStateSnapshot!,
        decisionChain: cycle.decisionChain!,
      });
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);

      const divergent = {
        ...bundle,
        envelope: {
          ...bundle.envelope,
          terminalReasonCode: "ALLOW_TRADING",
          contentDigest: "0".repeat(64),
        },
      };
      await expect(
        persistIntelligenceCycleBundle({ organizationId: orgA }, divergent, db),
      ).rejects.toBeInstanceOf(IntelligenceRecordsIdempotencyConflictError);
    });
  },
);
