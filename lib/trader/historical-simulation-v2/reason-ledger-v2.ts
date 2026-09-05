import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import { HISTORICAL_DATASET_MEMBERSHIP_V2, type HistoricalDatasetMembershipV2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";

export const HISTORICAL_SIMULATION_REASON_LEDGER_V2_SCHEMA =
  "waia.trader.historical_simulation_reason_ledger.v2" as const;

export type HistoricalSimulationPreHoldoutPartitionV2 = "DEVELOPMENT" | "WALK_FORWARD";

type EvidenceStageV2<Status extends string> = Readonly<{
  status: Status;
  reasonCodes: readonly string[];
}>;

export type HistoricalSimulationReasonLedgerV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_REASON_LEDGER_V2_SCHEMA;
  entryId: string;
  organizationId: string;
  accountId: string;
  runId: string;
  cycleId: string;
  cycleSequence: number;
  symbol: string;
  partition: HistoricalSimulationPreHoldoutPartitionV2;
  capitalEligible: false;
  replayBarClosedAtUtc: string;
  datasetMembership: HistoricalDatasetMembershipV2;
  previousContentDigestHex: string | null;
  forecast: EvidenceStageV2<"AUTHORIZED" | "NON_ACTIONABLE"> &
    Readonly<{ authorityContentDigestHex: string | null }>;
  /** Raw DEE-660 decision, before any position-aware Portfolio override. */
  decision: EvidenceStageV2<"ENTER_LONG" | "CASH"> &
    Readonly<{
      decisionContentDigestHex: string;
      whyNotCashReceiptDigestHex: string;
      evLower: string | null;
      evBase: string | null;
      evUpper: string | null;
    }>;
  portfolio: EvidenceStageV2<"PROPOSED" | "NO_PROPOSAL"> &
    Readonly<{
      action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE";
      proposalContentDigestHex: string;
    }>;
  risk: EvidenceStageV2<"APPROVE" | "RESIZE" | "VETO" | "NOT_EVALUATED"> &
    Readonly<{
      verdictContentDigestHex: string | null;
      allowanceContentDigestHex: string | null;
    }>;
  /** Submission caused by this cycle's decision; realized effects belong below. */
  execution: EvidenceStageV2<"COMMITTED" | "NOT_DISPATCHED"> &
    Readonly<{
      planContentDigestHex: string | null;
      attemptContentDigestHex: string | null;
      reportContentDigestHex: string | null;
      fillContentDigestHexes: readonly string[];
    }>;
  /** Effects observed on this bar from orders submitted by prior decisions. */
  observedExecutionEffects: ReadonlyArray<Readonly<{
    effectId: string;
    originatingDecisionId: string;
    originatingDecisionContentDigestHex: string;
    originatingPlanId: string;
    originatingPlanContentDigestHex: string;
    originatingAttemptId: string;
    originatingAttemptContentDigestHex: string;
    originatingOrderId: string;
    originatingOrderContentDigestHex: string;
    status: "NO_FILL" | "PARTIAL_FILL" | "FILLED" | "EXPIRED" | "CANCELLED";
    reportContentDigestHexes: readonly string[];
    fillContentDigestHexes: readonly string[];
    reasonCodes: readonly string[];
  }>>;
  accounting: EvidenceStageV2<"APPLIED" | "UNCHANGED" | "NOT_APPLICABLE"> &
    Readonly<{ frontierContentDigestHex: string }>;
  guardian: EvidenceStageV2<"NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT"> &
    Readonly<{ assessmentContentDigestHex: string }>;
  learning: EvidenceStageV2<"PENDING" | "APPLIED" | "NO_UPDATE"> &
    Readonly<{
      calibrationObservationContentDigestHex: string | null;
      knowledgeUpdateContentDigestHex: string | null;
      eligibleResolutionAtUtc: string | null;
      visibleFromPitAnchorUtc: string | null;
    }>;
  contentDigestHex: string;
}>;

export type HistoricalSimulationReasonLedgerV2Draft = Omit<
  HistoricalSimulationReasonLedgerV2,
  "schemaVersion" | "entryId" | "capitalEligible" | "contentDigestHex"
