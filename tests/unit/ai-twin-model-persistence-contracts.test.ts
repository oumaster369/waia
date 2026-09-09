import { beforeEach, describe, expect, it } from "vitest";

import {
  validateWorkingHypothesis,
  validateDynamicRelation,
  validateKnowledgeNeed,
  planPrivateExport,
  validateReflection,
  validatePredictionExperiment,
  validateOutcomeReceipt,
  type WorkingHypothesis,
  type VersionedModelReference,
} from "@/lib/ai-twin/model/persistence-contracts";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const now = "2026-09-08T12:00:00.000Z";
const source: VersionedModelReference = { ...scope, kind: "observation", id: "o1", version: 1 };

describe("reflection, expectation and reported outcome remain distinct", () => {
  const later = (hours: number) => new Date(Date.parse(now) + hours * 3600000).toISOString();
  const resultSource = { ...source, id: "reported-result" };
  const context = () => ({
    scope,
    purpose: "private_modelling",
    retentionPolicyId: "human-approved-2026-09-08/v1",
    now: later(2),
    eligibleSources: [source, resultSource],
  });
  const base = (kind: VersionedModelReference["kind"]) => ({
    ref: { ...scope, kind, id: kind, version: 1 },
    purpose: context().purpose,
    retentionPolicyId: context().retentionPolicyId,
    createdAt: now,
    context: "Synthetic planning only",
    uncertainty: "One self-report",
    evidence: [source],
    state: "proposed",
  });
  const reflection = () => ({ ...base("reflection"), text: "Quiet plans might matter this week" });
  const prediction = () => ({
    ...base("prediction"),
    mode: "expectation",
    expectedOutcome: "May report less interruption",
    windowStartsAt: now,
    windowEndsAt: later(1),
    reversibilityNotes: "No action authorized",
    stopCondition: "Human can decline",
    experimentConsent: null,
    actionAuthority: "none",
  });
  const report = () => ({
    ...base("outcome"),
    createdAt: later(2),
    prediction: prediction().ref,
    state: "human_reported",
    observedOutcome: "Human reported no difference",
    observedAt: later(1.5),
    evidence: [resultSource],
  });
  const actor = { kind: "human", subjectId: scope.subjectId };
  const validateReport = (input: unknown) =>
    validateOutcomeReceipt(input, context(), prediction(), actor);
  beforeEach(() => {
    expect(typeof validateReflection).toBe("function");
    expect(typeof validatePredictionExperiment).toBe("function");
    expect(typeof validateOutcomeReceipt).toBe("function");
  });
  it("preserves reflection as a proposed interpretation, not a ratified fact", () => {
    const input = reflection();
    const value = validateReflection(input, context());
    expect(value).toEqual(input);
    input.text = "changed";
    expect(value.text).not.toBe(input.text);
    expect(Object.isFrozen(value.evidence[0])).toBe(true);
    expect(value).not.toHaveProperty("verified");
  });
  it.each(["expectation", "experiment_proposal"])("keeps %s separate from permission", (mode) => {
    const input = { ...prediction(), mode };
    const value = validatePredictionExperiment(input, context());
    expect(value).toEqual(input);
    expect(value.actionAuthority).toBe("none");
    expect(value.experimentConsent).toBeNull();
    expect(Object.isFrozen(value)).toBe(true);
  });
  it("records a Human report outside the expected window without rewriting the prediction", () => {
    const expected = prediction();
    const before = structuredClone(expected);
    const value = validateOutcomeReceipt(report(), context(), expected, actor);
    expect(value.observedOutcome).toBe("Human reported no difference");
    expect(value.state).toBe("human_reported");
    expect(value.observedAt).toBe(later(1.5));
    expect(expected).toEqual(before);
    expect(value).not.toHaveProperty("calibration");
    expect(value).not.toHaveProperty("formationProgress");
    expect(Object.isFrozen(value.prediction)).toBe(true);
  });
  it.each(["unknown", "declined"])(
    "preserves %s without fabricated outcomes or progress",
    (state) => {
      const input = { ...report(), state, observedOutcome: null, observedAt: null, evidence: [] };
      expect(validateReport(input)).toEqual(input);
      expect(() => validateReport({ ...input, observedOutcome: "Succeeded" })).toThrow(
        "INVALID_INPUT",
      );
      expect(() => validateReport({ ...input, observedAt: later(1) })).toThrow("INVALID_INPUT");
      expect(() => validateReport({ ...input, evidence: [resultSource] })).toThrow("INVALID_INPUT");
    },
  );
  it.each(["model", "administrator"])("denies %s outcome attribution", (kind) => {
    expect(() =>
      validateOutcomeReceipt(report(), context(), prediction(), {
        kind,
        subjectId: scope.subjectId,
      }),
    ).toThrow("HUMAN_REQUIRED");
  });
  it("denies another Human actor", () => {
    expect(() =>
      validateOutcomeReceipt(report(), context(), prediction(), {
        ...actor,
        subjectId: "other",
      }),
    ).toThrow("HUMAN_REQUIRED");
  });
  it("binds the exact prediction identity and version", () => {
    for (const change of [{ id: "other" }, { version: 2 }, { kind: "claim" }]) {
      expect(() =>
        validateReport({ ...report(), prediction: { ...prediction().ref, ...change } }),
      ).toThrow("PREDICTION_MISMATCH");
    }
  });
  it("requires current evidence for both expected and reported outcomes", () => {
    for (const eligibleSources of [
      [],
      [source],
      [resultSource],
      [{ ...resultSource, version: 2 }, source],
    ]) {
      expect(() =>
        validateOutcomeReceipt(report(), { ...context(), eligibleSources }, prediction(), actor),
      ).toThrow("EVIDENCE_UNAVAILABLE");
    }
  });
  it("does not use a model interpretation or advice acceptance as observed evidence", () => {
    const claim = { ...resultSource, kind: "claim" as const };
    expect(() =>
      validateOutcomeReceipt(
        { ...report(), evidence: [claim] },
        {
          ...context(),
          eligibleSources: [source, claim],
        },
        prediction(),
        actor,
      ),
    ).toThrow("OBSERVATION_REQUIRED");
    expect(() => validateReport({ ...report(), state: "accepted" })).toThrow("INVALID_INPUT");
    expect(() => validateReport({ ...report(), state: "verified" })).toThrow("INVALID_INPUT");
  });
  it("requires an actual report and provenance for human_reported state", () => {
    for (const change of [
      { observedOutcome: null },
      { observedOutcome: "" },
      { observedAt: null },
      { evidence: [] },
    ]) {
      expect(() => validateReport({ ...report(), ...change })).toThrow();
    }
  });
  it("rejects event times before prediction or after report and future report creation", () => {
    for (const observedAt of [later(-1), later(3), "invalid"]) {
      expect(() => validateReport({ ...report(), observedAt })).toThrow("INVALID_INPUT");
    }
    expect(() => validateReport({ ...report(), createdAt: later(3) })).toThrow("INVALID_INPUT");
  });
  it.each(["unknown", "declined"])(
    "rejects a %s receipt created before the prediction",
    (state) => {
      expect(() =>
        validateReport({
          ...report(),
          state,
          createdAt: later(-1),
          observedOutcome: null,
          observedAt: null,
          evidence: [],
        }),
      ).toThrow("INVALID_INPUT");
    },
  );
  it.each([1, 2])("rejects a prediction grounded in its own outcome version %s", (version) => {
    const circular = { ...report().ref, version };
    expect(() =>
      validateOutcomeReceipt(
        report(),
        {
          ...context(),
          eligibleSources: [source, resultSource, circular],
        },
        { ...prediction(), evidence: [source, circular] },
        actor,
      ),
    ).toThrow("CIRCULAR_OUTCOME");
  });
  it.each(["organizationId", "subjectId"] as const)(
    "rejects foreign %s across all objects",
    (key) => {
      const foreign = { ...scope, [key]: "other" };
      expect(() =>
        validateReflection(
          { ...reflection(), ref: { ...reflection().ref, ...foreign } },
          context(),
        ),
      ).toThrow("SCOPE_MISMATCH");
      expect(() =>
        validatePredictionExperiment(
          { ...prediction(), evidence: [{ ...source, ...foreign }] },
          context(),
        ),
      ).toThrow("SCOPE_MISMATCH");
      expect(() =>
        validateReport({ ...report(), prediction: { ...prediction().ref, ...foreign } }),
      ).toThrow("SCOPE_MISMATCH");
      expect(() =>
        validateReport({ ...report(), evidence: [{ ...resultSource, ...foreign }] }),
      ).toThrow("SCOPE_MISMATCH");
    },
  );
  it("rejects changed purpose/policy and a stale prediction purpose", () => {
    for (const change of [{ purpose: "society" }, { retentionPolicyId: "unknown" }]) {
      expect(() => validateReflection({ ...reflection(), ...change }, context())).toThrow(
        "PURPOSE_POLICY_MISMATCH",
      );
      expect(() => validatePredictionExperiment({ ...prediction(), ...change }, context())).toThrow(
        "PURPOSE_POLICY_MISMATCH",
      );
      expect(() => validateReport({ ...report(), ...change })).toThrow("PURPOSE_POLICY_MISMATCH");
      expect(() =>
        validateOutcomeReceipt(report(), context(), { ...prediction(), ...change }, actor),
      ).toThrow("PURPOSE_POLICY_MISMATCH");
    }
  });
  it("rejects executable authority, invented consent, safety labels and confidence scores", () => {
    for (const change of [
      { actionAuthority: "execute" },
      { experimentConsent: "approved" },
      { safetyApproved: true },
      { confidence: 1 },
      { state: "active" },
      { reversibilityNotes: "" },
      { stopCondition: "" },
    ])
      expect(() => validatePredictionExperiment({ ...prediction(), ...change }, context())).toThrow(
        "INVALID_INPUT",
      );
    expect(() => validateReflection({ ...reflection(), state: "ratified" }, context())).toThrow(
      "INVALID_INPUT",
    );
  });
  it("rejects invalid observation windows", () => {
    for (const change of [
      { windowStartsAt: later(-1) },
      { windowEndsAt: now },
      { windowEndsAt: "invalid" },
      { windowStartsAt: later(2) },
    ])
      expect(() => validatePredictionExperiment({ ...prediction(), ...change }, context())).toThrow(
        "INVALID_INPUT",
      );
  });
  it("rejects missing, duplicated, sparse and accessor evidence", () => {
    for (const evidence of [[], [source, source], new Array(1)]) {
      expect(() => validateReflection({ ...reflection(), evidence }, context())).toThrow();
      expect(() =>
        validatePredictionExperiment({ ...prediction(), evidence }, context()),
      ).toThrow();
    }
    let invoked = false;
    const input = reflection();
    Object.defineProperty(input, "text", {
      enumerable: true,
      get() {
        invoked = true;
        return "x";
      },
    });
    expect(() => validateReflection(input, context())).toThrow("INVALID_INPUT");
    expect(invoked).toBe(false);
  });
});

