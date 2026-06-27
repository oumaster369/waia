import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, MsvEnvelope } from "@/lib/trader/intelligence/types";
import { MiEvidenceRefError, MiHypothesisNotFoundError } from "@/lib/trader/mi/errors";
import { createSqliteMiEvidenceService } from "@/lib/trader/mi/evidence-service";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
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
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a289a";
const USER_B = "00000000-0000-4000-8000-00000000b289b";
const SOURCE_A = "00000000-0000-4000-8000-00000000c289a";

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
  return buildMsvEnvelope({ features, newId: () => "iso-evidence-msv" });
}

describe("trader mi evidence tenant isolation (DEE-289 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisKey: string;
  let hypothesisDefinitionDigest: string;
  let observationId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-evidence-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-evidence-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-evidence-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Evidence Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-evidence-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Evidence Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Evidence Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Evidence Org B" });

    const measurement = createSqliteMiMeasurementService(db).measurement;
    const m = await measurement.registerMeasurement(
      { organizationId: orgA },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: USER_A,
      },
    );
    measurementRef = {
      measurementKey: m.measurementKey,
      measurementDefinitionDigest: m.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const p = await pattern.registerPattern(
      { organizationId: orgA },
      {
        patternKind: "recurring_structure",
        name: "iso_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_A,
      },
    );
    patternRef = { patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest };

    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const registered = await hypothesis.registerHypothesis(
      { organizationId: orgA },
      {
        hypothesisKind: "market_claim",
        name: "iso_evidence_hypothesis",
        definition: {
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
          regimeScope: { description: "iso scope" },
        },
        authoredBy: USER_A,
      },
    );
    hypothesisId = registered.id;
    hypothesisKey = registered.hypothesisKey;
    hypothesisDefinitionDigest = registered.definitionDigest;

    const sourceRepo = createSqliteMiSourceProvenanceRepository(db);
    await sourceRepo.insertSource(
      { organizationId: orgA },
      {
        venue: MI_MSV_INTERNAL_SOURCE.venue,
        feedKind: MI_MSV_INTERNAL_SOURCE.feedKind,
        symbol: MI_MSV_INTERNAL_SOURCE.symbol,
        description: MI_MSV_INTERNAL_SOURCE.description,
        status: "active",
      },
      SOURCE_A,
      new Date("2026-06-22T08:00:00.000Z"),
    );

    const { observation } = createSqliteMiObservationService(db, sourceRepo);
    const msv = buildSampleMsv();
    const marketTime = "2026-06-22T10:00:00.000Z";
    const recorded = await observation.recordObservation(
      { organizationId: orgA },
      {
        sourceId: SOURCE_A,
        observationKind: "msv_envelope",
        subjectRef: msv.instrumentId,
        payloadJson: serializeMsvPayloadJson(msv),
        eventTime: resolveMsvMarketKnowableEventTime({
          msvEvaluatedAt: msv.evaluatedAt,
          marketKnowableEventTime: marketTime,
        }),
        ingestTime: new Date("2026-06-22T10:00:01.000Z"),
        observedBy: USER_A,
      },
    );
    observationId = recorded.id;
  });

  it("org B cannot read org A evidence via service", async () => {
    const db = getDb();
    const evidenceA = createSqliteMiEvidenceService(db).evidence;
    const evidenceB = createSqliteMiEvidenceService(db).evidence;

    await evidenceA.recordEvidence(
      { organizationId: orgA },
      {
        direction: "FOR",
        hypothesisId,
        hypothesisDefinitionDigest,
        measurementRefs: [measurementRef],
        observationRefs: [{ observationId }],
        eventTime: new Date("2026-06-22T11:00:00.000Z"),
        ingestTime: new Date("2026-06-22T11:00:01.000Z"),
        recordedBy: USER_A,
      },
    );

    const crossList = await evidenceB.listEvidence({ organizationId: orgB }, hypothesisKey);
    expect(crossList).toHaveLength(0);

    const crossSummary = await evidenceB.getEvidenceSummary(
      { organizationId: orgB },
      hypothesisKey,
    );
    expect(crossSummary).toEqual({
      forCount: 0,
      againstCount: 0,
      neutralCount: 0,
      latestSeq: null,
    });
  });

  it("org B cannot record evidence using org A hypothesis or observation pins", async () => {
    const db = getDb();
    const evidenceB = createSqliteMiEvidenceService(db).evidence;

    await expect(
      evidenceB.recordEvidence(
        { organizationId: orgB },
        {
          direction: "FOR",
          hypothesisId,
          hypothesisDefinitionDigest,
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:01:00.000Z"),
          ingestTime: new Date("2026-06-22T11:01:01.000Z"),
          recordedBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);

    await expect(
      evidenceB.recordEvidence(
        { organizationId: orgB },
        {
          direction: "FOR",
          hypothesisId: "00000000-0000-4000-8000-000000009999",
          hypothesisDefinitionDigest: "fake",
          measurementRefs: [measurementRef],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:02:00.000Z"),
          ingestTime: new Date("2026-06-22T11:02:01.000Z"),
          recordedBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("org B cannot resolve org A observation pin even with a local hypothesis", async () => {
    const db = getDb();
    const measurementB = createSqliteMiMeasurementService(db).measurement;
    const m = await measurementB.registerMeasurement(
      { organizationId: orgB },
      {
        measurementKind: "feature_transform",
        name: "sma20",
        definition: {
          inputs: { observationKinds: ["msv_envelope"] },
          outputType: "decimal",
          params: { window: 20 },
        },
        authoredBy: USER_B,
      },
    );
    const patternB = createSqliteMiPatternService(db).pattern;
    const p = await patternB.registerPattern(
      { organizationId: orgB },
      {
        patternKind: "recurring_structure",
        name: "iso_pattern_b",
        definition: {
          measurements: [
            { measurementKey: m.measurementKey, measurementDefinitionDigest: m.definitionDigest },
          ],
          recurrence: { description: "iso b", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: USER_B,
      },
    );
    const hypothesisB = createSqliteMiHypothesisService(db).hypothesis;
    const localHypothesis = await hypothesisB.registerHypothesis(
      { organizationId: orgB },
      {
        hypothesisKind: "market_claim",
        name: "iso_evidence_hypothesis_b",
        definition: {
          claimShape: {
            relationshipType: "predictive",
            isDirectional: true,
            isTrendEdge: false,
            isTimingEdge: false,
          },
          prior: { ordinal: "moderate", band: "wide" },
          falsificationConditions: ["null wins"],
          requiredNulls: ["always-flat-cash", "buy-and-hold"],
          patternRefs: [{ patternKey: p.patternKey, patternDefinitionDigest: p.definitionDigest }],
          measurementRefs: [
            { measurementKey: m.measurementKey, measurementDefinitionDigest: m.definitionDigest },
          ],
          regimeScope: { description: "iso scope b" },
        },
        authoredBy: USER_B,
      },
    );

    const evidenceB = createSqliteMiEvidenceService(db).evidence;
    await expect(
      evidenceB.recordEvidence(
        { organizationId: orgB },
        {
          direction: "FOR",
          hypothesisId: localHypothesis.id,
          hypothesisDefinitionDigest: localHypothesis.definitionDigest,
          measurementRefs: [
            { measurementKey: m.measurementKey, measurementDefinitionDigest: m.definitionDigest },
          ],
          observationRefs: [{ observationId }],
          eventTime: new Date("2026-06-22T11:03:00.000Z"),
          ingestTime: new Date("2026-06-22T11:03:01.000Z"),
          recordedBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiEvidenceRefError);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
