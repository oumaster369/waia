/**
 * AT-E12 S3-B — settlement ledger Postgres append-only + service parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresPaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { createPostgresSettlementService } from "@/lib/trader/settlement/settlement-service";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000312s3";
const EXCHANGE_ACCOUNT_ID = "htx-settlement-s3b-pg";
const PERFORMANCE_FEE = "150.000000";

describe.skipIf(!integrationEnabled || !url)("postgres settlement parity (AT-E12 S3-B)", () => {
  let orgA: string;

  async function cleanup(): Promise<void> {
    const orgId = personalOrganizationIdFromUserId(USER_A);
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`DELETE FROM trader_settlement_applications WHERE organization_id = $1`, [
        orgId,
      ]);
      await sql.unsafe(`DELETE FROM trader_settlements WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_invoices WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM payment_events WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM payments WHERE organization_id = $1`, [orgId]);
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
      displayName: "Settlement Postgres Parity",
    });
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("trader_settlements is append-only — UPDATE rejected by DB trigger", async () => {
    const db = getPostgresDrizzle();
    const context = requireOrgContext(orgA);
    const paymentService = createPostgresPaymentService(db, {}, db);
    const settlementService = createPostgresSettlementService(db, {}, db);

    const detected = await paymentService.detectPayment(context, {
      idempotencyKey: "pg-settlement-append-only",
      subjectModule: "trader",
    });
    const transfer = {
      txHash: "pg-settlement-append-only-tx",
      transferIndex: 0,
      toAddress: "TPgSettlement",
      fromAddress: "TSenderPg",
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      amountRaw: "150000000",
      amountDecimal: PERFORMANCE_FEE,
      blockHeight: "200",
      blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
      confirmationsObserved: 21,
    };
    const confirmed = await paymentService.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T10:05:00.000Z")),
    });

    const settlement = await settlementService.applySettlementForPayment(context, {
      paymentId: confirmed.paymentId,
      organizationId: orgA,
      subjectModule: "trader",
      settlementNetwork: confirmed.settlementNetwork,
      settlementAsset: confirmed.settlementAsset,
      settlementAmount: confirmed.settlementAmount,
      settlementTxHash: confirmed.settlementTxHash,
      transferIndex: confirmed.transferIndex,
      blockHeight: transfer.blockHeight,
      paymentAddressId: null,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: confirmed.updatedAt,
    });

    await expect(
      db
        .update(pgSchema.traderSettlements)
        .set({ outcome: "APPLIED" })
        .where(eq(pgSchema.traderSettlements.id, settlement.id)),
    ).rejects.toThrow(/append-only/i);
  });
});
