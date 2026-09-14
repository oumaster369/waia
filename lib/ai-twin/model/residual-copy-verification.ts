import type { ModelScope } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";
import {
  TWIN_RIGHTS_OPERATION_POLICY,
  validateRightsOperationHistory,
  type RightsOperationHistory,
  type RightsOperationValidationContext,
} from "./rights-operation";

/** Contract qualification only. Not production residual-copy evidence, legal
 * compliance, or a deployment copy registry. */
export const TWIN_RESIDUAL_COPY_VERIFICATION = "contract-qualification-2026-09-14/v1" as const;

export type DeploymentCopyClass = "live_store" | "live_index" | "processor_copy" | "backup_copy";

export type TrustedCopyInventoryRow = Readonly<{
  copyClass: DeploymentCopyClass;
  storeReference: string;
}>;

export type TrustedCopyEvidenceBinding = Readonly<{
  digest: string;
  copyClass: DeploymentCopyClass;
  storeReference: string;
  operationId: string;
  scope: ModelScope;
  producerReference: string;
  admittedByReference: string;
}>;

export type ResidualCopyClassesDeclaration = "present" | "declared_absent_for_this_deployment";

export type ResidualCopyObligationStatus = "unmet" | "verified" | "overdue_unverified";

export type ResidualCopyClosure = Readonly<{
  policyVersion: typeof TWIN_RESIDUAL_COPY_VERIFICATION;
  recordedState: RightsOperationHistory["history"][number]["state"];
  productiveUseBlocked: boolean;
  liveRemovedIsNotResidualProof: true;
  originalRequestedAt: string;
  liveRemovalTargetAt: string;
  allCopiesRemovalTargetAt: string;
  closure:
    | "not_closable_inventory_required"
    | "residual_copies_pending"
    | "fail_closed_failed_cleanup"
    | "closable";
  obligations: readonly Readonly<{
    copyClass: DeploymentCopyClass;
    storeReference: string;
    deadlineAt: string;
    status: ResidualCopyObligationStatus;
  }>[];
  evidenceQualification: "trusted_inventory_and_operation_bound_digest_only";
  inventoryCompleteness: "trusted_adapter_declaration_only";
  authority: "none";
  productionClaim: "contract_qualification_only";
}>;

