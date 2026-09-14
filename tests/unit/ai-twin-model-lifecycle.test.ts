import { describe, expect, it } from "vitest";
import {
  composePrivateExperience,
  experienceFingerprint,
  planRetention,
  TWIN_NECESSITY_REVIEW_POLICY,
  TWIN_RETENTION_POLICY,
  type ExperienceDraft,
  type InitialHumanModelEndorsement,
  type ModelNecessityReviewState,
  type NecessityReviewConfirmation,
  type RetentionAuthorization,
  type RetentionRecord,
} from "@/lib/ai-twin/model/lifecycle";

const scope = { organizationId: "org-a", subjectId: "human-a" };
const start = "2026-01-01T00:00:00.000Z";
const day = (n: number) => new Date(Date.parse(start) + n * 86400000).toISOString();
function record(kind: RetentionRecord["kind"] = "dialogue"): RetentionRecord {
  return {
    scope,
    id: "item-a",
    revision: 1,
    kind,
    createdAt: start,
    evidenceEligible: true,
    erasureRequestedAt: null,
  };
}
function grant(purpose: RetentionAuthorization["purpose"] = "dialogue"): RetentionAuthorization {
  return {
    scope,
    recordId: "item-a",
    recordRevision: 1,
    purpose,
    approvedBy: "human",
    validFrom: start,
    validUntil: null,
    revokedAt: null,
    basisReference: "synthetic-reviewed-basis",
  };
}
function necessityReview(
  item: RetentionRecord,
  confirmedAt = day(300),
  preparedAt = day(299),
): NecessityReviewConfirmation {
  return {
    reviewId: "review-1",
    policyVersion: TWIN_NECESSITY_REVIEW_POLICY,
    target: {
      organizationId: item.scope.organizationId,
      subjectId: item.scope.subjectId,
      recordId: item.id,
      recordRevision: item.revision,
    },
    basis: "storage_necessity",
    decision: "retain",
    preparedAt,
    confirmedAt,
    confirmedBy: {
      kind: "human",
      organizationId: item.scope.organizationId,
      subjectId: item.scope.subjectId,
    },
  };
}
function modelRecord(overrides: Partial<RetentionRecord> = {}): RetentionRecord {
  return {
    ...record("model"),
    ...overrides,
  };
}
function initialEndorsement(
  item: RetentionRecord,
  confirmedAt = start,
): InitialHumanModelEndorsement {
  return {
    endorsementId: "endorsement-1",
    target: {
      organizationId: item.scope.organizationId,
      subjectId: item.scope.subjectId,
      recordId: item.id,
      recordRevision: 1,
    },
    basis: "initial_model_endorsement",
    confirmedAt,
    confirmedBy: {
      kind: "human",
      organizationId: item.scope.organizationId,
      subjectId: item.scope.subjectId,
    },
  };
}
function modelReviewState(
  item: RetentionRecord,
  latestReview: NecessityReviewConfirmation | null = null,
): ModelNecessityReviewState {
  return {
    initialEndorsement: initialEndorsement(item),
    latestReview,
  };
}
function planModelRetention(
  item: RetentionRecord,
  authorization: RetentionAuthorization | null,
  now: string,
  reviewState = modelReviewState(item),
) {
  return planRetention(item, authorization, now, reviewState);
}
const draft: ExperienceDraft = {
  scope,
  id: "item-a",
  revision: 1,
  recordedAt: start,
  situation: "Synthetic workday",
  eventTime: start,
  context: "Private example",
  intention: "Make space for focused work",
  consideredOptions: ["Morning", "Evening"],
  decision: "Try morning",
  reasons: ["Fewer interruptions"],
  expectedConsequences: ["More focus"],
  observedOutcomes: [],
  humanLesson: "Outcome not yet known",
  reinterpretations: [],
  uncertainty: "One situation is not a general rule",
  transferConditions: "No transfer",
  provenance: [
    {
      scope,
      sourceId: "independent-human-statement",
      sourceVersion: 1,
      kind: "human_declaration",
      authorizationReference: "private-archive-consent",
      eligible: true,
    },
  ],
};

