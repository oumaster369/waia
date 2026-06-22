import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiSourceTrust } from "@/db/schema";
import { MiSourceDuplicateError, PitViolationError } from "@/lib/trader/mi/errors";
import { normalizeTrustScore } from "@/lib/trader/mi/normalize-trust-score";
import {
  buildSourceTrustDigestInput,
  computeSourceTrustDigest,
} from "@/lib/trader/mi/serialize-source-trust";
import { createSqliteMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a279";
const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000b279";
const GOLDEN_SOURCE_ID = "00000000-0000-4000-8000-00000000c279";

describe("trader mi source provenance (DEE-279 / LD-2a)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-source-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-source.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-source@waia.invalid",
      password: "password123",
      identityLabel: "MI Source User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Source User",
    });
  });

  it("golden digest fixture pins canonical serialization", () => {
    const digestInput = buildSourceTrustDigestInput({
      organizationId: GOLDEN_ORG_ID,
      sourceId: GOLDEN_SOURCE_ID,
      trustScore: normalizeTrustScore("0.5"),
      rationale: "initial",
      recordedBy: "operator-1",
      eventTime: new Date("2026-06-22T08:00:00.000Z"),
      ingestTime: new Date("2026-06-22T08:00:01.000Z"),
      revisionOf: null,
      revisionSeq: 1,
    });

    const digest = computeSourceTrustDigest(digestInput);
    expect(digest).toBe("16d90e37d5224b65e173fad1789a4b6edd10ebe763aef30c36dbe0aba0710183");
    expect(computeSourceTrustDigest(digestInput)).toBe(digest);
  });

  it("creates source, appends trust revisions, and derives current trust", async () => {
    const db = getDb();
    const service = createSqliteMiSourceProvenanceService(db, {
      actorType: "user",
      actorId: USER_ID,
    });

    const source = await service.createSource(
      { organizationId },
      {
        venue: "htx",
        feedKind: "spot_ohlcv",
        symbol: "BTCUSDT",
        description: "HTX BTC/USDT spot OHLCV",
      },
    );

    const eventTime = new Date("2026-06-22T10:00:00.000Z");
    const ingestTime = new Date("2026-06-22T10:00:01.000Z");
    const first = await service.appendTrustRevision(
      { organizationId },
      {
        sourceId: source.id,
        trustScore: "0.75",
        rationale: "operator initial trust",
        recordedBy: USER_ID,
        eventTime,
        ingestTime,
      },
    );

    const secondEvent = new Date("2026-06-22T11:00:00.000Z");
    const secondIngest = new Date("2026-06-22T11:00:01.000Z");
    const second = await service.appendTrustRevision(
      { organizationId },
      {
        sourceId: source.id,
        trustScore: "0.80",
        rationale: "operator revised trust",
        recordedBy: USER_ID,
        eventTime: secondEvent,
        ingestTime: secondIngest,
      },
    );

    expect(first.revisionSeq).toBe(1);
    expect(first.revisionOf).toBeNull();
    expect(second.revisionSeq).toBe(2);
    expect(second.revisionOf).toBe(first.id);

    const current = await service.getCurrentTrust({ organizationId }, source.id);
    expect(current?.id).toBe(second.id);
    expect(current?.trustScore).toBe(normalizeTrustScore("0.80"));

    const history = await service.getTrustHistory({ organizationId }, source.id);
    expect(history.map((row) => row.revisionSeq)).toEqual([1, 2]);
  });

  it("rejects duplicate logical source keys", async () => {
    const db = getDb();
    const service = createSqliteMiSourceProvenanceService(db);

    await service.createSource(
      { organizationId },
      { venue: "htx", feedKind: "spot_ohlcv", symbol: "ETHUSDT" },
    );

    await expect(
      service.createSource(
        { organizationId },
        { venue: "htx", feedKind: "spot_ohlcv", symbol: "ETHUSDT" },
      ),
    ).rejects.toThrow(MiSourceDuplicateError);
  });

  it("rejects ingest_time before event_time", async () => {
    const db = getDb();
    const service = createSqliteMiSourceProvenanceService(db);
    const source = await service.createSource(
      { organizationId },
      { venue: "htx", feedKind: "fear_greed", symbol: null },
    );

    await expect(
      service.appendTrustRevision(
        { organizationId },
        {
          sourceId: source.id,
          trustScore: "0.5",
          rationale: "bad pit",
          recordedBy: USER_ID,
          eventTime: new Date("2026-06-22T12:00:00.000Z"),
          ingestTime: new Date("2026-06-22T11:00:00.000Z"),
        },
      ),
    ).rejects.toThrow(PitViolationError);
  });

  it("digest changes when any included field changes", async () => {
    const base = buildSourceTrustDigestInput({
      organizationId,
      sourceId: GOLDEN_SOURCE_ID,
      trustScore: normalizeTrustScore("0.5"),
      rationale: "rationale",
      recordedBy: USER_ID,
      eventTime: new Date("2026-06-22T08:00:00.000Z"),
      ingestTime: new Date("2026-06-22T08:00:01.000Z"),
      revisionOf: null,
      revisionSeq: 1,
    });
    const baseDigest = computeSourceTrustDigest(base);
    const changed = computeSourceTrustDigest({
      ...base,
      rationale: "different rationale",
    });
    expect(changed).not.toBe(baseDigest);
  });

  it("trust history is append-only at the DB level", async () => {
    const db = getDb();
    const service = createSqliteMiSourceProvenanceService(db);
    const source = await service.createSource(
      { organizationId },
      { venue: "htx", feedKind: "macro_calendar", symbol: null },
    );
    const revision = await service.appendTrustRevision(
      { organizationId },
      {
        sourceId: source.id,
        trustScore: "0.9",
        rationale: "append-only test",
        recordedBy: USER_ID,
        eventTime: new Date("2026-06-22T09:00:00.000Z"),
        ingestTime: new Date("2026-06-22T09:00:01.000Z"),
      },
    );

    expect(() =>
      db
        .update(traderMiSourceTrust)
        .set({ rationale: "tampered" })
        .where(eq(traderMiSourceTrust.id, revision.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      db.delete(traderMiSourceTrust).where(eq(traderMiSourceTrust.id, revision.id)).run(),
    ).toThrow(/append-only/i);
  });

  it("writes canonical audit rows for create, status change, and trust append", async () => {
    const db = getDb();
    const service = createSqliteMiSourceProvenanceService(db, {
      actorType: "user",
      actorId: USER_ID,
    });

    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    const source = await service.createSource(
      { organizationId },
      { venue: "htx", feedKind: "stablecoin_peg", symbol: "USDT" },
    );

    await service.setSourceStatus({ organizationId }, source.id, { status: "deprecated" });

    await service.appendTrustRevision(
      { organizationId },
      {
        sourceId: source.id,
        trustScore: "0.6",
        rationale: "audit test",
        recordedBy: USER_ID,
        eventTime: new Date("2026-06-22T13:00:00.000Z"),
        ingestTime: new Date("2026-06-22T13:00:01.000Z"),
      },
    );

    const rows = db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        organizationId: auditLogs.organizationId,
      })
      .from(auditLogs)
      .all()
      .slice(beforeCount);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: traderAuditActions.miSourceCreated,
          entityType: traderEntityTypes.miSource,
          organizationId,
        }),
        expect.objectContaining({
          action: traderAuditActions.miSourceStatusChanged,
          entityType: traderEntityTypes.miSource,
          organizationId,
        }),
        expect.objectContaining({
          action: traderAuditActions.miSourceTrustAppended,
          entityType: traderEntityTypes.miSourceTrust,
          organizationId,
        }),
      ]),
    );
  });
});
