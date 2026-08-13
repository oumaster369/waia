import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runTreasuryWatcherCycle } from "@/lib/waia-core/treasury/watcher/cycle";
import { TREASURY_WATCHER_CHECKPOINT_KEY } from "@/lib/waia-core/treasury/watcher/config";
import { createSilentTreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
import {
  ADDR_A,
  ADDR_B,
  ADDR_EXT,
  createFakeChainAdapter,
  transfer,
  watcherConfig,
} from "@/tests/unit/helpers/treasury-wp3";
import {
  ORG_A,
  actorA,
  ctxA,
  insertWatchedPair,
  openWp8Postgres,
  openWp8Services,
  resetWp8Tenants,
  seedActiveInception,
  seedWp8Identity,
  wp8IsolationEnabled,
  type Wp8PostgresHandle,
  type Wp8Services,
} from "@/tests/integration/treasury-wp8-harness";

const describeWp8 = describe.skipIf(!wp8IsolationEnabled);

describeWp8("DEE-606 WP-8 Postgres watcher coalescing + inception", () => {
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

  async function runCycle(chain: ReturnType<typeof createFakeChainAdapter>, now: Date) {
    return runTreasuryWatcherCycle(ctxA, {
      config: watcherConfig({
        enabled: true,
        confirmationsRequired: 3,
        maxBlocksPerCycle: 50,
        rescanWindow: 10,
      }),
      chainAdapter: chain,
      watcherRepository: services.watcher,
      treasuryRepository: services.domain.repository,
      transactions: services.domain.transactions,
      logger: createSilentTreasuryWatcherLogger(),
      now: () => now,
    });
  }

  it("40-43 internal A→B two observations, one semantic tx, cash 0, replay idempotent", async () => {
    await seedActiveInception(services, { inceptionBlock: "90", watcherStartBlock: "100" });
    await insertWatchedPair(services, ORG_A);
    const now = new Date("2026-08-13T12:00:00.000Z");
    const chain = createFakeChainAdapter({
      tip: "110",
      transfersByBlock: {
        "100": [
          transfer({
            txHash: "internal-ab",
            from: ADDR_A,
            to: ADDR_B,
            block: "100",
            amount: 2_000_000n,
          }),
        ],
      },
    });
    const first = await runCycle(chain, now);
    expect(first.outcome).toBe("completed");
    expect(first.fromBlock).toBe("100");
    expect(first.observationsUpserted).toBe(2);
    expect(first.semanticTransactions).toBe(1);

    const observations = await services.watcher.listObservationsForOrg(ctxA);
    expect(observations).toHaveLength(2);
    const links = await handle.sql<{ observation_role: string }[]>`
      SELECT observation_role FROM treasury_transaction_observation_links
      WHERE organization_id = ${ORG_A}::uuid
      ORDER BY observation_role
    `;
    expect(links.map((row) => row.observation_role).sort()).toEqual(
      ["INTERNAL_COUNTERPARTY", "PRIMARY"].sort(),
    );
    const txs = await services.domain.repository.listTransactions(ctxA);
    const watcherTxs = txs.filter((row) => row.provenance === "WATCHER");
    expect(watcherTxs).toHaveLength(1);
    expect(watcherTxs[0]?.direction).toBe("INTERNAL");
    expect(watcherTxs[0]?.kind).toBeNull();
    expect(watcherTxs[0]?.counterpartyIsInternal).toBe(true);

    await services.domain.transactions.classify(ctxA, actorA, {
      transactionId: watcherTxs[0]!.id,
      reason: "internal transfer",
      patch: {
        kind: "INTERNAL_TRANSFER",
        direction: "INTERNAL",
        accountingAmountMicros: 2_000_000n,
        accountingDenominationPolicy: "USDT_NOMINAL_USD_POLICY_V1",
      },
    });
    const classified = await services.domain.transactions.getTransaction(ctxA, watcherTxs[0]!.id);
    expect(classified.cashEffectMicros).toBe(0n);
    const verified = await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: classified.id,
      reason: "human verify internal",
    });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.cashEffectMicros).toBe(0n);

    const replay = await runCycle(chain, now);
    expect(replay.outcome).toBe("completed");
    const observationsAfter = await services.watcher.listObservationsForOrg(ctxA);
    expect(observationsAfter).toHaveLength(2);
    const watcherAfter = (await services.domain.repository.listTransactions(ctxA)).filter(
      (row) => row.provenance === "WATCHER",
    );
    expect(watcherAfter).toHaveLength(1);
  });

  it("44-47 inception checkpoint seeds start-1; pre-start ignored; post-start ingested", async () => {
    await seedActiveInception(services, { inceptionBlock: "90", watcherStartBlock: "100" });
    await insertWatchedPair(services, ORG_A);
    const now = new Date("2026-08-13T12:00:00.000Z");
    const chain = createFakeChainAdapter({
      tip: "105",
      transfersByBlock: {
        "95": [
          transfer({
            txHash: "historical-pre-start",
            from: ADDR_EXT,
            to: ADDR_A,
            block: "95",
            amount: 7_000_000n,
          }),
        ],
        "100": [
          transfer({
            txHash: "post-start",
            from: ADDR_EXT,
            to: ADDR_A,
            block: "100",
            amount: 3_000_000n,
          }),
        ],
      },
    });
    const report = await runCycle(chain, now);
    expect(report.outcome).toBe("completed");
    expect(report.fromBlock).toBe("100");
    const checkpoint = await services.watcher.getCheckpoint(ctxA, TREASURY_WATCHER_CHECKPOINT_KEY);
    expect(checkpoint?.lastScannedBlock).toBe("105");
    const seeded = await handle.sql<{ last_scanned_block: string }[]>`
      SELECT last_scanned_block FROM treasury_watcher_checkpoints
      WHERE organization_id = ${ORG_A}::uuid AND checkpoint_key = ${TREASURY_WATCHER_CHECKPOINT_KEY}
    `;
    expect(seeded[0]).toBeTruthy();

    const observations = await services.watcher.listObservationsForOrg(ctxA);
    expect(observations.some((row) => row.txHash === "historical-pre-start")).toBe(false);
    expect(observations.some((row) => row.txHash === "post-start")).toBe(true);
    const watcherTxs = (await services.domain.repository.listTransactions(ctxA)).filter(
      (row) => row.provenance === "WATCHER",
    );
    expect(watcherTxs).toHaveLength(1);
    expect(watcherTxs[0]?.canonicalTxHash).toBe("post-start");
  });
});
