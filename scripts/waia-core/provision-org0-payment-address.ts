/**
 * BP-9A Step 9A — Org-0 payment address registry provisioning (operator CLI).
 *
 * Registers a Tron mainnet public address via PaymentAddressService (event-sourced).
 * Never accepts or stores private keys / seed phrases.
 *
 * Usage:
 *   DATABASE_URL_POSTGRES=... WAIA_POSTGRES_CLI=1 node --import tsx --conditions=react-server \
 *     scripts/waia-core/provision-org0-payment-address.ts \
 *     --address=TSBJRw... --organization-id=3c50b4e9-...
 *
 * Optional:
 *   --dry-run   Validate inputs and resolve exchange_account_id only
 */

import { eq } from "drizzle-orm";

import { withWaiaPostgresClient } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  createPostgresPaymentAddressInboundResolver,
  createPostgresPaymentAddressService,
} from "@/lib/waia-core/payment-addresses";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

const NETWORK = "TRC-20" as const;
const WALLET_LABEL = "WAIA Org-0 Payment";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((a) => a.startsWith(prefix))
    ?.slice(prefix.length)
    ?.trim();
}

function addressPrefix(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 8)}…`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const address = parseArg("address");
  const organizationId = parseArg("organization-id") ?? "3c50b4e9-1138-43a5-a29f-e65088124cfc";

  if (!address || !address.startsWith("T") || address.length < 30) {
    throw new Error("[bp-9a] --address=<Tron T-address> is required");
  }

  await withWaiaPostgresClient(async (_sql, db) => {
    const credRows = await db
      .select({
        exchangeAccountId: pgSchema.exchangeCredentials.exchangeAccountId,
        status: pgSchema.exchangeCredentials.status,
      })
      .from(pgSchema.exchangeCredentials)
      .where(eq(pgSchema.exchangeCredentials.organizationId, organizationId))
      .limit(1);

    const credential = credRows[0];
    if (!credential?.exchangeAccountId) {
      throw new Error("[bp-9a] Org-0 exchange_credentials row with exchange_account_id not found");
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            organizationId,
            exchangeAccountIdPrefix: credential.exchangeAccountId.slice(0, 8),
            addressPrefix: addressPrefix(address),
            network: NETWORK,
          },
          null,
          2,
        ),
      );
      return;
    }

    const pgDb = db as WaiaPostgresDb;
    const service = createPostgresPaymentAddressService(pgDb, {}, pgDb);
    const context = requireOrgContext(organizationId);

    const wallet = await service.createWallet(context, {
      walletKind: "DEPOSIT",
      custodyModel: "ORGANIZATION",
      controlModel: "operator-tronlink-single-signer",
      providerRef: "tronlink:WAIA Org-0 Payment",
      derivationScheme: null,
      status: "active",
    });

    const generated = await service.generateAddress(context, {
      walletId: wallet.id,
      network: NETWORK,
      address,
      reason: "BP-9A first production inbound payment address for Org-0",
    });

    const assigned = await service.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: credential.exchangeAccountId,
      reason: "Org-0 HTX supervised billing account scope",
    });

    const activated = await service.activateAddress(context, {
      addressId: assigned.addressId,
    });

    const resolver = createPostgresPaymentAddressInboundResolver(pgDb);
    const resolved = await resolver.resolveOwnerByDepositAddress(NETWORK, address);

    const eventRows = await db
      .select({
        eventType: pgSchema.paymentAddressEvents.eventType,
        seq: pgSchema.paymentAddressEvents.seq,
      })
      .from(pgSchema.paymentAddressEvents)
      .where(eq(pgSchema.paymentAddressEvents.addressId, activated.addressId))
      .orderBy(pgSchema.paymentAddressEvents.seq);

    console.log(
      JSON.stringify(
        {
          ok: true,
          walletId: wallet.id,
          addressId: activated.addressId,
          network: activated.network,
          status: activated.status,
          walletKind: wallet.walletKind,
          custodyModel: wallet.custodyModel,
          subjectModule: activated.subjectModule,
          subjectRefPrefix: activated.subjectRef?.slice(0, 8) ?? null,
          addressPrefix: addressPrefix(address),
          walletLabel: WALLET_LABEL,
          eventTypes: eventRows.map((r) => r.eventType),
          resolver: resolved
            ? {
                organizationId: resolved.organizationId,
                status: resolved.status,
                subjectModule: resolved.subjectModule,
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
  console.error(
    "[bp-9a:provision-org0-payment-address] FAIL:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
