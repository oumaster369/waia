import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getDb } from "@/db/client";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import {
  assertStrategyLiveAuthorized,
  buildAssembleInput,
  createSqliteStrategyPromotionService,
  parseOperatorPromotionInputs,
  parsePaperEvaluationExportDocument,
  StrategyPromotionCoolingOffNotElapsedError,
  StrategyPromotionRequiredError,
  StrategyPromotionValidationError,
  StrategyPromotionVersionMismatchError,
} from "@/lib/trader/validation-gate";
import type { StrategyPromotionService } from "@/lib/trader/validation-gate";
import { listAuditLogsForEntitySqlite } from "@/lib/waia-core/audit/read";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { HANDLERS, parseFlags } from "@/scripts/trader/strategy-gate-cli";

const USER = "00000000-0000-4000-8000-0000000277r";
const SIGNAL = "signal-277-runway";
const ACTOR = { actorType: "admin" as const, actorId: USER };

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">, orgId: string): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "64000",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-277",
    strategySignalId: SIGNAL,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: orgId,
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
        price: order.avgFillPrice ?? "100",
        quantity: "0.01",
        fee: "0",
        feeAsset: "USDT",
        executedAt: new Date(150),
        createdAt: new Date(150),
      },
    ];
  }
  return {
    createOrder: async () => {
      throw new Error("not implemented");
    },
    getOrderById: async () => null,
    findOrderByClientOrderId: async () => null,
    findOrderByIdempotencyKey: async () => null,
    listOpenOrders: async () => [],
    listOrders: async (context) =>
      orders.filter((order) => order.organizationId === context.organizationId),
    transitionOrder: async () => {
      throw new Error("not implemented");
    },
    recordFill: async () => {
      throw new Error("not implemented");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

async function evidenceDocumentJson(orgId: string): Promise<string> {
  const document = await buildPaperEvaluationExportDocument({
    context: requireOrgContext(orgId),
    orderRepository: mockRepository([
      mockOrder({ id: "rw-buy", avgFillPrice: "100" }, orgId),
      mockOrder({ id: "rw-sell", side: "sell", avgFillPrice: "110" }, orgId),
    ]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [SIGNAL],
    executionMode: "paper",
    exportedAt: new Date("2026-06-18T12:00:00.000Z"),
  });
  return JSON.stringify(document);
}

function inputsJson(strategyId: string, strategyVersion = "0.1.0"): string {
  return JSON.stringify({
    strategyId,
    strategyVersion,
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "25" },
    failureModes: ["liquidity vacuum -> exposure cap"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  });
}

async function assemblyFor(orgId: string, strategyId: string, strategyVersion = "0.1.0") {
  const document = parsePaperEvaluationExportDocument(await evidenceDocumentJson(orgId));
  const inputs = parseOperatorPromotionInputs(inputsJson(strategyId, strategyVersion));
  return buildAssembleInput({
    organizationId: orgId,
    inputs,
    document,
    researchEvidenceDocument: buildValidResearchEvidenceDocument(orgId, {
      strategyId,
      strategyVersion,
    }),
  });
}

describe("strategy gate operator runway (DEE-277 S2–S4)", () => {
  let org: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-gate-runway-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "gate-runway.sqlite")}`;
    process.env.TRADER_PROMOTION_COOLING_OFF_MS = "1000";
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER,
      email: "gate-runway@waia.invalid",
      password: "password123",
      identityLabel: "Gate Runway",
    });
    org = ensureUserCoreSeedSqlite(db, { userId: USER, displayName: "Gate Runway Org" });
  });

  function makeService(now: { value: number }): StrategyPromotionService {
    return createSqliteStrategyPromotionService(getDb(), { nowMs: () => now.value });
  }

  it("runs export→request→confirm→effective via env-driven cooling-off, with ordered audit chain", async () => {
    const now = { value: Date.now() };
    const service = makeService(now);
    const context = requireOrgContext(org);

    const requested = await service.requestPromotion(ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await assemblyFor(org, "rw_happy"),
    });
    expect(requested.state).toBe("PENDING_CONFIRM");

    // Confirm WITHOUT a cooling-off override (CLI never forwards one) -> env-driven 1000ms.
    const confirmed = await service.confirmPromotion(ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
    });
    expect(confirmed.state).toBe("COOLING_OFF");

    await expect(
      service.markEffective(ACTOR, context, requested.id, {
        expectedStateVersion: confirmed.stateVersion,
      }),
    ).rejects.toThrow(StrategyPromotionCoolingOffNotElapsedError);

    now.value += 1000;
    const effective = await service.markEffective(ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });
    expect(effective.state).toBe("EFFECTIVE");

    const chain = listAuditLogsForEntitySqlite(getDb(), {
      organizationId: org,
      entityType: traderEntityTypes.strategyPromotion,
      entityId: requested.id,
    }).map((row) => row.action);

    expect(chain).toEqual([
      traderAuditActions.promotionRequested,
      traderAuditActions.promotionConfirmed,
      traderAuditActions.promotionEffective,
    ]);
  });

  it("is idempotent on repeated request with the same key", async () => {
    const now = { value: Date.now() };
    const service = makeService(now);
    const context = requireOrgContext(org);
    const key = randomUUID();

    const first = await service.requestPromotion(ACTOR, context, {
      idempotencyKey: key,
      assembly: await assemblyFor(org, "rw_idem"),
    });
    const second = await service.requestPromotion(ACTOR, context, {
      idempotencyKey: key,
      assembly: await assemblyFor(org, "rw_idem"),
    });
    expect(second.id).toBe(first.id);
  });

  it("fails closed on tampered evidence (digest mismatch)", async () => {
    const now = { value: Date.now() };
    const service = makeService(now);
    const context = requireOrgContext(org);

    const raw = await evidenceDocumentJson(org);
    const mutated = JSON.parse(raw);
    mutated.evidenceBody.orgPeriodRollup.periodRealizedPnl = "999999";
    const document = parsePaperEvaluationExportDocument(JSON.stringify(mutated));
    const inputs = parseOperatorPromotionInputs(inputsJson("rw_tamper"));
    const assembly = buildAssembleInput({
      organizationId: org,
      inputs,
      document,
      researchEvidenceDocument: buildValidResearchEvidenceDocument(org, {
        strategyId: "rw_tamper",
      }),
    });

    await expect(
      service.requestPromotion(ACTOR, context, { idempotencyKey: randomUUID(), assembly }),
    ).rejects.toThrow(StrategyPromotionValidationError);
  });

  it("enforces version-bound authorization and demotion", async () => {
    const now = { value: Date.now() };
    const service = makeService(now);
    const context = requireOrgContext(org);

    const requested = await service.requestPromotion(ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await assemblyFor(org, "rw_authz", "1.0.0"),
    });
    const confirmed = await service.confirmPromotion(ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
    });
    now.value += 1000;
    const effective = await service.markEffective(ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });

    expect(
      await service.isLiveAuthorized(context, { strategyId: "rw_authz", strategyVersion: "1.0.0" }),
    ).toBe(true);
    expect(
      await service.isLiveAuthorized(context, { strategyId: "rw_authz", strategyVersion: "1.0.1" }),
    ).toBe(false);
    await expect(
      assertStrategyLiveAuthorized(service, context, {
        strategyId: "rw_authz",
        strategyVersion: "1.0.1",
      }),
    ).rejects.toThrow(StrategyPromotionVersionMismatchError);

    const demoted = await service.demoteStrategy(ACTOR, context, "rw_authz", {
      expectedStateVersion: effective.stateVersion,
      reason: "operator review",
    });
    expect(demoted.state).toBe("REVOKED");

    expect(
      await service.isLiveAuthorized(context, { strategyId: "rw_authz", strategyVersion: "1.0.0" }),
    ).toBe(false);
    await expect(
      assertStrategyLiveAuthorized(service, context, {
        strategyId: "rw_authz",
        strategyVersion: "1.0.0",
      }),
    ).rejects.toThrow(StrategyPromotionRequiredError);
  });

  it("cancels during cooling-off", async () => {
    const now = { value: Date.now() };
    const service = makeService(now);
    const context = requireOrgContext(org);

    const requested = await service.requestPromotion(ACTOR, context, {
      idempotencyKey: randomUUID(),
      assembly: await assemblyFor(org, "rw_cancel"),
    });
    const confirmed = await service.confirmPromotion(ACTOR, context, requested.id, {
      expectedStateVersion: requested.stateVersion,
    });
    const cancelled = await service.cancelPromotion(ACTOR, context, requested.id, {
      expectedStateVersion: confirmed.stateVersion,
    });
    expect(cancelled.state).toBe("CANCELLED");
  });

  it("audit reader returns empty for an unknown record id", () => {
    const rows = listAuditLogsForEntitySqlite(getDb(), {
      organizationId: org,
      entityType: traderEntityTypes.strategyPromotion,
      entityId: "does-not-exist",
    });
    expect(rows).toEqual([]);
  });
});

describe("strategy gate CLI arg parsing (DEE-277 S3)", () => {
  it("parses allowed --key=value flags", () => {
    const flags = parseFlags(["--org-id=abc", "--record-id=r1"], ["org-id", "record-id"]);
    expect(flags.get("org-id")).toBe("abc");
    expect(flags.get("record-id")).toBe("r1");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["--mystery=1"], ["org-id"])).toThrowError(/Unknown flag/);
  });

  it("rejects a cooling-off override on confirm (no such flag exists)", () => {
    expect(() => parseFlags(["--cooling-off-ms=1"], HANDLERS.confirm.allowed)).toThrowError(
      /Unknown flag/,
    );
    expect(HANDLERS.confirm.allowed).not.toContain("cooling-off-ms");
    expect(HANDLERS.effective.allowed).not.toContain("cooling-off-ms");
  });

  it("rejects positional / malformed arguments", () => {
    expect(() => parseFlags(["positional"], ["org-id"])).toThrowError(/Unexpected positional/);
    expect(() => parseFlags(["--flag"], ["flag"])).toThrowError(/--key=value/);
  });
});
