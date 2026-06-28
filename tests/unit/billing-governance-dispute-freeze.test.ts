import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { traderAccountStatus } from "@/db/schema";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { createSqliteBillingGovernanceService } from "@/lib/trader/billing";
import { createSqliteAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-sqlite";
import { DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS } from "@/lib/trader/settlement/account-status-policy";
import { createSqliteOverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader-sqlite";
import { runOverdueSuspensionCycle } from "@/lib/trader/settlement/run-overdue-suspension-cycle";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { insertIssuedInvoiceWithDigest } from "@/tests/helpers/billing-governance-invoice-fixture";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000003216";
const EXCHANGE_ACCOUNT_ID = "htx-dispute-freeze";
const OPERATOR_ID = "00000000-0000-4000-8000-00000009998";
const CYCLE_NOW = new Date("2026-06-27T12:00:00.000Z");
const OVERDUE_ISSUED_AT = new Date(
  CYCLE_NOW.getTime() - DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS - 24 * 60 * 60 * 1000,
);

let organizationId: string;
let overdueInvoiceId: string;

describe("billing governance dispute freeze vs overdue suspension (sqlite)", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-dispute-freeze-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "dispute-freeze.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "dispute-freeze@waia.invalid",
      password: "password123",
      identityLabel: "Dispute Freeze User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Dispute Freeze User",
    });
    overdueInvoiceId = insertIssuedInvoiceWithDigest(
      db,
      organizationId,
      EXCHANGE_ACCOUNT_ID,
      OVERDUE_ISSUED_AT,
      { issuedBy: USER_ID },
    );
  });

  it("skips suspension while invoice dispute is OPEN, then suspends after upheld resolution", async () => {
    const db = getDb();
    const context = requireOrgContext(organizationId);
    const governance = createSqliteBillingGovernanceService(db);

    await governance.openInvoiceDispute(context, {
      invoiceId: overdueInvoiceId,
      reason: "Dispute freezes enforcement",
      openedBy: OPERATOR_ID,
    });

    const frozenReport = await runOverdueSuspensionCycle({
      overdueInvoicesReader: createSqliteOverdueInvoicesReader(db),
      accountStatusRepository: createSqliteAccountStatusRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
      logger: { log: () => undefined },
      now: () => CYCLE_NOW,
    });
    expect(frozenReport.suspended).toBe(0);

    const dispute = await governance.findOpenDisputeForInvoice(context, overdueInvoiceId);
    expect(dispute?.status).toBe("OPEN");

    await governance.resolveInvoiceDisputeUpheld(context, {
      disputeId: dispute!.id,
      resolutionReason: "Invoice verified after review",
      actorId: OPERATOR_ID,
    });

    const afterReport = await runOverdueSuspensionCycle({
      overdueInvoicesReader: createSqliteOverdueInvoicesReader(db),
      accountStatusRepository: createSqliteAccountStatusRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
      logger: { log: () => undefined },
      now: () => CYCLE_NOW,
    });
    expect(afterReport.suspended).toBe(1);

    const status = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationId),
          eq(traderAccountStatus.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .get();
    expect(status?.status).toBe("SUSPENDED");
  });
});
