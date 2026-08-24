import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createPostgresTreasuryFundAllocationRepository,
  createTreasuryFundAllocationService,
  type FundAllocationEvidenceRecord,
} from "@/lib/waia-core/treasury/allocation";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const NOW = new Date("2026-08-24T12:00:00.000Z");
const USER_A = "69000000-0000-4000-8000-000000000101";
const USER_B = "69000000-0000-4000-8000-000000000102";
const ORG_A = "69000000-0000-4000-8000-000000000201";
const ORG_B = "69000000-0000-4000-8000-000000000202";
const TX_A = "69000000-0000-4000-8000-000000000301";
const TX_B = "69000000-0000-4000-8000-000000000302";
const INCEPTION_A = "69000000-0000-4000-8000-000000000401";
const INCEPTION_B = "69000000-0000-4000-8000-000000000402";
const IDEAL_A = "69000000-0000-4000-8000-000000000501";
const IDEAL_B = "69000000-0000-4000-8000-000000000502";
const RECON_A = "69000000-0000-4000-8000-000000000601";
const RECON_B = "69000000-0000-4000-8000-000000000602";
const INPUT_DIGEST = "a".repeat(64);
const OUTPUT_DIGEST = "b".repeat(64);

const describePostgres = describe.skipIf(!enabled || !url);

function evidenceRecord(
  patch: Partial<FundAllocationEvidenceRecord> = {},
): FundAllocationEvidenceRecord {
  return {
    id: "69000000-0000-4000-8000-000000000701",
    organizationId: ORG_A,
    policyCode: "WAIA_DEVELOPMENT_FUND_EXCESS_ANNUAL_BUDGET",
    policyVersion: 1,
    accountingCurrency: "USD",
    idealAnnualBudgetId: IDEAL_A,
    balanceReconciliationId: RECON_A,
    accountingAsOf: NOW,
    accountingCashBalanceMicros: 150_000_000n,
    activeCommitmentsMicros: 0n,
    canonicalFreeFundsMicros: 150_000_000n,
    protectedAnnualBudgetMicros: 100_000_000n,
    operatingAllocationMicros: 100_000_000n,
    developmentAllocationMicros: 50_000_000n,
    inputDigest: INPUT_DIGEST,
    outputDigest: OUTPUT_DIGEST,
    createdAt: NOW,
    ...patch,
  };
}

