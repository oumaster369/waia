import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resolveTreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/resolve";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import { TreasuryNotFoundError } from "@/lib/waia-core/treasury/errors";
import { getBreathPublicSnapshot } from "@/lib/waia-core/treasury/breath";
import { getPublicContributionAggregate } from "@/lib/waia-core/treasury/share";
import {
  ADDR_A,
  ADDR_B,
  ORG_A,
  ORG_B,
  actorA,
  actorB,
  ctxA,
  ctxB,
  expectPostgresRejects,
  insertChainObservationFixture,
  insertWatchedPair,
  openWp8Postgres,
  openWp8Services,
  registerMetadataEvidence,
  resetWp8Tenants,
  seedWp8Identity,
  wp8IsolationEnabled,
  type Wp8PostgresHandle,
  type Wp8Services,
} from "@/tests/integration/treasury-wp8-harness";

const describeWp8 = describe.skipIf(!wp8IsolationEnabled);

describeWp8("DEE-606 WP-8 Postgres isolation + structural proof", () => {
  let handle: Wp8PostgresHandle;
  let services: Wp8Services;

  beforeAll(async () => {
    handle = openWp8Postgres();
    services = openWp8Services(handle.db);
    await seedWp8Identity(handle.sql);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetWp8Tenants(handle.sql);
  });

  it("1-5 refuses 54329 and records live journal/table/RLS inventory", async () => {
    expect(handle.url).toContain(":54339/");
    expect(handle.url).not.toContain("54329");
    expect(handle.url).toContain("waia_treasury_validate");

    const version = await handle.sql<{ version: string }[]>`SELECT version()`;
    expect(version[0]?.version).toMatch(/PostgreSQL 16/);

    const applied = await handle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
    `;
    expect(Number(applied[0]?.count)).toBe(156);

    const tip = await handle.sql<{ hash: string; created_at: string }[]>`
      SELECT hash, created_at::text FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    expect(tip[0]?.hash).toBeTruthy();
    expect(tip[0]?.created_at).toBe("1780000000155");

    const monotonic = await handle.sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY id
    `;
    const created = monotonic.map((row) => BigInt(row.created_at));
    for (let i = 1; i < created.length; i += 1) {
      expect(created[i]! >= created[i - 1]!).toBe(true);
    }

    const tables = await handle.sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'treasury_%'
      ORDER BY c.relname
    `;
    expect(tables.length).toBeGreaterThanOrEqual(24);
    expect(tables.every((row) => row.relrowsecurity)).toBe(true);

    const missingOrg = await handle.sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'treasury_%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
        )
    `;
    expect(missingOrg).toEqual([]);

    const nullableOrg = await handle.sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name LIKE 'treasury_%'
        AND column_name = 'organization_id'
        AND is_nullable = 'YES'
    `;
    expect(nullableOrg).toEqual([]);

    const enums = await handle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname LIKE 'treasury_%'
    `;
    expect(Number(enums[0]?.count)).toBeGreaterThanOrEqual(19);

    const policies = await handle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename LIKE 'treasury_%'
    `;
    expect(Number(policies[0]?.count)).toBeGreaterThanOrEqual(96);

    const sameOrgFks = await handle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid::regclass::text LIKE 'treasury_%'
        AND pg_get_constraintdef(oid) LIKE '%organization_id%'
        AND cardinality(conkey) > 1
    `;
    expect(Number(sameOrgFks[0]?.count)).toBeGreaterThanOrEqual(29);

    const checks = await handle.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_constraint
      WHERE contype = 'c' AND conrelid::regclass::text LIKE 'treasury_%'
    `;
    expect(Number(checks[0]?.count)).toBeGreaterThanOrEqual(27);
  });

  it("6-7 anon and authenticated cannot CRUD treasury tables", async () => {
    const tables = await handle.sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'treasury_%'
      ORDER BY c.relname
    `;
    await handle.sql.unsafe(
      `GRANT USAGE ON SCHEMA public TO authenticated, anon;
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, anon`,
    );

    try {
      for (const role of ["authenticated", "anon"] as const) {
        for (const table of tables) {
          await handle.sql.unsafe(`SET ROLE ${role}`);
          const visible = await handle.sql.unsafe(`SELECT * FROM ${table.relname} LIMIT 5`);
          expect(Array.isArray(visible) ? visible.length : 0).toBe(0);
          await expectPostgresRejects(() =>
            handle.sql.unsafe(`INSERT INTO ${table.relname} DEFAULT VALUES`),
          );
          await handle.sql.unsafe(`UPDATE ${table.relname} SET organization_id = organization_id`);
          await handle.sql.unsafe(`DELETE FROM ${table.relname}`);
          await handle.sql.unsafe(`RESET ROLE`);
        }
      }
      const buckets = await handle.sql<{ title: string }[]>`
        SELECT title FROM treasury_fund_buckets WHERE organization_id = ${ORG_A}::uuid
      `;
      expect(buckets[0]?.title).toBe("Unassigned");
    } finally {
      await handle.sql.unsafe(`RESET ROLE`);
    }
  });

  it("8-9 ORG_A/ORG_B app-layer isolation across treasury repositories", async () => {
    const txA = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      accountingAmountMicros: 1_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "org a",
    });
    const txB = await services.domain.transactions.createManualDraft(ctxB, actorB, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      nativeAmountAtomic: 2_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      accountingAmountMicros: 2_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "org b",
    });

    expect(await services.domain.repository.getTransaction(ctxA, txB.id)).toBeNull();
    expect(await services.domain.repository.getTransaction(ctxB, txA.id)).toBeNull();
    await expect(services.domain.transactions.getTransaction(ctxA, txB.id)).rejects.toBeInstanceOf(
      TreasuryNotFoundError,
    );

    const budgetA = await services.catalog.createBudget(ctxA, actorA, {
      code: "A1",
      title: "A",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currency: "USD",
      plannedAmountMicros: 10_000_000n,
      status: "ACTIVE",
      notes: null,
      reason: "a",
    });
    const budgetB = await services.catalog.createBudget(ctxB, actorB, {
      code: "B1",
      title: "B",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currency: "USD",
      plannedAmountMicros: 10_000_000n,
      status: "ACTIVE",
      notes: null,
      reason: "b",
    });
    expect(await services.catalogRepo.getBudget(ctxA, budgetB.id)).toBeNull();
    expect(await services.catalogRepo.getBudget(ctxB, budgetA.id)).toBeNull();

    const needA = await services.catalog.createFundingNeed(ctxA, actorA, {
      title: "need a",
      publicExplanation: null,
      targetStage: null,
      requiredAmountMicros: 1_000_000n,
      currency: "USD",
      status: "OPEN",
      budgetId: budgetA.id,
      reason: "a",
    });
    const needB = await services.catalog.createFundingNeed(ctxB, actorB, {
      title: "need b",
      publicExplanation: null,
      targetStage: null,
      requiredAmountMicros: 1_000_000n,
      currency: "USD",
      status: "OPEN",
      budgetId: budgetB.id,
      reason: "b",
    });
    expect(await services.catalogRepo.getFundingNeed(ctxA, needB.id)).toBeNull();
    expect(await services.catalogRepo.getFundingNeed(ctxB, needA.id)).toBeNull();

    const idealA = await services.catalog.createIdealBudget(ctxA, actorA, {
      periodYear: 2026,
      currency: "USD",
      amountMicros: 12_000_000n,
      reason: "a",
    });
    expect((await services.catalogRepo.listIdealBudgets(ctxB)).map((row) => row.id)).not.toContain(
      idealA.id,
    );

    const runwayA = await services.catalog.createRunwayDraft(ctxA, actorA, {
      currency: "USD",
      dailyBurnMicros: 1_000n,
      reason: "a",
    });
    expect((await services.catalogRepo.listRunwayPlans(ctxB)).map((row) => row.id)).not.toContain(
      runwayA.id,
    );

    const commitmentA = await services.domain.commitments.createDraft(ctxA, actorA, {
      amountMicros: 1000n,
      purpose: "a",
      budgetId: budgetA.id,
      reason: "a",
    });
    expect(await services.domain.repository.getCommitment(ctxB, commitmentA.id)).toBeNull();

    await insertWatchedPair(services, ORG_A);
    await insertWatchedPair(services, ORG_B);
    expect(
      (await services.catalog.listWatchedAddresses(ctxB)).every(
        (row) => row.organizationId === ORG_B,
      ),
    ).toBe(true);

    const evidenceA = await registerMetadataEvidence(services, ORG_A, actorA);
    expect(await services.catalogRepo.getEvidenceObject(ctxB, evidenceA)).toBeNull();

    const factsA = await services.breathFacts.loadFacts(ctxA);
    const factsB = await services.breathFacts.loadFacts(ctxB);
    expect(factsA.transactions.some((row) => row.id === txB.id)).toBe(false);
    expect(factsB.transactions.some((row) => row.id === txA.id)).toBe(false);

    const shareA = await getPublicContributionAggregate(ctxA, services.shareEngine);
    const shareB = await getPublicContributionAggregate(ctxB, services.shareEngine);
    expect(shareA.qualifyingContributionCount).toBe(0);
    expect(shareB.qualifyingContributionCount).toBe(0);

    const snapshotB = await getBreathPublicSnapshot(ctxB, services.breath);
    expect(JSON.stringify(snapshotB)).not.toContain(txA.id);
  });

  it("10-17 live same-org composite FKs reject cross-org references", async () => {
    const txA = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "a",
    });
    const txB = await services.domain.transactions.createManualDraft(ctxB, actorB, {
      direction: "INFLOW",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "b",
    });
    const budgetA = await services.catalog.createBudget(ctxA, actorA, {
      code: "A1",
      title: "A",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currency: "USD",
      plannedAmountMicros: 10_000_000n,
      status: "ACTIVE",
      notes: null,
      reason: "a",
    });
    const budgetB = await services.catalog.createBudget(ctxB, actorB, {
      code: "B1",
      title: "B",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currency: "USD",
      plannedAmountMicros: 10_000_000n,
      status: "ACTIVE",
      notes: null,
      reason: "b",
    });
    const needB = await services.catalog.createFundingNeed(ctxB, actorB, {
      title: "need b",
      publicExplanation: null,
      targetStage: null,
      requiredAmountMicros: 1_000_000n,
      currency: "USD",
      status: "OPEN",
      budgetId: null,
      reason: "b",
    });
    await insertWatchedPair(services, ORG_A);
    await insertWatchedPair(services, ORG_B);
    const obsB = await insertChainObservationFixture(services, {
      organizationId: ORG_B,
      watchedAddressId: (await services.catalog.listWatchedAddresses(ctxB))[0]!.id,
      txHash: "hash-b",
      fromAddress: ADDR_A,
      toAddress: ADDR_B,
      direction: "INFLOW",
      observationStatus: "OBSERVED",
      confirmationsObserved: 1,
      blockHeight: "100",
    });
    const evidenceA = await registerMetadataEvidence(services, ORG_A, actorA);
    const evidenceB = await registerMetadataEvidence(services, ORG_B, actorB);
    const commitmentA = await services.domain.commitments.createDraft(ctxA, actorA, {
      amountMicros: 1000n,
      purpose: "a",
      reason: "a",
    });
    const runwayA = await services.catalog.createRunwayDraft(ctxA, actorA, {
      currency: "USD",
      dailyBurnMicros: 1_000n,
      reason: "a",
    });
    const runwayB = await services.catalog.createRunwayDraft(ctxB, actorB, {
      currency: "USD",
      dailyBurnMicros: 1_000n,
      reason: "b",
    });

    const liveFks = await handle.sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid::regclass::text LIKE 'treasury_%'
        AND pg_get_constraintdef(oid) LIKE '%organization_id%'
        AND cardinality(conkey) > 1
      ORDER BY conname
    `;
    expect(liveFks.length).toBeGreaterThanOrEqual(29);
    expect(liveFks.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "treasury_transactions_budget_same_org_fk",
        "treasury_transactions_funding_need_same_org_fk",
        "treasury_tx_obs_links_tx_same_org_fk",
        "treasury_contribution_attributions_tx_same_org_fk",
        "treasury_evidence_links_tx_same_org_fk",
        "treasury_evidence_links_evidence_same_org_fk",
        "treasury_commitments_budget_same_org_fk",
        "treasury_runway_snapshots_plan_same_org_fk",
        "treasury_accounts_watched_address_same_org_fk",
        "treasury_transactions_counterparty_same_org_fk",
        "treasury_transactions_account_same_org_fk",
        "treasury_transactions_category_same_org_fk",
        "treasury_transactions_project_same_org_fk",
      ]),
    );

    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_transactions SET budget_id = $1 WHERE id = $2`, [
        budgetB.id,
        txA.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_transactions SET funding_need_id = $1 WHERE id = $2`, [
        needB.id,
        txA.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `INSERT INTO treasury_transaction_observation_links
          (id, organization_id, transaction_id, observation_id, observation_role)
         VALUES ($1, $2, $3, $4, 'PRIMARY')`,
        [crypto.randomUUID(), ORG_A, txA.id, obsB.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `INSERT INTO treasury_contribution_attributions
          (id, organization_id, transaction_id, status, attribution_method)
         VALUES ($1, $2, $3, 'UNMATCHED', 'WP8')`,
        [crypto.randomUUID(), ORG_A, txB.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `INSERT INTO treasury_evidence_links
          (id, organization_id, transaction_id, evidence_object_id)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), ORG_A, txA.id, evidenceB],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `INSERT INTO treasury_evidence_links
          (id, organization_id, transaction_id, evidence_object_id)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), ORG_A, txB.id, evidenceA],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_commitments SET budget_id = $1 WHERE id = $2`, [
        budgetB.id,
        commitmentA.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `INSERT INTO treasury_runway_snapshots
          (id, organization_id, runway_plan_id, runway_as_of, free_funds_at_as_of_micros,
           approved_daily_burn_micros, ends_at, input_digest)
         VALUES ($1, $2, $3, NOW(), 1, 1, NOW(), 'x')`,
        [crypto.randomUUID(), ORG_A, runwayB.id],
      ),
    );
    expect(runwayA.id).not.toBe(runwayB.id);
    expect(await services.catalogRepo.getBudget(ctxA, budgetA.id)).not.toBeNull();
  });

  it("18-20 observation lifecycle allowlist, immutable facts, and DELETE deny", async () => {
    await insertWatchedPair(services, ORG_A);
    await insertWatchedPair(services, ORG_B);
    const observation = await insertChainObservationFixture(services, {
      organizationId: ORG_A,
      watchedAddressId: (await services.catalog.listWatchedAddresses(ctxA)).find(
        (row) => row.address === ADDR_A,
      )!.id,
      txHash: "hash-imm",
      fromAddress: ADDR_A,
      toAddress: ADDR_B,
      direction: "INFLOW",
      observationStatus: "OBSERVED",
      confirmationsObserved: 1,
      confirmationsRequired: 3,
      blockHeight: "100",
    });

    await handle.sql.unsafe(
      `UPDATE treasury_chain_observations
       SET confirmations_observed = 3, observation_status = 'CONFIRMED'
       WHERE id = $1`,
      [observation.id],
    );
    const paymentId = crypto.randomUUID();
    await handle.sql.unsafe(
      `INSERT INTO payments (
         payment_id, organization_id, status, direction, subject_module,
         last_event_seq, last_event_digest, created_at, updated_at
       ) VALUES ($1, $2, 'DETECTED', 'INBOUND', 'trader', 0, 'wp8', NOW(), NOW())`,
      [paymentId, ORG_A],
    );
    await handle.sql.unsafe(
      `UPDATE treasury_chain_observations SET related_payment_id = $1 WHERE id = $2`,
      [paymentId, observation.id],
    );

    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_chain_observations SET network = 'ERC-20' WHERE id = $1`, [
        observation.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET token_contract = 'other' WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET tx_hash = 'mutated' WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_chain_observations SET transfer_index = 9 WHERE id = $1`, [
        observation.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_chain_observations SET from_address = 'X' WHERE id = $1`, [
        observation.id,
      ]),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET native_amount_atomic = 9 WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET block_height = '999' WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET raw_event_digest = 'nope' WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET organization_id = $1 WHERE id = $2`,
        [ORG_B, observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_chain_observations SET ingestion_source = 'future' WHERE id = $1`,
        [observation.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`DELETE FROM treasury_chain_observations WHERE id = $1`, [observation.id]),
    );
  });

  it("21-24 transaction and commitment revisions are append-only", async () => {
    const tx = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "rev",
    });
    const txRevs = await services.domain.repository.listRevisions(ctxA, tx.id);
    expect(txRevs.length).toBeGreaterThan(0);
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_transaction_revisions SET reason = 'mutated' WHERE id = $1`,
        [txRevs[0]!.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`DELETE FROM treasury_transaction_revisions WHERE id = $1`, [
        txRevs[0]!.id,
      ]),
    );

    const commitment = await services.domain.commitments.createDraft(ctxA, actorA, {
      amountMicros: 5000n,
      purpose: "c",
      reason: "c",
    });
    const cRevs = await services.domain.repository.listCommitmentRevisions(ctxA, commitment.id);
    expect(cRevs.length).toBeGreaterThan(0);
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_commitment_revisions SET reason = 'mutated' WHERE id = $1`,
        [cRevs[0]!.id],
      ),
    );
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`DELETE FROM treasury_commitment_revisions WHERE id = $1`, [cRevs[0]!.id]),
    );
  });

  it("60-61 evidence metadata isolation without R2; Breath does not require R2", async () => {
    expect(resolveTreasuryEvidenceStorage()).toBeNull();
    const evidenceA = await registerMetadataEvidence(services, ORG_A, actorA);
    const evidenceB = await registerMetadataEvidence(services, ORG_B, actorB);
    expect(await services.catalogRepo.getEvidenceObject(ctxA, evidenceB)).toBeNull();
    expect(await services.catalogRepo.getEvidenceObject(ctxB, evidenceA)).toBeNull();
    await expect(
      services.catalog.linkEvidence(ctxA, actorA, {
        transactionId: crypto.randomUUID(),
        evidenceObjectId: evidenceB,
        reason: "cross",
      }),
    ).rejects.toBeInstanceOf(TreasuryNotFoundError);

    const snapshot = await getBreathPublicSnapshot(ctxA, services.breath);
    expect(snapshot.status === "pending" || snapshot.status === "published").toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("objectKey");
    expect(JSON.stringify(snapshot)).not.toContain(evidenceA);
  });

  it("62-64 watcher remains DARK; wrangler has no R2; 54329 identity is not this connection", async () => {
    expect(loadTreasuryWatcherConfig().enabled).toBe(false);
    const wranglerPath = path.resolve(process.cwd(), "wrangler.jsonc");
    expect(existsSync(wranglerPath)).toBe(true);
    const wrangler = readFileSync(wranglerPath, "utf8");
    expect(wrangler).not.toMatch(/r2_buckets/);
    expect(wrangler).not.toMatch(/TREASURY_EVIDENCE_R2/);
    expect(wrangler).not.toMatch(/TREASURY_WATCHER_ENABLED/);
    expect(handle.url).not.toContain("54329");
    expect(handle.url).not.toContain("waia_validate");
  });
});
