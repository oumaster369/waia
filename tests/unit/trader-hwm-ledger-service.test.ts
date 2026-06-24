import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderHwmLedger } from "@/db/schema";
import {
  createSqliteHwmLedgerService,
  HwmLedgerDigestMismatchError,
  verifyHwmLedgerRecordDigest,
} from "@/lib/trader/billing";
import { insertHwmLedgerEntrySqlite } from "@/lib/trader/billing/hwm-ledger-repository-adapters";
import { buildHwmLedgerRecordPayload } from "@/lib/trader/billing/serialize-hwm-ledger";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000307s";
const EXCHANGE_ACCOUNT_ID = "htx-paper-307-service";

const EFFECTIVE_AT = new Date("2026-06-01T00:00:00.000Z");

describe("HWM ledger service (DEE-307 S3)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-hwm-service-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "hwm-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "hwm-service@waia.invalid",
      password: "password123",
      identityLabel: "HWM Service User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "HWM Service User",
    });
  });

  it("bootstraps and emits audit", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const bootstrapped = await service.bootstrapHwm(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      initialHwm: "10000.00",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: EFFECTIVE_AT,
    });

    expect(bootstrapped.entryType).toBe("BOOTSTRAP");
    verifyHwmLedgerRecordDigest(bootstrapped);

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.hwmBootstrapped))
      .all();
    const audit = audits.find((row) => row.entityId === bootstrapped.id);
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe(traderEntityTypes.hwmLedger);
  });

  it("ratchets and emits audit", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const ratcheted = await service.recordHwmRatchet(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      newHwm: "12000.00",
      sourcePeriodId: "period-service-307",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-06-30T23:59:59.000Z"),
    });

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.hwmRatcheted))
      .all();
    const audit = audits.find((row) => row.entityId === ratcheted.id);
    expect(audit).toBeDefined();
  });

  it("rejects tampered persisted digest on read", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const payload = buildHwmLedgerRecordPayload({
      organizationId,
      exchangeAccountId: "htx-paper-307-tamper",
      entryType: "BOOTSTRAP",
      highWaterMark: "5000.00",
      previousHighWaterMark: null,
      sourcePeriodId: null,
      sourceInvoiceId: null,
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: EFFECTIVE_AT,
      reason: null,
    });

    const inserted = insertHwmLedgerEntrySqlite(db, context, { payload });
    db.update(traderHwmLedger)
      .set({ recordContentDigest: "deadbeef" })
      .where(eq(traderHwmLedger.id, inserted.id))
      .run();

    await expect(service.getCurrentHwm(context, "htx-paper-307-tamper")).rejects.toThrow(
      HwmLedgerDigestMismatchError,
    );
  });
});
