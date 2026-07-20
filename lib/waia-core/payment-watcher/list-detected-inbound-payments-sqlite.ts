import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, like } from "drizzle-orm";

import { paymentEvents, payments } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

export type DetectedInboundPaymentRow = {
  paymentId: string;
  organizationId: string;
  idempotencyKey: string;
  createdAt: Date;
};

export function listDetectedInboundPaymentsSqlite(db: WaiaDb): DetectedInboundPaymentRow[] {
  const prefix = `${CANONICAL_NETWORK}:`;
  const rows = db
    .select({
      paymentId: payments.paymentId,
      organizationId: payments.organizationId,
      idempotencyKey: paymentEvents.idempotencyKey,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(paymentEvents, eq(paymentEvents.paymentId, payments.paymentId))
    .where(
      and(
        eq(payments.status, "DETECTED"),
        eq(paymentEvents.seq, 1),
        like(paymentEvents.idempotencyKey, `${prefix}%`),
      ),
    )
    .all();

  return rows
    .filter((row): row is typeof row & { idempotencyKey: string } => Boolean(row.idempotencyKey))
    .map((row) => ({
      paymentId: row.paymentId,
      organizationId: row.organizationId,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    }));
}
