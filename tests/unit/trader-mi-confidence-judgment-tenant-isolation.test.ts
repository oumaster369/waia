import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { MiHypothesisNotFoundError } from "@/lib/trader/mi/errors";
import { createSqliteMiConfidenceJudgmentService } from "@/lib/trader/mi/confidence-judgment-service";
import { createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import type {
  HypothesisMeasurementRef,
  HypothesisPatternRef,
} from "@/lib/trader/mi/hypothesis.types";
import { createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a293a";
const USER_B = "00000000-0000-4000-8000-00000000b293b";

describe("trader mi confidence judgment tenant isolation (DEE-293 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let hypothesisIdA: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-confidence-judgment-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-confidence-judgment-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-confidence-judgment-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Confidence Judgment Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-confidence-judgment-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Confidence Judgment Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "MI Confidence Judgment Org A",
    });
    orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "MI Confidence Judgment Org B",
    });

    const fixture = await seedHypothesisFixture(orgA, USER_A);
    hypothesisIdA = fixture.hypothesisId;

    const confidence = createSqliteMiConfidenceJudgmentService(db, {
      actorType: "user",
      actorId: USER_A,
    }).confidenceJudgment;
    await confidence.recordConfidenceJudgment(
      { organizationId: orgA },
      {
        hypothesisId: fixture.hypothesisId,
        hypothesisDefinitionDigest: fixture.hypothesisDefinitionDigest,
        judgmentKind: "insufficiency_attested",
        eventTime: new Date("2026-06-22T12:00:00.000Z"),
        ingestTime: new Date("2026-06-22T12:00:01.000Z"),
        recordedBy: USER_A,
      },
    );
  });

  async function seedHypothesisFixture(
    organizationId: string,
    userId: string,
  ): Promise<{
    hypothesisId: string;
    hypothesisDefinitionDigest: string;
  }> {
    const db = getDb();
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
        authoredBy: userId,
      },
    );
    const measurementRef: HypothesisMeasurementRef = {
      measurementKey: m.measurementKey,
      measurementDefinitionDigest: m.definitionDigest,
    };

    const pattern = createSqliteMiPatternService(db).pattern;
    const p = await pattern.registerPattern(
      { organizationId },
      {
        patternKind: "recurring_structure",
        name: "iso_confidence_pattern",
        definition: {
          measurements: [measurementRef],
          recurrence: { description: "iso", params: { window: 20 } },
        },
        trialBudgetMax: 1,
        authoredBy: userId,
      },
    );
    const patternRef: HypothesisPatternRef = {
      patternKey: p.patternKey,
      patternDefinitionDigest: p.definitionDigest,
    };

    const hypothesis = createSqliteMiHypothesisService(db).hypothesis;
    const registered = await hypothesis.registerHypothesis(
      { organizationId },
      {
        hypothesisKind: "market_claim",
        name: "iso_confidence_hypothesis",
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
          regimeScope: { description: "iso" },
        },
        authoredBy: userId,
      },
    );

    return {
      hypothesisId: registered.id,
      hypothesisDefinitionDigest: registered.definitionDigest,
    };
  }

  it("does not expose org A confidence judgments to org B", async () => {
    const confidence = createSqliteMiConfidenceJudgmentService(getDb()).confidenceJudgment;
    expect(
      await confidence.getCurrentConfidenceJudgment(
        { organizationId: orgB },
        hypothesisIdA,
        new Date("2026-06-22T13:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("rejects recording a judgment against org A hypothesis from org B", async () => {
    const confidence = createSqliteMiConfidenceJudgmentService(getDb(), {
      actorType: "user",
      actorId: USER_B,
    }).confidenceJudgment;
    await expect(
      confidence.recordConfidenceJudgment(
        { organizationId: orgB },
        {
          hypothesisId: hypothesisIdA,
          hypothesisDefinitionDigest:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          judgmentKind: "insufficiency_attested",
          eventTime: new Date("2026-06-22T13:00:00.000Z"),
          ingestTime: new Date("2026-06-22T13:00:01.000Z"),
          recordedBy: USER_B,
        },
      ),
    ).rejects.toThrow(MiHypothesisNotFoundError);
  });

  it("requires explicit org context", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