const DAY = 86_400_000;
const LIVE_DAYS = 7;
const ALL_COPIES_DAYS = 30;
const liveClasses = new Set<DeploymentCopyClass>(["live_store", "live_index"]);
const residualClasses = new Set<DeploymentCopyClass>(["processor_copy", "backup_copy"]);
const copyClasses = new Set<DeploymentCopyClass>([
  "live_store",
  "live_index",
  "processor_copy",
  "backup_copy",
]);
const outcomeByCopyClass: Record<DeploymentCopyClass, string> = {
  live_store: "LIVE_CLEANUP_VERIFIED",
  live_index: "LIVE_CLEANUP_VERIFIED",
  processor_copy: "PROCESSOR_PURGE_VERIFIED",
  backup_copy: "BACKUP_PURGE_VERIFIED",
};
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(code = "INVALID_INPUT"): never {
  throw new Error(code);
}
function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) fail(code);
}
function keys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}
function instant(value: unknown): number {
  requireValue(typeof value === "string");
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, "INVALID_TIME");
  return parsed;
}
function plusDays(iso: string, days: number): string {
  return new Date(instant(iso) + days * DAY).toISOString();
}
function freeze<T>(value: T): T {
  const clone = structuredClone(value);
  const walk = (part: unknown): void => {
    if (part && typeof part === "object") {
      Object.values(part).forEach(walk);
      Object.freeze(part);
    }
  };
  walk(clone);
  return clone;
}
function sameScope(left: ModelScope, right: ModelScope): boolean {
  return left.organizationId === right.organizationId && left.subjectId === right.subjectId;
}
function parseInventory(input: unknown): TrustedCopyInventoryRow[] {
  requireValue(Array.isArray(input), "COPY_INVENTORY_REQUIRED");
  requireValue(input.length > 0, "COPY_INVENTORY_REQUIRED");
  const rows: TrustedCopyInventoryRow[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    keys(raw, ["copyClass", "storeReference"]);
    requireValue(
      typeof raw.copyClass === "string" && copyClasses.has(raw.copyClass as DeploymentCopyClass),
    );
    requireValue(typeof raw.storeReference === "string" && identifier.test(raw.storeReference));
    const key = `${raw.copyClass}:${raw.storeReference}`;
    requireValue(!seen.has(key), "DUPLICATE_COPY_OBLIGATION");
    seen.add(key);
    rows.push({
      copyClass: raw.copyClass as DeploymentCopyClass,
      storeReference: raw.storeReference,
    });
  }
  return rows;
}
function parseEvidence(
  input: unknown,
  scope: ModelScope,
  operationId: string,
): TrustedCopyEvidenceBinding[] {
  requireValue(Array.isArray(input));
  const rows: TrustedCopyEvidenceBinding[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    keys(raw, [
      "digest",
      "copyClass",
      "storeReference",
      "operationId",
      "scope",
      "producerReference",
      "admittedByReference",
    ]);
    requireValue(
      typeof raw.digest === "string" && digestPattern.test(raw.digest),
      "INVALID_DIGEST",
    );
    requireValue(
      typeof raw.copyClass === "string" && copyClasses.has(raw.copyClass as DeploymentCopyClass),
    );
    requireValue(typeof raw.storeReference === "string" && identifier.test(raw.storeReference));
    requireValue(raw.operationId === operationId, "OPERATION_MISMATCH");
    keys(raw.scope, ["organizationId", "subjectId"]);
    requireValue(sameScope(raw.scope as ModelScope, scope), "SCOPE_MISMATCH");
    requireValue(
      typeof raw.producerReference === "string" && identifier.test(raw.producerReference),
    );
    requireValue(
      typeof raw.admittedByReference === "string" && identifier.test(raw.admittedByReference),
    );
    requireValue(!seen.has(raw.digest), "DUPLICATE_EVIDENCE_REFERENCE");
    seen.add(raw.digest);
    const copyKey = `${raw.copyClass}:${raw.storeReference}`;
    requireValue(!seen.has(copyKey), "DUPLICATE_COPY_OBLIGATION");
    seen.add(copyKey);
    rows.push({
      digest: raw.digest,
      copyClass: raw.copyClass as DeploymentCopyClass,
      storeReference: raw.storeReference,
      operationId,
      scope,
      producerReference: raw.producerReference,
      admittedByReference: raw.admittedByReference,
    });
  }
  return rows;
}

/**
 * Qualifies whether a DELETE/ERASE history may close against a trusted
 * deployment-copy inventory. LIVE_REMOVED, a CLOSED flag, a digest, or a
 * successful process exit never prove residual copies are gone. Missing
 * inventory fails closed instead of inventing a universal store list.
 */
