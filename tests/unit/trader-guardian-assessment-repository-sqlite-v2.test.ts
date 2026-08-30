import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { getDb, getRawSqliteDatabase, resetWaiaSqliteSingleton } from "@/db/client";
import {
  buildGuardianAssessmentV2,
  buildProtectiveMandateConsumptionV2,
  createSqliteGuardianAssessmentRepositoryV2,
  createSqliteProtectiveMandateConsumptionRepositoryV2,
} from "@/lib/trader/guardian/v2";
import {
  createSqliteLifecycleRepository,
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
} from "@/lib/trader/lifecycle";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER = "00000000-0000-4000-8000-0000000636a";
const hex = (character: string) => character.repeat(64);

describe("GuardianAssessmentRepositoryV2 SQLite", () => {
  let organizationId: string;
  let tradeId: string;
  let lotId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-guardian-v2-repo-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "guardian-v2.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER,
      email: "guardian-v2-repo@waia.invalid",
      password: "password123",
      identityLabel: "Guardian V2 Repo",
    });
    organizationId = ensureUserCoreSeedSqlite(db, { userId: USER, displayName: "Guardian V2 Repo" });
    tradeId = crypto.randomUUID();
    lotId = crypto.randomUUID();
    const context = requireOrgContext(organizationId);
    const lifecycle = createSqliteLifecycleRepository(db);
    const openedAt = new Date("2026-08-30T00:00:00.000Z");
    await lifecycle.insertTrade(context, { trade: {
      id: tradeId, organizationId, symbol: "BTCUSDT", venue: "HTX", accountKey: "account-a",
      positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "signal-a",
      strategyId: "strategy-a", strategyVersion: "v1", state: "OPEN",
      semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2, openedAt, closedAt: null,
      realizedPnl: "0", markedPnl: "0", hypothesisId: null, patternId: null,
      riskDecisionId: "risk-a", allocationDecisionId: null, reasoningSessionId: null,
      signalConfidence: null, openingRegime: null, openingMsvId: null, openingFeatureSetId: null,
      closingMsvId: null, closingFeatureSetId: null, closingRegime: null, frozenAt: null,
    } });
    await lifecycle.insertPositionLot(context, { lot: {
      id: lotId, organizationId, symbol: "BTCUSDT", venue: "HTX", accountKey: "account-a",
      positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "signal-a", state: "OPEN",
      openQty: "1", remainingQty: "1", avgCost: "60000", openedAt, closedAt: null,
      tradeId, hedgeGroupId: null, targetLotId: null,
    } });
  });

  const makeAssessment = () => buildGuardianAssessmentV2({
    organizationId, positionId: tradeId, lotId, symbol: "BTCUSDT",
    openingCausalLineageDigest: hex("1"), realityFrontierId: "reality-a",
    realityContentDigest: hex("2"), qualifiedEvidenceBundleId: "evidence-a",
    qualifiedEvidenceContentDigest: hex("3"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
    openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT",
    recommendation: "HOLD", targetReductionBps: 0, reasonCodes: ["THESIS_INTACT"],
  });

  it("survives restart and remains idempotent", async () => {
    const context = requireOrgContext(organizationId);
    const value = makeAssessment();
    await createSqliteGuardianAssessmentRepositoryV2(getDb()).append(context, value);
    resetWaiaSqliteSingleton();
    const restarted = createSqliteGuardianAssessmentRepositoryV2(getDb());
    await expect(restarted.append(context, value)).resolves.toEqual(value);
    await expect(restarted.listByLot(context, lotId)).resolves.toEqual([value]);
    await expect(restarted.getById(requireOrgContext(crypto.randomUUID()), value.assessmentId)).resolves.toBeNull();
  });

  it("converges concurrent replays to the same immutable row", async () => {
    const context = requireOrgContext(organizationId);
    const value = makeAssessment();
    const repository = createSqliteGuardianAssessmentRepositoryV2(getDb());
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.append(context, value)));
    expect(results).toEqual(Array.from({ length: 8 }, () => value));
    await expect(repository.listByLot(context, lotId)).resolves.toEqual([value]);
  });

  it("blocks update, delete and cross-tenant foreign-key substitution in the database", () => {
    const raw = getRawSqliteDatabase();
    const value = makeAssessment();
    expect(() => raw.prepare(
      "UPDATE trader_guardian_assessments_v2 SET symbol = 'ETHUSDT' WHERE assessment_id = ?",
    ).run(value.assessmentId)).toThrow(/GUARDIAN_ASSESSMENT_V2_APPEND_ONLY/);
    expect(() => raw.prepare(
      "DELETE FROM trader_guardian_assessments_v2 WHERE assessment_id = ?",
    ).run(value.assessmentId)).toThrow(/GUARDIAN_ASSESSMENT_V2_APPEND_ONLY/);
    expect(() => raw.prepare(
      "UPDATE trader_guardian_assessments_v2 SET organization_id = ? WHERE assessment_id = ?",
    ).run(crypto.randomUUID(), value.assessmentId)).toThrow();
  });

  it("atomically consumes a mandate once across concurrency and restart", async () => {
    const value = buildProtectiveMandateConsumptionV2({
      organizationId, mandateId: "protective-mandate-v2:once",
      mandateContentDigest: hex("4"), triggerProofContentDigest: hex("5"),
      adjudicatedAtUtc: "2026-08-30T00:00:31.000Z",
    });
    const repository = createSqliteProtectiveMandateConsumptionRepositoryV2(getDb());
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.claimOnce(value)));
    expect(results.filter((result) => result === "CLAIMED")).toHaveLength(1);
    expect(results.filter((result) => result === "ALREADY_CONSUMED")).toHaveLength(7);
    resetWaiaSqliteSingleton();
    await expect(createSqliteProtectiveMandateConsumptionRepositoryV2(getDb()).claimOnce(value))
      .resolves.toBe("ALREADY_CONSUMED");
    expect(() => getRawSqliteDatabase().prepare(
      "DELETE FROM trader_guardian_protective_consumptions_v2 WHERE mandate_id = ?",
    ).run(value.mandateId)).toThrow(/GUARDIAN_PROTECTIVE_CONSUMPTION_V2_APPEND_ONLY/);
  });
});
