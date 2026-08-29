import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { computeObservationKey } from "@/lib/trader/mi/serialize-observation";
import { createSqliteMiObservationService } from "@/lib/trader/mi/observation-service";
import { createSqliteMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import { serializeMsvPayloadJson } from "@/lib/trader/mi/serialize-observation";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a281a";
const USER_B = "00000000-0000-4000-8000-00000000b281b";
const MARKET_KNOWABLE_TIME = "2026-06-22T10:00:00.000Z";

describe("trader mi observation tenant isolation (DEE-281 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let sourceA: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-obs-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-observation-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-obs-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Obs Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-obs-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Obs Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Obs Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Obs Org B" });

    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    const source = await sourceRepo.insertSource(
      { organizationId: orgA },
      {
        venue: "internal",
        feedKind: "msv_envelope",
        symbol: null,
        description: "A",
        status: "active",
      },
      crypto.randomUUID(),
      new Date(),
    );
    sourceA = source.id;
  });

  it("org B cannot read org A observations via service", async () => {
    const db = getDb();
    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    const serviceA = createSqliteMiObservationService(db, sourceRepo).observation;
    const serviceB = createSqliteMiObservationService(db, sourceRepo).observation;

    const eventTime = new Date(MARKET_KNOWABLE_TIME);
    const observationKey = computeObservationKey({
      organizationId: orgA,
      sourceId: sourceA,
      observationKind: "msv_envelope",
      subjectRef: "BTC/USDT",
      eventTime,
    });

    await serviceA.recordObservation(
      { organizationId: orgA },
      {
        sourceId: sourceA,
        observationKind: "msv_envelope",
        subjectRef: "BTC/USDT",
        payloadJson: serializeMsvPayloadJson({
          msvId: "x",
          instrumentId: "BTC/USDT",
          evaluatedAt: MARKET_KNOWABLE_TIME,
          featureSetId: "y",
          physics: { close: "1", zscoreVsSma20: "0", priceDispersion20: "0" },
          liquidity: { spreadBps: "0" },
          crowd: { fearGreedIndex: null, newsSentiment: "0" },
          futureContext: { eventRiskScore: "0" },
          derived: {
            regime: "RANGE",
            tradingPermission: "ALLOW_TRADING",
            allowedStrategyIds: ["mean_reversion_v0"],
            riskMultiplier: "1.0",
            dataQualityScore: 1,
            reasonCodes: [],
          },
        }),
        eventTime,
        ingestTime: new Date("2026-06-22T10:00:01.000Z"),
        observedBy: USER_A,
      },
    );

    const crossRead = await serviceB.getLatestObservation({ organizationId: orgB }, observationKey);
    expect(crossRead).toBeNull();

    const orgBList = await serviceB.listObservations({ organizationId: orgB });
    expect(orgBList).toHaveLength(0);
  });

  it("org B cannot insert observation referencing org A source", async () => {
    const db = getDb();
    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    const serviceB = createSqliteMiObservationService(db, sourceRepo).observation;

    await expect(
      serviceB.recordObservation(
        { organizationId: orgB },
        {
          sourceId: sourceA,
          observationKind: "msv_envelope",
          subjectRef: "BTC/USDT",
          payloadJson: "{}",
          eventTime: new Date(MARKET_KNOWABLE_TIME),
          ingestTime: new Date("2026-06-22T10:00:02.000Z"),
          observedBy: USER_B,
        },
      ),
    ).rejects.toThrow();
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