describe("inert retention policy", () => {
  it.each([
    ["dialogue", "dialogue", 90],
    ["diagnostic_log", "diagnostics", 14],
    ["security_event", "security", 90],
    ["export", "export", 1],
    ["backup", "backup", 30],
  ] as const)("expires %s exactly at its creation-based limit", (kind, purpose, days) => {
    const r = record(kind);
    const g = grant(purpose);
    expect(planRetention(r, g, day(days - 0.000001)).disposition).toBe("retain");
    expect(planRetention(r, g, day(days))).toMatchObject({
      disposition: "remove",
      purposeUseAllowed: false,
      expiresAt: day(days),
    });
  });
  it("anchors processing copies at completion, not creation", () => {
    const r = { ...record("processing_copy"), processingCompletedAt: day(2) };
    expect(planRetention(r, grant("processing"), day(2)).expiresAt).toBe(day(3));
    expect(planRetention(r, grant("processing"), day(3)).disposition).toBe("remove");
    expect(() => planRetention(record("processing_copy"), grant("processing"), day(3))).toThrow();
  });
  describe.each(["proposed_relation", "open_knowledge_need"] as const)(
    "R1 working memory: %s",
    (kind) => {
      const candidate = () => record(kind);
      it("expires exactly at day 90 independently of any source clock", () => {
        const r = candidate();
        const g = grant("modelling");
        const before = new Date(Date.parse(day(90)) - 1).toISOString();
        expect(planRetention(r, g, before)).toMatchObject({
          purposeUseAllowed: true,
          expiresAt: day(90),
          reviewDueAt: null,
        });
        expect(planRetention(r, g, day(90))).toMatchObject({
          purposeUseAllowed: false,
          disposition: "remove",
          expiresAt: day(90),
        });
      });
      it("does not let repeated planning or undeclared review metadata renew age", () => {
        const r = candidate();
        for (const clock of [day(1), day(30), day(89)]) {
          expect(planRetention(r, grant("modelling"), clock).expiresAt).toBe(day(90));
        }
        expect(() =>
          planRetention(
            { ...r, lastNecessityReviewAt: day(89) } as RetentionRecord,
            grant("modelling"),
            day(90),
          ),
        ).toThrow();
      });
      it("applies a supplied evidence anchor and rejects invalid chronology", () => {
        const r = { ...candidate(), lastSubstantialEvidenceAt: day(10) };
        expect(planRetention(r, grant("modelling"), day(90))).toMatchObject({
          purposeUseAllowed: true,
          expiresAt: day(100),
        });
        expect(planRetention(r, grant("modelling"), day(100)).purposeUseAllowed).toBe(false);
        for (const anchor of [day(-1), day(101)]) {
          expect(() =>
            planRetention(
              { ...r, lastSubstantialEvidenceAt: anchor },
              grant("modelling"),
              day(100),
            ),
          ).toThrow();
        }
      });
      it("never turns retention into permission or a removal receipt", () => {
        const r = candidate();
        const g = grant("modelling");
        const cases = [
          [r, null],
          [r, grant("private_archive")],
          [r, { ...g, revokedAt: day(1) }],
          [r, { ...g, scope: { ...scope, subjectId: "other" } }],
          [{ ...r, evidenceEligible: false }, g],
          [{ ...r, erasureRequestedAt: day(1) }, g],
        ] as const;
        for (const [item, authority] of cases) {
          expect(planRetention(item, authority, day(1))).toMatchObject({
            purposeUseAllowed: false,
            disposition: "remove",
            removalVerified: false,
          });
        }
      });
    },
  );
  it("only substantial evidence can move the hypothesis anchor", () => {
    const r = { ...record("hypothesis"), lastSubstantialEvidenceAt: day(10) };
    expect(planRetention(r, grant("modelling"), day(90)).expiresAt).toBe(day(100));
    expect(planRetention(record("hypothesis"), grant("modelling"), day(90)).disposition).toBe(
      "remove",
    );
    expect(planRetention(r, grant("modelling"), day(100)).disposition).toBe("remove");
  });
  it.each(["diary", "saved_episode", "experience_archive"] as const)(
    "keeps explicitly selected %s without automatic TTL",
    (kind) => {
      expect(planRetention(record(kind), grant("private_archive"), day(10000))).toMatchObject({
        disposition: "retain",
        expiresAt: null,
      });
    },
  );
  it("does not promote dialogue with archive permission", () => {
    expect(planRetention(record(), grant("private_archive"), day(1)).disposition).toBe("remove");
    expect(
      planRetention(
        record("experience_archive"),
        { ...grant("private_archive"), approvedBy: "reviewed_policy" },
        day(1),
      ).disposition,
    ).toBe("remove");
  });
  it("pauses productive use exactly when a model necessity review becomes due", () => {
    const r = modelRecord();
    expect(planModelRetention(r, grant("modelling"), day(364))).toMatchObject({
      policyVersion: TWIN_RETENTION_POLICY,
      necessityReviewPolicyVersion: TWIN_NECESSITY_REVIEW_POLICY,
      disposition: "retain",
      purposeUseAllowed: true,
      reviewDue: false,
      reviewDueAt: day(365),
      reviewDecision: "current",
      humanRightsAssessment: "separate",
    });
    expect(planModelRetention(r, grant("modelling"), day(365))).toMatchObject({
      disposition: "human_review_required",
      purposeUseAllowed: false,
      reviewDue: true,
      reviewDueAt: day(365),
      reviewDecision: "human_decision_required",
      humanRightsAssessment: "separate",
      expiresAt: null,
      liveRemovalTargetAt: null,
      allCopiesRemovalTargetAt: null,
    });
  });
  it("starts the next interval only from exact Human review confirmation", () => {
    const base = modelRecord();
    const state = modelReviewState(base, necessityReview(base));
    expect(planModelRetention(base, grant("modelling"), day(664), state)).toMatchObject({
      disposition: "retain",
      purposeUseAllowed: true,
      reviewDue: false,
      reviewDueAt: day(665),
    });
    expect(planModelRetention(base, grant("modelling"), day(665), state)).toMatchObject({
      disposition: "human_review_required",
      purposeUseAllowed: false,
      reviewDue: true,
      reviewDueAt: day(665),
    });
  });
  it("does not let an ordinary correction refresh the initial review anchor", () => {
    const corrected = modelRecord({
      revision: 2,
      createdAt: day(200),
    });
    const authority = { ...grant("modelling"), recordRevision: 2 };
    expect(
      planModelRetention(corrected, authority, day(365), modelReviewState(corrected)),
    ).toMatchObject({
      disposition: "human_review_required",
      purposeUseAllowed: false,
      reviewDue: true,
      reviewDueAt: day(365),
    });
  });
  it("binds necessity review to both tenant dimensions and the exact record version", () => {
    const base = modelRecord();
    const valid = necessityReview(base);
    const invalid: NecessityReviewConfirmation[] = [
      { ...valid, target: { ...valid.target, organizationId: "other" } },
      { ...valid, target: { ...valid.target, subjectId: "other" } },
      { ...valid, target: { ...valid.target, recordId: "other" } },
      { ...valid, target: { ...valid.target, recordRevision: 2 } },
      {
        ...valid,
        confirmedBy: { ...valid.confirmedBy, organizationId: "other" },
      },
      {
        ...valid,
        confirmedBy: { ...valid.confirmedBy, subjectId: "other" },
      },
    ];
    for (const review of invalid) {
      expect(() =>
        planModelRetention(base, grant("modelling"), day(301), modelReviewState(base, review)),
      ).toThrow(/necessity review/i);
    }
  });
  it("rejects non-Human, future, out-of-order and undeclared review authority", () => {
    const base = modelRecord();
    const valid = necessityReview(base);
    const accessorReview = { ...valid };
    Object.defineProperty(accessorReview, "confirmedAt", {
      get: () => day(300),
      enumerable: true,
    });
    const validState = modelReviewState(base);
    const invalidStates: ModelNecessityReviewState[] = [
      {
        ...validState,
        initialEndorsement: initialEndorsement(base, day(302)),
      },
      modelReviewState(base, {
        ...valid,
        confirmedBy: { ...valid.confirmedBy, kind: "system" },
      } as unknown as NecessityReviewConfirmation),
      modelReviewState(base, {
        ...valid,
        policyVersion: "unreviewed-policy",
      } as unknown as NecessityReviewConfirmation),
      modelReviewState(base, {
        ...valid,
        preparedAt: day(301),
        confirmedAt: day(300),
      }),
      modelReviewState(base, {
        ...valid,
        preparedAt: day(301),
        confirmedAt: day(302),
      }),
      modelReviewState(base, {
        ...valid,
        preparedAt: day(0),
        confirmedAt: day(0),
      }),
      modelReviewState(base, accessorReview),
      modelReviewState(base, {
        ...valid,
        grantsModelUse: true,
      } as NecessityReviewConfirmation),
      {
        ...validState,
        initialEndorsement: {
          ...validState.initialEndorsement,
          target: { ...validState.initialEndorsement.target, organizationId: "other" },
        },
      },
      {
        ...validState,
        initialEndorsement: {
          ...validState.initialEndorsement,
          confirmedBy: { ...validState.initialEndorsement.confirmedBy, subjectId: "other" },
        },
      },
    ];
    expect(() => planRetention(base, grant("modelling"), day(301))).toThrow();
    for (const state of invalidStates) {
      expect(() => planModelRetention(base, grant("modelling"), day(301), state)).toThrow();
    }
    for (const item of [
      { ...base, lastNecessityReviewAt: day(300) } as RetentionRecord,
      { ...base, initialHumanEndorsedAt: day(300) } as RetentionRecord,
      { ...base, correctedAt: day(300) } as RetentionRecord,
    ]) {
      expect(() => planModelRetention(item, grant("modelling"), day(301), validState)).toThrow();
    }
    expect(() =>
      planRetention(record("experience_archive"), grant("private_archive"), day(301), validState),
    ).toThrow();
  });
  it("does not let review confirmation revive evidence or purpose authorization", () => {
    const base = modelRecord();
    const reviewed = modelReviewState(base, necessityReview(base));
    expect(
      planModelRetention(
        modelRecord({ evidenceEligible: false }),
        grant("modelling"),
        day(301),
        reviewed,
      ),
    ).toMatchObject({
      disposition: "remove",
      purposeUseAllowed: false,
      reviewDue: false,
    });
    expect(
      planModelRetention(base, { ...grant("modelling"), revokedAt: day(301) }, day(301), reviewed),
    ).toMatchObject({
      disposition: "remove",
      purposeUseAllowed: false,
      reviewDue: false,
    });
    expect(
      planModelRetention(base, { ...grant("modelling"), revokedAt: day(365) }, day(365)),
    ).toMatchObject({
      disposition: "remove",
      purposeUseAllowed: false,
      reviewDue: true,
      reviewDecision: "superseded_by_removal",
    });
  });
  it("requires separate explicit reviewed receipt limit; never defaults to twelve months", () => {
    expect(planRetention(record("receipt"), grant("rights_receipt"), day(1)).disposition).toBe(
      "remove",
    );
    const g = {
      ...grant("rights_receipt"),
      approvedBy: "reviewed_policy" as const,
      validUntil: day(100),
    };
    expect(planRetention(record("receipt"), g, day(1)).expiresAt).toBe(day(100));
    expect(planRetention(record("receipt"), g, day(100)).disposition).toBe("remove");
    expect(planRetention(record("receipt"), { ...g, basisReference: "" }, day(1)).disposition).toBe(
      "remove",
    );
  });
  it("excludes immediately and counts both erasure objectives from one request", () => {
    const r = { ...record("experience_archive"), erasureRequestedAt: day(2) };
    expect(planRetention(r, grant("private_archive"), day(2))).toMatchObject({
      disposition: "remove",
      purposeUseAllowed: false,
      liveRemovalTargetAt: day(9),
      allCopiesRemovalTargetAt: day(32),
      removalVerified: false,
    });
  });
  it("withdrawal blocks use without claiming deletion; unrelated private purpose remains distinct", () => {
    expect(
      planModelRetention(modelRecord(), { ...grant("modelling"), revokedAt: day(1) }, day(1))
        .purposeUseAllowed,
    ).toBe(false);
    expect(planRetention(record("diary"), grant("private_archive"), day(1)).purposeUseAllowed).toBe(
      true,
    );
  });
  it.each([
    { scope: { ...scope, organizationId: "other" } },
    { scope: { ...scope, subjectId: "other" } },
    { recordId: "other" },
    { recordRevision: 2 },
    { validFrom: day(2) },
  ])("rejects mismatched or not-yet-valid authority %j", (change) => {
    expect(planRetention(record(), { ...grant(), ...change }, day(1)).disposition).toBe("remove");
  });
  it("does not retain unknown consent or resurrect ineligible sources", () => {
    expect(planRetention(record(), null, day(1)).disposition).toBe("remove");
    expect(
      planRetention(
        { ...record("experience_archive"), evidenceEligible: false },
        grant("private_archive"),
        day(1),
      ).disposition,
    ).toBe("remove");
  });
  it.each(["not-a-date", "2026-02-30T00:00:00.000Z", "2026-01-01", day(-1)])(
    "rejects invalid/noncanonical/pre-creation clock %s",
    (now) => {
      expect(() => planRetention(record(), grant(), now)).toThrow();
    },
  );
  it("rejects future or pre-creation substantial evidence", () => {
    for (const anchor of [day(-1), day(2)]) {
      expect(() =>
        planRetention(
          { ...record("hypothesis"), lastSubstantialEvidenceAt: anchor },
          grant("modelling"),
          day(1),
        ),
      ).toThrow();
    }
  });
});

