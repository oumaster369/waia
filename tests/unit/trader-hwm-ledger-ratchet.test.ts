import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  createSqliteHwmLedgerService,
  HwmLedgerAlreadyBootstrappedError,
  HwmLedgerNotBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
  HwmLedgerRollbackReasonRequiredError,
  verifyHwmLedgerRecordDigest,
} from "@/lib/trader/billing";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000307";
const EXCHANGE_ACCOUNT_ID = "htx-paper-307";

const BOOTSTRAP_AT = new Date("2026-06-01T00:00:00.000Z");
const RATCHET_AT = new Date("2026-06-30T23:59:59.000Z");
const ROLLBACK_AT = new Date("2026-07-01T00:00:00.000Z");

describe("HWM ledger ratchet invariants (DEE-307 S3)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-hwm-ledger-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "hwm-ledger.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "hwm-ledger@waia.invalid",
      password: "password123",
      identityLabel: "HWM Ledger User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "HWM Ledger User",
    });
  });

  function bootstrapInput(exchangeAccountId = EXCHANGE_ACCOUNT_ID) {
    return {
      exchangeAccountId,
      initialHwm: "10000.00",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: BOOTSTRAP_AT,
    };
  }

  it("returns null before bootstrap", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const current = await service.getCurrentHwm(context, "htx-paper-unbootstrapped");
    expect(current).toBeNull();
  });

  it("bootstraps with digest and records previous as null", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const bootstrapped = await service.bootstrapHwm(context, bootstrapInput());

    expect(bootstrapped.entryType).toBe("BOOTSTRAP");
    expect(bootstrapped.highWaterMark).toBe("10000.00");
    expect(bootstrapped.previousHighWaterMark).toBeNull();
    verifyHwmLedgerRecordDigest(bootstrapped);
  });

  it("rejects double bootstrap", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    await expect(service.bootstrapHwm(context, bootstrapInput())).rejects.toThrow(
      HwmLedgerAlreadyBootstrappedError,
    );
  });

  it("ratchets up when new HWM strictly exceeds current", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const ratcheted = await service.recordHwmRatchet(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      newHwm: "12000.00",
      sourcePeriodId: "period-307",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: RATCHET_AT,
    });

    expect(ratcheted.entryType).toBe("RATCHET_UP");
    expect(ratcheted.highWaterMark).toBe("12000.00");
    expect(ratcheted.previousHighWaterMark).toBe("10000.00");
    verifyHwmLedgerRecordDigest(ratcheted);
  });

  it("rejects ratchet when equal to current (drawdown recovery not met)", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.recordHwmRatchet(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        newHwm: "12000.00",
        sourcePeriodId: "period-307-drawdown",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: RATCHET_AT,
      }),
    ).rejects.toThrow(HwmLedgerRatchetNotAllowedError);
  });

  it("rejects ratchet when lower than current (drawdown)", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.recordHwmRatchet(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        newHwm: "11000.00",
        sourcePeriodId: "period-307-lower",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: RATCHET_AT,
      }),
    ).rejects.toThrow(HwmLedgerRatchetNotAllowedError);
  });

  it("rejects ratchet when not bootstrapped", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.recordHwmRatchet(context, {
        exchangeAccountId: "htx-paper-not-bootstrapped",
        newHwm: "12000.00",
        sourcePeriodId: null,
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: RATCHET_AT,
      }),
    ).rejects.toThrow(HwmLedgerNotBootstrappedError);
  });

  it("appends rollback with reason and preserves prior entries", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const beforeCount = (
      await service.listHwmLedger(context, { exchangeAccountId: EXCHANGE_ACCOUNT_ID })
    ).length;

    const rolledBack = await service.recordHwmRollback(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      restoredHwm: "10000.00",
      sourcePeriodId: "period-307-overcharge",
      reason: "Overcharge remediation per Billing §11.4",
      effectiveAt: ROLLBACK_AT,
    });

    expect(rolledBack.entryType).toBe("ROLLBACK");
    expect(rolledBack.highWaterMark).toBe("10000.00");
    expect(rolledBack.previousHighWaterMark).toBe("12000.00");
    expect(rolledBack.reason).toBe("Overcharge remediation per Billing §11.4");

    const entries = await service.listHwmLedger(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
    });
    expect(entries).toHaveLength(beforeCount + 1);
    expect(entries[0]?.entryType).toBe("ROLLBACK");
  });

  it("rejects rollback without reason", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.recordHwmRollback(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        restoredHwm: "10000.00",
        sourcePeriodId: null,
        reason: "   ",
        effectiveAt: ROLLBACK_AT,
      }),
    ).rejects.toThrow(HwmLedgerRollbackReasonRequiredError);
  });

  it("getCurrentHwm returns latest entry after rollback", async () => {
    const db = getDb();
    const service = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const current = await service.getCurrentHwm(context, EXCHANGE_ACCOUNT_ID);
    expect(current?.entryType).toBe("ROLLBACK");
    expect(current?.highWaterMark).toBe("10000.00");
  });
});
