import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderMiTrialIntegrityEvent } from "@/db/schema";
import {
  MiTrialIntegrityInputValidationError,
  MiTrialNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisDefinition,
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createSqliteMiTrialIntegrityService } from "@/lib/trader/mi/trial-integrity-service";
import { createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a291";

describe("trader mi trial integrity (DEE-291 / LD-5a.2c)", () => {
  let organizationId: string;
  let measurementRef: HypothesisMeasurementRef;
  let patternRef: HypothesisPatternRef;
  let hypothesisId: string;
  let hypothesisDefinitionDigest: string;
  let trialId: string;

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
      regimeScope: { description: "integrity scope" },
    };
  }

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-trial-integrity-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-trial-integrity.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "mi-trial-integrity@waia.invalid",
      password: "password123",
      identityLabel: "MI Trial Integrity User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "MI Trial Integrity User",
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
        name: "integrity_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "integrity", params: { window: 20 } },
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
        name: "integrity_hypothesis",
        definition: buildDefinition(),
        authoredBy: USER_ID,
      },
    );
    hypothesisId = registered.id;
    hypothesisDefinitionDigest = registered.definitionDigest;

    const trial = createSqliteMiTrialService(db, {
      actorType: "service",
      actorId: USER_ID,
    }).trial;
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
    trialId = recorded.id;
  });

  function createIntegrityService() {
    return createSqliteMiTrialIntegrityService(getDb(), {
      actorType: "service",
      actorId: USER_ID,
    }).trialIntegrity;
  }

  it("derives valid integrity when no events exist", async () => {
    const integrity = createIntegrityService();
    expect(await integrity.getTrialIntegrity({ organizationId }, trialId)).toEqual({
      status: "valid",
      reasonCode: null,
      since: null,
      latestEventId: null,
    });
  });

  it("returns null integrity when trial is absent", async () => {
    const integrity = createIntegrityService();
    expect(
      await integrity.getTrialIntegrity({ organizationId }, "00000000-0000-4000-8000-0000000000ff"),
    ).toBeNull();
  });

  it("records an invalidation event and derives invalidated state", async () => {
    const integrity = createIntegrityService();
    const event = await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "pre_registration_breach",
        rationale: "registered after peeking",
        eventTime: new Date("2026-06-22T12:00:00.000Z"),
        ingestTime: new Date("2026-06-22T12:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    expect(event.seq).toBe(1);
    expect(event.eventType).toBe("invalidated");
    expect(event.reasonCode).toBe("pre_registration_breach");

    expect(await integrity.getTrialIntegrity({ organizationId }, trialId)).toEqual({
      status: "invalidated",
      reasonCode: "pre_registration_breach",
      since: event.eventTime,
      latestEventId: event.id,
    });
  });

  it("latest-transition-wins across multiple invalidations", async () => {
    const integrity = createIntegrityService();
    await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "look_ahead_contamination",
        rationale: "first invalidation",
        eventTime: new Date("2026-06-22T13:00:00.000Z"),
        ingestTime: new Date("2026-06-22T13:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );
    const latest = await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "computation_defect",
        rationale: "second invalidation",
        eventTime: new Date("2026-06-22T14:00:00.000Z"),
        ingestTime: new Date("2026-06-22T14:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const state = await integrity.getTrialIntegrity({ organizationId }, trialId);
    expect(state?.status).toBe("invalidated");
    expect(state?.reasonCode).toBe("computation_defect");
    expect(state?.latestEventId).toBe(latest.id);

    const events = await integrity.listTrialIntegrityEvents({ organizationId }, trialId);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("does not change trial counts after invalidation", async () => {
    const db = getDb();
    const trial = createSqliteMiTrialService(db).trial;
    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const latestHypothesis = await hypothesis.getLatestHypothesis(
      { organizationId },
      (await trial.getTrialById({ organizationId }, trialId))!.hypothesisKey,
    );
    const countsBefore = await trial.getTrialCounts(
      { organizationId },
      latestHypothesis!.hypothesisKey,
      hypothesisId,
    );

    const integrity = createIntegrityService();
    await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "provenance_gap",
        rationale: "counts unchanged",
        eventTime: new Date("2026-06-22T15:00:00.000Z"),
        ingestTime: new Date("2026-06-22T15:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const countsAfter = await trial.getTrialCounts(
      { organizationId },
      latestHypothesis!.hypothesisKey,
      hypothesisId,
    );
    expect(countsAfter).toEqual(countsBefore);
  });

  it("rejects invalid reason codes at the service layer", async () => {
    const integrity = createIntegrityService();
    await expect(
      integrity.invalidateTrial(
        { organizationId },
        {
          trialId,
          reasonCode: "operator_error" as never,
          rationale: "bad reason",
          eventTime: new Date("2026-06-22T16:00:00.000Z"),
          ingestTime: new Date("2026-06-22T16:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiTrialIntegrityInputValidationError);
  });

  it("rejects ingest_time before event_time", async () => {
    const integrity = createIntegrityService();
    await expect(
      integrity.invalidateTrial(
        { organizationId },
        {
          trialId,
          reasonCode: "provenance_gap",
          rationale: "pit violation",
          eventTime: new Date("2026-06-22T16:00:01.000Z"),
          ingestTime: new Date("2026-06-22T16:00:00.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(PitViolationError);
  });

  it("rejects invalidation for a missing trial", async () => {
    const integrity = createIntegrityService();
    await expect(
      integrity.invalidateTrial(
        { organizationId },
        {
          trialId: "00000000-0000-4000-8000-000000000099",
          reasonCode: "provenance_gap",
          rationale: "missing trial",
          eventTime: new Date("2026-06-22T16:00:00.000Z"),
          ingestTime: new Date("2026-06-22T16:00:01.000Z"),
          recordedBy: USER_ID,
        },
      ),
    ).rejects.toThrow(MiTrialNotFoundError);
  });

  it("writes trader.mi_trial_integrity.invalidated audit row", async () => {
    const db = getDb();
    const integrity = createIntegrityService();
    const event = await integrity.invalidateTrial(
      { organizationId },
      {
        trialId,
        reasonCode: "look_ahead_contamination",
        rationale: "audit coverage",
        eventTime: new Date("2026-06-22T17:00:00.000Z"),
        ingestTime: new Date("2026-06-22T17:00:01.000Z"),
        recordedBy: USER_ID,
      },
    );

    const rows = db.select().from(auditLogs).where(eq(auditLogs.entityId, event.id)).all();
    expect(rows.some((row) => row.action === traderAuditActions.miTrialIntegrityInvalidated)).toBe(
      true,
    );
    expect(rows.some((row) => row.entityType === traderEntityTypes.miTrialIntegrity)).toBe(true);
  });

  it("blocks UPDATE and DELETE on trader_mi_trial_integrity_event (append-only)", () => {
    const db = getDb();
    const row = db.select().from(traderMiTrialIntegrityEvent).limit(1).all()[0];
    expect(row).toBeTruthy();

    expect(() =>
      db
        .update(traderMiTrialIntegrityEvent)
        .set({ rationale: "mutated" })
        .where(eq(traderMiTrialIntegrityEvent.id, row.id))
        .run(),
    ).toThrow(/append-only/i);

    expect(() =>
      db
        .delete(traderMiTrialIntegrityEvent)
        .where(eq(traderMiTrialIntegrityEvent.id, row.id))
        .run(),
    ).toThrow(/append-only/i);
  });

  it("enforces reason_code when event_type is invalidated at the database layer", () => {
    const db = getDb();
    expect(() =>
      db
        .insert(traderMiTrialIntegrityEvent)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          trialId,
          eventType: "invalidated",
          reasonCode: null,
          rationale: "missing reason",
          causeRef: null,
          schemaVersion: "mi-trial-integrity-v1",
          eventTime: new Date("2026-06-22T18:00:00.000Z"),
          ingestTime: new Date("2026-06-22T18:00:01.000Z"),
          recordedBy: USER_ID,
          seq: 999,
          contentDigest: "deadbeef",
          createdAt: new Date("2026-06-22T18:00:01.000Z"),
        })
        .run(),
    ).toThrow();
  });
});
