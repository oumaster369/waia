/**
 * DEE-306 — Reporting period repository Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  createPostgresReportingPeriodLifecycleService,
  ReportingPeriodAlreadyOpenError,
  ReportingPeriodNotOpenError,
  verifyReportingPeriodRecordDigest,
} from "@/lib/trader/billing";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { ensureAuthUsersSeed } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000030601";
const EXCHANGE_ACCOUNT_ID = "htx-paper-306-pg";

const PERIOD_START = new Date("2026-06-01T00:00:00.000Z");
const STARTING_SNAPSHOT_AT = new Date("2026-06-01T00:05:00.000Z");
const PERIOD_END = new Date("2026-06-30T23:59:59.000Z");
const ENDING_SNAPSHOT_AT = new Date("2026-06-30T23:55:00.000Z");

describe.skipIf(!integrationEnabled || !url)(
  "postgres reporting period lifecycle parity (DEE-306 S2)",
  () => {
    let orgA: string;
    let service: ReturnType<typeof createPostgresReportingPeriodLifecycleService>;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await sql.unsafe(`DELETE FROM trader_reporting_periods WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgId]);
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
      await verifyHtrPostgresConnectionIdentity();
      await cleanup();
      await ensureAuthUsersSeed(url!, [USER_A]);

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "Reporting Period Postgres Parity",
      });
      service = createPostgresReportingPeriodLifecycleService(db, {}, db);
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("opens and closes a reporting period with digest verification", async () => {
      const context = requireOrgContext(orgA);

      const open = await service.openReportingPeriod(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        periodStart: PERIOD_START,
        startingEquity: "10000.00",
        openPositionsSnapshotRef: "paper-positions:2026-06-01T00:05:00.000Z",
        valuationSource: "paper_pnl_read_model.v1",
        startingSnapshotAt: STARTING_SNAPSHOT_AT,
      });

      expect(open.status).toBe("OPEN");
      verifyReportingPeriodRecordDigest(open);

      await expect(
        service.openReportingPeriod(context, {
          exchangeAccountId: EXCHANGE_ACCOUNT_ID,
          periodStart: PERIOD_START,
          startingEquity: "10000.00",
          openPositionsSnapshotRef: "paper-positions:2026-06-01T00:05:00.000Z",
          valuationSource: "paper_pnl_read_model.v1",
          startingSnapshotAt: STARTING_SNAPSHOT_AT,
        }),
      ).rejects.toThrow(ReportingPeriodAlreadyOpenError);

      const openDigest = open.recordContentDigest;
      const closed = await service.closeReportingPeriod(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        periodEnd: PERIOD_END,
        endingEquity: "11250.00",
        endingSnapshotAt: ENDING_SNAPSHOT_AT,
        realizedPnl: "800.00",
        unrealizedPnl: "450.00",
      });

      expect(closed.status).toBe("CLOSED");
      expect(closed.recordContentDigest).not.toBe(openDigest);
      verifyReportingPeriodRecordDigest(closed);

      await expect(
        service.closeReportingPeriod(context, {
          exchangeAccountId: EXCHANGE_ACCOUNT_ID,
          periodEnd: PERIOD_END,
          endingEquity: "11250.00",
          endingSnapshotAt: ENDING_SNAPSHOT_AT,
          realizedPnl: "800.00",
          unrealizedPnl: "450.00",
        }),
      ).rejects.toThrow(ReportingPeriodNotOpenError);

      const listed = await service.listClosedPeriods(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(closed.id);
    });
  },
);
