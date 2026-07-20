import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { traderAccountStatus, traderAccountStatusEvents, traderInvoices } from "@/db/schema";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { createSqliteAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-sqlite";
import { DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS } from "@/lib/trader/settlement/account-status-policy";
import { createSqliteOverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader-sqlite";
import { runOverdueSuspensionCycle } from "@/lib/trader/settlement/run-overdue-suspension-cycle";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000321e";
const USER_B = "00000000-0000-4000-8000-0000000321f";
const ACCOUNT_A = "htx-overdue-tenant-a";
const ACCOUNT_B = "htx-overdue-tenant-b";
const CYCLE_NOW = new Date("2026-06-27T12:00:00.000Z");
const OVERDUE_ISSUED_AT = new Date(
  CYCLE_NOW.getTime() - DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS - 24 * 60 * 60 * 1000,
);

let organizationA: string;
let organizationB: string;

function insertOverdueInvoice(
  db: ReturnType<typeof getDb>,
  orgId: string,
  exchangeAccountId: string,
) {
  const id = crypto.randomUUID();
  db.insert(traderInvoices)
    .values({
      id,
      organizationId: orgId,
      exchangeAccountId,
      reportingPeriodId: `period-${id.slice(0, 8)}`,
      feeArtifactDigest: "artifact-digest-tenant-test",
      status: "ISSUED",
      currency: "USD",
      periodRealizedStrategyProfit: "500.00",
      cumulativeRealizedStrategyProfit: "500.00",
      previousHighWaterMark: "0",
      newProfitAboveHwm: "500.00",
      feeRate: "0.30",
      performanceFee: "150.000000",
      proposedNewHighWaterMark: "500.00",
      billable: true,
      unrealizedPnl: "0",
      realizedFillFinality: true,
      startingEquity: "10000.00",
      endingEquity: "10500.00",
      netDeposits: "0",
      netWithdrawals: "0",
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-28T23:59:59.000Z"),
      valuationSource: "paper_pnl_read_model.v1",
      feeComputedAt: OVERDUE_ISSUED_AT,
      schemaVersion: "waia.trader.invoice.v1",
      recordContentDigest: "digest-tenant-test",
      issuanceApprovedAt: OVERDUE_ISSUED_AT,
      issuanceApprovedBy: USER_A,
      coolingOffUntil: new Date(OVERDUE_ISSUED_AT.getTime() - 24 * 60 * 60 * 1000),
      issuedAt: OVERDUE_ISSUED_AT,
      issuedBy: USER_A,
      settledAmount: "0",
      paidAt: null,
      createdAt: OVERDUE_ISSUED_AT,
      updatedAt: OVERDUE_ISSUED_AT,
    })
    .run();
  return id;
}

describe("account status overdue suspension tenant isolation (sqlite)", () => {
  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-overdue-tenant-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "overdue-tenant.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "overdue-tenant-a@waia.invalid",
      password: "password123",
      identityLabel: "Overdue Tenant A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "overdue-tenant-b@waia.invalid",
      password: "password123",
      identityLabel: "Overdue Tenant B",
    });
    organizationA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Overdue Tenant A",
    });
    organizationB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Overdue Tenant B",
    });

    insertOverdueInvoice(db, organizationA, ACCOUNT_A);
    insertOverdueInvoice(db, organizationB, ACCOUNT_B);
  });

  it("suspends only within each organization scope", async () => {
    const db = getDb();
    const accountStatusRepository = createSqliteAccountStatusRepository(db);

    const report = await runOverdueSuspensionCycle({
      overdueInvoicesReader: createSqliteOverdueInvoicesReader(db),
      accountStatusRepository,
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
      logger: { log: () => undefined },
      now: () => CYCLE_NOW,
    });

    expect(report.suspended).toBe(2);

    const statusA = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationA),
          eq(traderAccountStatus.exchangeAccountId, ACCOUNT_A),
        ),
      )
      .get();
    const statusB = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationB),
          eq(traderAccountStatus.exchangeAccountId, ACCOUNT_B),
        ),
      )
      .get();
    expect(statusA?.status).toBe("SUSPENDED");
    expect(statusB?.status).toBe("SUSPENDED");

    const orgAViewOfOrgB = await accountStatusRepository.getProjection(
      requireOrgContext(organizationA),
      ACCOUNT_B,
    );
    expect(orgAViewOfOrgB).toBeNull();

    const orgBEventsForOrgAAccount = await accountStatusRepository.listEventsForAccount(
      requireOrgContext(organizationB),
      ACCOUNT_A,
    );
    expect(orgBEventsForOrgAAccount).toHaveLength(0);

    const orgAEvents = db
      .select()
      .from(traderAccountStatusEvents)
      .where(eq(traderAccountStatusEvents.organizationId, organizationA))
      .all();
    const orgBEvents = db
      .select()
      .from(traderAccountStatusEvents)
      .where(eq(traderAccountStatusEvents.organizationId, organizationB))
      .all();
    expect(orgAEvents.every((event) => event.organizationId === organizationA)).toBe(true);
    expect(orgBEvents.every((event) => event.organizationId === organizationB)).toBe(true);
  });
});
