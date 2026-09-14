import { describe, expect, it } from "vitest";

import { qualifyResidualCopyClosure } from "@/lib/ai-twin/model/residual-copy-verification";
import {
  TWIN_RIGHTS_OPERATION_POLICY,
  type RightsOperationHistory,
  type RightsOperationState,
} from "@/lib/ai-twin/model/rights-operation";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const requestedAt = "2026-09-01T00:00:00.000Z";
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
function plusDays(days: number): string {
  return new Date(Date.parse(requestedAt) + days * 86_400_000).toISOString();
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
function operation(
  states: RightsOperationState[] = ["REQUESTED"],
  changes: Partial<RightsOperationHistory> = {},
): RightsOperationHistory {
  return {
    operationId: "rights-operation-1",
    policyVersion: TWIN_RIGHTS_OPERATION_POLICY,
    scope,
    type: "DELETE",
    target: { scopeKind: "source", digest: digest("a") },
    requestedAt,
    requestedBy: {
      actorClass: "human",
      subjectId: scope.subjectId,
      actorReference: "human-ref-1",
    },
    acceptedBy: states.includes("ACCEPTED")
      ? { actorClass: "human", subjectId: scope.subjectId, actorReference: "human-ref-1" }
      : null,
    history: stateHistory(states),
    attempts: states.includes("LIVE_REMOVED")
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
    effect: null,
    ...changes,
  };
}
function snapshot(input: RightsOperationHistory): RightsOperationHistory {
  return {
    ...input,
    acceptedBy: null,
    history: [{ ...input.history[0] }],
    attempts: [],
    effect: null,
  };
}
const admitted = [..."123456789abef"].map(digest);
function qualify(
  history: RightsOperationHistory,
  extra: Record<string, unknown> = {},
  now = "2026-09-14T10:00:00.000Z",
) {
  return qualifyResidualCopyClosure({
    now,
    history,
    validation: {
      scope,
      now,
      previous: history.history.length === 1 ? null : snapshot(history),
      admittedCompletionEvidenceDigests: admitted,
    },
    copyInventory: [
      { copyClass: "live_store", storeReference: "primary-db" },
      { copyClass: "backup_copy", storeReference: "nightly-backup" },
    ],
    copyEvidence: [],
    admittedCompletionEvidenceDigests: admitted,
    inventoryComplete: true,
    residualCopyClasses: "present",
    ...extra,
  });
}

describe("residual-copy closure is contract qualification, not production deletion", () => {
  it("blocks productive use independently of physical cleanup", () => {
    const result = qualify(operation(["REQUESTED", "ACCEPTED", "USE_BLOCKED"]));
    expect(result.productiveUseBlocked).toBe(true);
    expect(result.closure).toBe("residual_copies_pending");
    expect(result.liveRemovedIsNotResidualProof).toBe(true);
    expect(result.productionClaim).toBe("contract_qualification_only");
    expect(result.authority).toBe("none");
    expect(result.inventoryCompleteness).toBe("trusted_adapter_declaration_only");
  });

  it("does not treat LIVE_REMOVED as residual-copy proof", () => {
    const result = qualify(operation(removalStates.slice(0, 5)));
    expect(result.recordedState).toBe("LIVE_REMOVED");
    expect(result.closure).toBe("residual_copies_pending");
    expect(result.obligations.find((row) => row.copyClass === "backup_copy")?.status).toBe("unmet");
  });

  it("fails closed when no trusted copy inventory exists", () => {
    const pending = qualify(operation(removalStates.slice(0, 6)), { copyInventory: null });
    expect(pending.closure).toBe("not_closable_inventory_required");
    expect(() => qualify(operation(removalStates), { copyInventory: null })).toThrow(
      "COPY_INVENTORY_REQUIRED",
    );
    expect(() => qualify(operation(removalStates), { copyInventory: [] })).toThrow(
      "COPY_INVENTORY_REQUIRED",
    );
  });

  it("does not close from a digest, flag, or process exit without copy-class evidence", () => {
    expect(() => qualify(operation(removalStates))).toThrow("RESIDUAL_COPIES_UNVERIFIED");
  });

  it("keeps the original request clock and 7/30 day targets across retry", () => {
    const history = operation(removalStates.slice(0, 6), {
      attempts: [
        {
          attemptId: "attempt-1",
          sequence: 1,
          startedAt: atMinute(3.05),
          completedAt: atMinute(3.08),
          outcome: "FAILED",
          outcomeCode: "BACKUP_UNREACHABLE",
          completionEvidenceDigest: null,
        },
        {
          attemptId: "attempt-2",
          sequence: 2,
          startedAt: atMinute(3.1),
          completedAt: atMinute(3.2),
          outcome: "SUCCEEDED",
          outcomeCode: "LIVE_CLEANUP_VERIFIED",
          completionEvidenceDigest: digest("b"),
        },
      ],
    });
    const result = qualify(history);
    expect(result.originalRequestedAt).toBe(requestedAt);
    expect(result.liveRemovalTargetAt).toBe(plusDays(7));
    expect(result.allCopiesRemovalTargetAt).toBe(plusDays(30));
    expect(result.closure).toBe("residual_copies_pending");
  });

  it("keeps failed cleanup fail-closed until residual evidence exists", () => {
    const history = operation(
      ["REQUESTED", "ACCEPTED", "USE_BLOCKED", "LIVE_REMOVAL_IN_PROGRESS"],
      {
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
        ],
      },
    );
    expect(qualify(history).closure).toBe("fail_closed_failed_cleanup");
    expect(qualify(history).productiveUseBlocked).toBe(true);
  });

  it("closes only when every inventory obligation has operation-bound admitted evidence", () => {
    const history = operation(removalStates, {
      attempts: [
        {
          attemptId: "attempt-1",
          sequence: 1,
          startedAt: atMinute(3.1),
          completedAt: atMinute(3.2),
          outcome: "SUCCEEDED",
          outcomeCode: "LIVE_CLEANUP_VERIFIED",
          completionEvidenceDigest: digest("b"),
        },
        {
          attemptId: "attempt-2",
          sequence: 2,
          startedAt: atMinute(5.1),
          completedAt: atMinute(5.2),
          outcome: "SUCCEEDED",
          outcomeCode: "BACKUP_PURGE_VERIFIED",
          completionEvidenceDigest: digest("e"),
        },
      ],
    });
    const result = qualify(history, {
      copyEvidence: [
        {
          digest: digest("b"),
          copyClass: "live_store",
          storeReference: "primary-db",
          operationId: history.operationId,
          scope,
          producerReference: "live-store-controller",
          admittedByReference: "human-ref-1",
        },
        {
          digest: digest("e"),
          copyClass: "backup_copy",
          storeReference: "nightly-backup",
          operationId: history.operationId,
          scope,
          producerReference: "backup-controller",
          admittedByReference: "human-ref-1",
        },
      ],
    });
    expect(result.closure).toBe("closable");
    expect(result.obligations.every((row) => row.status === "verified")).toBe(true);
  });

  it("rejects foreign-scope or other-operation evidence and LIVE_REMOVED digest reuse on backups", () => {
    const history = operation(removalStates);
    const liveRemoved = history.history.find((event) => event.state === "LIVE_REMOVED")!;
    expect(() =>
      qualify(history, {
        copyEvidence: [
          {
            digest: digest("b"),
            copyClass: "live_store",
            storeReference: "primary-db",
            operationId: history.operationId,
            scope,
            producerReference: "live-store-controller",
            admittedByReference: "human-ref-1",
          },
          {
            digest: liveRemoved.completionEvidenceDigest,
            copyClass: "backup_copy",
            storeReference: "nightly-backup",
            operationId: history.operationId,
            scope,
            producerReference: "backup-controller",
            admittedByReference: "human-ref-1",
          },
        ],
      }),
    ).toThrow("RESIDUAL_COPIES_UNVERIFIED");
    expect(() =>
      qualify(history, {
        copyEvidence: [
          {
            digest: digest("b"),
            copyClass: "live_store",
            storeReference: "primary-db",
            operationId: "other-operation",
            scope,
            producerReference: "live-store-controller",
            admittedByReference: "human-ref-1",
          },
        ],
      }),
    ).toThrow("OPERATION_MISMATCH");
  });

  it("rejects remapping CLOSED or live-cleanup lifecycle digests onto residual copies", () => {
    const history = operation(removalStates);
    const closed = history.history.find((event) => event.state === "CLOSED")!;
    expect(() =>
      qualify(history, {
        copyEvidence: [
          {
            digest: digest("b"),
            copyClass: "live_store",
            storeReference: "primary-db",
            operationId: history.operationId,
            scope,
            producerReference: "live-store-controller",
            admittedByReference: "human-ref-1",
          },
          {
            digest: closed.completionEvidenceDigest,
            copyClass: "backup_copy",
            storeReference: "nightly-backup",
            operationId: history.operationId,
            scope,
            producerReference: "backup-controller",
            admittedByReference: "human-ref-1",
          },
        ],
      }),
    ).toThrow("RESIDUAL_COPIES_UNVERIFIED");
    expect(() =>
      qualify(history, {
        copyEvidence: [
          {
            digest: digest("b"),
            copyClass: "live_store",
            storeReference: "primary-db",
            operationId: history.operationId,
            scope,
            producerReference: "live-store-controller",
            admittedByReference: "human-ref-1",
          },
          {
            digest: digest("b"),
            copyClass: "backup_copy",
            storeReference: "nightly-backup",
            operationId: history.operationId,
            scope,
            producerReference: "backup-controller",
            admittedByReference: "human-ref-1",
          },
        ],
      }),
    ).toThrow("DUPLICATE_EVIDENCE_REFERENCE");
    expect(() =>
      qualify(history, {
        copyEvidence: [
          {
            digest: digest("b"),
            copyClass: "backup_copy",
            storeReference: "nightly-backup",
            operationId: history.operationId,
            scope,
            producerReference: "backup-controller",
            admittedByReference: "human-ref-1",
          },
        ],
      }),
    ).toThrow("RESIDUAL_COPIES_UNVERIFIED");
  });

  it("does not treat a live-only inventory as complete without an explicit absence declaration", () => {
    const history = operation(removalStates);
    const liveOnly = {
      copyInventory: [{ copyClass: "live_store", storeReference: "primary-db" }],
      copyEvidence: [
        {
          digest: digest("b"),
          copyClass: "live_store",
          storeReference: "primary-db",
          operationId: history.operationId,
          scope,
          producerReference: "live-store-controller",
          admittedByReference: "human-ref-1",
        },
      ],
    };
    expect(() => qualify(history, liveOnly)).toThrow("INVENTORY_RESIDUAL_CLASSES_UNDECLARED");
    expect(() => qualify(history, { ...liveOnly, inventoryComplete: false })).toThrow(
      "INVENTORY_INCOMPLETE",
    );
    expect(() =>
      qualify(history, { residualCopyClasses: "declared_absent_for_this_deployment" }),
    ).toThrow("INVENTORY_DECLARATION_CONTRADICTION");
    const declaredAbsent = qualify(history, {
      ...liveOnly,
      residualCopyClasses: "declared_absent_for_this_deployment",
    });
    expect(declaredAbsent.closure).toBe("closable");
    expect(declaredAbsent.inventoryCompleteness).toBe("trusted_adapter_declaration_only");
  });

  it("marks unmet residual copies overdue after the original 30-day target", () => {
    const result = qualify(operation(removalStates.slice(0, 6)), {}, plusDays(30));
    expect(result.obligations.find((row) => row.copyClass === "backup_copy")?.status).toBe(
      "overdue_unverified",
    );
    expect(result.closure).toBe("residual_copies_pending");
  });
});
