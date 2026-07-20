/**
 * BP-9A Step 9A — verify Org-0 payment address registry (read-only).
 */

import { eq } from "drizzle-orm";

import { withWaiaPostgresClient } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresPaymentAddressInboundResolver } from "@/lib/waia-core/payment-addresses";

const ORG = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const ADDRESS = process.argv
  .find((a) => a.startsWith("--address="))
  ?.split("=")[1]
  ?.trim();

async function main(): Promise<void> {
  if (!ADDRESS) {
    throw new Error("--address required");
  }

  await withWaiaPostgresClient(async (_sql, db) => {
    const wallets = await db
      .select()
      .from(pgSchema.paymentWallets)
      .where(eq(pgSchema.paymentWallets.organizationId, ORG));

    const addresses = await db
      .select()
      .from(pgSchema.paymentAddresses)
      .where(eq(pgSchema.paymentAddresses.organizationId, ORG));

    const events = await db
      .select({
        seq: pgSchema.paymentAddressEvents.seq,
        eventType: pgSchema.paymentAddressEvents.eventType,
        addressId: pgSchema.paymentAddressEvents.addressId,
      })
      .from(pgSchema.paymentAddressEvents)
      .where(eq(pgSchema.paymentAddressEvents.organizationId, ORG))
      .orderBy(pgSchema.paymentAddressEvents.seq);

    const audit = await db
      .select({
        action: pgSchema.auditLogs.action,
        entityType: pgSchema.auditLogs.entityType,
        entityId: pgSchema.auditLogs.entityId,
      })
      .from(pgSchema.auditLogs)
      .where(eq(pgSchema.auditLogs.organizationId, ORG));

    const paymentAudit = audit.filter(
      (row) =>
        row.action.startsWith("payment_address") ||
        row.entityType === "payment_wallet" ||
        row.entityType === "payment_address",
    );

    const resolver = createPostgresPaymentAddressInboundResolver(db);
    const resolved = await resolver.resolveOwnerByDepositAddress("TRC-20", ADDRESS);

    const checkpoint = await db
      .select({
        network: pgSchema.paymentWatcherCheckpoints.network,
        cycleCount: pgSchema.paymentWatcherCheckpoints.cycleCount,
        lastScannedAt: pgSchema.paymentWatcherCheckpoints.lastScannedAt,
        lastScannedBlock: pgSchema.paymentWatcherCheckpoints.lastScannedBlock,
        leaseUntil: pgSchema.paymentWatcherCheckpoints.leaseUntil,
        lastError: pgSchema.paymentWatcherCheckpoints.lastError,
      })
      .from(pgSchema.paymentWatcherCheckpoints)
      .limit(1);

    console.log(
      JSON.stringify(
        {
          payment_wallets: {
            count: wallets.length,
            walletKind: wallets[0]?.walletKind,
            custodyModel: wallets[0]?.custodyModel,
            controlModel: wallets[0]?.controlModel,
            providerRef: wallets[0]?.providerRef,
            status: wallets[0]?.status,
            idPrefix: wallets[0]?.id.slice(0, 8),
          },
          payment_addresses: {
            count: addresses.length,
            network: addresses[0]?.network,
            status: addresses[0]?.status,
            subjectModule: addresses[0]?.subjectModule,
            subjectRefPrefix: addresses[0]?.subjectRef?.slice(0, 8),
            addressIdPrefix: addresses[0]?.addressId.slice(0, 8),
            walletIdMatches:
              addresses[0]?.walletId != null && addresses[0]?.walletId === wallets[0]?.id,
          },
          payment_address_events: {
            count: events.length,
            chain: events.map((e) => ({ seq: e.seq, eventType: e.eventType })),
          },
          audit_trail: {
            count: paymentAudit.length,
            actions: [...new Set(paymentAudit.map((a) => a.action))],
          },
          resolver: resolved,
          watcher_checkpoint: checkpoint[0]
            ? {
                network: checkpoint[0].network,
                cycleCount: checkpoint[0].cycleCount,
                lastScannedAt: checkpoint[0].lastScannedAt,
                lastScannedBlock: checkpoint[0].lastScannedBlock,
                leaseUntil: checkpoint[0].leaseUntil,
                lastError: checkpoint[0].lastError,
              }
            : null,
        },
        null,
        2,
      ),
    );
  });
}

main().catch((err: unknown) => {
  console.error("[bp-9a:verify] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
