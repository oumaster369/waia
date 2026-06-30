import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { computePaperEvaluationExportDigest } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  assembleStrategyPromotionRecord,
  buildAssembleInput,
  OperatorRunwayInputError,
  parseOperatorPromotionInputs,
} from "@/lib/trader/validation-gate";
import { createSqliteOrderRepository } from "@/lib/trader/execution";
import { getDb } from "@/db/client";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import {
  assertPostgresExportDatabaseEnv,
  buildPaperEvaluationExportForOrg,
  parsePaperEvaluationExportFlags,
  runPaperEvaluationExportCli,
  validatePaperEvaluationExportDocument,
} from "@/scripts/trader/export-paper-evaluation";

const ORG_A = "00000000-0000-4000-8000-0000000362a";
const ORG_B = "00000000-0000-4000-8000-0000000362b";
const STRATEGY = "mean_reversion_v0";
const EXPORTED_AT = new Date("2026-06-30T12:00:00.000Z");

function mockOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id">,
  organizationId: string,
): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "paper",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "65250",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-362",
    strategySignalId: STRATEGY,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId,
    ...overrides,
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [
      {
        id: `fill-${order.id}`,
        organizationId: order.organizationId,
        orderId: order.id,
        exchangeTradeId: `trade-${order.id}`,
        price: order.avgFillPrice ?? "65250",
        quantity: "0.01",
        fee: "0",
        feeAsset: "USDT",
        executedAt: new Date("2026-06-10T12:00:00.000Z"),
        createdAt: new Date("2026-06-10T12:00:00.000Z"),
      },
    ];
  }

  return {
    createOrder: async () => {
      throw new Error("read-only export");
    },
    getOrderById: async () => null,
    findOrderByClientOrderId: async () => null,
    findOrderByIdempotencyKey: async () => null,
    listOpenOrders: async () => [],
    listOrders: async (context) =>
      orders.filter((order) => order.organizationId === context.organizationId),
    transitionOrder: async () => {
      throw new Error("read-only export");
    },
    recordFill: async () => {
      throw new Error("read-only export");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

function validInputsJson(strategyId = STRATEGY) {
  return {
    strategyId,
    strategyVersion: "0.1.0",
    gitCommitSha: "c4486fdfb0a2ca64eaeb1d8b20345be42e1b2468",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "25" },
    failureModes: ["liquidity vacuum -> exposure cap"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 1 },
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

describe("trader:paper:export (HC-3.5 Phase 1)", () => {
  it("buildPaperEvaluationExportForOrg uses domain builder and valid digest", async () => {
    const document = await buildPaperEvaluationExportForOrg({
      organizationId: ORG_A,
      orderRepository: mockRepository([
        mockOrder({ id: "buy-1" }, ORG_A),
        mockOrder({ id: "sell-1", side: "sell" }, ORG_A),
      ]),
      window: {
        start: new Date("2026-06-01T00:00:00.000Z"),
        end: new Date("2026-06-15T00:00:00.000Z"),
      },
      strategySignalIds: [STRATEGY],
      executionMode: "paper",
      exportedAt: EXPORTED_AT,
    });

    expect(document.schemaVersion).toBe("waia.trader.paper-evaluation-export.v1");
    expect(document.envelope.organizationId).toBe(ORG_A);
    expect(document.envelope.contentDigest).toBe(
      computePaperEvaluationExportDigest(document.evidenceBody),
    );
    validatePaperEvaluationExportDocument(document);
  });

  it("org mismatch fails validation-gate assembly", async () => {
    const document = await buildPaperEvaluationExportForOrg({
      organizationId: ORG_A,
      orderRepository: mockRepository([mockOrder({ id: "buy-1" }, ORG_A)]),
      window: {
        start: new Date("2026-06-01T00:00:00.000Z"),
        end: new Date("2026-06-15T00:00:00.000Z"),
      },
      strategySignalIds: [STRATEGY],
      executionMode: "paper",
      exportedAt: EXPORTED_AT,
    });

    const inputs = parseOperatorPromotionInputs(JSON.stringify(validInputsJson()));
    expect(() =>
      buildAssembleInput({
        organizationId: ORG_B,
        inputs,
        document,
      }),
    ).toThrow(OperatorRunwayInputError);

    expect(() =>
      assembleStrategyPromotionRecord(
        buildAssembleInput({
          organizationId: ORG_A,
          inputs,
          document,
        }),
      ),
    ).not.toThrow();

    const mismatchedDocument = {
      ...document,
      envelope: { ...document.envelope, organizationId: ORG_B },
    };
    expect(() =>
      buildAssembleInput({
        organizationId: ORG_A,
        inputs,
        document: mismatchedDocument,
      }),
    ).toThrow(OperatorRunwayInputError);
  });

  it("assertPostgresExportDatabaseEnv requires postgres backend", () => {
    const previousBackend = process.env.WAIA_DB_BACKEND;
    const previousUrl = process.env.DATABASE_URL_POSTGRES;
    process.env.WAIA_DB_BACKEND = "sqlite";
    delete process.env.DATABASE_URL_POSTGRES;
    expect(() => assertPostgresExportDatabaseEnv()).toThrow(/WAIA_DB_BACKEND=postgres/);
    process.env.WAIA_DB_BACKEND = previousBackend;
    if (previousUrl !== undefined) {
      process.env.DATABASE_URL_POSTGRES = previousUrl;
    }
  });

  it("validate mode dry-runs an export file without database", async () => {
    const document = await buildPaperEvaluationExportForOrg({
      organizationId: ORG_A,
      orderRepository: mockRepository([mockOrder({ id: "buy-1" }, ORG_A)]),
      window: {
        start: new Date("2026-06-01T00:00:00.000Z"),
        end: new Date("2026-06-15T00:00:00.000Z"),
      },
      strategySignalIds: [STRATEGY],
      executionMode: "paper",
      exportedAt: EXPORTED_AT,
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-paper-export-validate-"));
    const filePath = path.join(tmpDir, "evidence.json");
    fs.writeFileSync(filePath, JSON.stringify(document, null, 2), "utf8");

    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    await runPaperEvaluationExportCli(parsePaperEvaluationExportFlags([`--validate=${filePath}`]));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("validate PASS"));
    logSpy.mockRestore();
  });

  it("trader:gate export path still uses SQLite order repository", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-gate-sqlite-export-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "gate-export.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    const repo = createSqliteOrderRepository(db);
    expect(repo.listOrders).toBeTypeOf("function");

    const gateSource = fs.readFileSync(
      path.join(process.cwd(), "scripts/trader/strategy-gate-cli.ts"),
      "utf8",
    );
    expect(gateSource).toContain("createSqliteOrderRepository(db)");
    expect(gateSource).toContain("buildPaperEvaluationExportDocument");
  });
});
