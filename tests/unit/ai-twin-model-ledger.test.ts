import { describe, expect, it } from "vitest";

import {
  applyModelCommand,
  createModelLedger,
  projectCurrentModel,
} from "@/lib/ai-twin/model/ledger";
import type { ModelCommand, ModelContext, ModelLedger } from "@/lib/ai-twin/model/contracts";

const scope = { organizationId: "org-a", subjectId: "human-a" };
const now = "2026-09-06T12:00:00.000Z";
function context(kind: "human" | "model" = "human"): ModelContext {
  return {
    scope,
    actor: { kind, subjectId: scope.subjectId },
    now,
    purpose: "formation",
    grants: [
      {
        id: "grant-a",
        version: 1,
        scope,
        purpose: "formation",
        sources: ["dialogue", "diary"],
        mode: "private_modelling",
        issuedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
        revokedAt: null,
        retentionPolicyId: "synthetic-policy-v1",
      },
    ],
  };
}
const observation: ModelCommand = {
  kind: "observe",
  requestId: "request-observe",
  id: "observation-a",
  scope,
  grant: { id: "grant-a", version: 1 },
  source: "dialogue",
  eventTime: "2026-09-05T09:00:00.000Z",
  context: "Synthetic workday example",
  text: "I focus better in the morning on workdays.",
  projectionRisks: ["missing_context"],
};
const proposal: ModelCommand = {
  kind: "propose",
  requestId: "request-propose",
  claimId: "claim-a",
  scope,
  statement: "Morning meetings are always preferred.",
  domain: "daily-context",
  context: "Synthetic example",
  uncertainty: "May confuse focus time with meeting preference.",
  observationIds: ["observation-a"],
};
const correction: ModelCommand = {
  kind: "correct",
  requestId: "request-correct",
  id: "correction-a",
  claimId: "claim-a",
  scope,
  expectedRevision: 1,
  action: "correct",
  reason: "Focus and meetings are different.",
  statement: "I prefer uninterrupted morning focus on workdays.",
  context: "Workdays only",
};
function proposed(): ModelLedger {
  return applyModelCommand(
    applyModelCommand(createModelLedger(scope), observation, context()),
    proposal,
    context("model"),
  );
}

