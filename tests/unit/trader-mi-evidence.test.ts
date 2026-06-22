import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiEvidence } from "@/db/schema";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, MsvEnvelope } from "@/lib/trader/intelligence/types";
import {
  MiEvidenceInputValidationError,
  MiEvidenceRefError,
  MiHypothesisNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiEvidenceService } from "@/lib/trader/mi/evidence-service";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisDefinition,
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { MI_MSV_INTERNAL_SOURCE } from "@/lib/trader/mi/observation.types";
import {
  createSqliteMiObservationService,
  resolveMsvMarketKnowableEventTime,
} from "@/lib/trader/mi/observation-service";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createSqliteMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import { serializeMsvPayloadJson } from "@/lib/trader/mi/serialize-observation";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a289";
const SOURCE_ID = "00000000-0000-4000-8000-00000000c289";

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

function buildSampleMsv(): MsvEnvelope {
  const features = computeFeatureSnapshot({
    bars: SAMPLE_BARS,
    evaluatedAt: "2026-06-22T10:00:00.000Z",
  });
  return buildMsvEnvelope({ features, newId: () => "evidence-test-msv" });
}

describe("trader mi evidence (DEE-289 / LD-5a.2a)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisKey: string;
  let hypothesisDefinitionDigest: string;
  let observationId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-evidence-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-evidence.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-evidence@waia.invalid",
      password: "password123",
      identityLabel: "MI Evidence User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Evidence User",
    });

    const measurement = createSqliteMiMeasurementService(db).measurement;
    const m = await measurement.registerMeasurement(
      { organizationId },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: USER_ID,
      },
    );
    measurementRef = {
      measurementKey: m.measurementKey,
      measurementDefinitionDigest: m.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const p = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "evidence_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "evidence", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );
    patternRef = { patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest };

    const hypothesisService = createSqliteMiHypothesisService(db).hypothesis;
    const hypothesis = await hypothesisService.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "evidence_hypothesis",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );
    hypothesisId = hypothesis.id;
    hypothesisKey = hypothesis.hypothesisKey;
    hypothesisDefinitionDigest = hypothesis.definitionDigest;

    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    await sourceRepo.insertSource(
      { organizationId },
      {
        venue: MI_MSV_INTERNAL_SOURCE.venue,
        feedKind: MI_MSV_INTERNAL_SOURCE.feedKind,
        symbol: MI_MSV_INTERNAL_SOURCE.symbol,
        description: MI_MSV_INTERNAL_SOURCE.description,
        status: "active",
      },
      SOURCE_ID,
      new Date("2026-06-22T08:00:00.000Z"),
    );

    const { observation } = createSqliteMiObservationService(db, sourceRepo);
    const msv = buildSampleMsv();
    const marketTime = "2026-06-22T10:00:00.000Z";
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: marketTime,
    });
    const recorded = await observation.recordObservation(
      { organizationId },
      {
        sourceId: SOURCE_ID,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime: new Date("2026-06-22T10:00:01.000Z"),
        observedBy: USER_ID,
      },
    );
    observationId = recorded.id;
  });

  function buildDefinition(): HypothesisDefinition {
    return {
      claimShape: {
        relationshipType: "predictive",
        isDirectional: true,
        isTrendEdge: false,
        isTimingEdge: false,
      },
      prior: { ordinal: "moderate", band: "wide" },
      falsificationConditions: ["null wins"],
      requiredNulls: ["always-flat-cash", "buy-and-hold"],
      patternRefs: [patternRef],
      measurementRefs: [measurementRef],
      regimeScope: { description: "evidence scope" },
    };
  }

  function createEvidenceService() {
    return createSqliteMiEvidenceService(getDb(), {
      actorType: "service",
      actorId: USER_ID,
    }).evidence;
  }

  it("records evidence with version-exact pins and reserved null refs", async () => {
    const evidence = createEvidenceService();
    const eventTime = new Date("2026-06-22T11:00:00.000Z");
    const ingestTime = new Date("2026-06-22T11:00:01.000Z");

    const recorded = await evidence.recordEvidence(
      { organizationId },
      {
        direction: "FOR",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime,
        ingestTime,
        recordedBy: USER_ID,
      },
    );

    expect(recorded.seq).toBe(1);
    expect(recorded.direction).toBe("FOR");
    expect(recorded.evidenceKind).toBe("observed");
    expect(recorded.hypothesisKey).toBe(hypothesisKey);
    expect(recorded.nullComparatorRef).toBeNull();
    expect(recorded.regimeContextRef).toBeNull();
    expect(recorded.trialRegistrationRef).toBeNull();
    expect(JSON.parse(recorded.observationRefsJson)).toEqual([{ observationId }]);
  });

  it("rejects ingest_time before event_time", async () => {
    const evidence = createEvidenceService();
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "NEUTRAL",
          hypothesisId,
          hypothesisDefinitionDigest,
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:00:00.000Z"),
          ingestTime: new Date("2026-06-22T10:59:59.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(PitViolationError);
  });

  it("rejects unresolved hypothesis pin", async () => {
    const evidence = createEvidenceService();
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "FOR",
          hypothesisId: "00000000-0000-4000-8000-000000009999",
          hypothesisDefinitionDigest,
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:01:00.000Z"),
          ingestTime: new Date("2026-06-22T11:01:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("rejects observation pin outside org scope", async () => {
    const evidence = createEvidenceService();
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "FOR",
          hypothesisId,
          hypothesisDefinitionDigest,
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId: "00000000-0000-4000-8000-00000000dead" }],
          eventTime: new Date("2026-06-22T11:02:00.000Z"),
          ingestTime: new Date("2026-06-22T11:02:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiEvidenceRefError);
  });

  it("rejects digest mismatch on hypothesis pin", async () => {
    const evidence = createEvidenceService();
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "FOR",
          hypothesisId,
          hypothesisDefinitionDigest: "wrong-digest",
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:03:00.000Z"),
          ingestTime: new Date("2026-06-22T11:03:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiEvidenceRefError);
  });

  it("requires at least one measurement and observation ref", async () => {
    const evidence = createEvidenceService();
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "FOR",
          hypothesisId,
          hypothesisDefinitionDigest,
          measurementRefs: [],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:04:00.000Z"),
          ingestTime: new Date("2026-06-22T11:04:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiEvidenceInputValidationError);
  });

  it("returns ordered evidence stream and raw direction counts only", async () => {
    const evidence = createEvidenceService();
    const baseEvent = new Date("2026-06-22T12:00:00.000Z");

    await evidence.recordEvidence(
      { organizationId },
      {
        direction: "AGAINST",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: baseEvent,
        ingestTime: new Date(baseEvent.getTime() + 1000),
        recordedBy: USER_ID,
      },
    );
    await evidence.recordEvidence(
      { organizationId },
      {
        direction: "NEUTRAL",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date(baseEvent.getTime() + 60_000),
        ingestTime: new Date(baseEvent.getTime() + 61_000),
        recordedBy: USER_ID,
      },
    );

    const stream = await evidence.listEvidence({ organizationId }, hypothesisKey);
    expect(stream.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(stream.map((row) => row.direction)).toEqual(["FOR", "AGAINST", "NEUTRAL"]);

    const summary = await evidence.getEvidenceSummary({ organizationId }, hypothesisKey);
    expect(summary).toEqual({
      forCount: 1,
      againstCount: 1,
      neutralCount: 1,
      latestSeq: 3,
    });
  });

  it("writes trader.mi_evidence.recorded audit row", async () => {
    const db = getDb();
    const evidence = createEvidenceService();
    const before = db.select().from(auditLogs).all().length;

    const recorded = await evidence.recordEvidence(
      { organizationId },
      {
        direction: "FOR",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date("2026-06-22T13:00:00.000Z"),
        ingestTime: new Date("2026-06-22T13:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const rows = db.select().from(auditLogs).where(eq(auditLogs.entityId, recorded.id)).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.action === traderAuditActions.miEvidenceRecorded)).toBe(true);
    expect(rows.some((row) => row.entityType === traderEntityTypes.miEvidence)).toBe(true);
    expect(db.select().from(auditLogs).all().length).toBeGreaterThan(before);
  });

  it("blocks UPDATE and DELETE on trader_mi_evidence (append-only)", () => {
    const db = getDb();
    const row = db.select().from(traderMiEvidence).limit(1).all()[0];
    expect(row).toBeTruthy();

    expect(() =>
      db
        .update(traderMiEvidence)
        .set({ recordedBy: "mutated" })
        .where(eq(traderMiEvidence.id, row.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() => db.delete(traderMiEvidence).where(eq(traderMiEvidence.id, row.id)).run()).toThrow(
      /append-only/i,
    );
  });
});
