/**
 * DEE-415 / HTR-WP17 — trader_fill_execution_economics Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  DeterministicExecutionIdCollisionError,
  historicalFillId,
} from "@/lib/trader/execution/deterministic-execution-id";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { EXECUTION_FACT_KIND_HISTORICAL_SIMULATED } from "@/lib/trader/execution/historical-execution-model.types";
import { buildRecordFillPayload } from "@/lib/trader/execution/historical-simulated-exchange";
import { createPostgresOrderRepository } from "@/lib/trader/execution/repository-adapters";
import type { RecordFillProgressInput } from "@/lib/trader/execution/order-repository.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-0000000417d1";

function createMarketOrderInput(clientOrderId: string) {
  return {
    venue: "HTX",
    executionMode: "mock" as const,
    symbol: "BTCUSDT",
    side: "buy" as const,
    type: "market" as const,
    quantity: "0.20000000",
    clientOrderId,
    idempotencyKey: clientOrderId,
    riskDecisionId: crypto.randomUUID(),
  };
}

async function transitionToAccepted(
  repo: ReturnType<typeof createPostgresOrderRepository>,
  context: ReturnType<typeof requireOrgContext>,
  created: Awaited<ReturnType<typeof repo.createOrder>>,
) {
  let order = await repo.transitionOrder(context, {
    orderId: created.id,
    expectedStateVersion: 1,
    toState: "RISK_APPROVED",
  });
  order = await repo.transitionOrder(context, {
    orderId: order.id,
    expectedStateVersion: order.stateVersion,
    toState: "SENT_TO_EXCHANGE",
  });
  return repo.transitionOrder(context, {
    orderId: order.id,
    expectedStateVersion: order.stateVersion,
    toState: "ACCEPTED",
  });
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader fill execution economics parity (DEE-415 / HTR-WP17)",
  () => {
    let orgA: string;
    let repo: ReturnType<typeof createPostgresOrderRepository>;
    const model = createHistoricalExecutionModelV1();

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await sql.unsafe(`ALTER TABLE trader_fill_execution_economics DISABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`ALTER TABLE trader_fill_execution_economics ENABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      await cleanup();
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
          USER_A,
        ]);
        await sql.unsafe(
          `INSERT INTO users (id, identity_label, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [USER_A, "wp17-parity", "wp17-parity@example.com"],
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "WP17 Fill Economics Parity",
      });
      repo = createPostgresOrderRepository(db);
    });

    beforeEach(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`ALTER TABLE trader_fill_execution_economics DISABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgA]);
        await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgA]);
        await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgA]);
        await sql.unsafe(`ALTER TABLE trader_fill_execution_economics ENABLE TRIGGER USER`);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("creates trader_fill_execution_economics table with expected schema", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const tables = await sql.unsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'trader_fill_execution_economics'`,
        );
        expect(tables).toHaveLength(1);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("persists historical fill and economics atomically with content-addressed fill id", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-atomic"));
      const order = await transitionToAccepted(repo, context, created);

      const bar = makeWp17Bar(1);
      const event = {
        orderId: order.id,
        organizationId: orgA,
        symbol: "BTCUSDT",
        side: "buy" as const,
        fillSequence: 1,
        sourceBarIndex: 1,
        sourceBar: bar,
        grossFillPrice: "50000",
        sliceQuantity: "0.10000000",
        remainingQuantityAfter: "0.10000000",
        acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
        fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
        submitLatencyMs: 50,
        cancelLatencyMs: null,
      };
      const economics = applyHistoricalExecutionEconomics(event, model);
      const payload = buildRecordFillPayload(
        event,
        economics,
        orgA,
        order.id,
        "buy",
        economics.netFillPrice,
        event.sliceQuantity,
        false,
      );

      await repo.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: order.stateVersion,
        toState: "PARTIALLY_FILLED",
        filledQuantity: event.sliceQuantity,
        avgFillPrice: economics.netFillPrice,
      });
      await repo.recordFill(context, payload);

      const db = getPostgresDrizzle();
      const economicsRows = await db
        .select()
        .from(pgSchema.traderFillExecutionEconomics)
        .where(eq(pgSchema.traderFillExecutionEconomics.organizationId, orgA));
      expect(economicsRows).toHaveLength(1);
      expect(economicsRows[0]?.fillId).toBe(payload.fillId);
      expect(economicsRows[0]?.economicsContentDigest).toBe(economics.economicsContentDigest);
      expect(payload.fillId).toBe(
        historicalFillId({
          organizationId: orgA,
          orderId: order.id,
          fillSequence: 1,
          sourceBarIndex: 1,
        }),
      );
    });

    it("recordFillProgress appends economics rows with monotonic fill_sequence", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-progress"));
      let order = await transitionToAccepted(repo, context, created);

      const slices = [1, 2] as const;
      for (const fillSequence of slices) {
        const bar = makeWp17Bar(fillSequence);
        const event = {
          orderId: order.id,
          organizationId: orgA,
          symbol: "BTCUSDT",
          side: "buy" as const,
          fillSequence,
          sourceBarIndex: fillSequence,
          sourceBar: bar,
          grossFillPrice: "50000",
          sliceQuantity: "0.05000000",
          remainingQuantityAfter: fillSequence === 2 ? "0" : "0.05000000",
          acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
          fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
          submitLatencyMs: 50,
          cancelLatencyMs: null,
        };
        const economics = applyHistoricalExecutionEconomics(event, model);
        const filledQuantity = fillSequence === 1 ? "0.05000000" : "0.10000000";
        const payload = buildRecordFillPayload(
          event,
          economics,
          orgA,
          order.id,
          "buy",
          economics.netFillPrice,
          filledQuantity,
          fillSequence > 1,
        );

        if (fillSequence === 1) {
          order = await repo.transitionOrder(context, {
            orderId: order.id,
            expectedStateVersion: order.stateVersion,
            toState: "PARTIALLY_FILLED",
            filledQuantity,
            avgFillPrice: economics.netFillPrice,
          });
          await repo.recordFill(context, payload);
        } else {
          await repo.recordFillProgress(context, payload as RecordFillProgressInput);
        }
      }

      const db = getPostgresDrizzle();
      const economicsRows = await db
        .select()
        .from(pgSchema.traderFillExecutionEconomics)
        .where(eq(pgSchema.traderFillExecutionEconomics.organizationId, orgA))
        .orderBy(pgSchema.traderFillExecutionEconomics.fillSequence);
      expect(economicsRows.map((row) => row.fillSequence)).toEqual([1, 2]);
    });

    it("fails closed on fill id content conflict", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-collision"));
      const order = await transitionToAccepted(repo, context, created);

      const bar = makeWp17Bar(1);
      const event = {
        orderId: order.id,
        organizationId: orgA,
        symbol: "BTCUSDT",
        side: "buy" as const,
        fillSequence: 1,
        sourceBarIndex: 1,
        sourceBar: bar,
        grossFillPrice: "50000",
        sliceQuantity: "0.10000000",
        remainingQuantityAfter: "0",
        acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
        fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
        submitLatencyMs: 50,
        cancelLatencyMs: null,
      };
      const economics = applyHistoricalExecutionEconomics(event, model);
      const payload = buildRecordFillPayload(
        event,
        economics,
        orgA,
        order.id,
        "buy",
        economics.netFillPrice,
        event.sliceQuantity,
        false,
      );
      await repo.recordFill(context, payload);

      const conflicting = {
        ...payload,
        price: "49999.00000000",
      };
      await expect(repo.recordFill(context, conflicting)).rejects.toThrow(
        DeterministicExecutionIdCollisionError,
      );
    });

    it("rejects append-only mutation on economics table", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-append"));
      const order = await transitionToAccepted(repo, context, created);
      const bar = makeWp17Bar(1);
      const event = {
        orderId: order.id,
        organizationId: orgA,
        symbol: "BTCUSDT",
        side: "buy" as const,
        fillSequence: 1,
        sourceBarIndex: 1,
        sourceBar: bar,
        grossFillPrice: "50000",
        sliceQuantity: "0.10000000",
        remainingQuantityAfter: "0",
        acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
        fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
        submitLatencyMs: 50,
        cancelLatencyMs: null,
      };
      const economics = applyHistoricalExecutionEconomics(event, model);
      const payload = buildRecordFillPayload(
        event,
        economics,
        orgA,
        order.id,
        "buy",
        economics.netFillPrice,
        event.sliceQuantity,
        false,
      );
      await repo.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: order.stateVersion,
        toState: "FILLED",
        filledQuantity: event.sliceQuantity,
        avgFillPrice: economics.netFillPrice,
      });
      await repo.recordFill(context, payload);

      const sql = postgres(url!, { max: 1 });
      try {
        await expect(
          sql.unsafe(
            `UPDATE trader_fill_execution_economics SET fee_amount = '9' WHERE fill_id = $1`,
            [payload.fillId!],
          ),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("allows legacy venue fills without economics rows", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-legacy"));
      const order = await transitionToAccepted(repo, context, created);

      await repo.recordFill(context, {
        orderId: order.id,
        exchangeTradeId: "legacy-trade-1",
        price: "100",
        quantity: "0.1",
        fee: "0.01",
        feeAsset: "USDT",
        executedAt: new Date(),
      });

      const db = getPostgresDrizzle();
      const economicsRows = await db
        .select()
        .from(pgSchema.traderFillExecutionEconomics)
        .where(eq(pgSchema.traderFillExecutionEconomics.organizationId, orgA));
      expect(economicsRows).toHaveLength(0);
    });

    it("requires complete economics for HISTORICAL_SIMULATED fills", async () => {
      const context = requireOrgContext(orgA);
      const created = await repo.createOrder(context, createMarketOrderInput("wp17-pg-required"));
      const order = await transitionToAccepted(repo, context, created);

      await expect(
        repo.recordFill(context, {
          orderId: order.id,
          exchangeTradeId: "missing-econ",
          price: "100",
          quantity: "0.1",
          executedAt: new Date(),
          executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
        }),
      ).rejects.toThrow(/economics/i);
    });
  },
);