describe("inert AI-TWIN epistemic correction kernel", () => {
  it("binds evidence and every correction version to the original modelling purpose", () => {
    const state = applyModelCommand(proposed(), correction, context());
    expect(state.observations[0]).toHaveProperty("purpose", "formation");
    expect(state.claims.every((claim) => "purpose" in claim && claim.purpose === "formation")).toBe(
      true,
    );
    expect(state.corrections[0]).toHaveProperty("purpose", "formation");
  });

  it("does not repurpose old evidence even if the adapter relabels a grant", () => {
    const state = proposed();
    const ctx = context();
    ctx.purpose = "another-purpose";
    ctx.grants = [{ ...ctx.grants[0], purpose: ctx.purpose }];
    expect(projectCurrentModel(state, ctx)).toEqual([]);
    expect(() => applyModelCommand(state, correction, ctx)).toThrow("EVIDENCE_UNAVAILABLE");
    expect(() =>
      applyModelCommand(state, proposal, { ...ctx, actor: context("model").actor }),
    ).toThrow("EVIDENCE_UNAVAILABLE");
  });

  it.each([null, undefined, 1, "observe", { kind: "toString" }])(
    "rejects malformed command %j with a stable input error",
    (command) => {
      expect(() =>
        applyModelCommand(createModelLedger(scope), command as ModelCommand, context()),
      ).toThrow("INVALID_INPUT");
    },
  );

  it("uses the Human correction without overwriting self-report or prior interpretation", () => {
    const before = proposed();
    const after = applyModelCommand(before, correction, context());
    expect(before.claims).toHaveLength(1);
    expect(after.claims).toHaveLength(2);
    expect(after.observations[0].epistemicKind).toBe("self_report");
    expect(after.observations[0].text).toBe(observation.text);
    expect(after.claims[0]).toMatchObject({
      status: "proposed",
      basis: "model_interpretation",
      revision: 1,
    });
    expect(projectCurrentModel(after, context())).toEqual([
      expect.objectContaining({
        statement: correction.statement,
        context: "Workdays only",
        revision: 2,
        status: "active",
        basis: "human_endorsed",
        supersedesRevision: 1,
        humanCorrectionId: "correction-a",
        observationIds: ["observation-a"],
        uncertainty: proposal.uncertainty,
      }),
    ]);
    expect(after.corrections[0]).toMatchObject({ previousRevision: 1, actorSubjectId: "human-a" });
  });

  it("does not let model output impersonate Human correction or self-report", () => {
    expect(() => applyModelCommand(proposed(), correction, context("model"))).toThrow(
      "HUMAN_REQUIRED",
    );
    expect(() =>
      applyModelCommand(createModelLedger(scope), observation, context("model")),
    ).toThrow("HUMAN_REQUIRED");
    const forged = { ...correction, actor: { kind: "human" } } as ModelCommand;
    expect(() => applyModelCommand(proposed(), forged, context("model"))).toThrow();
  });

  it.each(["organizationId", "subjectId"] as const)(
    "isolates %s on commands, actors and reads",
    (field) => {
      const otherScope = { ...scope, [field]: "other" };
      expect(() =>
        applyModelCommand(proposed(), { ...correction, scope: otherScope }, context()),
      ).toThrow("SCOPE_MISMATCH");
      expect(() => projectCurrentModel(proposed(), { ...context(), scope: otherScope })).toThrow(
        "SCOPE_MISMATCH",
      );
      const wrongGrant = context();
      wrongGrant.grants = [{ ...wrongGrant.grants[0], scope: otherScope }];
      expect(() => applyModelCommand(createModelLedger(scope), observation, wrongGrant)).toThrow(
        "CONSENT_UNAVAILABLE",
      );
    },
  );

  it("requires the authenticated subject, not an organization administrator", () => {
    const ctx = context();
    ctx.actor = { kind: "human", subjectId: "admin" };
    expect(() => applyModelCommand(proposed(), correction, ctx)).toThrow("SCOPE_MISMATCH");
  });

  it.each(["missing", "revoked", "expired", "raw_only", "purpose", "source", "revision"])(
    "excludes evidence with %s consent",
    (mode) => {
      const ctx = context();
      if (mode === "missing") ctx.grants = [];
      else
        ctx.grants = [
          {
            ...ctx.grants[0],
            ...(mode === "revoked" ? { revokedAt: now } : {}),
            ...(mode === "expired" ? { expiresAt: now } : {}),
            ...(mode === "raw_only" ? { mode: "raw_only" as const } : {}),
            ...(mode === "purpose" ? { purpose: "another-purpose" } : {}),
            ...(mode === "source" ? { sources: ["diary" as const] } : {}),
            ...(mode === "revision" ? { version: 2 } : {}),
          },
        ];
      expect(() => applyModelCommand(createModelLedger(scope), observation, ctx)).toThrow(
        "CONSENT_UNAVAILABLE",
      );
      const state = proposed();
      expect(projectCurrentModel(state, ctx)).toEqual([]);
      expect(() => applyModelCommand(state, correction, ctx)).toThrow("EVIDENCE_UNAVAILABLE");
      expect(state.observations).toHaveLength(1); // Filtering is not physical deletion.
    },
  );

  it("rejects missing evidence rather than inventing a source", () => {
    expect(() => applyModelCommand(createModelLedger(scope), proposal, context("model"))).toThrow(
      "EVIDENCE_UNAVAILABLE",
    );
  });

  it("rejects sparse source references instead of admitting an evidence-free claim", () => {
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        { ...proposal, observationIds: new Array<string>(1) },
        context("model"),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects undeclared array properties rather than storing unhashed content", () => {
    const risks = Object.assign([], { extra: "Unadmitted synthetic content" });
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        { ...observation, projectionRisks: risks },
        context(),
      ),
    ).toThrow("INVALID_INPUT");
    const ids = Object.assign(["observation-a"], { extra: "Unadmitted synthetic content" });
    expect(() =>
      applyModelCommand(proposed(), { ...proposal, observationIds: ids }, context("model")),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects symbolic and accessor array entries without invoking accessors", () => {
    let reads = 0;
    const risks: [] = [];
    Object.defineProperty(risks, "0", {
      get: () => {
        reads++;
        return "ambiguity";
      },
    });
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        { ...observation, projectionRisks: risks },
        context(),
      ),
    ).toThrow("INVALID_INPUT");
    expect(reads).toBe(0);
    const ids = Object.assign(["observation-a"], { [Symbol("extra")]: "Unadmitted" });
    expect(() =>
      applyModelCommand(proposed(), { ...proposal, observationIds: ids }, context("model")),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects a custom iterator that disguises missing source elements", () => {
    const ids = new Array<string>(1);
    ids[Symbol.iterator] = function* () {
      yield "not-present";
      return undefined;
    };
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        { ...proposal, observationIds: ids },
        { ...context("model"), grants: [] },
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects non-enumerable evidence indices that cloning would silently drop", () => {
    const ids: string[] = [];
    Object.defineProperty(ids, "0", { value: "observation-a", enumerable: false });
    expect(() =>
      applyModelCommand(
        proposed(),
        { ...proposal, requestId: "new-request", claimId: "new-claim", observationIds: ids },
        context("model"),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects non-enumerable command fields excluded from fingerprints", () => {
    const command = { ...observation };
    Object.defineProperty(command, "text", { value: "Hidden synthetic text", enumerable: false });
    expect(() => applyModelCommand(createModelLedger(scope), command, context())).toThrow(
      "INVALID_INPUT",
    );
  });

  it("rejects accessor fields before reading unstable command content", () => {
    let reads = 0;
    const command = { ...observation };
    Object.defineProperty(command, "kind", {
      enumerable: true,
      get: () => {
        reads++;
        return "observe";
      },
    });
    expect(() => applyModelCommand(createModelLedger(scope), command, context())).toThrow(
      "INVALID_INPUT",
    );
    expect(reads).toBe(0);
  });

  it("rejects undeclared payload fields nested in scope or consent reference", () => {
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        {
          ...observation,
          scope: { ...scope, additionalData: "Not an admitted field" },
        } as ModelCommand,
        context(),
      ),
    ).toThrow("INVALID_INPUT");
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        {
          ...observation,
          grant: { ...observation.grant, additionalData: "Not an admitted field" },
        } as ModelCommand,
        context(),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("deduplicates exact retries but rejects reuse with different content", () => {
    const state = proposed();
    const next = applyModelCommand(state, correction, context());
    expect(applyModelCommand(next, correction, context())).toBe(next);
    expect(() =>
      applyModelCommand(next, { ...correction, statement: "Different" }, context()),
    ).toThrow("REPLAY_CONFLICT");
    expect(applyModelCommand(state, proposal, context("model"))).toBe(state);
  });

  it("does not let idempotent replay bypass current revocation", () => {
    const state = applyModelCommand(proposed(), correction, context());
    const ctx = context();
    ctx.grants = [];
    expect(() => applyModelCommand(state, correction, ctx)).toThrow("EVIDENCE_UNAVAILABLE");
  });

  it("refuses stale corrections without changing the snapshot", () => {
    const state = applyModelCommand(proposed(), correction, context());
    expect(() =>
      applyModelCommand(
        state,
        { ...correction, id: "correction-b", requestId: "another" },
        context(),
      ),
    ).toThrow("STALE_REVISION");
    expect(state.claims).toHaveLength(2);
  });

  it.each(["ratify", "dispute"] as const)(
    "preserves uncertainty when the Human chooses %s",
    (action) => {
      const state = applyModelCommand(
        proposed(),
        { ...correction, action, statement: null, context: null },
        context(),
      );
      expect(projectCurrentModel(state, context())[0]).toMatchObject({
        status: action === "ratify" ? "active" : "contested",
        statement: proposal.statement,
        uncertainty: proposal.uncertainty,
      });
    },
  );

  it("copies and freezes inputs so later mutation cannot rewrite evidence", () => {
    const input = structuredClone(observation);
    const state = applyModelCommand(createModelLedger(scope), input, context());
    input.text = "Changed after submission";
    expect(state.observations[0].text).toBe(observation.text);
    expect(Object.isFrozen(state.observations[0])).toBe(true);
    expect(Object.isFrozen(state.observations[0].projectionRisks)).toBe(true);
  });

  it("rejects invalid time and future observations without consulting a clock", () => {
    expect(() =>
      applyModelCommand(createModelLedger(scope), observation, { ...context(), now: "invalid" }),
    ).toThrow("INVALID_INPUT");
    expect(() =>
      applyModelCommand(
        createModelLedger(scope),
        { ...observation, eventTime: "2030-01-01T00:00:00.000Z" },
        context(),
      ),
    ).toThrow("INVALID_INPUT");
  });
});
