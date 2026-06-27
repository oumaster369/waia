import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiObservation } from "@/db/schema";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, MsvEnvelope } from "@/lib/trader/intelligence/types";
import { EventTimeNotKnowableError, PitViolationError } from "@/lib/trader/mi/errors";
import {
  MI_MSV_INTERNAL_SOURCE,
  MI_OBSERVATION_SCHEMA_VERSION,
} from "@/lib/trader/mi/observation.types";
import {
  createSqliteMiObservationService,
  resolveMsvMarketKnowableEventTime,
} from "@/lib/trader/mi/observation-service";
import { createSqliteMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import {
  buildMsvPayloadCanonical,
  buildObservationDigestFromMsv,
  computeObservationDigest,
  computeObservationKey,
  normalizeDataQualityScore,
  parseMsvPayloadJson,
  serializeMsvPayloadJson,
} from "@/lib/trader/mi/serialize-observation";
import {
  MI_OBSERVATION_PERSIST_FAILED_CODE,
  recordMsvObservationSafe,
} from "@/lib/trader/mi/record-msv-observation-safe";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a281";
const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000b281";
const GOLDEN_SOURCE_ID = "00000000-0000-4000-8000-00000000c281";
const MARKET_KNOWABLE_TIME = "2026-06-22T10:00:00.000Z";

const SAMPLE_BARS: Bar[] = Array.from({ length: 20 }, (_, index) => ({
  symbol: "BTC/USDT",
  interval: "1m" as const,
  open: "100",
  high: "101",
  low: "99",
  close: index === 19 ? "100.5" : "100",
  volume: "1",
  barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
  barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
}));

function buildSampleMsv(overrides?: {
  msvId?: string;
  featureSetId?: string;
  evaluatedAt?: string;
}): MsvEnvelope {
  const features = computeFeatureSnapshot({ bars: SAMPLE_BARS, evaluatedAt: MARKET_KNOWABLE_TIME });
  const msv = buildMsvEnvelope({ features, newId: () => "fixed-id-for-test" });
  return {
    ...msv,
    msvId: overrides?.msvId ?? "random-msv-id-1",
    featureSetId: overrides?.featureSetId ?? "random-feature-set-1",
    evaluatedAt: overrides?.evaluatedAt ?? MARKET_KNOWABLE_TIME,
  };
}

describe("trader mi observation (DEE-281 / LD-2b)", () => {
  let organizationId: string;
  let sourceId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-obs-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-observation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-obs@waia.invalid",
      password: "password123",
      identityLabel: "MI Observation User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Observation User",
    });

    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    const source = await sourceRepo.insertSource(
      { organizationId },
      {
        venue: MI_MSV_INTERNAL_SOURCE.venue,
        feedKind: MI_MSV_INTERNAL_SOURCE.feedKind,
        symbol: MI_MSV_INTERNAL_SOURCE.symbol,
        description: MI_MSV_INTERNAL_SOURCE.description,
        status: "active",
      },
      GOLDEN_SOURCE_ID,
      new Date("2026-06-22T08:00:00.000Z"),
    );
    sourceId = source.id;
  });

  function createServices() {
    const db = getDb();
    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    return createSqliteMiObservationService(db, sourceRepo, {
      actorType: "user",
      actorId: USER_ID,
    });
  }

  it("golden observation key fixture pins deterministic identity (R1)", () => {
    const key = computeObservationKey({
      organizationId: GOLDEN_ORG_ID,
      sourceId: GOLDEN_SOURCE_ID,
      observationKind: "msv_envelope",
      subjectRef: "BTC/USDT",
      eventTime: new Date(MARKET_KNOWABLE_TIME),
    });
    expect(key).toBe("756053b098f2b4cbd59a1dc61cc836e9b820b34b5f2bd06b6b1a7bed5cab0871");
    expect(
      computeObservationKey({
        organizationId: GOLDEN_ORG_ID,
        sourceId: GOLDEN_SOURCE_ID,
        observationKind: "msv_envelope",
        subjectRef: "BTC/USDT",
        eventTime: new Date(MARKET_KNOWABLE_TIME),
      }),
    ).toBe(key);
  });

  it("observation_key is independent of random MSV ids (R1)", () => {
    const msvA = buildSampleMsv({ msvId: "uuid-a", featureSetId: "uuid-a-feature" });
    const msvB = buildSampleMsv({ msvId: "uuid-b", featureSetId: "uuid-b-feature" });
    const eventTime = new Date(MARKET_KNOWABLE_TIME);

    const keyA = computeObservationKey({
      organizationId,
      sourceId,
      observationKind: "msv_envelope",
      subjectRef: msvA.instrumentId,
      eventTime,
    });
    const keyB = computeObservationKey({
      organizationId,
      sourceId,
      observationKind: "msv_envelope",
      subjectRef: msvB.instrumentId,
      eventTime,
    });
    expect(keyA).toBe(keyB);

    const digestA = buildObservationDigestFromMsv({
      organizationId,
      sourceId,
      observationKey: keyA,
      observationKind: "msv_envelope",
      subjectRef: msvA.instrumentId,
      eventTime,
      msv: msvA,
    });
    const digestB = buildObservationDigestFromMsv({
      organizationId,
      sourceId,
      observationKey: keyB,
      observationKind: "msv_envelope",
      subjectRef: msvB.instrumentId,
      eventTime,
      msv: msvB,
    });
    expect(digestA).toBe(digestB);
  });

  it("digest excludes msvId, featureSetId, ingestTime, and revision metadata (R2)", () => {
    const msv = buildSampleMsv();
    const eventTime = new Date(MARKET_KNOWABLE_TIME);
    const observationKey = computeObservationKey({
      organizationId,
      sourceId,
      observationKind: "msv_envelope",
      subjectRef: msv.instrumentId,
      eventTime,
    });
    const baseDigest = buildObservationDigestFromMsv({
      organizationId,
      sourceId,
      observationKey,
      observationKind: "msv_envelope",
      subjectRef: msv.instrumentId,
      eventTime,
      msv,
    });

    const msvDifferentIds = buildSampleMsv({
      msvId: "other-msv-id",
      featureSetId: "other-feature-set",
    });
    expect(
      buildObservationDigestFromMsv({
        organizationId,
        sourceId,
        observationKey,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        eventTime,
        msv: msvDifferentIds,
      }),
    ).toBe(baseDigest);

    const withIngest = computeObservationDigest({
      schemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
      organizationId,
      sourceId,
      observationKey,
      observationKind: "msv_envelope",
      subjectRef: msv.instrumentId,
      eventTime,
      payloadCanonical: buildMsvPayloadCanonical(msv),
    });
    expect(withIngest).toBe(baseDigest);
  });

  it("normalizes dataQualityScore to fixed-precision decimal string (R2)", () => {
    const canonical = buildMsvPayloadCanonical(buildSampleMsv());
    expect(canonical.derived).toEqual(
      expect.objectContaining({
        dataQualityScore: normalizeDataQualityScore(buildSampleMsv().derived.dataQualityScore),
      }),
    );
    expect(typeof (canonical.derived as { dataQualityScore: unknown }).dataQualityScore).toBe(
      "string",
    );
  });

  it("records MSV observation with provenance and round-trips payload (R3)", async () => {
    const { observation } = createServices();
    const msv = buildSampleMsv({ evaluatedAt: "2026-06-22T10:01:00.000Z" });
    const marketTime = "2026-06-22T10:01:00.000Z";
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });
    const ingestTime = new Date("2026-06-22T10:01:01.000Z");

    const recorded = await observation.recordObservation(
      { organizationId },
      {
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime,
        observedBy: USER_ID,
      },
    );

    expect(recorded.sourceId).toBe(sourceId);
    expect(recorded.observationKind).toBe("msv_envelope");
    expect(recorded.eventTime.toISOString()).toBe(marketTime);
    expect(parseMsvPayloadJson(recorded.payloadJson)).toEqual(msv);
  });

  it("seeds internal MSV source when absent (R3)", async () => {
    const db = getDb();
    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    const { observation } = createSqliteMiObservationService(db, sourceRepo);

    const resolved = await observation.resolveInternalMsvSource({ organizationId });
    expect(resolved.id).toBeTruthy();

    const resolvedAgain = await observation.resolveInternalMsvSource({ organizationId });
    expect(resolvedAgain.id).toBe(resolved.id);
  });

  it("replay of identical PIT MSV produces same observation_key (R1)", async () => {
    const { observation } = createServices();
    const marketTime = "2026-06-22T10:02:00.000Z";
    const msv = buildSampleMsv({ evaluatedAt: marketTime });
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });
    const ingestTime = new Date("2026-06-22T10:02:01.000Z");

    const first = await observation.recordObservation(
      { organizationId },
      {
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime,
        observedBy: USER_ID,
      },
    );

    const replayMsv = buildSampleMsv({
      msvId: "different-on-replay",
      featureSetId: "different-feature-on-replay",
    });
    const replayKey = computeObservationKey({
      organizationId,
      sourceId,
      observationKind: "msv_envelope",
      subjectRef: replayMsv.instrumentId,
      eventTime,
    });
    expect(replayKey).toBe(first.observationKey);
  });

  it("appends revisions on the same deterministic observation_key (R1)", async () => {
    const { observation } = createServices();
    const marketTime = "2026-06-22T10:03:00.000Z";
    const msv = buildSampleMsv({ evaluatedAt: marketTime });
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });

    const first = await observation.recordObservation(
      { organizationId },
      {
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime: new Date("2026-06-22T10:03:01.000Z"),
        observedBy: USER_ID,
      },
    );

    const correctedMsv = {
      ...msv,
      derived: { ...msv.derived, regime: "RANGE" as const },
    };
    const second = await observation.appendObservationRevision(
      { organizationId },
      {
        observationKey: first.observationKey,
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(correctedMsv),
        eventTime,
        ingestTime: new Date("2026-06-22T10:03:02.000Z"),
        observedBy: USER_ID,
      },
    );

    expect(second.observationKey).toBe(first.observationKey);
    expect(second.revisionSeq).toBe(2);
    expect(second.revisionOf).toBe(first.id);

    const current = await observation.getLatestObservation(
      { organizationId },
      first.observationKey,
    );
    expect(current?.id).toBe(second.id);
  });

  it("rejects ingest_time before event_time (PIT)", async () => {
    const { observation } = createServices();
    const msv = buildSampleMsv();

    await expect(
      observation.recordObservation(
        { organizationId },
        {
          sourceId,
          observationKind: "msv_envelope",
          subjectRef: msv.instrumentId,
          payloadJson: serializeMsvPayloadJson(msv),
          eventTime: new Date("2026-06-22T12:00:00.000Z"),
          ingestTime: new Date("2026-06-22T11:00:00.000Z"),
          observedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(PitViolationError);
  });

  it("rejects wall-clock / untraceable evaluatedAt override (R4)", () => {
    expect(() =>
      resolveMsvMarketKnowableEventTime({
        msvEvaluatedAt: "2026-06-22T12:00:00.000Z",
        marketKnowableEventTime: MARKET_KNOWABLE_TIME,
      }),
    ).toThrow(EventTimeNotKnowableError);
  });

  it("observations are append-only at the DB level", async () => {
    const { observation } = createServices();
    const marketTime = "2026-06-22T10:04:00.000Z";
    const msv = buildSampleMsv({ evaluatedAt: marketTime });
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });

    const recorded = await observation.recordObservation(
      { organizationId },
      {
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime: new Date("2026-06-22T10:04:01.000Z"),
        observedBy: USER_ID,
      },
    );

    const db = getDb();
    expect(() =>
      db
        .update(traderMiObservation)
        .set({ payloadJson: "tampered" })
        .where(eq(traderMiObservation.id, recorded.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      db.delete(traderMiObservation).where(eq(traderMiObservation.id, recorded.id)).run(),
    ).toThrow(/append-only/i);
  });

  it("fail-open recorder does not throw and emits telemetry on failure (R5)", async () => {
    const sink = vi.fn();
    const failingService = {
      resolveInternalMsvSource: vi.fn().mockRejectedValue(new Error("db down")),
      recordObservation: vi.fn(),
      appendObservationRevision: vi.fn(),
      getLatestObservation: vi.fn(),
      getObservationHistory: vi.fn(),
      listObservations: vi.fn(),
    };

    await expect(
      recordMsvObservationSafe({
        observationService: failingService,
        context: { organizationId },
        msv: buildSampleMsv(),
        marketKnowableEventTime: MARKET_KNOWABLE_TIME,
        telemetrySink: sink,
      }),
    ).resolves.toBeUndefined();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual(
      expect.objectContaining({
        organization_id: organizationId,
        domain: "mi_observation",
        code: MI_OBSERVATION_PERSIST_FAILED_CODE,
      }),
    );
  });

  it("fail-open recorder does not affect evaluation cycle result (R5)", async () => {
    const cycleInput = {
      organizationId,
      bars: SAMPLE_BARS,
      evaluatedAt: MARKET_KNOWABLE_TIME,
      newId: () => "cycle-id",
    };
    const baseline = runEvaluationCycle(cycleInput);

    const failingService = {
      resolveInternalMsvSource: vi.fn().mockRejectedValue(new Error("db down")),
      recordObservation: vi.fn(),
      appendObservationRevision: vi.fn(),
      getLatestObservation: vi.fn(),
      getObservationHistory: vi.fn(),
      listObservations: vi.fn(),
    };

    await recordMsvObservationSafe({
      observationService: failingService,
      context: { organizationId },
      msv: baseline.msv,
      marketKnowableEventTime: MARKET_KNOWABLE_TIME,
    });

    const afterFailure = runEvaluationCycle(cycleInput);
    expect(afterFailure.signal.outcome).toBe(baseline.signal.outcome);
    expect(afterFailure.msv.derived.regime).toBe(baseline.msv.derived.regime);
  });

  it("writes audit rows for record and revision", async () => {
    const db = getDb();
    const { observation } = createServices();
    const marketTime = "2026-06-22T10:05:00.000Z";
    const msv = buildSampleMsv({ evaluatedAt: marketTime });
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });

    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;

    const recorded = await observation.recordObservation(
      { organizationId },
      {
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime: new Date("2026-06-22T10:05:01.000Z"),
        observedBy: USER_ID,
      },
    );

    await observation.appendObservationRevision(
      { organizationId },
      {
        observationKey: recorded.observationKey,
        sourceId,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson({
          ...msv,
          derived: { ...msv.derived, regime: "CHOP" },
        }),
        eventTime,
        ingestTime: new Date("2026-06-22T10:05:02.000Z"),
        observedBy: USER_ID,
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
          action: traderAuditActions.miObservationRecorded,
          entityType: traderEntityTypes.miObservation,
          organizationId,
        }),
        expect.objectContaining({
          action: traderAuditActions.miObservationRevised,
          entityType: traderEntityTypes.miObservation,
          organizationId,
        }),
      ]),
    );
  });
});
