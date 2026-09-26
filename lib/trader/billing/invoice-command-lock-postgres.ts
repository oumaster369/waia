import { enforceServerOnly } from "@/lib/enforce-server-only";
import { HwmLedgerNotBootstrappedError } from "@/lib/trader/billing/hwm-ledger.errors";
import { sql } from "drizzle-orm";
import type { WaiaPostgresTransactionCallback } from "@/db/waia-postgres-transaction";

enforceServerOnly();

type Transaction = Parameters<WaiaPostgresTransactionCallback<unknown>>[0];

/** After locking the scoped invoice, coordinate the two administrative command
 * surfaces on the stable bootstrap row. A latest-HWM row is not a stable mutex:
 * every successful issuance appends a different row. This does not serialize
 * independent correction writers that do not participate in this protocol.
 * Subsequent service reads use the command's READ COMMITTED transaction. */
export async function lockInvoiceCommandAccountPostgres(
  tx: Transaction,
  organizationId: string,
  exchangeAccountId: string,
): Promise<void> {
  const rows = await tx.execute(sql`SELECT id FROM trader_hwm_ledger
    WHERE organization_id = ${organizationId}::uuid
      AND exchange_account_id = ${exchangeAccountId} AND entry_type = 'BOOTSTRAP'
    ORDER BY id FOR UPDATE`);
  if (rows.length !== 1) throw new HwmLedgerNotBootstrappedError(exchangeAccountId);
}
