import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import {
  createSqlitePaymentService,
  IllegalPaymentTransitionError,
  PaymentAttributionRequiredError,
  PaymentSettlementAlreadyAttributedError,
  paymentAuditActions,
  paymentEntityTypes,
} from "@/lib/waia-core/payments";
import { deletePaymentProjectionByIdSqlite } from "@/lib/waia-core/payments/payment-repository-adapters";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000312s";
const INVOICE_ID = "invoice-312-service";

const SETTLEMENT = {
  settlementNetwork: "TRC20",
  settlementAsset: "USDT",
  settlementAmount: "150.00",
  settlementTxHash: "312abc-service-tx",
  transferIndex: 0,
  confirmationsRequired: 20,
  confirmationsObserved: 20,
  blockHeight: "12345",
  observedAt: new Date("2026-06-25T10:00:00.000Z"),
  confirmedAt: new Date("2026-06-25T10:05:00.000Z"),
  valuedAmountUsd: "150.00",
  valuationSource: "usdt_usd_peg.v1",
  valuationAt: new Date("2026-06-25T10:05:01.000Z"),
  evidenceRef: "watcher://312-service",
};

describe("payment service (DEE-312 S1)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-payment-service-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "payment-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "payment-service@waia.invalid",
      password: "password123",
      identityLabel: "Payment Service User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Payment Service User",
    });
  });

  it("detects, confirms, and emits audit rows", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-1",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });

    expect(detected.status).toBe("DETECTED");
    expect(detected.subjectInvoiceId).toBe(INVOICE_ID);

    const confirmed = await service.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: SETTLEMENT,
    });

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.settlementTxHash).toBe(SETTLEMENT.settlementTxHash);

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, detected.paymentId))
      .all();
    expect(audits.some((row) => row.action === paymentAuditActions.paymentDetected)).toBe(true);
    expect(audits.some((row) => row.action === paymentAuditActions.paymentConfirmed)).toBe(true);
    expect(audits.every((row) => row.entityType === paymentEntityTypes.payment)).toBe(true);
  });

  it("returns the same payment on idempotent detect", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const first = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-idem",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });
    const second = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-idem",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });

    expect(second.paymentId).toBe(first.paymentId);
  });

  it("fails payment from DETECTED and blocks illegal transitions", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-fail",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });

    const failed = await service.failPayment(context, {
      paymentId: detected.paymentId,
      reason: "DROPPED",
    });
    expect(failed.status).toBe("FAILED");

    await expect(
      service.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: {
          ...SETTLEMENT,
          settlementTxHash: "312abc-fail-blocked",
        },
      }),
    ).rejects.toThrow(IllegalPaymentTransitionError);
  });

  it("requires attribution before confirmation (fail-uncertain)", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-unattributed",
      subjectModule: "trader",
      subjectInvoiceId: null,
    });

    await expect(
      service.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: {
          ...SETTLEMENT,
          settlementTxHash: "312abc-unattributed",
        },
      }),
    ).rejects.toThrow(PaymentAttributionRequiredError);
  });

  it("blocks double attribution of the same settlement transfer", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const first = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-settle-a",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });
    await service.confirmPayment(context, {
      paymentId: first.paymentId,
      settlement: {
        ...SETTLEMENT,
        settlementTxHash: "312abc-double-attrib",
      },
    });

    const second = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-settle-b",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });

    await expect(
      service.confirmPayment(context, {
        paymentId: second.paymentId,
        settlement: {
          ...SETTLEMENT,
          settlementTxHash: "312abc-double-attrib",
        },
      }),
    ).rejects.toThrow(PaymentSettlementAlreadyAttributedError);
  });

  it("rebuilds projection after projection row deletion", async () => {
    const db = getDb();
    const service = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-service-312-rebuild",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });
    const confirmed = await service.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: {
        ...SETTLEMENT,
        settlementTxHash: "312abc-rebuild",
      },
    });

    deletePaymentProjectionByIdSqlite(db, context, confirmed.paymentId);
    expect(await service.getPayment(context, confirmed.paymentId)).toBeNull();

    const rebuilt = await service.rebuildProjection(context, confirmed.paymentId);
    expect(rebuilt).toMatchObject({
      paymentId: confirmed.paymentId,
      status: "CONFIRMED",
      settlementTxHash: "312abc-rebuild",
      lastEventSeq: confirmed.lastEventSeq,
      lastEventDigest: confirmed.lastEventDigest,
    });
  });

  it("blocks UPDATE on append-only payment_events", () => {
    const db = getDb();
    const sqlite = (db as unknown as { session: { client: { exec: (sql: string) => void } } })
      .session.client;
    expect(() =>
      sqlite.exec(`UPDATE payment_events SET event_type = 'FAILED' WHERE seq = 1`),
    ).toThrow(/append-only/i);
  });
});