describePostgres("DEE-690 PostgreSQL virtual fund allocation", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;

  async function clearEvidence() {
    await sqlClient.unsafe(
      "ALTER TABLE treasury_fund_allocation_evidence DISABLE TRIGGER treasury_fund_allocation_evidence_block_delete",
    );
    try {
      await sqlClient`DELETE FROM treasury_fund_allocation_evidence WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    } finally {
      await sqlClient.unsafe(
        "ALTER TABLE treasury_fund_allocation_evidence ENABLE TRIGGER treasury_fund_allocation_evidence_block_delete",
      );
    }
  }

  async function cleanupFixtures() {
    await clearEvidence();
    await sqlClient`DELETE FROM treasury_balance_reconciliations WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM treasury_ledger_inceptions WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM treasury_transactions WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM treasury_ideal_annual_budgets WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM treasury_fund_buckets WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`;
    await sqlClient`DELETE FROM users WHERE id IN (${USER_A}::uuid, ${USER_B}::uuid)`;
    await sqlClient.unsafe("DELETE FROM auth.users WHERE id IN ($1::uuid, $2::uuid)", [
      USER_A,
      USER_B,
    ]);
  }

  async function seedOrganization(input: {
    userId: string;
    organizationId: string;
    transactionId: string;
    inceptionId: string;
    idealId: string;
    reconciliationId: string;
  }) {
    await sqlClient.unsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", [input.userId]);
    await db.insert(pgSchema.users).values({
      id: input.userId,
      identityLabel: `DEE-690 ${input.organizationId}`,
      email: `${input.userId}@waia.invalid`,
      passwordHash: null,
    });
    await db.insert(pgSchema.organizations).values({
      id: input.organizationId,
      ownerUserId: input.userId,
      kind: "fund",
      name: "DEE-690 disposable integration fixture",
    });
    await db.insert(pgSchema.treasuryFundBuckets).values({
      organizationId: input.organizationId,
      code: "UNASSIGNED",
      title: "Unassigned",
      isActive: true,
    });
    await db.insert(pgSchema.treasuryTransactions).values({
      id: input.transactionId,
      organizationId: input.organizationId,
      status: "VERIFIED",
      detailPublication: "PRIVATE",
      provenance: "MANUAL",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      fundBucketCode: "UNASSIGNED",
      nativeAmountAtomic: 150_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      accountingAmountMicros: 150_000_000n,
      accountingDenominationPolicy: "USDT_NOMINAL_USD_POLICY_V1",
      cashEffectMicros: 150_000_000n,
      counterpartyIsInternal: false,
      occurredAt: NOW,
      purpose: "DEE-690 disposable test opening balance",
      publishCounterparty: false,
      verifiedAt: NOW,
      verifiedByUserId: input.userId,
      recordContentDigest: `digest-${input.transactionId}`,
      createdByUserId: input.userId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(pgSchema.treasuryLedgerInceptions).values({
      id: input.inceptionId,
      organizationId: input.organizationId,
      network: "TRC-20",
      tokenContract: "TUSDT",
      assetCode: "USDT",
      inceptionBlock: "1",
      inceptionTime: NOW,
      openingBalanceTransactionId: input.transactionId,
      watcherStartBlock: "1",
      status: "ACTIVE",
      createdByUserId: input.userId,
      approvedByUserId: input.userId,
      createdAt: NOW,
    });
    await db.insert(pgSchema.treasuryIdealAnnualBudgets).values({
      id: input.idealId,
      organizationId: input.organizationId,
      periodYear: 2026,
      currency: "USD",
      amountMicros: 100_000_000n,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-31T23:59:59.000Z"),
      status: "ACTIVE",
      publicationState: "PUBLIC",
      createdByUserId: input.userId,
      approvedByUserId: input.userId,
      createdAt: NOW,
    });
    await db.insert(pgSchema.treasuryBalanceReconciliations).values({
      id: input.reconciliationId,
      organizationId: input.organizationId,
      ledgerInceptionId: input.inceptionId,
      asOfBlock: "10",
      asOfTime: NOW,
      observedOnchainBalanceAtomic: 150_000_000n,
      accountingCashBalanceMicros: 150_000_000n,
      deltaMicros: 0n,
      explainedPendingMicros: 0n,
      unexplainedResidualMicros: 0n,
      status: "MATCHED",
      toleranceMicros: 0n,
      createdBy: "dee-690-integration",
      createdAt: NOW,
    });
  }

  beforeAll(async () => {
    sqlClient = postgres(url!, { max: 6, prepare: false });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
    await cleanupFixtures();
    await seedOrganization({
      userId: USER_A,
      organizationId: ORG_A,
      transactionId: TX_A,
      inceptionId: INCEPTION_A,
      idealId: IDEAL_A,
      reconciliationId: RECON_A,
    });
    await seedOrganization({
      userId: USER_B,
      organizationId: ORG_B,
      transactionId: TX_B,
      inceptionId: INCEPTION_B,
      idealId: IDEAL_B,
      reconciliationId: RECON_B,
    });
  }, 120_000);

  beforeEach(async () => {
    await sqlClient.unsafe("RESET ROLE");
    await clearEvidence();
  });

  afterAll(async () => {
    if (!sqlClient) return;
    await sqlClient.unsafe("RESET ROLE");
    await cleanupFixtures();
    await sqlClient.end({ timeout: 5 });
  });

  it("applies table, RLS, immutable triggers, checks, and same-org foreign keys", async () => {
    const structure = await sqlClient<
      {
        relrowsecurity: boolean;
        policy_count: number;
        trigger_count: number;
      }[]
    >`
      SELECT c.relrowsecurity,
        (SELECT count(*)::int FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count,
        (SELECT count(*)::int FROM pg_trigger t
          WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS trigger_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'treasury_fund_allocation_evidence'
    `;
    expect(structure[0]).toEqual({ relrowsecurity: true, policy_count: 4, trigger_count: 2 });

    await expect(
      db.insert(pgSchema.treasuryFundAllocationEvidence).values(
        evidenceRecord({
          developmentAllocationMicros: 49_999_999n,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.insert(pgSchema.treasuryFundAllocationEvidence).values(
        evidenceRecord({
          id: "69000000-0000-4000-8000-000000000702",
          idealAnnualBudgetId: IDEAL_B,
        }),
      ),
    ).rejects.toThrow();
  });

  it("denies browser roles and blocks update/delete even for the service role", async () => {
    await db.insert(pgSchema.treasuryFundAllocationEvidence).values(evidenceRecord());
    await sqlClient.unsafe(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON treasury_fund_allocation_evidence TO authenticated, anon",
    );
    for (const role of ["authenticated", "anon"] as const) {
      const visible = await sqlClient.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        return tx`SELECT id FROM treasury_fund_allocation_evidence`;
      });
      expect(visible).toHaveLength(0);
      await expect(
        sqlClient.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          return tx`
            INSERT INTO treasury_fund_allocation_evidence (
              id, organization_id, policy_code, policy_version, accounting_currency,
              ideal_annual_budget_id, balance_reconciliation_id, accounting_as_of,
              accounting_cash_balance_micros, active_commitments_micros,
              canonical_free_funds_micros, protected_annual_budget_micros,
              operating_allocation_micros, development_allocation_micros,
              input_digest, output_digest, created_at
            ) VALUES (
              ${role === "authenticated" ? "69000000-0000-4000-8000-000000000703" : "69000000-0000-4000-8000-000000000704"}::uuid,
              ${ORG_A}::uuid,
              'WAIA_DEVELOPMENT_FUND_EXCESS_ANNUAL_BUDGET', 1, 'USD',
              ${IDEAL_A}::uuid, ${RECON_A}::uuid, ${NOW},
              150000000, 0, 150000000, 100000000, 100000000, 50000000,
              ${role === "authenticated" ? "c".repeat(64) : "d".repeat(64)},
              ${role === "authenticated" ? "e".repeat(64) : "f".repeat(64)},
              ${NOW}
            )
          `;
        }),
      ).rejects.toThrow();
    }
    await expect(
      sqlClient`UPDATE treasury_fund_allocation_evidence SET accounting_currency = 'EUR' WHERE organization_id = ${ORG_A}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sqlClient`DELETE FROM treasury_fund_allocation_evidence WHERE organization_id = ${ORG_A}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  it("serializes concurrent derivation, persists once, and remains tenant-scoped", async () => {
    const repository = createPostgresTreasuryFundAllocationRepository(db);
    let sequence = 700;
    const allocation = createTreasuryFundAllocationService({
      repository,
      now: () => NOW,
      newId: () => `69000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    });

    const current = await Promise.all(
      Array.from({ length: 8 }, () => allocation.getCurrent(requireOrgContext(ORG_A))),
    );
    expect(current.every((row) => row.status === "available")).toBe(true);
    const ids = new Set(
      current.map((row) => (row.status === "available" ? row.evidence.id : "unavailable")),
    );
    expect(ids.size).toBe(1);
    const countA = await sqlClient<{ count: number }[]>`
      SELECT count(*)::int AS count FROM treasury_fund_allocation_evidence
      WHERE organization_id = ${ORG_A}::uuid
    `;
    expect(countA[0]?.count).toBe(1);

    const other = await allocation.getCurrent(requireOrgContext(ORG_B));
    expect(other.status).toBe("available");
    if (other.status !== "available") return;
    expect(other.evidence.organizationId).toBe(ORG_B);
    expect(other.evidence.id).not.toBe([...ids][0]);
    const rows = await sqlClient<{ organization_id: string; count: number }[]>`
      SELECT organization_id::text, count(*)::int AS count
      FROM treasury_fund_allocation_evidence
      GROUP BY organization_id ORDER BY organization_id
    `;
    expect(rows).toEqual([
      { organization_id: ORG_A, count: 1 },
      { organization_id: ORG_B, count: 1 },
    ]);
  });
});
