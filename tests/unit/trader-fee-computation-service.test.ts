import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { traderHwmLedger, traderReportingPeriods } from "@/db/schema";
import {
  FeeComputationHwmNotBootstrappedError,
  FeeComputationPeriodNotClosedError,
  FeeComputationRealizedPnlMissingError,
  createSqliteFeeComputationService,
  createSqliteHwmLedgerService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { insertOpenReportingPeriodSqlite } from "@/lib/trader/billing/repository-adapters";
import { buildReportingPeriodRecordPayload } from "@/lib/trader/billing/serialize-reporting-period";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000309";
const EXCHANGE_ACCOUNT_ID = "htx-paper-309-service";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");

describe("fee computation service (DEE-309 S4)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-fee-computation-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "fee-computation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "fee-computation@waia.invalid",
      password: "password123",
      identityLabel: "Fee Computation User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Fee Computation User",
    });
  });

  async function bootstrapZeroHwm(exchangeAccountId = EXCHANGE_ACCOUNT_ID) {
    const db = getDb();
    const hwmService = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const existing = await hwmService.getCurrentHwm(context, exchangeAccountId);
    if (existing) {
      return;
    }

    await hwmService.bootstrapHwm(context, {
      exchangeAccountId,
      initialHwm: "0",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  async function openAndClosePeriod(
    exchangeAccountId: string,
    options: {
      month: number;
      realizedPnl: string;
      unrealizedPnl?: string;
      netDeposits?: string;
      netWithdrawals?: string;
    },
  ) {
    const db = getDb();
    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    const month = String(options.month).padStart(2, "0");
    const periodStart = new Date(`2026-${month}-01T00:00:00.000Z`);
    const periodEnd = new Date(`2026-${month}-28T23:59:59.000Z`);
    const startingSnapshotAt = new Date(`2026-${month}-01T00:05:00.000Z`);
    const endingSnapshotAt = new Date(`2026-${month}-28T23:55:00.000Z`);

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId,
      periodStart,
      startingEquity: "10000.00",
      openPositionsSnapshotRef: `paper-positions:${periodStart.toISOString()}`,
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt,
    });

    return lifecycle.closeReportingPeriod(context, {
      exchangeAccountId,
      periodEnd,
      endingEquity: "10100.00",
      endingSnapshotAt,
      realizedPnl: options.realizedPnl,
      unrealizedPnl: options.unrealizedPnl ?? "0",
      netDeposits: options.netDeposits,
      netWithdrawals: options.netWithdrawals,
    });
  }

  it("computes fee for a closed period with bootstrapped HWM", async () => {
    const db = getDb();
    await bootstrapZeroHwm();

    const closed = await openAndClosePeriod(EXCHANGE_ACCOUNT_ID, {
      month: 1,
      realizedPnl: "100.00",
    });
    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);

    const artifact = await service.computeFeeForPeriod(context, {
      periodId: closed.id,
      realizedFillFinality: true,
      computedAt: FIXED_AT,
    });

    expect(artifact.periodRealizedStrategyProfit).toBe("100.00");
    expect(artifact.cumulativeRealizedStrategyProfit).toBe("100");
    expect(artifact.previousHighWaterMark).toBe("0");
    expect(artifact.newProfitAboveHwm).toBe("100");
    expect(artifact.performanceFee).toBe("30");
    expect(artifact.proposedNewHighWaterMark).toBe("100");
    expect(artifact.billable).toBe(true);
    expect(artifact.unrealizedPnl).toBe("0");
    expect(artifact.realizedFillFinality).toBe(true);
    expect(artifact.computedAt).toEqual(FIXED_AT);
  });

  it("fails closed when realized_pnl is null on a closed period row", async () => {
    const db = getDb();
    const context = requireOrgContext(organizationId);

    const payload = buildReportingPeriodRecordPayload({
      organizationId,
      exchangeAccountId: "htx-paper-309-null-rsp",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-31T23:59:59.000Z"),
      startingEquity: "10000.00",
      endingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:null",
      realizedPnl: null,
      unrealizedPnl: "0",
      netDeposits: "0",
      netWithdrawals: "0",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date("2026-05-01T00:05:00.000Z"),
      endingSnapshotAt: new Date("2026-05-31T23:55:00.000Z"),
      status: "CLOSED",
    });

    const inserted = insertOpenReportingPeriodSqlite(db, context, { payload });
    db.update(traderReportingPeriods)
      .set({ status: "CLOSED", realizedPnl: null })
      .where(eq(traderReportingPeriods.id, inserted.id))
      .run();

    await bootstrapZeroHwm("htx-paper-309-null-rsp");
    const service = createSqliteFeeComputationService(db);

    await expect(service.computeFeeForPeriod(context, { periodId: inserted.id })).rejects.toThrow(
      FeeComputationRealizedPnlMissingError,
    );
  });

  it("fails closed for non-CLOSED periods", async () => {
    const db = getDb();
    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);

    await bootstrapZeroHwm("htx-paper-309-open");

    const open = await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: "htx-paper-309-open",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      startingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:open",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date("2026-08-01T00:05:00.000Z"),
    });

    await expect(service.computeFeeForPeriod(context, { periodId: open.id })).rejects.toThrow(
      FeeComputationPeriodNotClosedError,
    );
  });

  it("fails closed when HWM bootstrap is missing", async () => {
    const db = getDb();
    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: "htx-paper-309-no-hwm",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      startingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:no-hwm",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date("2026-09-01T00:05:00.000Z"),
    });

    const closed = await lifecycle.closeReportingPeriod(context, {
      exchangeAccountId: "htx-paper-309-no-hwm",
      periodEnd: new Date("2026-09-30T23:59:59.000Z"),
      endingEquity: "10100.00",
      endingSnapshotAt: new Date("2026-09-30T23:55:00.000Z"),
      realizedPnl: "50.00",
      unrealizedPnl: "0",
    });

    await expect(service.computeFeeForPeriod(context, { periodId: closed.id })).rejects.toThrow(
      FeeComputationHwmNotBootstrappedError,
    );
  });

  it("does not write to HWM ledger or reporting periods", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-309-no-write");
    const closed = await openAndClosePeriod("htx-paper-309-no-write", {
      month: 2,
      realizedPnl: "75.00",
    });

    const hwmCountBefore = db.select().from(traderHwmLedger).all().length;
    const periodCountBefore = db.select().from(traderReportingPeriods).all().length;

    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);

    await service.computeFeeForPeriod(context, {
      periodId: closed.id,
      computedAt: FIXED_AT,
    });

    expect(db.select().from(traderHwmLedger).all().length).toBe(hwmCountBefore);
    expect(db.select().from(traderReportingPeriods).all().length).toBe(periodCountBefore);
  });

  it("is invariant to deposits and withdrawals for identical cumulative RSP", async () => {
    const db = getDb();
    const hwmService = createSqliteHwmLedgerService(db);
    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);
    const accountId = "htx-paper-309-deposit";

    await bootstrapZeroHwm(accountId);

    const baseline = await openAndClosePeriod(accountId, {
      month: 3,
      realizedPnl: "100.00",
      netDeposits: "0",
      netWithdrawals: "0",
    });

    await hwmService.recordHwmRatchet(context, {
      exchangeAccountId: accountId,
      newHwm: "100.00",
      sourcePeriodId: baseline.id,
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-03-28T23:59:59.000Z"),
    });

    const withCapitalMovement = await openAndClosePeriod(accountId, {
      month: 4,
      realizedPnl: "100.00",
      netDeposits: "5000.00",
      netWithdrawals: "250.00",
    });

    const capitalMovementArtifact = await service.computeFeeForPeriod(context, {
      periodId: withCapitalMovement.id,
      computedAt: FIXED_AT,
    });

    expect(capitalMovementArtifact.cumulativeRealizedStrategyProfit).toBe("200");
    expect(capitalMovementArtifact.newProfitAboveHwm).toBe("100");
    expect(capitalMovementArtifact.performanceFee).toBe("30");
    expect(capitalMovementArtifact.billable).toBe(true);
  });

  it("recomputes multi-period cumulative RSP with ratcheted HWM without double-charge", async () => {
    const db = getDb();
    const hwmService = createSqliteHwmLedgerService(db);
    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);
    const accountId = "htx-paper-309-sequence";

    await bootstrapZeroHwm(accountId);

    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const rspSequence = ["100", "-40", "30", "50"] as const;
    const expectedBases = ["100", "0", "0", "40"] as const;
    const closedPeriods = [];

    for (let index = 0; index < rspSequence.length; index += 1) {
      const month = String(index + 1).padStart(2, "0");

      await lifecycle.openReportingPeriod(context, {
        exchangeAccountId: accountId,
        periodStart: new Date(`2026-${month}-01T00:00:00.000Z`),
        startingEquity: "10000.00",
        openPositionsSnapshotRef: `paper-positions:seq-${index + 1}`,
        valuationSource: "paper_pnl_read_model.v1",
        startingSnapshotAt: new Date(`2026-${month}-01T00:05:00.000Z`),
      });

      closedPeriods.push(
        await lifecycle.closeReportingPeriod(context, {
          exchangeAccountId: accountId,
          periodEnd: new Date(`2026-${month}-28T23:59:59.000Z`),
          endingEquity: "10100.00",
          endingSnapshotAt: new Date(`2026-${month}-28T23:55:00.000Z`),
          realizedPnl: rspSequence[index],
          unrealizedPnl: "0",
        }),
      );

      const artifact = await service.computeFeeForPeriod(context, {
        periodId: closedPeriods[index]!.id,
        computedAt: FIXED_AT,
      });

      expect(artifact.newProfitAboveHwm).toBe(expectedBases[index]);

      if (index === 0) {
        await hwmService.recordHwmRatchet(context, {
          exchangeAccountId: accountId,
          newHwm: artifact.proposedNewHighWaterMark,
          sourcePeriodId: closedPeriods[index]!.id,
          valuationSource: "paper_pnl_read_model.v1",
          effectiveAt: new Date("2026-01-28T23:59:59.000Z"),
        });
      }
    }
  });

  it("is idempotent and does not mutate state on repeated execution", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-309-idempotent");
    const closed = await openAndClosePeriod("htx-paper-309-idempotent", {
      month: 5,
      realizedPnl: "88.00",
    });

    const service = createSqliteFeeComputationService(db);
    const context = requireOrgContext(organizationId);
    const input = { periodId: closed.id, computedAt: FIXED_AT, realizedFillFinality: true };

    const hwmCountBefore = db.select().from(traderHwmLedger).all().length;
    const first = await service.computeFeeForPeriod(context, input);
    const second = await service.computeFeeForPeriod(context, input);

    expect(first).toEqual(second);
    expect(db.select().from(traderHwmLedger).all().length).toBe(hwmCountBefore);
  });
});