describe("Human-approved private experience composition", () => {
  function context() {
    return {
      scope,
      actor: { kind: "human" as const, subjectId: scope.subjectId },
      now: day(1),
      authorization: grant("private_archive"),
      currentRecord: record("experience_archive"),
      currentSources: draft.provenance,
      approvedFingerprint: experienceFingerprint(draft),
    };
  }
  it("retains context and uncertainty without inventing an outcome or transfer authority", () => {
    const result = composePrivateExperience(draft, context());
    expect(result.observedOutcomes).toEqual([]);
    expect(result.transferAuthority).toBe("none");
    expect(result.provenance).toEqual(draft.provenance);
    expect(result).not.toBe(draft);
    expect(result.provenance).not.toBe(draft.provenance);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provenance[0].scope)).toBe(true);
    expect(() => {
      (result as { humanLesson: string }).humanLesson = "Altered";
    }).toThrow();
  });
  it("binds Human approval to exact content, revision and both scope dimensions", () => {
    for (const change of [
      { humanLesson: "Invented conclusion" },
      { revision: 2 },
      { scope: { ...scope, organizationId: "other" } },
      { scope: { ...scope, subjectId: "other" } },
    ]) {
      expect(() => composePrivateExperience({ ...draft, ...change }, context())).toThrow();
    }
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        actor: { kind: "model", subjectId: scope.subjectId },
      }),
    ).toThrow();
  });
  it("rejects missing, cross-tenant or erased-only provenance even with a matching fingerprint", () => {
    for (const provenance of [
      [],
      [{ ...draft.provenance[0], eligible: false }],
      [{ ...draft.provenance[0], scope: { ...scope, subjectId: "other" } }],
    ]) {
      const changed = { ...draft, provenance };
      expect(() =>
        composePrivateExperience(changed, {
          ...context(),
          approvedFingerprint: experienceFingerprint(changed),
        }),
      ).toThrow();
    }
  });
  it("rejects revoked archive authority and does not accept policy-only archival selection", () => {
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        authorization: { ...grant("private_archive"), revokedAt: day(1) },
      }),
    ).toThrow();
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        authorization: { ...grant("private_archive"), approvedBy: "reviewed_policy" },
      }),
    ).toThrow();
  });
  it("rejects an approved payload after removal request or source withdrawal", () => {
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        currentRecord: { ...record("experience_archive"), erasureRequestedAt: day(1) },
      }),
    ).toThrow();
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        currentSources: [{ ...draft.provenance[0], eligible: false }],
      }),
    ).toThrow();
    expect(() => composePrivateExperience(draft, { ...context(), currentSources: [] })).toThrow();
  });
  it("rejects undeclared sensitive fields even if their content was fingerprinted", () => {
    const changed = { ...draft, rawDiary: "Not admitted archive content" };
    expect(() =>
      composePrivateExperience(changed, {
        ...context(),
        approvedFingerprint: experienceFingerprint(changed),
      }),
    ).toThrow();
  });
  it("requires current lifecycle identity and unambiguous current source authority", () => {
    for (const change of [
      { revision: 2 },
      { id: "other" },
      { scope: { ...scope, organizationId: "other" } },
      { scope: { ...scope, subjectId: "other" } },
      { evidenceEligible: false },
    ]) {
      expect(() =>
        composePrivateExperience(draft, {
          ...context(),
          currentRecord: { ...record("experience_archive"), ...change },
        }),
      ).toThrow();
    }
    expect(() =>
      composePrivateExperience(draft, {
        ...context(),
        currentSources: [...draft.provenance, ...draft.provenance],
      }),
    ).toThrow();
  });
  it("rejects clone/hash ambiguity in sparse, hidden, extra and accessor fields", () => {
    const sparse = new Array(1) as string[];
    const extra = Object.assign(["Morning"], { raw: "Hidden content" });
    const hidden = ["Morning"];
    Object.defineProperty(hidden, "0", { value: "Morning", enumerable: false });
    for (const consideredOptions of [sparse, extra, hidden]) {
      expect(() => experienceFingerprint({ ...draft, consideredOptions })).toThrow();
    }
    let invoked = false;
    const accessor = { ...draft };
    Object.defineProperty(accessor, "humanLesson", {
      get: () => {
        invoked = true;
        return "Changed";
      },
      enumerable: true,
    });
    expect(() => experienceFingerprint(accessor)).toThrow();
    expect(invoked).toBe(false);
  });
  it("canonical approval is independent of object-key order but sensitive to ordered experience", () => {
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as ExperienceDraft;
    expect(experienceFingerprint(reordered)).toBe(experienceFingerprint(draft));
    expect(
      experienceFingerprint({
        ...draft,
        consideredOptions: [...draft.consideredOptions].reverse(),
      }),
    ).not.toBe(experienceFingerprint(draft));
  });
});
