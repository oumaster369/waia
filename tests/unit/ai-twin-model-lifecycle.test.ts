import { describe, expect, it } from "vitest";
import {
  composePrivateExperience,
  experienceFingerprint,
  planRetention,
  type ExperienceDraft,
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
  it("requires model necessity review without refreshing evidence", () => {
    const r = record("model");
    expect(planRetention(r, grant("modelling"), "2027-01-01T00:00:00.000Z")).toMatchObject({
      reviewDue: true,
      expiresAt: null,
    });
    expect(
      planRetention({ ...r, evidenceEligible: false }, grant("modelling"), day(1)).disposition,
    ).toBe("remove");
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
      planRetention(record("model"), { ...grant("modelling"), revokedAt: day(1) }, day(1))
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