> &
  Readonly<{ entryId?: string }>;

const DIGEST = /^[0-9a-f]{64}$/;

function requireText(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} is required`);
}

function requireDigest(value: string | null, field: string, nullable = false): void {
  if (value === null && nullable) return;
  if (value === null || !DIGEST.test(value)) throw new Error(`${field} must be lowercase sha256 hex`);
}

function requireUtc(value: string | null, field: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (value === null) throw new Error(`${field} is required`);
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC milliseconds`);
  }
  return epoch;
}

function requireReasons(stage: string, status: string, reasons: readonly string[], success: boolean): void {
  for (const reason of reasons) requireText(reason, `${stage}.reasonCodes[]`);
  if (!success && reasons.length === 0) throw new Error(`${stage}.${status} requires reasonCodes`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function assertComplete(input: HistoricalSimulationReasonLedgerV2Draft): void {
  [
    [input.organizationId, "organizationId"],
    [input.accountId, "accountId"],
    [input.runId, "runId"],
    [input.cycleId, "cycleId"],
    [input.symbol, "symbol"],
  ].forEach(([value, field]) => requireText(value!, field!));
  if (!Number.isSafeInteger(input.cycleSequence) || input.cycleSequence < 0) {
    throw new Error("cycleSequence must be a nonnegative safe integer");
  }
  if (input.partition !== "DEVELOPMENT" && input.partition !== "WALK_FORWARD") {
    throw new Error("only DEVELOPMENT/WALK_FORWARD partitions are permitted");
  }
  const replayEpoch = requireUtc(input.replayBarClosedAtUtc, "replayBarClosedAtUtc")!;
  const membership = input.datasetMembership;
  const { contentDigestHex: membershipDigest, ...membershipBody } = membership;
  requireDigest(membershipDigest, "datasetMembership.contentDigestHex");
  if (membership.schemaVersion !== HISTORICAL_DATASET_MEMBERSHIP_V2 ||
      computeSemanticSha256Hex(membershipBody) !== membershipDigest ||
      membership.organizationId !== input.organizationId || membership.cycleId !== input.cycleId ||
      membership.symbol !== input.symbol.replace("/", "") || membership.partition !== input.partition) {
    throw new Error("dataset membership scope/content mismatch");
  }
  requireDigest(input.previousContentDigestHex, "previousContentDigestHex", true);

  requireDigest(input.forecast.authorityContentDigestHex, "forecast.authorityContentDigestHex", true);
  requireReasons("forecast", input.forecast.status, input.forecast.reasonCodes, input.forecast.status === "AUTHORIZED");
  if ((input.forecast.status === "AUTHORIZED") !== (input.forecast.authorityContentDigestHex !== null)) {
    throw new Error("forecast authority/status mismatch");
  }

  requireDigest(input.decision.decisionContentDigestHex, "decision.decisionContentDigestHex");
  requireDigest(input.decision.whyNotCashReceiptDigestHex, "decision.whyNotCashReceiptDigestHex");
  const hasEv = [input.decision.evLower, input.decision.evBase, input.decision.evUpper].every(
    (value) => value !== null,
  );
  if (input.decision.status === "ENTER_LONG" && !hasEv) throw new Error("ENTER_LONG requires EV range");
  requireReasons("decision", input.decision.status, input.decision.reasonCodes, input.decision.status !== "CASH");

  requireDigest(input.portfolio.proposalContentDigestHex, "portfolio.proposalContentDigestHex");
  if ((input.portfolio.status === "NO_PROPOSAL") !== (input.portfolio.action === "CASH")) {
    throw new Error("portfolio status/action mismatch");
  }
  requireReasons("portfolio", input.portfolio.status, input.portfolio.reasonCodes, input.portfolio.status === "PROPOSED");

  requireDigest(input.risk.verdictContentDigestHex, "risk.verdictContentDigestHex", true);
  requireDigest(input.risk.allowanceContentDigestHex, "risk.allowanceContentDigestHex", true);
  const riskPermitted = input.risk.status === "APPROVE" || input.risk.status === "RESIZE";
  if (riskPermitted && (!input.risk.verdictContentDigestHex || !input.risk.allowanceContentDigestHex)) {
    throw new Error("permitted risk requires verdict and allowance digests");
  }
  if (!riskPermitted && input.risk.allowanceContentDigestHex !== null) {
    throw new Error("non-permitted risk cannot carry an allowance digest");
  }
  requireReasons("risk", input.risk.status, input.risk.reasonCodes, riskPermitted);

  if (input.execution.fillContentDigestHexes.length !== 0 || input.execution.reportContentDigestHex !== null) {
    throw new Error("current decision execution is submission-only; observed effects belong in observedExecutionEffects");
  }
  const dispatched = input.execution.status !== "NOT_DISPATCHED";
  for (const [value, field] of [
    [input.execution.planContentDigestHex, "execution.planContentDigestHex"],
    [input.execution.attemptContentDigestHex, "execution.attemptContentDigestHex"],
  ] as const) {
    requireDigest(value, field, !dispatched);
    if (dispatched && value === null) throw new Error(`${field} required for dispatched execution`);
  }
  requireDigest(input.execution.reportContentDigestHex, "execution.reportContentDigestHex", true);
  requireReasons("execution", input.execution.status, input.execution.reasonCodes,
    input.execution.status === "COMMITTED");

  const effectIds = new Set<string>();
  for (const [index, effect] of input.observedExecutionEffects.entries()) {
    for (const [value, field] of [
      [effect.effectId, "effectId"], [effect.originatingDecisionId, "originatingDecisionId"],
      [effect.originatingPlanId, "originatingPlanId"], [effect.originatingAttemptId, "originatingAttemptId"],
      [effect.originatingOrderId, "originatingOrderId"],
    ] as const) requireText(value, `observedExecutionEffects[${index}].${field}`);
    if (effectIds.has(effect.effectId)) throw new Error("observedExecutionEffects effectId must be unique per ledger entry");
    effectIds.add(effect.effectId);
    for (const [value, field] of [
      [effect.originatingDecisionContentDigestHex, "originatingDecisionContentDigestHex"],
      [effect.originatingPlanContentDigestHex, "originatingPlanContentDigestHex"],
      [effect.originatingAttemptContentDigestHex, "originatingAttemptContentDigestHex"],
      [effect.originatingOrderContentDigestHex, "originatingOrderContentDigestHex"],
    ] as const) requireDigest(value, `observedExecutionEffects[${index}].${field}`);
    if (effect.originatingDecisionContentDigestHex === input.decision.decisionContentDigestHex) {
      throw new Error("observed execution effect must originate from a prior decision");
    }
    effect.reportContentDigestHexes.forEach((value) => requireDigest(value, `observedExecutionEffects[${index}].reportContentDigestHexes[]`));
    effect.fillContentDigestHexes.forEach((value) => requireDigest(value, `observedExecutionEffects[${index}].fillContentDigestHexes[]`));
    if (effect.reportContentDigestHexes.length === 0) throw new Error("observed execution effect requires report evidence");
    const filled = effect.status === "PARTIAL_FILL" || effect.status === "FILLED";
    if (filled !== (effect.fillContentDigestHexes.length > 0)) throw new Error("observed execution effect fill/status mismatch");
    requireReasons("observedExecutionEffects", effect.status, effect.reasonCodes, filled);
  }

  requireDigest(input.accounting.frontierContentDigestHex, "accounting.frontierContentDigestHex");
  requireReasons("accounting", input.accounting.status, input.accounting.reasonCodes,
    input.accounting.status === "APPLIED" || input.accounting.status === "UNCHANGED");
  requireDigest(input.guardian.assessmentContentDigestHex, "guardian.assessmentContentDigestHex");
  requireReasons("guardian", input.guardian.status, input.guardian.reasonCodes, input.guardian.status === "NONE");

  requireDigest(input.learning.calibrationObservationContentDigestHex,
    "learning.calibrationObservationContentDigestHex", true);
  requireDigest(input.learning.knowledgeUpdateContentDigestHex,
    "learning.knowledgeUpdateContentDigestHex", true);
  const eligibleEpoch = requireUtc(input.learning.eligibleResolutionAtUtc,
    "learning.eligibleResolutionAtUtc", true);
  const visibleEpoch = requireUtc(input.learning.visibleFromPitAnchorUtc,
    "learning.visibleFromPitAnchorUtc", true);
  if (input.learning.status === "APPLIED") {
    if (!input.learning.calibrationObservationContentDigestHex ||
        !input.learning.knowledgeUpdateContentDigestHex || eligibleEpoch === null || visibleEpoch === null) {
      throw new Error("APPLIED learning requires calibration, update and PIT timing evidence");
    }
    // APPLIED describes prior Forecast evidence consumed by this cycle. Its
    // resolution must precede the visibility PIT, and that visibility PIT may
    // be this replay bar (or an earlier one after a safe resume), never future.
    if (eligibleEpoch >= visibleEpoch || visibleEpoch > replayEpoch) {
      throw new Error("applied learning must be resolved before a non-future PIT anchor");
    }
  }
  requireReasons("learning", input.learning.status, input.learning.reasonCodes,
    input.learning.status === "APPLIED");
}

export function createHistoricalSimulationReasonLedgerV2(
  draft: HistoricalSimulationReasonLedgerV2Draft,
): HistoricalSimulationReasonLedgerV2 {
  assertComplete(draft);
  const entryId = draft.entryId ?? deterministicExecutionUuidV2("report", {
    kind: "historical-simulation-reason-ledger-v2",
    organizationId: draft.organizationId,
    accountId: draft.accountId,
    runId: draft.runId,
    cycleId: draft.cycleId,
    cycleSequence: draft.cycleSequence,
    datasetMembershipContentDigestHex: draft.datasetMembership.contentDigestHex,
  });
  const body = {
    ...draft,
    schemaVersion: HISTORICAL_SIMULATION_REASON_LEDGER_V2_SCHEMA,
    entryId,
    capitalEligible: false as const,
  };
  const entry = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  return deepFreeze(entry);
}

export function appendHistoricalSimulationReasonLedgerV2(
  previous: HistoricalSimulationReasonLedgerV2 | null,
  draft: Omit<HistoricalSimulationReasonLedgerV2Draft, "cycleSequence" | "previousContentDigestHex">,
): HistoricalSimulationReasonLedgerV2 {
  if (previous && (previous.organizationId !== draft.organizationId || previous.accountId !== draft.accountId ||
      previous.runId !== draft.runId)) {
    throw new Error("reason-ledger chain scope mismatch");
  }
  return createHistoricalSimulationReasonLedgerV2({
    ...draft,
    cycleSequence: previous ? previous.cycleSequence + 1 : 0,
    previousContentDigestHex: previous?.contentDigestHex ?? null,
  });
}

export function validateHistoricalSimulationReasonLedgerV2(
  entry: HistoricalSimulationReasonLedgerV2,
): boolean {
  try {
    const { schemaVersion, capitalEligible, contentDigestHex, ...draft } = entry;
    if (schemaVersion !== HISTORICAL_SIMULATION_REASON_LEDGER_V2_SCHEMA || capitalEligible !== false) {
      return false;
    }
    return createHistoricalSimulationReasonLedgerV2(draft).contentDigestHex === contentDigestHex;
  } catch {
    return false;
  }
}

export function assertHistoricalSimulationReasonLedgerChainV2(
  entries: readonly HistoricalSimulationReasonLedgerV2[],
): void {
  entries.forEach((entry, index) => {
    if (!validateHistoricalSimulationReasonLedgerV2(entry)) throw new Error(`invalid ledger entry at ${index}`);
    if (entry.cycleSequence !== index) throw new Error(`non-contiguous cycle sequence at ${index}`);
    const previous = entries[index - 1];
    if (entry.previousContentDigestHex !== (previous?.contentDigestHex ?? null)) {
      throw new Error(`broken digest chain at ${index}`);
    }
    if (previous && (entry.organizationId !== previous.organizationId || entry.accountId !== previous.accountId ||
        entry.runId !== previous.runId)) {
      throw new Error(`reason-ledger chain scope mismatch at ${index}`);
    }
  });
}
