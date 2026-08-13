/**
 * DEE-528 — Decision economics V2 Postgres roundtrip (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  buildDecisionEconomicsV2Record,
  decisionEvRangeFromRecord,
  persistDecisionEconomicsV2,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const WP518_ECON_PG_USER = "00000000-0000-4000-8000-000000051802";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

async function cleanupDecisionEconomicsV2(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  await sql.unsafe(
    `ALTER TABLE trader_intelligence_decision_economics_v2 DISABLE TRIGGER trader_intelligence_decision_economics_v2_block_delete`,
  );
  await sql.unsafe(
    `DELETE FROM trader_intelligence_decision_economics_v2 WHERE organization_id = $1`,
    [organizationId],
  );
  await sql.unsafe(
    `ALTER TABLE trader_intelligence_decision_economics_v2 ENABLE TRIGGER trader_intelligence_decision_economics_v2_block_delete`,
  );
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres decision economics v2 persistence (DEE-528)",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP518_ECON_PG_USER);
      orgId = await seedWp13User(url!, WP518_ECON_PG_USER, "Decision Economics V2");
      sql = postgres(url!, { max: 1 });
    });

    beforeEach(async () => {
      await cleanupDecisionEconomicsV2(sql, orgId);
    });

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupDecisionEconomicsV2(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
      await cleanupWp13Org(url!, WP518_ECON_PG_USER);
    });

    it("persists immutable economics evidence and roundtrips EV fields", async () => {
      const forecastId = "00000000-0000-4000-8000-000000000010";
      const record = buildDecisionEconomicsV2Record({
        organizationId: orgId,
        forecastId,
        notionalUsdt: 10_000,
        costRate: 0.001,
        slippageBufferUsdt: 5,
        replicaSamples: [
          [
            [0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          ],
        ],
        scientificAdmissionReceiptDigest: "a".repeat(64),
        scientificAdmissionVerified: true,
      });
      await persistDecisionEconomicsV2(sql, record);

      const rows = await sql<
        {
          content_digest: string;
          ev_lower: string;
          ev_base: string;
          ev_upper: string;
          decision_actionable: boolean;
        }[]
      >`
        SELECT content_digest, ev_lower, ev_base, ev_upper, decision_actionable
        FROM trader_intelligence_decision_economics_v2
        WHERE organization_id = ${orgId}::uuid AND forecast_id = ${forecastId}::uuid
      `;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.content_digest).toBe(record.contentDigest);
      const roundtrip = decisionEvRangeFromRecord(record);
      expect(rows[0]?.ev_lower).toBe(roundtrip.evLowerScale8);
      expect(rows[0]?.ev_base).toBe(roundtrip.evBaseScale8);
      expect(rows[0]?.ev_upper).toBe(roundtrip.evUpperScale8);
      expect(rows[0]?.decision_actionable).toBe(record.decisionActionable);
    });
  },
);
