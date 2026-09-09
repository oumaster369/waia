import { describe, expect, it } from "vitest";

import {
  validateWorkingHypothesis,
  validateDynamicRelation,
  validateKnowledgeNeed,
  type WorkingHypothesis,
  type VersionedModelReference,
} from "@/lib/ai-twin/model/persistence-contracts";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const now = "2026-09-08T12:00:00.000Z";
const source: VersionedModelReference = { ...scope, kind: "observation", id: "o1", version: 1 };
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
    const self = relationDraft().ref;
    for (const endpoints of [
      [],
      [source, source],
      [self],
      [{ ...source, kind: "action_capability" }],
      [{ ...source, kind: "experience" }],
    ]) {
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