describe("private export composition — metadata only, no delivery", () => {
  const older = { ...source, version: 2 };
  const context = () => ({
    scope,
    actor: { kind: "human", subjectId: scope.subjectId },
    requestId: "export-a",
    createdAt: now,
    now,
    approvedRecords: [source, older],
    eligibleRecords: [source],
  });
  const at = (hours: number) => new Date(Date.parse(now) + hours * 3600000).toISOString();

  it("includes only explicitly selected current export-eligible versions", () => {
    const ctx = context();
    ctx.eligibleRecords.push({ ...source, id: "unselected" });
    expect(planPrivateExport([source, older], ctx)).toEqual({
      scope,
      requestId: "export-a",
      requesterSubjectId: scope.subjectId,
      createdAt: now,
      expiresAt: at(24),
      records: [source],
      excluded: [{ ref: older, reason: "UNAVAILABLE_FOR_PRIVATE_EXPORT" }],
      deliveryAuthority: "none",
    });
  });
  it("does not renew creation or deadline on repeated composition", () => {
    const ctx = context();
    const result = planPrivateExport([source, older], { ...ctx, now: at(23.99) });
    expect(result.createdAt).toBe(now);
    expect(result.expiresAt).toBe(at(24));
    expect(() => planPrivateExport([source, older], { ...ctx, now: at(24) })).toThrow(
      "EXPORT_EXPIRED",
    );
  });
  it("rechecks permission loss without renewing expiry or reporting removal", () => {
    const result = planPrivateExport([source, older], {
      ...context(),
      now: at(1),
      eligibleRecords: [],
    });
    expect(result.records).toEqual([]);
    expect(result.excluded).toHaveLength(2);
    expect(result.expiresAt).toBe(at(24));
    expect(result.deliveryAuthority).toBe("none");
    expect(result).not.toHaveProperty("removalVerified");
  });
  it("rejects revoked or altered Human selection", () => {
    expect(() => planPrivateExport([source], { ...context(), approvedRecords: [] })).toThrow();
    expect(() => planPrivateExport([source], context())).toThrow("SELECTION_MISMATCH");
    expect(() =>
      planPrivateExport([source, older, { ...source, id: "extra" }], context()),
    ).toThrow();
  });
  it.each(["model", "administrator"])("rejects %s actor", (kind) => {
    expect(() =>
      planPrivateExport([source, older], {
        ...context(),
        actor: { kind, subjectId: scope.subjectId },
      }),
    ).toThrow("HUMAN_REQUIRED");
  });
  it.each(["organizationId", "subjectId"] as const)("rejects foreign %s anywhere", (key) => {
    const foreign = { ...source, [key]: "other" };
    expect(() => planPrivateExport([foreign, older], context())).toThrow();
    expect(() =>
      planPrivateExport([source, older], {
        ...context(),
        approvedRecords: [source, foreign],
      }),
    ).toThrow();
    expect(() =>
      planPrivateExport([source, older], {
        ...context(),
        eligibleRecords: [source, foreign],
      }),
    ).toThrow();
    expect(() =>
      planPrivateExport([source, older], {
        ...context(),
        scope: { ...scope, [key]: "other" },
      }),
    ).toThrow();
  });
  it("rejects a different Human actor even inside the same organization", () => {
    expect(() =>
      planPrivateExport([source, older], {
        ...context(),
        actor: { kind: "human", subjectId: "other" },
      }),
    ).toThrow("HUMAN_REQUIRED");
  });
  it.each(["action_capability", "legacy_directive", "subscription", "unknown"])(
    "does not activate export of unsupported %s",
    (kind) => {
      const unsupported = { ...source, kind } as VersionedModelReference;
      expect(() =>
        planPrivateExport([unsupported], {
          ...context(),
          approvedRecords: [unsupported],
          eligibleRecords: [unsupported],
        }),
      ).toThrow();
    },
  );
  it("rejects extra authority, raw-content and caller TTL fields", () => {
    for (const extra of [
      { deliveryAuthority: "download" },
      { expiresAt: at(48) },
      { rawText: "private" },
    ]) {
      expect(() => planPrivateExport([source, older], { ...context(), ...extra })).toThrow();
      expect(() => planPrivateExport([{ ...source, ...extra }, older], context())).toThrow();
    }
  });
  it("rejects duplicate and sparse references before composing", () => {
    for (const records of [[source, source], new Array(1)]) {
      expect(() => planPrivateExport(records, context())).toThrow();
      expect(() =>
        planPrivateExport([source, older], {
          ...context(),
          eligibleRecords: records,
        }),
      ).toThrow();
      expect(() =>
        planPrivateExport([source, older], {
          ...context(),
          approvedRecords: records,
        }),
      ).toThrow();
    }
  });
  it("rejects getters without invoking them", () => {
    let invoked = false;
    const hostile = { ...source };
    Object.defineProperty(hostile, "id", {
      enumerable: true,
      get() {
        invoked = true;
        return "other";
      },
    });
    expect(() => planPrivateExport([hostile, older], context())).toThrow();
    expect(invoked).toBe(false);
  });
  it("rejects invalid and future creation clocks", () => {
    for (const createdAt of ["invalid", at(1)]) {
      expect(() => planPrivateExport([source, older], { ...context(), createdAt })).toThrow();
    }
    expect(() => planPrivateExport([source, older], { ...context(), now: "invalid" })).toThrow();
  });
  it("returns independent deeply frozen private metadata", () => {
    const selected = structuredClone([source, older]);
    const ctx = structuredClone(context());
    const result = planPrivateExport(selected, ctx);
    selected[0].id = "changed";
    ctx.scope.subjectId = "changed";
    expect(result.records[0].id).toBe(source.id);
    expect(result.scope.subjectId).toBe(scope.subjectId);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.records[0])).toBe(true);
    expect(Object.isFrozen(result.excluded[0].ref)).toBe(true);
  });
});
function draft(): WorkingHypothesis {
  return {
    ref: { ...scope, kind: "hypothesis", id: "h1", version: 1 },
    purpose: "private_modelling",
    createdAt: now,
    retentionPolicyId: "human-approved-2026-09-08/v1",
    context: "Synthetic weekend planning",
    domains: ["preferences"],
    alternatives: [
      {
        id: "a",
        statement: "May prefer quiet plans",
        support: [source],
        contradiction: [],
        uncertainty: "One self-report",
        falsifier: "Human reports choosing a busy event",
      },
      {
        id: "b",
        statement: "May want quiet only this week",
        support: [source],
        contradiction: [],
        uncertainty: "Temporary context remains unknown",
        falsifier: "Human describes a stable repeated preference",
      },
    ],
    validFrom: now,
    validUntil: null,
    lastSubstantialEvidenceAt: null,
    status: "proposed",
  };
}

