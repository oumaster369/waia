import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  createReconciliationServiceFromDeps,
  createSqliteOrderRepository,
} from "@/lib/trader/execution";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000250b";
const USER_B = "00000000-0000-4000-8000-0000000250c";

describe("trader order reconciliation tenant isolation (DEE-250 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let orgAOrderId: string;
  let repo: ReturnType<typeof createSqliteOrderRepository>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "order-recon-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Recon Iso Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Order Recon Iso Org B" });

    repo = createSqliteOrderRepository(db);

    let orderA = await repo.createOrder(requireOrgContext(orgA), {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      clientOrderId: "iso-recon-client-a",
      idempotencyKey: "iso-recon-idem-a",
      riskDecisionId: crypto.randomUUID(),
    });
    orgAOrderId = orderA.id;
    orderA = await repo.transitionOrder(requireOrgContext(orgA), {
      orderId: orderA.id,
      expectedStateVersion: orderA.stateVersion,
      toState: "RISK_APPROVED",
    });
    orderA = await repo.transitionOrder(requireOrgContext(orgA), {
      orderId: orderA.id,
      expectedStateVersion: orderA.stateVersion,
      toState: "SENT_TO_EXCHANGE",
    });
  });

  it("org B cannot reconcile or mutate org A order", async () => {
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () => connector,
      writeAudit: () => "audit",
      nowMs: () => Date.now(),
    });

    const report = await service.reconcile(requireOrgContext(orgB), {
      kind: "order",
      orderId: orgAOrderId,
    });

    expect(report.outcomes).toHaveLength(0);

    const orgAOrder = await repo.getOrderById(requireOrgContext(orgA), orgAOrderId);
    expect(orgAOrder?.state).toBe("SENT_TO_EXCHANGE");
  });
});
