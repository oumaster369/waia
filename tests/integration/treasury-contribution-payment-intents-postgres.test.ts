import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { matchContributionPaymentIntent } from "@/lib/waia-core/treasury/contributions/payment-intents";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const describePostgres = describe.skipIf(!enabled || !url);

const USER = "73100000-0000-4000-8000-000000000001";
const ORG = "73100000-0000-4000-8000-000000000002";
const TX = "73100000-0000-4000-8000-000000000003";
const INTENT = "73100000-0000-4000-8000-000000000004";
const ATTRIBUTION = "73100000-0000-4000-8000-000000000005";
const NOW = new Date("2026-08-27T09:00:00.000Z");
const ADDRESS = "TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD";

describePostgres("DEE-731 PostgreSQL contribution payment intents", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;

  async function cleanup() {
    await sqlClient.unsafe(
      "ALTER TABLE treasury_balance_checkpoints DISABLE TRIGGER treasury_balance_checkpoint_delete_guard",
    );
    await sqlClient.unsafe(
      "ALTER TABLE treasury_contribution_payment_intents DISABLE TRIGGER treasury_contribution_payment_intent_delete_guard",
    );
    try {
      await sqlClient`DELETE FROM treasury_contribution_attributions WHERE organization_id = ${ORG}::uuid`;
      await sqlClient`DELETE FROM treasury_contribution_payment_intents WHERE organization_id = ${ORG}::uuid`;
      await sqlClient`DELETE FROM treasury_balance_checkpoints WHERE organization_id = ${ORG}::uuid`;
    } finally {
      await sqlClient.unsafe(
        "ALTER TABLE treasury_contribution_payment_intents ENABLE TRIGGER treasury_contribution_payment_intent_delete_guard",
      );
      await sqlClient.unsafe(
        "ALTER TABLE treasury_balance_checkpoints ENABLE TRIGGER treasury_balance_checkpoint_delete_guard",
      );
    }
    await sqlClient`DELETE FROM treasury_transactions WHERE organization_id = ${ORG}::uuid`;
    await sqlClient`DELETE FROM treasury_fund_buckets WHERE organization_id = ${ORG}::uuid`;
    await sqlClient`DELETE FROM organizations WHERE id = ${ORG}::uuid`;
    await sqlClient`DELETE FROM users WHERE id = ${USER}::uuid`;
    await sqlClient.unsafe("DELETE FROM auth.users WHERE id = $1::uuid", [USER]);
  }

  beforeAll(async () => {
    sqlClient = postgres(url!, { max: 4, prepare: false });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
    await cleanup();
    await sqlClient.unsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", [USER]);
    await db.insert(pgSchema.users).values({
      id: USER,
      identityLabel: "Named patron",
      email: "dee-731@waia.invalid",
      passwordHash: null,
    });
    await db.insert(pgSchema.organizations).values({
      id: ORG,
      ownerUserId: USER,
      kind: "fund",
      name: "DEE-731 disposable integration fixture",
    });
    await db.insert(pgSchema.treasuryFundBuckets).values({
      organizationId: ORG,
      code: "UNASSIGNED",
      title: "Unassigned",
      isActive: true,
    });
    await db.insert(pgSchema.treasuryTransactions).values({
      id: TX,
      organizationId: ORG,
      status: "NEEDS_REVIEW",
      detailPublication: "PRIVATE",
      provenance: "WATCHER",
      direction: "INFLOW",
      kind: null,
      fundBucketCode: "UNASSIGNED",
      nativeAmountAtomic: 100_000_123n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      accountingAmountMicros: 100_000_123n,
      accountingDenominationPolicy: "USDT_NOMINAL_USD_POLICY_V1",
      cashEffectMicros: null,
      counterpartyIsInternal: false,
      occurredAt: NOW,
      purpose: null,
      publishCounterparty: false,
      recordContentDigest: "dee-731-needs-review-transaction",
      createdByUserId: USER,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(pgSchema.treasuryContributionPaymentIntents).values({
      id: INTENT,
      organizationId: ORG,
      contributorUserId: USER,
      displayNameSnapshot: "Named patron",
      publicSiteUrl: "https://example.com/",
      twinProfileUrl: null,
      consentPublicIdentity: true,
      requestedAmountAtomic: 100_000_000n,
      payableAmountAtomic: 100_000_123n,
      assetCode: "USDT",
      network: "TRON",
      receivingAddress: ADDRESS,
      status: "PENDING",
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      createdAt: NOW,
      updatedAt: NOW,
    });
  }, 120_000);

  afterAll(async () => {
    if (!sqlClient) return;
    await sqlClient.unsafe("RESET ROLE");
    await cleanup();
    await sqlClient.end({ timeout: 5 });
  });

  it("matches identity idempotently without verifying the transaction", async () => {
    const matched = await matchContributionPaymentIntent({
      db,
      organizationId: ORG,
      transactionId: TX,
      toAddress: ADDRESS,
      amountAtomic: 100_000_123n,
      network: "TRON",
      assetCode: "USDT",
      now: NOW,
      newId: () => ATTRIBUTION,
    });
    expect(matched).toBe(INTENT);

    const [intent] = await db.select().from(pgSchema.treasuryContributionPaymentIntents);
    const [attribution] = await db.select().from(pgSchema.treasuryContributionAttributions);
    const [transaction] = await db.select().from(pgSchema.treasuryTransactions);
    expect(intent?.status).toBe("MATCHED");
    expect(attribution).toMatchObject({
      transactionId: TX,
      contributorUserId: USER,
      status: "ATTRIBUTED",
      consentPublicIdentity: true,
      publicSiteUrl: "https://example.com/",
    });
    expect(transaction?.status).toBe("NEEDS_REVIEW");

    await expect(
      matchContributionPaymentIntent({
        db,
        organizationId: ORG,
        transactionId: TX,
        toAddress: ADDRESS,
        amountAtomic: 100_000_123n,
        network: "TRON",
        assetCode: "USDT",
        now: NOW,
        newId: () => "73100000-0000-4000-8000-000000000006",
      }),
    ).resolves.toBeNull();
  });

  it("denies direct authenticated browser-role reads", async () => {
    await sqlClient.unsafe("SET ROLE authenticated");
    try {
      await expect(sqlClient`SELECT id FROM treasury_contribution_payment_intents`).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await sqlClient.unsafe("RESET ROLE");
    }
  });

  it("keeps Human balance checkpoints append-only and hidden from browser roles", async () => {
    const checkpointId = "73100000-0000-4000-8000-000000000007";
    await db.insert(pgSchema.treasuryBalanceCheckpoints).values({
      id: checkpointId,
      organizationId: ORG,
      currency: "USD",
      confirmedBalanceMicros: 26_550_000n,
      asOf: NOW,
      sourceLabel: "HUMAN_CONFIRMED",
      note: "Human-confirmed integration fixture",
      confirmedByUserId: USER,
      createdAt: NOW,
    });
    await expect(
      sqlClient`UPDATE treasury_balance_checkpoints SET note = 'changed' WHERE id = ${checkpointId}::uuid`,
    ).rejects.toThrow(/append-only/i);
    await expect(
      sqlClient`DELETE FROM treasury_balance_checkpoints WHERE id = ${checkpointId}::uuid`,
    ).rejects.toThrow(/append-only/i);

    await sqlClient.unsafe("SET ROLE authenticated");
    try {
      await expect(sqlClient`SELECT id FROM treasury_balance_checkpoints`).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await sqlClient.unsafe("RESET ROLE");
    }
  });
});
