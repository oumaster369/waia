import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { payments } from "@/db/schema";
import {
  createSqlitePaymentAddressInboundResolver,
  createSqlitePaymentAddressService,
} from "@/lib/waia-core/payment-addresses";
import { createSqlitePaymentService } from "@/lib/waia-core/payments";
import type { ChainAdapter } from "@/lib/waia-core/payment-watcher/chain-adapter.port";
import { createSqliteWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import { listDetectedInboundPaymentsSqlite } from "@/lib/waia-core/payment-watcher/list-detected-inbound-payments-sqlite";
import { paymentIdempotencyKey } from "@/lib/waia-core/payment-watcher/idempotency";
import { runWatcherCycle } from "@/lib/waia-core/payment-watcher/run-watcher-cycle";
import {
  CANONICAL_NETWORK,
  loadWatcherConfig,
} from "@/lib/waia-core/payment-watcher/watcher-config";
import type {
  ObservedTransfer,
  WatcherDeps,
} from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import { createStdoutWatcherLogger } from "@/lib/waia-core/payment-watcher/watcher-logger";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000321a";
const DEPOSIT_ADDRESS = "TWatcher321Deposit";

function makeTransfer(overrides: Partial<ObservedTransfer> = {}): ObservedTransfer {
  return {
    txHash: "321abc-watcher-tx",
    transferIndex: 0,
    toAddress: DEPOSIT_ADDRESS,
    fromAddress: "TSender321",
    contractAddress: loadWatcherConfig().tronContractAddress,
    amountRaw: "150000000",
    amountDecimal: "150.000000",
    blockHeight: "100",
    blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
    confirmationsObserved: 21,
    ...overrides,
  };
}

function createMockAdapter(transfers: ObservedTransfer[], txExists = true): ChainAdapter {
  return {
    getTipBlock: async () => ({ ok: true, value: "120", provider: "primary" }),
    getTransfersInRange: async () => ({ ok: true, value: transfers, provider: "primary" }),
    getTransactionExists: async () => ({ ok: true, value: txExists, provider: "primary" }),
  };
}

describe("runWatcherCycle (sqlite integration)", () => {
  let organizationId: string;
  let addressId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-watcher-cycle-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "watcher-cycle.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "watcher-cycle@waia.invalid",
      password: "password123",
      identityLabel: "Watcher Cycle User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Watcher Cycle User",
    });

    const addressService = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await addressService.createWallet(context, {
      walletKind: "DEPOSIT",
      custodyModel: "ORGANIZATION",
      controlModel: "2-of-3",
      status: "active",
    });
    const generated = await addressService.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: DEPOSIT_ADDRESS,
    });
    await addressService.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: "subject-watcher-321",
    });
    const activated = await addressService.activateAddress(context, {
      addressId: generated.addressId,
    });
    addressId = activated.addressId;
  });

  function buildDeps(
    adapter: ChainAdapter,
    configOverrides: Record<string, string> = {},
  ): WatcherDeps {
    const db = getDb();
    const config = loadWatcherConfig({
      WATCHER_START_BLOCK: "0",
      WATCHER_ENABLED: "true",
      ...configOverrides,
    });
    return {
      config,
      chainAdapter: adapter,
      checkpointRepository: createSqliteWatcherCheckpointRepositoryAdapter(db),
      paymentService: createSqlitePaymentService(db),
      inboundResolver: createSqlitePaymentAddressInboundResolver(db),
      logger: createStdoutWatcherLogger(),
      listDetectedInboundPayments: async () => listDetectedInboundPaymentsSqlite(db),
      now: () => new Date("2026-06-26T12:00:00.000Z"),
    };
  }

  it("detects and confirms eligible transfers idempotently", async () => {
    const db = getDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);
    await repo.bootstrap(CANONICAL_NETWORK, "90");

    const deps = buildDeps(createMockAdapter([makeTransfer()]));
    const first = await runWatcherCycle(deps);
    expect(first.outcome).toBe("success");
    expect(first.detected).toBe(1);
    expect(first.confirmed).toBe(1);

    const second = await runWatcherCycle(deps);
    expect(second.detected).toBe(0);
    expect(second.confirmed).toBe(0);

    const context = requireOrgContext(organizationId);
    const payments = await deps.paymentService.listPayments(context, { status: "CONFIRMED" });
    const match = payments.find((p) => p.settlementTxHash === "321abc-watcher-tx");
    expect(match).toBeDefined();
    expect(match?.settlementNetwork).toBe("TRC-20");
  });

  it("skips unknown and ineligible addresses", async () => {
    const deps = buildDeps(
      createMockAdapter([
        makeTransfer({ toAddress: "TUnknownAddr", txHash: "unknown-tx" }),
        makeTransfer({ txHash: "known-tx", blockHeight: "101", confirmationsObserved: 5 }),
      ]),
    );
    const report = await runWatcherCycle(deps);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
  });

  it("no-ops on provider error without advancing cursor", async () => {
    const db = getDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);
    const before = await repo.load(CANONICAL_NETWORK);
    const cursorBefore = before?.lastScannedBlock;

    const failingAdapter: ChainAdapter = {
      getTipBlock: async () => ({ ok: false, error: "429", provider: "primary" }),
      getTransfersInRange: async () => ({ ok: false, error: "429", provider: "primary" }),
      getTransactionExists: async () => ({ ok: false, error: "429", provider: "primary" }),
    };

    const report = await runWatcherCycle(buildDeps(failingAdapter));
    expect(report.outcome).toBe("noop_provider_error");
    const checkpoint = await repo.load(CANONICAL_NETWORK);
    expect(checkpoint?.lastScannedBlock).toBe(cursorBefore);
  });

  it("resolves owner via inbound resolver without cross-org bleed", async () => {
    const db = getDb();
    const resolver = createSqlitePaymentAddressInboundResolver(db);
    const owner = await resolver.resolveOwnerByDepositAddress("TRC-20", DEPOSIT_ADDRESS);
    expect(owner?.organizationId).toBe(organizationId);
    expect(owner?.addressId).toBe(addressId);
  });

  it("ages out reorg-dropped detected payments as ORPHANED", async () => {
    const db = getDb();
    const paymentService = createSqlitePaymentService(db);
    const context = requireOrgContext(organizationId);
    const detected = await paymentService.detectPayment(context, {
      idempotencyKey: paymentIdempotencyKey("reorg-tx", 0),
      subjectModule: "trader",
      paymentAddressId: addressId,
    });
    db.update(payments)
      .set({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(payments.paymentId, detected.paymentId))
      .run();

    const adapter = createMockAdapter([], false);
    const deps = buildDeps(adapter);
    const report = await runWatcherCycle(deps);
    expect(report.failed).toBe(1);

    const failed = await paymentService.listPayments(context, { status: "FAILED" });
    expect(failed.some((p) => p.paymentId)).toBe(true);
  });
});
