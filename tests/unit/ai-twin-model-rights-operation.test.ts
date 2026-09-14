import { describe, expect, it } from "vitest";

import {
  TWIN_RIGHTS_OPERATION_POLICY,
  validateRightsOperationHistory,
  type RightsOperationEffect,
  type RightsOperationHistory,
  type RightsOperationState,
  type RightsOperationType,
} from "@/lib/ai-twin/model/rights-operation";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const requestedAt = "2026-09-01T00:00:00.000Z";
const now = "2026-09-14T10:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const removalStates: RightsOperationState[] = [
  "REQUESTED",
  "ACCEPTED",
  "USE_BLOCKED",
  "LIVE_REMOVAL_IN_PROGRESS",
  "LIVE_REMOVED",
  "RESIDUAL_COPIES_PENDING",
  "CLOSED",
];

function atMinute(minute: number): string {
  return new Date(Date.parse(requestedAt) + minute * 60_000).toISOString();
}

function stateHistory(states: RightsOperationState[]) {
  return states.map((state, index) => ({
    sequence: index + 1,
    state,
    at: index === 0 ? requestedAt : atMinute(index),
    completionEvidenceDigest: [
      "ACCEPTED",
      "USE_BLOCKED",
      "LIVE_REMOVED",
      "CLOSED",
      "REFUSED",
      "CANCELLED",
    ].includes(state)
      ? digest(String((index % 9) + 1))
      : null,
  }));
}

const effects: Record<
  Exclude<RightsOperationType, "WITHDRAW_USE" | "DELETE" | "ERASE">,
  RightsOperationEffect["kind"]
> = {
  EXPORT: "EXPORT_ARTIFACT_CREATED",
  CORRECT: "CORRECTIVE_REVISION_COMMITTED",
  RETAIN: "RETENTION_DECISION_COMMITTED",
  ARCHIVE: "ARCHIVE_EFFECT_COMMITTED",
};

function operation(
  type: RightsOperationType = "DELETE",
  states: RightsOperationState[] = ["REQUESTED"],
  changes: Partial<RightsOperationHistory> = {},
): RightsOperationHistory {
  const hasLiveRemoved = states.includes("LIVE_REMOVED");
  const nonRemoval = type in effects;
  const effect =
    nonRemoval && states.includes("CLOSED")
      ? {
          kind: effects[type as keyof typeof effects],
          committedAt: atMinute(1.5),
          completionEvidenceDigest: digest("e"),
        }
      : null;
  return {
    operationId: "rights-operation-1",
    policyVersion: TWIN_RIGHTS_OPERATION_POLICY,
    scope,
    type,
    target: { scopeKind: "source", digest: digest("a") },
    requestedAt,
    requestedBy: {
      actorClass: "human",
      subjectId: scope.subjectId,
      actorReference: "human-ref-1",
    },
    acceptedBy: states.includes("ACCEPTED")
      ? {
          actorClass: "human",
          subjectId: scope.subjectId,
          actorReference: "human-ref-1",
        }
      : null,
    history: stateHistory(states),
    attempts: hasLiveRemoved
      ? [
          {
            attemptId: "attempt-1",
            sequence: 1,
            startedAt: atMinute(3.1),
            completedAt: atMinute(3.2),
            outcome: "SUCCEEDED",
            outcomeCode: "LIVE_CLEANUP_VERIFIED",
            completionEvidenceDigest: digest("b"),
          },
        ]
      : [],
    effect,
    ...changes,
  };
}

const admittedCompletionEvidenceDigests = [..."123456789abef"].map(digest);

function initialSnapshot(input: RightsOperationHistory): RightsOperationHistory {
  return {
    ...input,
    acceptedBy: null,
    history: [{ ...input.history[0] }],
    attempts: [],
    effect: null,
  };
}

function validationContext(
  previous: RightsOperationHistory | null,
  trustedScope = scope,
  trustedNow = now,
) {
  return {
    scope: trustedScope,
    now: trustedNow,
    previous,
    admittedCompletionEvidenceDigests,
  };
}

function validate(
  input: RightsOperationHistory,
  previous: RightsOperationHistory | null = input.history.length === 1
    ? null
    : initialSnapshot(input),
) {
  return validateRightsOperationHistory(input, validationContext(previous));
}

