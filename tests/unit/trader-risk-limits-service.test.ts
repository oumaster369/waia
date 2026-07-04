import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  RiskLimitsValidationError,
  toCapitalLimitsConfig,
  toTradeAbuseLimitsConfig,
} from "@/lib/trader/risk/limits";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a239";

describe("trader risk limits service (DEE-239)", () => {
  let orgA: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-risk-limits-svc-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "risk-limits-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "risk-limits-svc-a@waia.invalid",
      password: "password123",
      identityLabel: "Risk Limits Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Risk Limits Org A" });
  });

  function createService() {
    const db = getDb();
    const writeAudit = vi.fn(() => "audit-id");
    const service = createSqliteRiskLimitsService(db, { writeAudit });
    return { service, writeAudit, context: requireOrgContext(orgA) };
  }

  it("getLimitsForOrg returns null when no row exists", async () => {
    const { service, context } = createService();
    await expect(service.getLimitsForOrg(context)).resolves.toBeNull();
  });

  it("getOrCreateLimitsForOrg inserts defaults and is idempotent", async () => {
    const { service, writeAudit, context } = createService();

    const first = await service.getOrCreateLimitsForOrg(context);
    const second = await service.getOrCreateLimitsForOrg(context);

    expect(first.id).toBe(second.id);
    expect(first.configVersion).toBe(1);
    expect(first.configVersion).toBe(second.configVersion);
    expect(first.updatedAt.getTime()).toBe(second.updatedAt.getTime());
    expect(first.allowedSymbols).toEqual(DEFAULT_ORG_RISK_LIMITS.allowedSymbols);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.riskLimitsCreated,
        entityType: traderEntityTypes.riskLimits,
      }),
    );
  });

  it("upsertLimitsForOrg updates changed values and bumps configVersion", async () => {
    const { service, writeAudit, context } = createService();

    await service.getOrCreateLimitsForOrg(context);
    writeAudit.mockClear();

    const updated = await service.upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxNotional: "20000.00",
    });

    expect(updated.configVersion).toBe(2);
    expect(updated.maxNotional).toBe("20000");
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.riskLimitsUpdated,
        metadata: expect.objectContaining({
          changedFields: ["maxNotional"],
          configVersion: 2,
        }),
      }),
    );
  });

  it("upsertLimitsForOrg with identical normalized values is a no-op", async () => {
    const { service, writeAudit, context } = createService();

    const created = await service.getOrCreateLimitsForOrg(context);
    writeAudit.mockClear();

    const noop = await service.upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
    });

    expect(noop.id).toBe(created.id);
    expect(noop.configVersion).toBe(created.configVersion);
    expect(noop.updatedAt.getTime()).toBe(created.updatedAt.getTime());
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("normalizes allowedSymbols before persistence and treats reorder as no-op", async () => {
    const { service, writeAudit, context } = createService();

    const created = await service.upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
      allowedSymbols: [" btc/usdt ", "BTC/USDT", "ETH/USDT"],
    });

    expect(created.allowedSymbols).toEqual(["BTC/USDT", "ETH/USDT"]);
    writeAudit.mockClear();

    const noop = await service.upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
      allowedSymbols: ["ETH/USDT", "BTC/USDT"],
    });

    expect(noop.allowedSymbols).toEqual(["BTC/USDT", "ETH/USDT"]);
    expect(noop.configVersion).toBe(created.configVersion);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("treats decimal-equivalent values as no-op", async () => {
    const { service, writeAudit, context } = createService();

    const created = await service.getOrCreateLimitsForOrg(context);
    writeAudit.mockClear();

    const noop = await service.upsertLimitsForOrg(context, {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxDailyLoss: "500.00",
    });

    expect(noop.configVersion).toBe(created.configVersion);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects invalid symbol format after normalization", async () => {
    const { service, context } = createService();

    await expect(
      service.upsertLimitsForOrg(context, {
        ...DEFAULT_ORG_RISK_LIMITS,
        allowedSymbols: ["INVALID"],
      }),
    ).rejects.toThrow(RiskLimitsValidationError);
  });

  it("rejects non-positive decimals and invalid integers", async () => {
    const { service, context } = createService();

    await expect(
      service.upsertLimitsForOrg(context, {
        ...DEFAULT_ORG_RISK_LIMITS,
        maxNotional: "0",
      }),
    ).rejects.toThrow(RiskLimitsValidationError);

    await expect(
      service.upsertLimitsForOrg(context, {
        ...DEFAULT_ORG_RISK_LIMITS,
        collarBps: 20_000,
      }),
    ).rejects.toThrow(RiskLimitsValidationError);
  });

  it("maps metadata to evaluator config shapes", async () => {
    const { service, context } = createService();

    const metadata = await service.getOrCreateLimitsForOrg(context);

    expect(toTradeAbuseLimitsConfig(metadata)).toEqual({
      allowedSymbols: metadata.allowedSymbols,
      maxNotional: metadata.maxNotional,
      maxOrdersPerWindow: metadata.maxOrdersPerWindow,
      windowMs: metadata.windowMs,
      collarBps: metadata.collarBps,
    });
    expect(toCapitalLimitsConfig(metadata)).toEqual({
      maxPositionPerSymbol: metadata.maxPositionPerSymbol,
      maxDailyLoss: metadata.maxDailyLoss,
      maxDrawdown: metadata.maxDrawdown,
      maxOpenOrders: metadata.maxOpenOrders,
      maxQuoteExposure: metadata.maxQuoteExposure,
      maxRiskPerTradePct: metadata.maxRiskPerTradePct,
      maxPortfolioRiskPct: metadata.maxPortfolioRiskPct,
      maxConcurrentPositions: metadata.maxConcurrentPositions,
    });
  });
});
