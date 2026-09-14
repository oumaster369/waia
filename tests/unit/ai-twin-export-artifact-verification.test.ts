import { describe, expect, it } from "vitest";

import { qualifyExportArtifactRetention } from "@/lib/ai-twin/model/export-artifact-verification";
import { planPrivateExport } from "@/lib/ai-twin/model/persistence-contracts";
import {
  TWIN_RIGHTS_OPERATION_POLICY,
  type RightsOperationHistory,
} from "@/lib/ai-twin/model/rights-operation";
import { planLegacyModelQuarantine } from "@/lib/ai-twin/model/legacy-quarantine";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const createdAt = "2026-09-14T00:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const source = {
  organizationId: scope.organizationId,
  subjectId: scope.subjectId,
  kind: "observation" as const,
  id: "obs-1",
  version: 1,
};

function atHours(hours: number): string {
  return new Date(Date.parse(createdAt) + hours * 3_600_000).toISOString();
}

function manifest(eligible = [source]) {
  return planPrivateExport([source], {
    scope,
    actor: { kind: "human", subjectId: scope.subjectId },
    requestId: "export-a",
    createdAt,
    now: createdAt,
    approvedRecords: [source],
    eligibleRecords: eligible,
  });
}

const exportClosed: RightsOperationHistory = {
  operationId: "export-op-1",
  policyVersion: TWIN_RIGHTS_OPERATION_POLICY,
  scope,
  type: "EXPORT",
  target: { scopeKind: "purpose", digest: digest("a") },
  requestedAt: createdAt,
  requestedBy: { actorClass: "human", subjectId: scope.subjectId, actorReference: "human-ref-1" },
  acceptedBy: { actorClass: "human", subjectId: scope.subjectId, actorReference: "human-ref-1" },
  history: [
    { sequence: 1, state: "REQUESTED", at: createdAt, completionEvidenceDigest: null },
    {
      sequence: 2,
      state: "ACCEPTED",
      at: atHours(0.1),
      completionEvidenceDigest: digest("1"),
    },
    { sequence: 3, state: "CLOSED", at: atHours(0.2), completionEvidenceDigest: digest("2") },
  ],
  attempts: [],
  effect: {
    kind: "EXPORT_ARTIFACT_CREATED",
    committedAt: atHours(0.15),
    completionEvidenceDigest: digest("e"),
  },
};

function qualify(extra: Record<string, unknown> = {}, now = atHours(1)) {
  return qualifyExportArtifactRetention({
    manifest: manifest(),
    now,
    retryNow: null,
    exportOperation: null,
    artifactRemovalEvidence: null,
    admittedCompletionEvidenceDigests: [..."123e"].map(digest),
    ...extra,
  });
}

describe("export artifact retention verification — contract qualification only", () => {
  it("keeps the artifact valid before the original 24-hour deadline", () => {
    const result = qualify({}, atHours(23.99));
    expect(result.disposition).toBe("artifact_valid");
    expect(result.expiresAt).toBe(atHours(24));
    expect(result.originalCreatedAt).toBe(createdAt);
    expect(result.retryRefreshesLifetime).toBe(false);
    expect(result.sourceRecordsDeleted).toBe(false);
    expect(result.productionClaim).toBe("contract_qualification_only");
  });

  it("requires artifact removal at/after the original deadline without refreshing TTL on retry", () => {
    const composed = manifest();
    expect(qualify({ manifest: composed, retryNow: atHours(23) }, atHours(23)).disposition).toBe(
      "artifact_valid",
    );
    expect(qualify({ manifest: composed, retryNow: atHours(24) }, atHours(24)).disposition).toBe(
      "artifact_removal_required",
    );
    expect(composed.expiresAt).toBe(atHours(24));
  });

  it("does not treat EXPORT CLOSED or artifact-created effect as artifact removal", () => {
    const result = qualify({ exportOperation: exportClosed }, atHours(25));
    expect(result.disposition).toBe("artifact_removal_required");
    expect(result.exportOperationClosedIsNotArtifactRemoval).toBe(true);
    expect(() =>
      qualify({
        exportOperation: exportClosed,
        artifactRemovalEvidence: {
          digest: digest("e"),
          requestId: "export-a",
          scope,
          producerReference: "export-worker",
          admittedByReference: "human-ref-1",
        },
      }),
    ).toThrow("EXPORT_EFFECT_IS_NOT_ARTIFACT_REMOVAL");
    expect(() =>
      qualify({
        exportOperation: exportClosed,
        artifactRemovalEvidence: {
          digest: digest("2"),
          requestId: "export-a",
          scope,
          producerReference: "export-worker",
          admittedByReference: "human-ref-1",
        },
      }),
    ).toThrow("EXPORT_EFFECT_IS_NOT_ARTIFACT_REMOVAL");
  });

  it("verifies artifact removal only from trusted, request-bound admitted evidence", () => {
    const result = qualify({
      exportOperation: exportClosed,
      now: atHours(25),
      artifactRemovalEvidence: {
        digest: digest("3"),
        requestId: "export-a",
        scope,
        producerReference: "export-worker",
        admittedByReference: "human-ref-1",
      },
    });
    expect(result.disposition).toBe("artifact_removal_verified");
    expect(result.sourceRecordsDeleted).toBe(false);
  });

  it("excludes revoked or deleted sources on later composition without deleting sources", () => {
    const later = planPrivateExport([source], {
      scope,
      actor: { kind: "human", subjectId: scope.subjectId },
      requestId: "export-a",
      createdAt,
      now: atHours(1),
      approvedRecords: [source],
      eligibleRecords: [],
    });
    expect(later.records).toEqual([]);
    expect(later.excluded[0]?.reason).toBe("UNAVAILABLE_FOR_PRIVATE_EXPORT");
    expect(later.expiresAt).toBe(atHours(24));
    const artifact = qualify({ manifest: later }, atHours(1));
    expect(artifact.sourceRecordsDeleted).toBe(false);
    expect(artifact.disposition).toBe("artifact_valid");
  });
});

describe("legacy quarantine remains non-productive for WP-3", () => {
  it("does not import readiness or embeddings into the epistemic ledger", () => {
    const plan = planLegacyModelQuarantine(
      [
        { ...scope, kind: "readiness", id: "legacy-ready", revision: 1, createdAt: createdAt },
        { ...scope, kind: "embedding", id: "legacy-embed", revision: 1, createdAt: createdAt },
      ],
      scope,
      createdAt,
    );
    expect(plan.authority.import).toBe(false);
    expect(plan.authority.modelUse).toBe(false);
    expect(plan.authority.formationCredit).toBe(false);
    expect(plan.appliedToStorage).toBe(false);
    expect(plan.items.every((item) => item.disposition === "quarantined")).toBe(true);
  });
});