describe("RightsOperation history is evidence, not execution authority", () => {
  it.each(["DELETE", "ERASE"] as const)("accepts every ordered %s removal prefix", (type) => {
    for (let length = 1; length <= removalStates.length; length++) {
      const states = removalStates.slice(0, length);
      const result = validate(operation(type, states));
      expect(result.recordedState).toBe(states.at(-1));
      expect(result.productiveUseBlockRecorded).toBe(states.includes("USE_BLOCKED"));
      expect(result.authority).toBe("none");
    }
  });

  it("records WITHDRAW_USE closure from admitted use-block evidence without claiming removal", () => {
    const result = validate(
      operation("WITHDRAW_USE", ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"]),
    );
    expect(result.recordedState).toBe("CLOSED");
    expect(result.productiveUseBlockRecorded).toBe(true);
    expect(result.operation.history.map((event) => event.state)).not.toContain("LIVE_REMOVED");
    expect(result).not.toHaveProperty("physicalDeletionVerified");
  });

  it.each(["EXPORT", "CORRECT", "RETAIN", "ARCHIVE"] as const)(
    "records %s closure only with an admitted type-specific effect reference",
    (type) => {
      const result = validate(operation(type, ["REQUESTED", "ACCEPTED", "CLOSED"]));
      expect(result.recordedState).toBe("CLOSED");
      expect(result.operation.effect?.kind).toBe(effects[type]);
      expect(result.productiveUseBlockRecorded).toBe(false);
      expect(result.operation.history.map((event) => event.state)).not.toContain("LIVE_REMOVED");
    },
  );

  it.each(["WITHDRAW_USE", "DELETE", "ERASE"] as const)(
    "allows %s cancellation only before acceptance",
    (type) => {
      expect(validate(operation(type, ["REQUESTED", "CANCELLED"])).recordedState).toBe("CANCELLED");
      expect(() => validate(operation(type, ["REQUESTED", "ACCEPTED", "CANCELLED"]))).toThrow(
        "INVALID_STATE_PATH",
      );
    },
  );

  it.each(["EXPORT", "CORRECT", "RETAIN", "ARCHIVE"] as const)(
    "allows %s cancellation after acceptance only before effect commitment",
    (type) => {
      expect(validate(operation(type, ["REQUESTED", "ACCEPTED", "CANCELLED"])).recordedState).toBe(
        "CANCELLED",
      );
      expect(() =>
        validate(
          operation(type, ["REQUESTED", "ACCEPTED", "CANCELLED"], {
            effect: {
              kind: effects[type],
              committedAt: atMinute(1.5),
              completionEvidenceDigest: digest("e"),
            },
          }),
        ),
      ).toThrow("EFFECT_ALREADY_COMMITTED");
    },
  );

  it("allows refusal before acceptance and never treats attempt failure as operation closure", () => {
    expect(validate(operation("DELETE", ["REQUESTED", "REFUSED"])).recordedState).toBe("REFUSED");
    expect(() => validate(operation("DELETE", ["REQUESTED", "ACCEPTED", "REFUSED"]))).toThrow(
      "INVALID_STATE_PATH",
    );
  });

  it("preserves failed attempts across retry under one immutable operation clock", () => {
    const input = operation("DELETE", removalStates, {
      attempts: [
        {
          attemptId: "attempt-1",
          sequence: 1,
          startedAt: atMinute(3.1),
          completedAt: atMinute(3.2),
          outcome: "FAILED",
          outcomeCode: "PROCESSOR_TIMEOUT",
          completionEvidenceDigest: null,
        },
        {
          attemptId: "attempt-2",
          sequence: 2,
          startedAt: atMinute(3.3),
          completedAt: atMinute(3.4),
          outcome: "SUCCEEDED",
          outcomeCode: "LIVE_CLEANUP_VERIFIED",
          completionEvidenceDigest: digest("b"),
        },
      ],
    });
    const previous = operation("DELETE", removalStates.slice(0, 4), {
      attempts: [input.attempts[0]],
    });
    const result = validate(input, previous);
    expect(result.operation.requestedAt).toBe(requestedAt);
    expect(result.operation.attempts.map((attempt) => attempt.outcome)).toEqual([
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(result.productiveUseBlockRecorded).toBe(true);
  });

  it("rejects rewritten request clocks and malformed attempt retry history", () => {
    const input = operation("DELETE", removalStates);
    input.history[0] = { ...input.history[0], at: atMinute(1) };
    expect(() => validate(input)).toThrow("REQUEST_CLOCK_MISMATCH");
    for (const attempts of [
      [
        {
          ...operation("DELETE", removalStates).attempts[0],
          sequence: 2,
        },
      ],
      [
        operation("DELETE", removalStates).attempts[0],
        operation("DELETE", removalStates).attempts[0],
      ],
      [
        {
          ...operation("DELETE", removalStates).attempts[0],
          outcome: "FAILED" as const,
          completionEvidenceDigest: digest("b"),
        },
      ],
    ])
      expect(() => validate(operation("DELETE", removalStates, { attempts }))).toThrow();
  });

  it("requires successful attempt and admitted evidence references before recorded closure", () => {
    expect(() =>
      validate(operation("DELETE", removalStates.slice(0, 5), { attempts: [] })),
    ).toThrow("COMPLETION_EVIDENCE_REQUIRED");
    const missingLiveEvidence = operation("DELETE", removalStates.slice(0, 5));
    missingLiveEvidence.history[4] = {
      ...missingLiveEvidence.history[4],
      completionEvidenceDigest: null,
    };
    expect(() => validate(missingLiveEvidence)).toThrow("COMPLETION_EVIDENCE_REQUIRED");
    const missingCloseEvidence = operation("WITHDRAW_USE", [
      "REQUESTED",
      "ACCEPTED",
      "USE_BLOCKED",
      "CLOSED",
    ]);
    missingCloseEvidence.history[3] = {
      ...missingCloseEvidence.history[3],
      completionEvidenceDigest: null,
    };
    expect(() => validate(missingCloseEvidence)).toThrow("COMPLETION_EVIDENCE_REQUIRED");
  });

  it.each(["EXPORT", "CORRECT", "RETAIN", "ARCHIVE"] as const)(
    "rejects removal-only states and missing %s effect",
    (type) => {
      expect(() => validate(operation(type, ["REQUESTED", "ACCEPTED", "USE_BLOCKED"]))).toThrow(
        "INVALID_STATE_PATH",
      );
      expect(() =>
        validate(operation(type, ["REQUESTED", "ACCEPTED", "CLOSED"], { effect: null })),
      ).toThrow("COMPLETION_EVIDENCE_REQUIRED");
    },
  );

  it("rejects wrong type-specific effects and effects on removal operations", () => {
    expect(() =>
      validate(
        operation("EXPORT", ["REQUESTED", "ACCEPTED", "CLOSED"], {
          effect: {
            kind: "ARCHIVE_EFFECT_COMMITTED",
            committedAt: atMinute(1.5),
            completionEvidenceDigest: digest("e"),
          },
        }),
      ),
    ).toThrow("EFFECT_MISMATCH");
    expect(() =>
      validate(
        operation("DELETE", ["REQUESTED"], {
          effect: {
            kind: "EXPORT_ARTIFACT_CREATED",
            committedAt: atMinute(1),
            completionEvidenceDigest: digest("e"),
          },
        }),
      ),
    ).toThrow("EFFECT_MISMATCH");
  });

  it("computes unresolved and twelve-calendar-month terminal receipt policy", () => {
    const unresolved = validate(operation());
    expect(unresolved.receiptRetention).toMatchObject({
      mode: "while_unresolved",
      terminalAt: null,
      retainUntil: null,
      containsPersonalContent: false,
      subjectDeletionOverride:
        "remove_after_verified_full_cleanup_without_separate_human_approved_basis",
    });
    const closed = validate(
      operation("WITHDRAW_USE", ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"]),
    );
    expect(closed.receiptRetention).toMatchObject({
      mode: "terminal_12_months",
      terminalAt: atMinute(3),
      retainUntil: "2027-09-01T00:03:00.000Z",
    });
  });

  it("uses a calendar-year boundary for a leap-day terminal receipt", () => {
    const terminalAt = "2028-02-29T12:00:00.000Z";
    const input = operation("DELETE", ["REQUESTED", "REFUSED"], {
      requestedAt: "2028-02-29T11:59:00.000Z",
      history: [
        {
          sequence: 1,
          state: "REQUESTED",
          at: "2028-02-29T11:59:00.000Z",
          completionEvidenceDigest: null,
        },
        {
          sequence: 2,
          state: "REFUSED",
          at: terminalAt,
          completionEvidenceDigest: digest("f"),
        },
      ],
    });
    expect(
      validateRightsOperationHistory(
        input,
        validationContext(initialSnapshot(input), scope, "2028-03-01T00:00:00.000Z"),
      ).receiptRetention.retainUntil,
    ).toBe("2029-02-28T12:00:00.000Z");
  });

  it.each(["organizationId", "subjectId"] as const)(
    "binds both tenant dimensions and Human actor subject on %s",
    (field) => {
      const foreignScope = { ...scope, [field]: "foreign" };
      expect(() =>
        validateRightsOperationHistory(
          operation("DELETE", ["REQUESTED"], { scope: foreignScope }),
          validationContext(null),
        ),
      ).toThrow("SCOPE_MISMATCH");
      expect(() =>
        validateRightsOperationHistory(operation(), validationContext(null, foreignScope)),
      ).toThrow("SCOPE_MISMATCH");
      const input = operation();
      input.requestedBy = { ...input.requestedBy, subjectId: "foreign" };
      expect(() => validate(input)).toThrow("SCOPE_MISMATCH");
    },
  );

  it("rejects copied personal payloads and non-digest completion claims", () => {
    for (const extra of [
      { sourceText: "private dialogue" },
      { claimText: "private claim" },
      { embedding: [0.1, 0.2] },
      { payload: { private: true } },
      { consentRenewed: true },
      { formationChanged: true },
    ])
      expect(() => validate({ ...operation(), ...extra } as RightsOperationHistory)).toThrow(
        "INVALID_INPUT",
      );
    expect(() =>
      validate(
        operation("WITHDRAW_USE", ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"], {
          history: stateHistory(["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"]).map((event) =>
            event.state === "CLOSED"
              ? { ...event, completionEvidenceDigest: "process exited 0" }
              : event,
          ),
        }),
      ),
    ).toThrow("INVALID_DIGEST");
  });

  it("rejects effects and attempts recorded after terminal disposition", () => {
    expect(() =>
      validate(
        operation("EXPORT", ["REQUESTED", "ACCEPTED", "CLOSED"], {
          effect: {
            kind: "EXPORT_ARTIFACT_CREATED",
            committedAt: atMinute(3),
            completionEvidenceDigest: digest("e"),
          },
        }),
      ),
    ).toThrow("INVALID_EFFECT_TIME");

    const cancelled = operation("EXPORT", ["REQUESTED", "ACCEPTED", "CANCELLED"], {
      attempts: [
        {
          attemptId: "attempt-after-cancel",
          sequence: 1,
          startedAt: atMinute(3),
          completedAt: atMinute(4),
          outcome: "FAILED",
          outcomeCode: "TOO_LATE",
          completionEvidenceDigest: null,
        },
      ],
    });
    expect(() => validate(cancelled)).toThrow("INVALID_ATTEMPT_TIME");
  });

  it("requires trusted prior history and rejects header or append-only rewrites", () => {
    const completed = operation("DELETE", removalStates);
    expect(() => validateRightsOperationHistory(completed, validationContext(null))).toThrow(
      "PREVIOUS_HISTORY_REQUIRED",
    );

    const failedAttempt = {
      attemptId: "attempt-1",
      sequence: 1,
      startedAt: atMinute(3.1),
      completedAt: atMinute(3.2),
      outcome: "FAILED" as const,
      outcomeCode: "PROCESSOR_TIMEOUT",
      completionEvidenceDigest: null,
    };
    const previous = operation("DELETE", removalStates.slice(0, 4), {
      attempts: [failedAttempt],
    });
    const reorderedPrevious: RightsOperationHistory = {
      type: previous.type,
      scope: previous.scope,
      policyVersion: previous.policyVersion,
      operationId: previous.operationId,
      target: {
        digest: previous.target.digest,
        scopeKind: previous.target.scopeKind,
      },
      requestedBy: {
        actorReference: previous.requestedBy.actorReference,
        actorClass: previous.requestedBy.actorClass,
        subjectId: previous.requestedBy.subjectId,
      },
      requestedAt: previous.requestedAt,
      history: previous.history.map((event) => ({
        completionEvidenceDigest: event.completionEvidenceDigest,
        at: event.at,
        state: event.state,
        sequence: event.sequence,
      })),
      acceptedBy: previous.acceptedBy
        ? {
            actorReference: previous.acceptedBy.actorReference,
            actorClass: previous.acceptedBy.actorClass,
            subjectId: previous.acceptedBy.subjectId,
          }
        : null,
      effect: previous.effect,
      attempts: previous.attempts.map((attempt) => ({
        outcomeCode: attempt.outcomeCode,
        outcome: attempt.outcome,
        completedAt: attempt.completedAt,
        startedAt: attempt.startedAt,
        sequence: attempt.sequence,
        attemptId: attempt.attemptId,
        completionEvidenceDigest: attempt.completionEvidenceDigest,
      })),
    };
    const retry = operation("DELETE", removalStates, {
      attempts: [
        failedAttempt,
        {
          ...completed.attempts[0],
          attemptId: "attempt-2",
          sequence: 2,
          startedAt: atMinute(3.3),
          completedAt: atMinute(3.4),
        },
      ],
    });
    expect(validate(retry, previous).operation.attempts).toHaveLength(2);
    expect(validate(retry, reorderedPrevious).operation.attempts).toHaveLength(2);

    expect(() => validate({ ...retry, operationId: "rewritten-operation" }, previous)).toThrow(
      "IMMUTABLE_HEADER_MISMATCH",
    );
    expect(() =>
      validate(
        {
          ...retry,
          attempts: [{ ...failedAttempt, outcomeCode: "REWRITTEN_FAILURE" }, retry.attempts[1]],
        },
        previous,
      ),
    ).toThrow("ATTEMPT_REWRITTEN");
    const rewrittenHistory = retry.history.map((event, index) =>
      index === 1 ? { ...event, completionEvidenceDigest: digest("9") } : event,
    );
    expect(() => validate({ ...retry, history: rewrittenHistory }, previous)).toThrow(
      "HISTORY_REWRITTEN",
    );
  });

  it("admits digest references from trusted context without claiming evidence proof", () => {
    const input = operation("WITHDRAW_USE", ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "CLOSED"]);
    const previous = initialSnapshot(input);
    const contextWithoutCloseEvidence = {
      ...validationContext(previous),
      admittedCompletionEvidenceDigests: admittedCompletionEvidenceDigests.filter(
        (value) => value !== input.history.at(-1)!.completionEvidenceDigest,
      ),
    };
    expect(() => validateRightsOperationHistory(input, contextWithoutCloseEvidence)).toThrow(
      "EVIDENCE_NOT_ADMITTED",
    );

    const result = validate(input, previous);
    expect(result).toMatchObject({
      recordedState: "CLOSED",
      productiveUseBlockRecorded: true,
      evidenceQualification: "trusted_context_reference_match_only",
      authority: "none",
    });
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("independentEvidence");
  });

  it("rejects getters, hidden fields, cycles and sparse histories before reading them", () => {
    let read = false;
    const getter = operation();
    Object.defineProperty(getter, "type", {
      enumerable: true,
      get() {
        read = true;
        return "EXPORT";
      },
    });
    expect(() => validateRightsOperationHistory(getter, validationContext(null))).toThrow(
      "INVALID_INPUT",
    );
    expect(read).toBe(false);

    const hidden = operation();
    Object.defineProperty(hidden, "content", { enumerable: false, value: "private" });
    expect(() => validateRightsOperationHistory(hidden, validationContext(null))).toThrow(
      "INVALID_INPUT",
    );

    const cyclic = operation() as RightsOperationHistory & { cycle?: unknown };
    cyclic.cycle = cyclic;
    expect(() => validateRightsOperationHistory(cyclic, validationContext(null))).toThrow(
      "INVALID_INPUT",
    );
    expect(() =>
      validateRightsOperationHistory(
        operation("DELETE", ["REQUESTED"], {
          history: new Array(1),
        }),
        validationContext(null),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("returns an independent deeply frozen history with no operational authority", () => {
    const input = operation("DELETE", removalStates);
    const result = validate(input);
    input.operationId = "changed";
    input.history[0].at = now;
    input.attempts[0].outcomeCode = "changed";
    expect(result.operation.operationId).toBe("rights-operation-1");
    expect(result.operation.history[0].at).toBe(requestedAt);
    expect(result.operation.attempts[0].outcomeCode).toBe("LIVE_CLEANUP_VERIFIED");
    expect(Object.isFrozen(result.operation.history[0])).toBe(true);
    expect(Object.isFrozen(result.operation.attempts[0])).toBe(true);
    expect(result.authority).toBe("none");
    expect(result.evidenceQualification).toBe("trusted_context_reference_match_only");
    expect(result).not.toHaveProperty("consentGranted");
    expect(result).not.toHaveProperty("disclosureGranted");
    expect(result).not.toHaveProperty("archiveGranted");
    expect(result).not.toHaveProperty("executed");
  });
});
