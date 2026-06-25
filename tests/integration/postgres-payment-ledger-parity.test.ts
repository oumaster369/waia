/**
 * DEE-312 — payment ledger repository Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  createPostgresPaymentService,
  IllegalPaymentTransitionError,
  PaymentAttributionRequiredError,
  verifyPaymentEventChain,
} from "@/lib/waia-core/payments";
import { listPaymentEventsForPaymentPostgres } from "@/lib/waia-core/payments/payment-events-repository-postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000312p1";
const INVOICE_ID = "invoice-312-pg";

const SETTLEMENT = {
  settlementNetwork: "TRC20",
  settlementAsset: "USDT",
  settlementAmount: "150.00",
  settlementTxHash: "312abc-pg-tx",
  transferIndex: 0,
  confirmationsRequired: 20,
  confirmationsObserved: 20,
  blockHeight: "12345",
  observedAt: new Date("2026-06-25T10:00:00.000Z"),
  confirmedAt: new Date("2026-06-25T10:05:00.000Z"),
  valuedAmountUsd: "150.00",
  valuationSource: "usdt_usd_peg.v1",
  valuationAt: new Date("2026-06-25T10:05:01.000Z"),
  evidenceRef: "watcher://312-pg",
};

describe.skipIf(!integrationEnabled || !url)("postgres payment ledger parity (DEE-312 S1)", () => {
  let orgA: string;
  let service: ReturnType<typeof createPostgresPaymentService>;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`DELETE FROM payment_events WHERE organization_id = $1`, [orgA]);
      await sql.unsafe(`DELETE FROM payments WHERE organization_id = $1`, [orgA]);
      await sql.unsafe(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgA]);
      await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgA]);
      await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgA]);
      await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  beforeAll(async () => {
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
      displayName: "Payment Ledger Postgres Parity",
    });
    service = createPostgresPaymentService(db, {}, db);
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("detects, confirms, rebuilds, and verifies hash chain", async () => {
    await cleanup();
    const context = requireOrgContext(orgA);
    const db = getPostgresDrizzle();

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-pg-312-1",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });
    expect(detected.status).toBe("DETECTED");

    const idempotent = await service.detectPayment(context, {
      idempotencyKey: "detect-pg-312-1",
      subjectModule: "trader",
      subjectInvoiceId: INVOICE_ID,
    });
    expect(idempotent.paymentId).toBe(detected.paymentId);

    const confirmed = await service.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: SETTLEMENT,
    });
    expect(confirmed.status).toBe("CONFIRMED");

    const rebuilt = await service.rebuildProjection(context, detected.paymentId);
    expect(rebuilt.lastEventDigest).toBe(confirmed.lastEventDigest);

    const events = await listPaymentEventsForPaymentPostgres(db, context, detected.paymentId);
    verifyPaymentEventChain(events);

    await expect(
      service.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: SETTLEMENT,
      }),
    ).rejects.toThrow(IllegalPaymentTransitionError);
  });

  it("requires attribution before confirmation", async () => {
    const context = requireOrgContext(orgA);

    const detected = await service.detectPayment(context, {
      idempotencyKey: "detect-pg-312-unattributed",
      subjectModule: "trader",
      subjectInvoiceId: null,
    });

    await expect(
      service.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: {
          ...SETTLEMENT,
          settlementTxHash: "312abc-unattributed-pg-2",
        },
      }),
    ).rejects.toThrow(PaymentAttributionRequiredError);
  });
});
