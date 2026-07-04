import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createLifecycleRecorder, createSqliteLifecycleRepository } from "@/lib/trader/lifecycle";
import {
  GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
  type ExitIntent,
  type GuardianReasonRecord,
} from "@/lib/trader/guardian";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER = "00000000-0000-4000-8000-0000000378";

describe("lifecycle recorder guardian phases (M3 / DEE-378)", () => {
  let orgId: string;
  let lifecycleRepo: ReturnType<typeof createSqliteLifecycleRepository>;
  let recorder: ReturnType<typeof createLifecycleRecorder>;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-guardian-recorder-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "guardian-recorder.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER,
      email: "guardian-recorder@waia.invalid",
      password: "password123",
      identityLabel: "Guardian Recorder Org",
    });

    orgId = ensureUserCoreSeedSqlite(db, { userId: USER, displayName: "Guardian Recorder Org" });
    lifecycleRepo = createSqliteLifecycleRepository(db);
    recorder = createLifecycleRecorder({ repository: lifecycleRepo });
  });

  it("persists GUARDIAN_EVALUATED and GUARDIAN_EXIT_INTENT with JSON payloads", async () => {
    const context = requireOrgContext(orgId);
    const reason: GuardianReasonRecord = {
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      decision: "EXIT_FULL" as const,
      reasonCode: "GUARDIAN_CLOSE_ONLY_PERMISSION",
      ruleId: "CLOSE_ONLY_PERMISSION",
      cycleId: "cycle-378",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
      symbol: "BTC/USDT",
      positionLotId: "lot-378",
      tradeId: "trade-378",
      strategyId: "mean_reversion_v0",
      openingStrategySignalId: "signal-378",
      regime: "RANGE" as const,
      tradingPermission: "ONLY_CLOSE_POSITIONS" as const,
      remainingQty: "0.01",
      avgCost: "64000",
      markPrice: "65000",
      unrealizedPnlUsdt: "10",
      barsHeld: 6,
      slTpLevels: null,
      rMultiple: null,
      invalidation: null,
      patternRefs: [],
      signalRefs: [],
    };

    await recorder.recordGuardianEvaluated({
      context,
      positionLotId: "lot-378",
      reason,
      occurredAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    const intent: ExitIntent = {
      intentId: "cycle-378:lot-378:exit",
      evaluationId: "cycle-378:lot-378",
      kind: "CLOSE_LONG",
      positionLotId: "lot-378",
      tradeId: "trade-378",
      symbol: "BTC/USDT",
      side: "sell",
      quantity: "0.01",
      openingStrategySignalId: "signal-378",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      referencePrice: "65000",
      accountKey: "paper",
      reason,
      clientOrderId: "client-guardian-cycle-378-lot-378",
      idempotencyKey: "idem-guardian-cycle-378-lot-378",
    };

    await recorder.recordGuardianExitIntent({
      context,
      intent,
      occurredAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    const events = await lifecycleRepo.listLifecycleEvents(context, {
      entityType: "POSITION_LOT",
      entityId: "lot-378",
    });

    expect(events.map((e) => e.phase)).toEqual(["GUARDIAN_EVALUATED", "GUARDIAN_EXIT_INTENT"]);
    expect(JSON.parse(events[0]!.payload!)).toMatchObject({
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      reasonCode: "GUARDIAN_CLOSE_ONLY_PERMISSION",
    });
    expect(JSON.parse(events[1]!.payload!)).toMatchObject({
      intentId: "cycle-378:lot-378:exit",
      quantity: "0.01",
    });
  });
});