export function qualifyResidualCopyClosure(input: unknown): ResidualCopyClosure {
  assertModelJsonData(input);
  keys(input, [
    "now",
    "history",
    "validation",
    "copyInventory",
    "copyEvidence",
    "admittedCompletionEvidenceDigests",
    "inventoryComplete",
    "residualCopyClasses",
  ]);
  const now = instant(input.now);
  keys(input.validation, ["scope", "now", "previous", "admittedCompletionEvidenceDigests"]);
  const historyValidation = validateRightsOperationHistory(
    input.history,
    input.validation as RightsOperationValidationContext,
  );
  requireValue(historyValidation.operation.policyVersion === TWIN_RIGHTS_OPERATION_POLICY);
  requireValue(
    historyValidation.operation.type === "DELETE" || historyValidation.operation.type === "ERASE",
    "REMOVAL_OPERATION_REQUIRED",
  );
  const operation = historyValidation.operation;
  const requestedAt = operation.requestedAt;
  requireValue(instant(requestedAt) === instant(operation.history[0].at), "REQUEST_CLOCK_MISMATCH");
  requireValue(now >= instant(requestedAt), "INVALID_TIME");

  const liveRemovalTargetAt = plusDays(requestedAt, LIVE_DAYS);
  const allCopiesRemovalTargetAt = plusDays(requestedAt, ALL_COPIES_DAYS);
  const recordedState = historyValidation.recordedState;
  const productiveUseBlocked = historyValidation.productiveUseBlockRecorded;
  const failedWithoutSuccess =
    operation.attempts.some((attempt) => attempt.outcome === "FAILED") &&
    !operation.attempts.some((attempt) => attempt.outcome === "SUCCEEDED");

  const base: Omit<ResidualCopyClosure, "closure" | "obligations"> = {
    policyVersion: TWIN_RESIDUAL_COPY_VERIFICATION,
    recordedState,
    productiveUseBlocked,
    liveRemovedIsNotResidualProof: true,
    originalRequestedAt: requestedAt,
    liveRemovalTargetAt,
    allCopiesRemovalTargetAt,
    evidenceQualification: "trusted_inventory_and_operation_bound_digest_only",
    inventoryCompleteness: "trusted_adapter_declaration_only",
    authority: "none",
    productionClaim: "contract_qualification_only",
  };

  if (input.copyInventory === null) {
    requireValue(recordedState !== "CLOSED", "COPY_INVENTORY_REQUIRED");
    return freeze({
      ...base,
      closure: "not_closable_inventory_required",
      obligations: [],
    });
  }

  requireValue(input.inventoryComplete === true, "INVENTORY_INCOMPLETE");
  requireValue(
    input.residualCopyClasses === "present" ||
      input.residualCopyClasses === "declared_absent_for_this_deployment",
    "INVENTORY_DECLARATION_INVALID",
  );
  const inventory = parseInventory(input.copyInventory);
  const residualPresent = inventory.some((row) => residualClasses.has(row.copyClass));
  if (input.residualCopyClasses === "present") {
    requireValue(residualPresent, "INVENTORY_RESIDUAL_CLASSES_UNDECLARED");
  } else {
    requireValue(!residualPresent, "INVENTORY_DECLARATION_CONTRADICTION");
  }
  const admitted = new Set<string>();
  requireValue(Array.isArray(input.admittedCompletionEvidenceDigests));
  for (const digest of input.admittedCompletionEvidenceDigests) {
    requireValue(typeof digest === "string" && digestPattern.test(digest), "INVALID_DIGEST");
    requireValue(!admitted.has(digest), "DUPLICATE_EVIDENCE_REFERENCE");
    admitted.add(digest);
  }
  const evidence = parseEvidence(input.copyEvidence, operation.scope, operation.operationId);
  const lifecycleDigests = new Set(
    operation.history
      .map((event) => event.completionEvidenceDigest)
      .filter((value): value is string => value !== null),
  );
  const succeededByDigest = new Map<string, string>();
  for (const attempt of operation.attempts) {
    if (attempt.outcome !== "SUCCEEDED" || !attempt.completionEvidenceDigest) continue;
    requireValue(
      !succeededByDigest.has(attempt.completionEvidenceDigest),
      "DUPLICATE_ATTEMPT_DIGEST",
    );
    succeededByDigest.set(attempt.completionEvidenceDigest, attempt.outcomeCode);
  }

  const obligations = inventory.map((row) => {
    const deadlineAt = plusDays(
      requestedAt,
      liveClasses.has(row.copyClass) ? LIVE_DAYS : ALL_COPIES_DAYS,
    );
    const match = evidence.find((item) => {
      const outcomeCode = succeededByDigest.get(item.digest);
      return (
        item.copyClass === row.copyClass &&
        item.storeReference === row.storeReference &&
        admitted.has(item.digest) &&
        outcomeCode === outcomeByCopyClass[row.copyClass] &&
        !lifecycleDigests.has(item.digest)
      );
    });
    const verified = Boolean(match);
    let status: ResidualCopyObligationStatus = verified ? "verified" : "unmet";
    if (!verified && now >= instant(deadlineAt)) status = "overdue_unverified";
    return { ...row, deadlineAt, status };
  });

  if (failedWithoutSuccess && recordedState !== "CLOSED") {
    return freeze({
      ...base,
      closure: "fail_closed_failed_cleanup",
      obligations,
    });
  }

  const allVerified = obligations.every((row) => row.status === "verified");
  if (recordedState === "CLOSED") {
    requireValue(allVerified, "RESIDUAL_COPIES_UNVERIFIED");
    requireValue(!failedWithoutSuccess, "CLEANUP_FAILED");
    return freeze({ ...base, closure: "closable", obligations });
  }

  return freeze({
    ...base,
    closure: allVerified ? "closable" : "residual_copies_pending",
    obligations,
  });
}
