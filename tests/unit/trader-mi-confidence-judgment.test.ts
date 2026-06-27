import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiConfidenceJudgment } from "@/db/schema";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, MsvEnvelope } from "@/lib/trader/intelligence/types";
import {
  MiConfidenceJudgmentAuthorizationError,
  MiConfidenceJudgmentInputValidationError,
  MiConfidenceJudgmentRefError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiConfidenceJudgmentService } from "@/lib/trader/mi/confidence-judgment-service";
import {
  MI_CONFIDENCE_DERIVATION_VERSION,
  MI_CONFIDENCE_SCALE_V1,
} from "@/lib/trader/mi/confidence-judgment.types";
import { createSqliteMiEvidenceService } from "@/lib/trader/mi/evidence-service";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisDefinition,
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { MI_MSV_INTERNAL_SOURCE } from "@/lib/trader/mi/observation.types";
import {
  createSqliteMiObservationService,
  resolveMsvMarketKnowableEventTime,
} from "@/lib/trader/mi/observation-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createSqliteMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import { serializeMsvPayloadJson } from "@/lib/trader/mi/serialize-observation";
import { createSqliteMiTrialIntegrityService } from "@/lib/trader/mi/trial-integrity-service";
import { createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000e293";
const SOURCE_ID = "00000000-0000-4000-8000-00000000s293";

const SAMPLE_BARS: Bar[] = Array.from({ length: 20 }, (_, index) => ({
  symbol: "BTC/USDT",
  interval: "1m" as const,
  open: "100",
  high: "101",
  low: "99",
  close: index === 19 ? "100.5" : "100",
  volume: "1",
  barOpenTime: new Date(Date.parse("2026-06-20T09:40:00.000Z") + index * 60_000).toISOString(),
  barCloseTime: new Date(Date.parse("2026-06-20T09:41:00.000Z") + index * 60_000).toISOString(),
}));

function buildSampleMsv(): MsvEnvelope {
  const features = computeFeatureSnapshot({
    bars: SAMPLE_BARS,
    evaluatedAt: "2026-06-20T10:00:00.000Z",
  });
  return buildMsvEnvelope({ features, newId: () => "confidence-judgment-msv" });
}

describe("trader mi confidence judgment (DEE-293 / LD-5a.3a)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisKey: string;
  let hypothesisDefinitionDigest: string;
  let observationId: string;
  let forEvidenceId: string;
  let forEvidenceDigest: string;
  let trialId: string;

  function buildDefinition(overrides?: Partial<HypothesisDefinition>): HypothesisDefinition {
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
      regimeScope: { description: "confidence scope" },
      ...overrides,
    };
  }

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-confidence-judgment-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-confidence-judgment.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-confidence-judgment@waia.invalid",
      password: "password123",
      identityLabel: "MI Confidence Judgment User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Confidence Judgment User",
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
        name: "confidence_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "confidence", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_ID,
      },
    );
    patternRef = { patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest };

    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "confidence_hypothesis",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );
    hypothesisId = registered.id;
    hypothesisKey = registered.hypothesisKey;
    hypothesisDefinitionDigest = registered.definitionDigest;

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
      new Date("2026-06-20T08:00:00.000Z"),
    );

    const { observation } = createSqliteMiObservationService(db, sourceRepo);
    const msv = buildSampleMsv();
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: msv.evaluatedAt,
      marketKnowableEventTime: "2026-06-20T10:00:00.000Z",
    });
    const recordedObservation = await observation.recordObservation(
      { organizationId },
      {
        sourceId: SOURCE_ID,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime,
        ingestTime: new Date("2026-06-20T10:00:01.000Z"),
        observedBy: USER_ID,
      },
    );
    observationId = recordedObservation.id;

    const trial = createSqliteMiTrialService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).trial;
    const registeredTrial = await trial.registerTrial(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        eventTime: new Date("2026-06-20T13:00:00.000Z"),
        ingestTime: new Date("2026-06-20T13:00:01.000Z"),
        registeredBy: USER_ID,
      },
    );
    trialId = registeredTrial.id;

    const evidence = createSqliteMiEvidenceService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).evidence;
    const recordedEvidence = await evidence.recordEvidence(
      { organizationId },
      {
        direction: "FOR",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date("2026-06-20T14:00:00.000Z"),
        ingestTime: new Date("2026-06-20T14:00:01.000Z"),
        recordedBy: USER_ID,
        trialRegistrationRef: trialId,
      },
    );
    forEvidenceId = recordedEvidence.id;
    forEvidenceDigest = recordedEvidence.contentDigest;
  });

  function createConfidenceService(actorType: "user" | "admin" | "service" = "user") {
    return createSqliteMiConfidenceJudgmentService(getDb(), {
      actorType,
      actorId: USER_ID,
    }).confidenceJudgment;
  }

  it("records asserted confidence judgment with FOR citations and audit", async () => {
    const confidence = createConfidenceService();
    const recorded = await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    expect(recorded.level).toBe("supported");
    expect(recorded.confidenceScaleVersion).toBe(MI_CONFIDENCE_SCALE_V1);
    expect(recorded.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(recorded.seq).toBe(1);

    const audit = getDb().select().from(auditLogs).where(eq(auditLogs.entityId, recorded.id)).all();
    expect(
      audit.some((row) => row.action === traderAuditActions.miConfidenceJudgmentRecorded),
    ).toBe(true);
    expect(audit.some((row) => row.entityType === traderEntityTypes.miConfidenceJudgment)).toBe(
      true,
    );
  });

  it("maps withdrawal to WITHDRAWN eligibility, not NO_JUDGMENT", async () => {
    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        judgmentKind: "insufficiency_attested",
        eventTime: new Date("2026-06-21T11:00:00.000Z"),
        ingestTime: new Date("2026-06-21T11:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId, asOf: new Date("2026-06-21T12:00:00.000Z") },
    );
    expect(eligibility?.verdict).toBe("INELIGIBLE");
    expect(eligibility?.reasons).toEqual(["WITHDRAWN"]);
    expect(eligibility?.reasons).not.toContain("NO_JUDGMENT");
    expect(eligibility?.derivationVersionId).toBe(MI_CONFIDENCE_DERIVATION_VERSION);
  });

  it("returns NO_JUDGMENT when no judgment exists for version", async () => {
    const db = getDb();
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const fresh = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "no_judgment_hypothesis",
        definition: buildDefinition({ prior: { ordinal: "low", band: "narrow" } }),
        authoredBy: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId: fresh.id, asOf: new Date("2026-06-21T12:00:00.000Z") },
    );
    expect(eligibility?.verdict).toBe("INELIGIBLE");
    expect(eligibility?.reasons).toEqual(["NO_JUDGMENT"]);
  });

  it("blocks UPDATE and DELETE (append-only)", async () => {
    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "tentative",
        bandLow: "speculative",
        bandHigh: "supported",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const db = getDb();
    const row = db.select().from(traderMiConfidenceJudgment).limit(1).all()[0];
    expect(() =>
      db
        .update(traderMiConfidenceJudgment)
        .set({ recordedBy: "mutated" })
        .where(eq(traderMiConfidenceJudgment.id, row.id))
        .run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db.delete(traderMiConfidenceJudgment).where(eq(traderMiConfidenceJudgment.id, row.id)).run(),
    ).toThrow(/append-only/i);
  });

  it("rejects invalid confidence scale tokens", async () => {
    const confidence = createConfidenceService();
    await expect(
      confidence.recordConfidenceJudgment(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          level: "invalid_level" as "supported",
          bandLow: "tentative",
          bandHigh: "strong",
          judgmentKind: "asserted",
          reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
          forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
          eventTime: new Date("2026-06-21T10:00:00.000Z"),
          ingestTime: new Date("2026-06-21T10:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiConfidenceJudgmentInputValidationError);
  });

  it("rejects non-FOR evidence citations", async () => {
    const db = getDb();
    const evidence = createSqliteMiEvidenceService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).evidence;
    const against = await evidence.recordEvidence(
      { organizationId },
      {
        direction: "AGAINST",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date("2026-06-20T15:00:00.000Z"),
        ingestTime: new Date("2026-06-20T15:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    await expect(
      confidence.recordConfidenceJudgment(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          level: "supported",
          bandLow: "tentative",
          bandHigh: "strong",
          judgmentKind: "asserted",
          reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
          forCitations: [{ evidenceId: against.id, evidenceContentDigest: against.contentDigest }],
          eventTime: new Date("2026-06-21T10:00:00.000Z"),
          ingestTime: new Date("2026-06-21T10:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiConfidenceJudgmentRefError);
  });

  it("rejects citations from a different hypothesis version", async () => {
    const db = getDb();
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const v2 = await hypothesis.appendHypothesisVersion(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        hypothesisKey,
        name: "confidence_hypothesis",
        definition: buildDefinition({ prior: { ordinal: "high", band: "narrow" } }),
        authoredBy: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    await expect(
      confidence.recordConfidenceJudgment(
        { organizationId },
        {
          hypothesisId: v2.id,
          hypothesisDefinitionDigest: v2.definitionDigest,
          level: "supported",
          bandLow: "tentative",
          bandHigh: "strong",
          judgmentKind: "asserted",
          reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
          forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
          eventTime: new Date("2026-06-22T11:00:00.000Z"),
          ingestTime: new Date("2026-06-22T11:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiConfidenceJudgmentRefError);
  });

  it("hides future judgments from replay (ingest_time <= T)", async () => {
    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const beforeIngest = await confidence.getCurrentConfidenceJudgment(
      { organizationId },
      hypothesisId,
      new Date("2026-06-21T10:00:00.500Z"),
    );
    expect(beforeIngest).toBeNull();

    const atIngest = await confidence.getCurrentConfidenceJudgment(
      { organizationId },
      hypothesisId,
      new Date("2026-06-21T10:00:01.000Z"),
    );
    expect(atIngest?.level).toBe("supported");
  });

  it("scopes eligibility to hypothesis version", async () => {
    const db = getDb();
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const v2 = await hypothesis.getLatestHypothesis({ organizationId }, hypothesisKey);
    expect(v2).toBeTruthy();
    expect(v2!.id).not.toBe(hypothesisId);

    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "strong",
        bandLow: "supported",
        bandHigh: "compelling",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const v2Eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId: v2!.id, asOf: new Date("2026-06-22T12:00:00.000Z") },
    );
    expect(v2Eligibility?.reasons).toEqual(["NO_JUDGMENT"]);
  });

  it("derives CITATION_INVALIDATED when trial integrity fails", async () => {
    const db = getDb();
    const integrity = createSqliteMiTrialIntegrityService(db, {
      actorType: "admin",
      actorId: USER_ID,
    }).trialIntegrity;

    await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "pre_registration_breach",
        rationale: "registered after peeking",
        eventTime: new Date("2026-06-21T09:00:00.000Z"),
        ingestTime: new Date("2026-06-21T09:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId, asOf: new Date("2026-06-21T12:00:00.000Z") },
    );
    expect(eligibility?.reasons).toContain("CITATION_INVALIDATED");
  });

  it("derives EXPIRED when review horizon passed", async () => {
    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId,
        hypothesisDefinitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-06-21T11:00:00.000Z"),
        forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId, asOf: new Date("2026-06-21T12:00:00.000Z") },
    );
    expect(eligibility?.reasons).toContain("EXPIRED");
  });

  it("derives LIFECYCLE_BLOCKED when hypothesis is quarantined", async () => {
    const db = getDb();
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const isolated = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "lifecycle_blocked_hypothesis",
        definition: buildDefinition({ prior: { ordinal: "lifecycle", band: "wide" } }),
        authoredBy: USER_ID,
      },
    );
    await hypothesis.transitionHypothesisLifecycle(
      { organizationId },
      {
        hypothesisKey: isolated.hypothesisKey,
        toState: "VALIDATING",
        rationale: "sealed",
        recordedBy: USER_ID,
        actorType: "user",
        actorId: USER_ID,
      },
    );
    await hypothesis.transitionHypothesisLifecycle(
      { organizationId },
      {
        hypothesisKey: isolated.hypothesisKey,
        toState: "QUARANTINED",
        rationale: "integrity hold",
        recordedBy: USER_ID,
        actorType: "user",
        actorId: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId: isolated.id,
        hypothesisDefinitionDigest: isolated.definitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
        forCitations: [],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId: isolated.id, asOf: new Date("2026-12-31T12:00:00.000Z") },
    );
    expect(eligibility?.reasons).toContain("LIFECYCLE_BLOCKED");
  });

  it("emits derivationVersionId on signals and signals never gate eligibility", async () => {
    const db = getDb();
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const isolated = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "signals_hypothesis",
        definition: buildDefinition({ prior: { ordinal: "signals", band: "wide" } }),
        authoredBy: USER_ID,
      },
    );

    const confidence = createConfidenceService();
    await confidence.recordConfidenceJudgment(
      { organizationId },
      {
        hypothesisId: isolated.id,
        hypothesisDefinitionDigest: isolated.definitionDigest,
        level: "supported",
        bandLow: "tentative",
        bandHigh: "strong",
        judgmentKind: "asserted",
        reviewHorizonAt: new Date("2026-06-28T12:00:00.000Z"),
        forCitations: [],
        eventTime: new Date("2026-06-21T10:00:00.000Z"),
        ingestTime: new Date("2026-06-21T10:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const asOf = new Date("2026-06-25T12:00:00.000Z");
    const eligibility = await confidence.getConfidenceEligibility(
      { organizationId },
      { hypothesisId: isolated.id, asOf },
    );
    const signals = await confidence.getConfidenceSignals(
      { organizationId },
      { hypothesisId: isolated.id, asOf },
    );

    expect(eligibility?.verdict).toBe("ELIGIBLE");
    expect(signals?.derivationVersionId).toBe(MI_CONFIDENCE_DERIVATION_VERSION);
    expect(signals?.signals.some((signal) => signal.signalClass === "EXPIRING_SOON")).toBe(true);
  });

  it("rejects service actor for human-only authorship", async () => {
    const confidence = createConfidenceService("service");
    await expect(
      confidence.recordConfidenceJudgment(
        { organizationId },
        {
          hypothesisId,
          hypothesisDefinitionDigest,
          level: "supported",
          bandLow: "tentative",
          bandHigh: "strong",
          judgmentKind: "asserted",
          reviewHorizonAt: new Date("2026-07-20T12:00:00.000Z"),
          forCitations: [{ evidenceId: forEvidenceId, evidenceContentDigest: forEvidenceDigest }],
          eventTime: new Date("2026-06-21T10:00:00.000Z"),
          ingestTime: new Date("2026-06-21T10:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiConfidenceJudgmentAuthorizationError);
  });
});