describe("AI-TWIN persistence hypothesis contract — synthetic, not extraction", () => {
  it("does not count the same interpretation under two ids as plural", () => {
    const value = draft();
    value.alternatives[1] = {
      ...structuredClone(value.alternatives[0]),
      id: "b",
      statement: `  ${value.alternatives[0].statement}  `,
    };
    expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow(
      "DUPLICATE_INTERPRETATION",
    );
  });
  it("preserves competing interpretations, uncertainty and versioned evidence without promotion", () => {
    const result = validateWorkingHypothesis(draft(), scope, [source], now);
    expect(result.alternatives).toHaveLength(2);
    expect(result.status).toBe("proposed");
    expect(result.alternatives[0].support[0]).toEqual(source);
    expect(result).not.toHaveProperty("confidenceScore");
  });
  it.each(["organizationId", "subjectId"] as const)(
    "rejects foreign %s at root and evidence endpoints",
    (key) => {
      const root = draft();
      root.ref = { ...root.ref, [key]: "other" };
      expect(() => validateWorkingHypothesis(root, scope, [source], now)).toThrow();
      const nested = draft();
      nested.alternatives[0].support = [{ ...source, [key]: "other" }];
      expect(() =>
        validateWorkingHypothesis(nested, scope, [{ ...source, [key]: "other" }], now),
      ).toThrow();
    },
  );
  it("requires current exact eligible source versions, not an old draft flag", () => {
    expect(() => validateWorkingHypothesis(draft(), scope, [], now)).toThrow(
      "EVIDENCE_UNAVAILABLE",
    );
    expect(() =>
      validateWorkingHypothesis(draft(), scope, [{ ...source, version: 2 }], now),
    ).toThrow("EVIDENCE_UNAVAILABLE");
  });
  it("rejects a single, duplicated or ungrounded interpretation", () => {
    for (const modify of [
      (x: WorkingHypothesis) => {
        x.alternatives.pop();
      },
      (x: WorkingHypothesis) => {
        x.alternatives[1].id = "a";
      },
      (x: WorkingHypothesis) => {
        x.alternatives.forEach((a) => {
          a.support = [];
        });
      },
    ]) {
      const value = draft();
      modify(value);
      expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow();
    }
  });
  it("keeps support and contradiction distinct, including an untested alternative", () => {
    const value = draft();
    value.alternatives[1].support = [];
    value.alternatives[1].contradiction = [source];
    expect(
      validateWorkingHypothesis(value, scope, [source], now).alternatives[1].contradiction,
    ).toEqual([source]);
  });
  it("rejects future clocks, invalid intervals and invalid revisions", () => {
    for (const modify of [
      (x: WorkingHypothesis) => {
        x.createdAt = "2027-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.lastSubstantialEvidenceAt = "2027-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.validUntil = "2025-01-01T00:00:00.000Z";
      },
      (x: WorkingHypothesis) => {
        x.ref.version = 0;
      },
    ]) {
      const value = draft();
      modify(value);
      expect(() => validateWorkingHypothesis(value, scope, [source], now)).toThrow();
    }
  });
  it("rejects undeclared sensitive fields, sparse arrays and accessors without invoking them", () => {
    const extra = { ...draft(), rawDiary: "not allowed" };
    expect(() => validateWorkingHypothesis(extra, scope, [source], now)).toThrow();
    const sparse = draft();
    sparse.alternatives[0].support = new Array(1);
    expect(() => validateWorkingHypothesis(sparse, scope, [source], now)).toThrow();
    let read = false;
    const getter = draft();
    Object.defineProperty(getter.alternatives[0], "statement", {
      enumerable: true,
      get() {
        read = true;
        return "bad";
      },
    });
    expect(() => validateWorkingHypothesis(getter, scope, [source], now)).toThrow();
    expect(read).toBe(false);
  });
  it("returns an immutable independent record", () => {
    const value = draft();
    const result = validateWorkingHypothesis(value, scope, [source], now);
    value.alternatives[0].statement = "changed";
    expect(result.alternatives[0].statement).not.toBe("changed");
    expect(Object.isFrozen(result.alternatives[0].support[0])).toBe(true);
  });
});

