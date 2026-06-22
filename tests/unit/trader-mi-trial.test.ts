import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiTrial } from "@/db/schema";
import {
  MiHypothesisNotFoundError,
  MiEvidenceRefError,
  MiTrialInputValidationError,
  MiTrialRefError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
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
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, MsvEnvelope } from "@/lib/trader/intelligence/types";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a290";
const SOURCE_ID = "00000000-0000-4000-8000-00000000c290";

const SAMPLE_BARS: Bar[] = Array.from({ length: 20 }, (_, index) => ({
  symbol: "BTC/USDT",
  interval: "1m" as const,
  open: "100",
  high: "101",
  low: "99",
  close: "100",
  volume: "1",
  barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
  barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
}));

function buildSampleMsv(): MsvEnvelope {
  const features = computeFeatureSnapshot({
    bars: SAMPLE_BARS,
    evaluatedAt: "2026-06-22T10:00:00.000Z",
  });
  return buildMsvEnvelope({ features, newId: () => "trial-test-msv" });
}

describe("trader mi trial (DEE-289 / LD-5a.2b)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisKey: string;
  let hypothesisDefinitionDigest: string;
  let observationId: string;

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
      regimeScope: { description: "trial scope" },
    };
  }

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-trial-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-trial.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-trial@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Trial User",
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
        name: "trial_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "trial", params: { window: 20 } },
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
        name: "trial_hypothesis",
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
    const recorded = await observation.recordObservation(
      { organizationId },
      {
        sourceId: SOURCE_ID,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime: resolveMsvMarketKnowableEventTime({
          msvEvaluatedAt: msv.evaluatedAt,
          marketKnowableEventTime: "2026-06-22T10:00:00.000Z",
        }),
        ingestTime: new Date("2026-06-22T10:00:01.000Z"),
        observedBy: USER_ID,
      },
    );
    observationId = recorded.id;
  });

  function createTrialService() {
    return createSqliteMiTrialService(getDb(), {
      actorType: "service",
      actorId: USER_ID,
    }).trial;
  }

  it("registers a trial with a version-exact hypothesis pin", async () => {
    const trial = createTrialService();
    const recorded = await trial.registerTrial(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-22T11:00:00.000Z"),
        ingestTime: new Date("2026-06-22T11:00:01.000Z"),
        registeredBy: USER_ID,
      },
    );

    expect(recorded.seq).toBe(1);
    expect(recorded.hypothesisId).toBe(hypothesisId);
    expect(recorded.hypothesisKey).toBe(hypothesisKey);
    expect(recorded.hypothesisDefinitionDigest).toBe(hypothesisDefinitionDigest);
    expect(recorded.researchProgram).toBeNull();
    expect(recorded.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts an inert research_program hint", async () => {
    const trial = createTrialService();
    const recorded = await trial.registerTrial(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        researchProgram: "  alpha-program  ",
        eventTime: new Date("2026-06-22T11:05:00.000Z"),
        ingestTime: new Date("2026-06-22T11:05:01.000Z"),
        registeredBy: USER_ID,
      },
    );
    expect(recorded.researchProgram).toBe("alpha-program");
  });

  it("rejects ingest_time before event_time", async () => {
    const trial = createTrialService();
    await expect(
      trial.registerTrial(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          eventTime: new Date("2026-06-22T11:10:00.000Z"),
          ingestTime: new Date("2026-06-22T11:09:59.000Z"),
          registeredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(PitViolationError);
  });

  it("rejects unresolved hypothesis pin", async () => {
    const trial = createTrialService();
    await expect(
      trial.registerTrial(
        { organizationId },
        {
          hypothesisId: "00000000-0000-4000-8000-000000009999",
          hypothesisDefinitionDigest,
          eventTime: new Date("2026-06-22T11:11:00.000Z"),
          ingestTime: new Date("2026-06-22T11:11:01.000Z"),
          registeredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("rejects hypothesis digest mismatch", async () => {
    const trial = createTrialService();
    await expect(
      trial.registerTrial(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest: "wrong-digest",
          eventTime: new Date("2026-06-22T11:12:00.000Z"),
          ingestTime: new Date("2026-06-22T11:12:01.000Z"),
          registeredBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiTrialRefError);
  });

  it("rejects empty registeredBy", async () => {
    const trial = createTrialService();
    await expect(
      trial.registerTrial(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          eventTime: new Date("2026-06-22T11:13:00.000Z"),
          ingestTime: new Date("2026-06-22T11:13:01.000Z"),
          registeredBy: "   ",
        },
      ),
    ).rejects.toThrow(MiTrialInputValidationError);
  });

  it("content_digest excludes seq (identical attempts produce identical digests)", async () => {
    const trial = createTrialService();
    const common = {
      hypothesisId,
      hypothesisDefinitionDigest,
      researchProgram: "dup-program",
      eventTime: new Date("2026-06-22T11:20:00.000Z"),
      ingestTime: new Date("2026-06-22T11:20:01.000Z"),
      registeredBy: USER_ID,
    };
    const first = await trial.registerTrial({ organizationId }, common);
    const second = await trial.registerTrial({ organizationId }, common);
    expect(second.seq).toBe(first.seq + 1);
    expect(second.contentDigest).toBe(first.contentDigest);
  });

  it("exposes ordered stream and per-hypothesis counts", async () => {
    const trial = createTrialService();
    const stream = await trial.listTrials({ organizationId }, hypothesisKey);
    expect(stream.length).toBeGreaterThanOrEqual(4);
    expect(stream.map((row) => row.seq)).toEqual(
      [...stream.map((row) => row.seq)].sort((a, b) => a - b),
    );

    const counts = await trial.getTrialCounts({ organizationId }, hypothesisKey, hypothesisId);
    expect(counts.byHypothesisKey).toBe(stream.length);
    expect(counts.byHypothesisId).toBe(stream.length);
    expect(counts.latestSeq).toBe(stream[stream.length - 1].seq);
  });

  it("resolves nulls and falsification from the pinned hypothesis at read time", async () => {
    const trial = createTrialService();
    const stream = await trial.listTrials({ organizationId }, hypothesisKey);
    const claim = await trial.getTrialPinnedClaim({ organizationId }, stream[0].id);
    expect(claim).not.toBeNull();
    expect(claim?.requiredNulls).toEqual(["always-flat-cash", "buy-and-hold"]);
    expect(claim?.falsificationConditions).toEqual(["null wins"]);
  });

  it("writes trader.mi_trial.registered audit row", async () => {
    const db = getDb();
    const trial = createTrialService();
    const recorded = await trial.registerTrial(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-22T13:00:00.000Z"),
        ingestTime: new Date("2026-06-22T13:00:01.000Z"),
        registeredBy: USER_ID,
      },
    );

    const rows = db.select().from(auditLogs).where(eq(auditLogs.entityId, recorded.id)).all();
    expect(rows.some((row) => row.action === traderAuditActions.miTrialRegistered)).toBe(true);
    expect(rows.some((row) => row.entityType === traderEntityTypes.miTrial)).toBe(true);
  });

  it("blocks UPDATE and DELETE on trader_mi_trial (append-only)", () => {
    const db = getDb();
    const row = db.select().from(traderMiTrial).limit(1).all()[0];
    expect(row).toBeTruthy();

    expect(() =>
      db
        .update(traderMiTrial)
        .set({ registeredBy: "mutated" })
        .where(eq(traderMiTrial.id, row.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() => db.delete(traderMiTrial).where(eq(traderMiTrial.id, row.id)).run()).toThrow(
      /append-only/i,
    );
  });

  it("links evidence to an in-org trial via trial_registration_ref", async () => {
    const db = getDb();
    const trial = createTrialService();
    const registered = await trial.registerTrial(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-22T14:00:00.000Z"),
        ingestTime: new Date("2026-06-22T14:00:01.000Z"),
        registeredBy: USER_ID,
      },
    );

    const evidence = createSqliteMiEvidenceService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).evidence;
    const recorded = await evidence.recordEvidence(
      { organizationId },
      {
        direction: "FOR",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date("2026-06-22T14:05:00.000Z"),
        ingestTime: new Date("2026-06-22T14:05:01.000Z"),
        recordedBy: USER_ID,
        trialRegistrationRef: registered.id,
      },
    );
    expect(recorded.trialRegistrationRef).toBe(registered.id);
  });

  it("rejects evidence pinned to a non-existent trial", async () => {
    const db = getDb();
    const evidence = createSqliteMiEvidenceService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).evidence;
    await expect(
      evidence.recordEvidence(
        { organizationId },
        {
          direction: "FOR",
          hypothesisId,
          hypothesisDefinitionDigest,
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T14:10:00.000Z"),
          ingestTime: new Date("2026-06-22T14:10:01.000Z"),
          recordedBy: USER_ID,
          trialRegistrationRef: "00000000-0000-4000-8000-0000000000aa",
        },
      ),
    ).rejects.toThrow(MiEvidenceRefError);
  });
});
