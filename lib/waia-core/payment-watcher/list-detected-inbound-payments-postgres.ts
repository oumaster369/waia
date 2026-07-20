import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, like } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";
import type { DetectedInboundPaymentRow } from "@/lib/waia-core/payment-watcher/list-detected-inbound-payments-sqlite";

type PgDetectedExecutor = Pick<WaiaPostgresDb, "select">;

export async function listDetectedInboundPaymentsPostgres(
  ex: PgDetectedExecutor,
): Promise<DetectedInboundPaymentRow[]> {
  const prefix = `${CANONICAL_NETWORK}:`;
  const rows = await ex
    .select({
      paymentId: pgSchema.payments.paymentId,
      organizationId: pgSchema.payments.organizationId,
      idempotencyKey: pgSchema.paymentEvents.idempotencyKey,
      createdAt: pgSchema.payments.createdAt,
    })
    .from(pgSchema.payments)
    .innerJoin(
      pgSchema.paymentEvents,
      eq(pgSchema.paymentEvents.paymentId, pgSchema.payments.paymentId),
    )
    .where(
      and(
        eq(pgSchema.payments.status, "DETECTED"),
        eq(pgSchema.paymentEvents.seq, 1),
        like(pgSchema.paymentEvents.idempotencyKey, `${prefix}%`),
      ),
    );

  return rows
    .filter((row): row is typeof row & { idempotencyKey: string } => Boolean(row.idempotencyKey))
    .map((row) => ({
      paymentId: row.paymentId,
      organizationId: row.organizationId,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    }));
}