const candidateContext = {
  scope,
  purpose: "private_modelling",
  retentionPolicyId: "human-approved-2026-09-08/v1",
  eligibleSources: [source],
  now,
};
function relationDraft() {
  return {
    ref: { ...scope, kind: "relation", id: "r1", version: 1 },
    kind: "tension",
    endpoints: [source],
    purpose: candidateContext.purpose,
    retentionPolicyId: candidateContext.retentionPolicyId,
    createdAt: now,
    context: "Synthetic independence and collaboration tension",
    uncertainty: "Only one report; alternatives remain open",
    validFrom: now,
    validUntil: null,
    status: "proposed",
  };
}
function needDraft() {
  return {
    ref: { ...scope, kind: "knowledge_need", id: "n1", version: 1 },
    purpose: candidateContext.purpose,
    retentionPolicyId: candidateContext.retentionPolicyId,
    createdAt: now,
    reason: "Context is missing",
    proposedObservation: "Ask whether this applies outside work, if the Human wants to discuss it",
    evidence: [] as VersionedModelReference[],
    state: "open",
  };
}

describe("AI-TWIN remaining object candidates — validation is not authority", () => {
  it.each(["sigma", "delta", "attractor", "tension", "temporal_transition"])(
    "preserves a proposed %s relation and its uncertainty",
    (kind) => {
      const result = validateDynamicRelation({ ...relationDraft(), kind }, candidateContext);
      expect(result.status).toBe("proposed");
      expect(result.endpoints).toEqual([source]);
      expect(result.uncertainty).toBe(relationDraft().uncertainty);
      expect(result).not.toHaveProperty("confidence");
    },
  );
  it("allows an open unknown without evidence but not unsupported resolution", () => {
    expect(validateKnowledgeNeed(needDraft(), candidateContext).state).toBe("open");
    expect(() =>
      validateKnowledgeNeed({ ...needDraft(), state: "resolved" }, candidateContext),
    ).toThrow("EVIDENCE_UNAVAILABLE");
    expect(
      validateKnowledgeNeed(
        { ...needDraft(), state: "resolved", evidence: [source] },
        candidateContext,
      ).state,
    ).toBe("resolved");
    const skipped = validateKnowledgeNeed({ ...needDraft(), state: "skipped" }, candidateContext);
    expect(skipped).not.toHaveProperty("penalty");
  });
  it.each(["organizationId", "subjectId"])(
    "rejects foreign %s at candidate and eligible source",
    (field) => {
      expect(() =>
        validateDynamicRelation(
          { ...relationDraft(), ref: { ...relationDraft().ref, [field]: "foreign" } },
          candidateContext,
        ),
      ).toThrow("SCOPE_MISMATCH");
      expect(() =>
        validateKnowledgeNeed(needDraft(), {
          ...candidateContext,
          eligibleSources: [{ ...source, [field]: "foreign" }],
        }),
      ).toThrow("SCOPE_MISMATCH");
    },
  );
  it("binds current exact eligible sources, purpose and policy", () => {
    for (const context of [
      { ...candidateContext, purpose: "society" },
      { ...candidateContext, retentionPolicyId: "unknown-policy" },
      { ...candidateContext, eligibleSources: [{ ...source, version: 2 }] },
      { ...candidateContext, eligibleSources: [] },
    ])
      expect(() => validateDynamicRelation(relationDraft(), context)).toThrow();
    expect(() =>
      validateKnowledgeNeed(
        { ...needDraft(), evidence: [source] },
        { ...candidateContext, eligibleSources: [] },
      ),
    ).toThrow("EVIDENCE_UNAVAILABLE");
  });
  it("rejects empty/duplicate/self endpoints and action or private archive references", () => {
    const self: VersionedModelReference = { ...source, kind: "relation", id: "r1" };
    const invalidEndpointSets: VersionedModelReference[][] = [
      [],
      [source, source],
      [self],
      [{ ...source, kind: "action_capability" }],
      [{ ...source, kind: "experience" }],
    ];
    for (const endpoints of invalidEndpointSets) {
      expect(() =>
        validateDynamicRelation(
          { ...relationDraft(), endpoints },
          { ...candidateContext, eligibleSources: endpoints },
        ),
      ).toThrow();
    }
    expect(() =>
      validateKnowledgeNeed({ ...needDraft(), evidence: [source, source] }, candidateContext),
    ).toThrow();
  });
  it("rejects authority/score extras, invalid dates, versions and automatic ratification", () => {
    for (const changes of [
      { status: "ratified" },
      { confidence: 1 },
      { createdAt: "2030-01-01T00:00:00.000Z" },
      { validUntil: now },
      { uncertainty: "" },
      { kind: "diagnosis" },
      { ref: { ...relationDraft().ref, version: 0 } },
    ]) {
      expect(() =>
        validateDynamicRelation({ ...relationDraft(), ...changes }, candidateContext),
      ).toThrow();
    }
    expect(() =>
      validateKnowledgeNeed({ ...needDraft(), collectionAuthorized: true }, candidateContext),
    ).toThrow();
  });
  it("checks plain JSON before reading and returns frozen independent data", () => {
    let read = false;
    const getter = relationDraft();
    Object.defineProperty(getter, "context", {
      enumerable: true,
      get() {
        read = true;
        return "bad";
      },
    });
    expect(() => validateDynamicRelation(getter, candidateContext)).toThrow();
    expect(read).toBe(false);
    expect(() =>
      validateKnowledgeNeed({ ...needDraft(), evidence: new Array(1) }, candidateContext),
    ).toThrow();
    const input = relationDraft();
    const result = validateDynamicRelation(input, candidateContext);
    input.context = "changed";
    expect(result.context).not.toBe("changed");
    expect(Object.isFrozen(result.endpoints[0])).toBe(true);
    expect(Object.isFrozen(validateKnowledgeNeed(needDraft(), candidateContext).ref)).toBe(true);
  });
});
