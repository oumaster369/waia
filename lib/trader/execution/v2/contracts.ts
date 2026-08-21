import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { addDecimal, compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { RiskAllowanceV2 } from "@/lib/trader/risk/v2/risk-allowance-v2";

export const EXECUTION_POLICY_BINDING_V2_SCHEMA_VERSION = "execution-policy-binding/v2" as const;
export const EXECUTION_PLAN_V2_SCHEMA_VERSION = "execution-plan/v2" as const;
export const EXECUTION_ATTEMPT_V2_SCHEMA_VERSION = "execution-attempt/v2" as const;
export const EXECUTION_REPORT_V2_SCHEMA_VERSION = "execution-report/v2" as const;

export const EXECUTION_REPORT_TYPES_V2 = [
  "PLAN_SEALED",
  "ALLOWANCE_CLAIMED",
  "ATTEMPT_BOUND",
  "SUBMIT_STARTED",
  "VENUE_ACCEPTED",
  "VENUE_REJECTED",
  "VENUE_STATUS_OBSERVED",
  "CANCEL_REQUESTED",
  "CANCEL_ACKNOWLEDGED",
  "FILL_REPORT_OBSERVED",
  "CONNECTOR_UNCERTAIN",
  "RECONCILIATION_REQUIRED",
] as const;

export type ExecutionReportTypeV2 = (typeof EXECUTION_REPORT_TYPES_V2)[number];
export type ExecutionOrderTypeV2 = "market" | "limit";
export type ExecutionTimeInForceV2 = "GTC" | "IOC" | "FOK";
export type ExecutionSideV2 = "buy" | "sell";
export type ExecutionActionV2 = "ENTER_LONG" | "REDUCE" | "CLOSE";

export type ExecutionQuantityRulesV2 = Readonly<{
  minimumQuantity: string;
  quantityStep: string;
  roundingMode: "EXACT" | "DOWN_TO_QUALIFIED";
  economicQualifiedQuantities: readonly string[];
}>;

export type ExecutionPolicyBindingV2 = Readonly<{
  schemaVersion: typeof EXECUTION_POLICY_BINDING_V2_SCHEMA_VERSION;
  executionPolicyId: string;
  organizationId: string;
  policyVersion: string;
  decisionId: string;
  decisionContentDigestHex: string;
  decisionExecutionPolicyDigestHex: string;
  economicSizeSetDigestHex: string;
  venue: string;
  market: "SPOT";
  instrumentIdentityDigestHex: string;
  allowedOrderTypes: readonly ExecutionOrderTypeV2[];
  allowedTimeInForce: readonly ExecutionTimeInForceV2[];
  allowedLiquidityRoles: readonly ("MAKER" | "TAKER")[];
  priceCollar: Readonly<{
    minimumPrice: string;
    maximumPrice: string;
    authorityDigestHex: string;
  }>;
  quantityRules: ExecutionQuantityRulesV2;
  slicingPolicy: Readonly<{
    maximumSlices: number;
    completePlanRequired: true;
  }>;
  retryPolicy: Readonly<{
    maximumNetworkSubmissions: 1;
    sameIdentityRetryAllowed: false;
    venueIdempotencyProven: false;
  }>;
  cancelPolicy: Readonly<{
    protectiveCancelAllowed: true;
    replacementRequiresPresealedOrFreshAuthority: true;
  }>;
  timeoutMs: number;
  uncertaintyHandling: "RECONCILIATION_REQUIRED";
  effectiveFromUtc: string;
  effectiveUntilUtc: string;
  semanticDigestHex: string;
  contentDigestHex: string;
}>;

export type ExecutionPolicyBindingV2Draft = Omit<
  ExecutionPolicyBindingV2,
  "schemaVersion" | "semanticDigestHex" | "contentDigestHex"
>;

export type ExecutionPlanSliceV2 = Readonly<{
  sequence: number;
  quantity: string;
  limitPrice: string | null;
}>;

export type ExecutionPlanV2 = Readonly<{
  schemaVersion: typeof EXECUTION_PLAN_V2_SCHEMA_VERSION;
  executionPlanId: string;
  organizationId: string;
  accountId: string;
  riskAllowanceId: string;
  riskAllowanceContentDigestHex: string;
  riskVerdictId: string;
  decisionId: string;
  decisionContentDigestHex: string;
  economicSizeSetDigestHex: string;
  instrumentIdentityDigestHex: string;
  symbol: string;
  action: ExecutionActionV2;
  side: ExecutionSideV2;
  approvedQualifiedQuantityCeiling: string;
  approvedNotionalCeiling: string;
  plannedQuantity: string;
  venue: string;
  orderType: ExecutionOrderTypeV2;
  liquidityRole: "MAKER" | "TAKER";
  limitPrice: string | null;
  priceCollar: ExecutionPolicyBindingV2["priceCollar"];
  timeInForce: ExecutionTimeInForceV2;
  timingWindow: Readonly<{ opensAtUtc: string; closesAtUtc: string }>;
  quantityRules: ExecutionQuantityRulesV2;
  childSlices: readonly ExecutionPlanSliceV2[];
  retryPolicy: ExecutionPolicyBindingV2["retryPolicy"];
  cancelPolicy: ExecutionPolicyBindingV2["cancelPolicy"];
  executionPolicyId: string;
  executionPolicyContentDigestHex: string;
  sealedAtUtc: string;
  semanticDigestHex: string;
  contentDigestHex: string;
}>;

export type CreateExecutionPlanV2Input = Readonly<{
  executionPlanId: string;
  allowance: RiskAllowanceV2;
  policy: ExecutionPolicyBindingV2;
  approvedNotionalCeiling: string;
  plannedQuantity: string;
  orderType: ExecutionOrderTypeV2;
  liquidityRole: "MAKER" | "TAKER";
  limitPrice?: string | null;
  timeInForce: ExecutionTimeInForceV2;
  timingWindow: ExecutionPlanV2["timingWindow"];
  childSlices: readonly ExecutionPlanSliceV2[];
  sealedAtUtc: string;
}>;

export type ExecutionAttemptRequestPayloadV2 = Readonly<{
  clientOrderId: string;
  symbol: string;
  side: ExecutionSideV2;
  type: ExecutionOrderTypeV2;
  price: string | null;
  quantity: string;
  timeInForce: ExecutionTimeInForceV2;
}>;

export type ExecutionAttemptV2 = Readonly<{
  schemaVersion: typeof EXECUTION_ATTEMPT_V2_SCHEMA_VERSION;
  executionAttemptId: string;
  organizationId: string;
  accountId: string;
  executionPlanId: string;
  executionPlanContentDigestHex: string;
  riskAllowanceId: string;
  riskAllowanceContentDigestHex: string;
  orderId: string;
  attemptSequence: "1";
  effectIdentityDigestHex: string;
  clientOrderId: string;
  venue: string;
  exactRequestPayload: ExecutionAttemptRequestPayloadV2;
  lifecycleState: "BOUND";
  boundAtUtc: string;
  semanticDigestHex: string;
  contentDigestHex: string;
}>;

export type CreateExecutionAttemptV2Input = Readonly<{
  executionAttemptId: string;
  orderId: string;
  plan: ExecutionPlanV2;
  riskAllowanceContentDigestHex: string;
  boundAtUtc: string;
}>;

export type ExecutionReportV2 = Readonly<{
  schemaVersion: typeof EXECUTION_REPORT_V2_SCHEMA_VERSION;
  executionReportId: string;
  organizationId: string;
  accountId: string;
  executionAttemptId: string;
  executionAttemptContentDigestHex: string;
  reportSequence: string;
  reportType: ExecutionReportTypeV2;
  source: "EXECUTION" | "CONNECTOR";
  rawObservation: Readonly<Record<string, unknown>>;
  venueOrderId: string | null;
  observedAtUtc: string;
  previousReportDigestHex: string | null;
  contentDigestHex: string;
}>;

export type ExecutionReportV2Draft = Omit<
  ExecutionReportV2,
  "schemaVersion" | "contentDigestHex"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireText(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} is required`);
}

function requireUuid(value: string, field: string): void {
  if (!UUID.test(value)) throw new Error(`${field} must be a canonical UUID`);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`${field} must be lowercase sha256 hex`);
}

function canonicalTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC milliseconds`);
  }
  return value;
}

function canonicalPositive(value: string, field: string): string {
  const parsed = parseDecimal(value);
  if (parsed <= 0n) throw new Error(`${field} must be positive`);
  return formatDecimal(parsed);
}

function canonicalNonnegative(value: string, field: string): string {
  const parsed = parseDecimal(value);
  if (parsed < 0n) throw new Error(`${field} must be nonnegative`);
  return formatDecimal(parsed);
}

function canonicalUnique<T extends string>(values: readonly T[], field: string): readonly T[] {
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${field} must be non-empty and unique`);
  }
  return Object.freeze([...values].sort());
}

function canonicalQuantityRules(input: ExecutionQuantityRulesV2): ExecutionQuantityRulesV2 {
  const minimumQuantity = canonicalPositive(input.minimumQuantity, "minimumQuantity");
  const quantityStep = canonicalPositive(input.quantityStep, "quantityStep");
  const economicQualifiedQuantities = input.economicQualifiedQuantities.map((value) =>
    canonicalPositive(value, "economicQualifiedQuantity"));
  const sorted = [...new Set(economicQualifiedQuantities)].sort((a, b) => compareDecimal(a, b));
  if (sorted.length !== economicQualifiedQuantities.length) {
    throw new Error("economic qualified quantities must be unique");
  }
  if (sorted.some((value) => compareDecimal(value, minimumQuantity) < 0)) {
    throw new Error("economic qualified quantity is below venue minimum");
  }
  return Object.freeze({
    minimumQuantity,
    quantityStep,
    roundingMode: input.roundingMode,
    economicQualifiedQuantities: Object.freeze(sorted),
  });
}

function exactMultiple(value: string, step: string): boolean {
  return parseDecimal(value) % parseDecimal(step) === 0n;
}

export function deterministicExecutionUuidV2(
  kind: "plan" | "order" | "attempt" | "risk-event" | "report",
  seed: Readonly<Record<string, unknown>>,
): string {
  const digest = computeStableJsonDigest({
    schemaVersion: "execution-deterministic-identity/v2",
    kind,
    seed,
  });
  const chars = digest.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = "8";
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createExecutionPolicyBindingV2(
  draft: ExecutionPolicyBindingV2Draft,
): ExecutionPolicyBindingV2 {
  requireUuid(draft.executionPolicyId, "executionPolicyId");
  [draft.organizationId, draft.policyVersion, draft.decisionId, draft.venue].forEach(
    (value, index) => requireText(
      value,
      ["organizationId", "policyVersion", "decisionId", "venue"][index]!,
    ),
  );
  [
    draft.decisionContentDigestHex,
    draft.decisionExecutionPolicyDigestHex,
    draft.economicSizeSetDigestHex,
    draft.instrumentIdentityDigestHex,
    draft.priceCollar.authorityDigestHex,
  ].forEach((value) => requireDigest(value, "policy digest"));
  if (draft.market !== "SPOT") throw new Error("Execution V2 is SPOT only");
  if (!Number.isSafeInteger(draft.timeoutMs) || draft.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(draft.slicingPolicy.maximumSlices) ||
    draft.slicingPolicy.maximumSlices <= 0) {
    throw new Error("maximumSlices must be a positive integer");
  }
  if (draft.retryPolicy.maximumNetworkSubmissions !== 1 ||
    draft.retryPolicy.sameIdentityRetryAllowed || draft.retryPolicy.venueIdempotencyProven) {
    throw new Error("unproven venue idempotency requires one fail-unknown submission");
  }
  const minimumPrice = canonicalPositive(draft.priceCollar.minimumPrice, "minimumPrice");
  const maximumPrice = canonicalPositive(draft.priceCollar.maximumPrice, "maximumPrice");
  if (compareDecimal(minimumPrice, maximumPrice) > 0) throw new Error("invalid price collar");
  const effectiveFromUtc = canonicalTimestamp(draft.effectiveFromUtc, "effectiveFromUtc");
  const effectiveUntilUtc = canonicalTimestamp(draft.effectiveUntilUtc, "effectiveUntilUtc");
  if (new Date(effectiveUntilUtc).getTime() <= new Date(effectiveFromUtc).getTime()) {
    throw new Error("policy validity window is empty");
  }
  const withoutDigests = {
    ...draft,
    schemaVersion: EXECUTION_POLICY_BINDING_V2_SCHEMA_VERSION,
    allowedOrderTypes: canonicalUnique(draft.allowedOrderTypes, "allowedOrderTypes"),
    allowedTimeInForce: canonicalUnique(draft.allowedTimeInForce, "allowedTimeInForce"),
    allowedLiquidityRoles: canonicalUnique(draft.allowedLiquidityRoles, "allowedLiquidityRoles"),
    priceCollar: Object.freeze({ ...draft.priceCollar, minimumPrice, maximumPrice }),
    quantityRules: canonicalQuantityRules(draft.quantityRules),
    slicingPolicy: Object.freeze({ ...draft.slicingPolicy }),
    retryPolicy: Object.freeze({ ...draft.retryPolicy }),
    cancelPolicy: Object.freeze({ ...draft.cancelPolicy }),
    effectiveFromUtc,
    effectiveUntilUtc,
  };
  const semanticDigestHex = computeStableJsonDigest(withoutDigests);
  return Object.freeze({
    ...withoutDigests,
    semanticDigestHex,
    contentDigestHex: computeStableJsonDigest({ ...withoutDigests, semanticDigestHex }),
  });
}

function requiredAction(allowance: RiskAllowanceV2): ExecutionActionV2 {
  if (allowance.decision.action === "HOLD") throw new Error("HOLD has no Execution authority");
  return allowance.decision.action;
}

function requiredSide(action: ExecutionActionV2): ExecutionSideV2 {
  return action === "ENTER_LONG" ? "buy" : "sell";
}

export function createExecutionPlanV2(input: CreateExecutionPlanV2Input): ExecutionPlanV2 {
  requireUuid(input.executionPlanId, "executionPlanId");
  if (input.allowance.lifecycleState !== "ISSUED") throw new Error("allowance is not issuable");
  if (input.policy.organizationId !== input.allowance.organizationId ||
    input.policy.decisionId !== input.allowance.decision.decisionId ||
    input.policy.decisionContentDigestHex !== input.allowance.decision.contentDigestHex ||
    input.policy.venue !== input.allowance.venue ||
    input.policy.instrumentIdentityDigestHex !== input.allowance.instrumentIdentityDigestHex ||
    input.policy.economicSizeSetDigestHex !== input.allowance.decision.economicSizeSetDigestHex) {
    throw new Error("execution policy is not bound to the allowance economics");
  }
  if (!input.policy.allowedOrderTypes.includes(input.orderType) ||
    !input.policy.allowedTimeInForce.includes(input.timeInForce) ||
    !input.policy.allowedLiquidityRoles.includes(input.liquidityRole)) {
    throw new Error("planned mechanics are outside the execution policy");
  }
  if (input.orderType === "market" && input.limitPrice != null) {
    throw new Error("market plan cannot carry a limit price");
  }
  if (input.orderType === "limit" && input.limitPrice == null) {
    throw new Error("limit plan requires an exact price");
  }
  const plannedQuantity = canonicalPositive(input.plannedQuantity, "plannedQuantity");
  const approvedQuantity = canonicalPositive(
    input.allowance.exactQualifiedQuantity,
    "approvedQualifiedQuantityCeiling",
  );
  const rules = canonicalQuantityRules(input.policy.quantityRules);
  if (compareDecimal(plannedQuantity, approvedQuantity) > 0 ||
    !rules.economicQualifiedQuantities.includes(plannedQuantity) ||
    !exactMultiple(plannedQuantity, rules.quantityStep)) {
    throw new Error("planned quantity lacks qualified discrete membership");
  }
  const limitPrice = input.limitPrice == null ? null : canonicalPositive(input.limitPrice, "limitPrice");
  if (limitPrice !== null && (compareDecimal(limitPrice, input.policy.priceCollar.minimumPrice) < 0 ||
    compareDecimal(limitPrice, input.policy.priceCollar.maximumPrice) > 0)) {
    throw new Error("limit price is outside the qualified collar");
  }
  const opensAtUtc = canonicalTimestamp(input.timingWindow.opensAtUtc, "opensAtUtc");
  const closesAtUtc = canonicalTimestamp(input.timingWindow.closesAtUtc, "closesAtUtc");
  const sealedAtUtc = canonicalTimestamp(input.sealedAtUtc, "sealedAtUtc");
  if (new Date(closesAtUtc).getTime() <= new Date(opensAtUtc).getTime() ||
    new Date(opensAtUtc).getTime() < new Date(input.policy.effectiveFromUtc).getTime() ||
    new Date(closesAtUtc).getTime() > new Date(input.policy.effectiveUntilUtc).getTime() ||
    new Date(sealedAtUtc).getTime() > new Date(opensAtUtc).getTime()) {
    throw new Error("timing window is outside the qualified policy");
  }
  if (input.childSlices.length === 0 ||
    input.childSlices.length > input.policy.slicingPolicy.maximumSlices) {
    throw new Error("complete child slice plan is required");
  }
  let sliceTotal = "0";
  const childSlices = input.childSlices.map((slice, index) => {
    if (slice.sequence !== index + 1) throw new Error("slice sequence must be contiguous");
    const quantity = canonicalPositive(slice.quantity, "slice quantity");
    if (!exactMultiple(quantity, rules.quantityStep)) throw new Error("slice violates quantity step");
    const price = slice.limitPrice == null ? null : canonicalPositive(slice.limitPrice, "slice price");
    if ((input.orderType === "limit") !== (price !== null) ||
      (price !== null && (compareDecimal(price, input.policy.priceCollar.minimumPrice) < 0 ||
        compareDecimal(price, input.policy.priceCollar.maximumPrice) > 0))) {
      throw new Error("slice price is outside sealed mechanics");
    }
    sliceTotal = addDecimal(sliceTotal, quantity);
    return Object.freeze({ sequence: slice.sequence, quantity, limitPrice: price });
  });
  if (compareDecimal(sliceTotal, plannedQuantity) !== 0) throw new Error("slice total mismatch");
  const action = requiredAction(input.allowance);
  const withoutDigests = {
    schemaVersion: EXECUTION_PLAN_V2_SCHEMA_VERSION,
    executionPlanId: input.executionPlanId,
    organizationId: input.allowance.organizationId,
    accountId: input.allowance.accountId,
    riskAllowanceId: input.allowance.riskAllowanceId,
    riskAllowanceContentDigestHex: input.allowance.contentDigestHex,
    riskVerdictId: input.allowance.riskVerdictId,
    decisionId: input.allowance.decision.decisionId,
    decisionContentDigestHex: input.allowance.decision.contentDigestHex,
    economicSizeSetDigestHex: input.allowance.decision.economicSizeSetDigestHex,
    instrumentIdentityDigestHex: input.allowance.instrumentIdentityDigestHex,
    symbol: input.allowance.symbol,
    action,
    side: requiredSide(action),
    approvedQualifiedQuantityCeiling: approvedQuantity,
    approvedNotionalCeiling: canonicalNonnegative(input.approvedNotionalCeiling, "notional ceiling"),
    plannedQuantity,
    venue: input.allowance.venue,
    orderType: input.orderType,
    liquidityRole: input.liquidityRole,
    limitPrice,
    priceCollar: Object.freeze({ ...input.policy.priceCollar }),
    timeInForce: input.timeInForce,
    timingWindow: Object.freeze({ opensAtUtc, closesAtUtc }),
    quantityRules: rules,
    childSlices: Object.freeze(childSlices),
    retryPolicy: input.policy.retryPolicy,
    cancelPolicy: input.policy.cancelPolicy,
    executionPolicyId: input.policy.executionPolicyId,
    executionPolicyContentDigestHex: input.policy.contentDigestHex,
    sealedAtUtc,
  };
  const semanticDigestHex = computeStableJsonDigest(withoutDigests);
  return Object.freeze({
    ...withoutDigests,
    semanticDigestHex,
    contentDigestHex: computeStableJsonDigest({ ...withoutDigests, semanticDigestHex }),
  });
}

export function deterministicExecutionClientOrderId(planDigestHex: string): string {
  requireDigest(planDigestHex, "executionPlanContentDigestHex");
  return `waia-v2-${planDigestHex.slice(0, 24)}`;
}

export function createExecutionAttemptV2(
  input: CreateExecutionAttemptV2Input,
): ExecutionAttemptV2 {
  requireUuid(input.executionAttemptId, "executionAttemptId");
  requireUuid(input.orderId, "orderId");
  requireDigest(input.riskAllowanceContentDigestHex, "riskAllowanceContentDigestHex");
  if (input.riskAllowanceContentDigestHex !== input.plan.riskAllowanceContentDigestHex) {
    throw new Error("attempt allowance digest mismatch");
  }
  if (input.plan.childSlices.length !== 1) {
    throw new Error("one attempt represents one pre-sealed venue order slice");
  }
  const clientOrderId = deterministicExecutionClientOrderId(input.plan.contentDigestHex);
  const exactRequestPayload = Object.freeze({
    clientOrderId,
    symbol: input.plan.symbol,
    side: input.plan.side,
    type: input.plan.orderType,
    price: input.plan.limitPrice,
    quantity: input.plan.plannedQuantity,
    timeInForce: input.plan.timeInForce,
  });
  const boundAtUtc = canonicalTimestamp(input.boundAtUtc, "boundAtUtc");
  const effectIdentityDigestHex = computeStableJsonDigest({
    schemaVersion: "execution-effect-identity/v2",
    organizationId: input.plan.organizationId,
    accountId: input.plan.accountId,
    riskAllowanceId: input.plan.riskAllowanceId,
    executionPlanContentDigestHex: input.plan.contentDigestHex,
    exactRequestPayload,
  });
  const withoutDigests = {
    schemaVersion: EXECUTION_ATTEMPT_V2_SCHEMA_VERSION,
    executionAttemptId: input.executionAttemptId,
    organizationId: input.plan.organizationId,
    accountId: input.plan.accountId,
    executionPlanId: input.plan.executionPlanId,
    executionPlanContentDigestHex: input.plan.contentDigestHex,
    riskAllowanceId: input.plan.riskAllowanceId,
    riskAllowanceContentDigestHex: input.plan.riskAllowanceContentDigestHex,
    orderId: input.orderId,
    attemptSequence: "1" as const,
    effectIdentityDigestHex,
    clientOrderId,
    venue: input.plan.venue,
    exactRequestPayload,
    lifecycleState: "BOUND" as const,
    boundAtUtc,
  };
  const semanticDigestHex = computeStableJsonDigest(withoutDigests);
  return Object.freeze({
    ...withoutDigests,
    semanticDigestHex,
    contentDigestHex: computeStableJsonDigest({ ...withoutDigests, semanticDigestHex }),
  });
}

export function createExecutionReportV2(draft: ExecutionReportV2Draft): ExecutionReportV2 {
  requireUuid(draft.executionReportId, "executionReportId");
  requireUuid(draft.executionAttemptId, "executionAttemptId");
  requireDigest(draft.executionAttemptContentDigestHex, "executionAttemptContentDigestHex");
  if (!/^[1-9][0-9]*$/.test(draft.reportSequence)) throw new Error("invalid report sequence");
  if (!EXECUTION_REPORT_TYPES_V2.includes(draft.reportType)) throw new Error("invalid report type");
  if ((draft.reportSequence === "1") !== (draft.previousReportDigestHex === null)) {
    throw new Error("report chain head mismatch");
  }
  if (draft.previousReportDigestHex !== null) {
    requireDigest(draft.previousReportDigestHex, "previousReportDigestHex");
  }
  const observedAtUtc = canonicalTimestamp(draft.observedAtUtc, "observedAtUtc");
  const payload = {
    ...draft,
    schemaVersion: EXECUTION_REPORT_V2_SCHEMA_VERSION,
    rawObservation: Object.freeze({ ...draft.rawObservation }),
    observedAtUtc,
  };
  return Object.freeze({ ...payload, contentDigestHex: computeStableJsonDigest(payload) });
}

export function validateExecutionPolicyBindingV2(value: ExecutionPolicyBindingV2): boolean {
  try {
    const { schemaVersion: _s, semanticDigestHex: _sd, contentDigestHex: _cd, ...draft } = value;
    const rebuilt = createExecutionPolicyBindingV2(draft);
    return _s === rebuilt.schemaVersion && _sd === rebuilt.semanticDigestHex &&
      _cd === rebuilt.contentDigestHex;
  } catch { return false; }
}

export function validateExecutionPlanV2(value: ExecutionPlanV2): boolean {
  try {
    const { semanticDigestHex, contentDigestHex, ...payload } = value;
    return value.schemaVersion === EXECUTION_PLAN_V2_SCHEMA_VERSION &&
      DIGEST.test(value.riskAllowanceContentDigestHex) &&
      DIGEST.test(value.executionPolicyContentDigestHex) &&
      value.childSlices.length > 0 &&
      computeStableJsonDigest(payload) === semanticDigestHex &&
      computeStableJsonDigest({ ...payload, semanticDigestHex }) === contentDigestHex;
  } catch { return false; }
}

export function validateExecutionAttemptV2(value: ExecutionAttemptV2): boolean {
  try {
    const { semanticDigestHex, contentDigestHex, ...payload } = value;
    return value.schemaVersion === EXECUTION_ATTEMPT_V2_SCHEMA_VERSION &&
      value.attemptSequence === "1" && value.lifecycleState === "BOUND" &&
      value.clientOrderId === deterministicExecutionClientOrderId(value.executionPlanContentDigestHex) &&
      computeStableJsonDigest(payload) === semanticDigestHex &&
      computeStableJsonDigest({ ...payload, semanticDigestHex }) === contentDigestHex;
  } catch { return false; }
}

export function validateExecutionReportV2(value: ExecutionReportV2): boolean {
  try {
    const { schemaVersion: _s, contentDigestHex: _cd, ...draft } = value;
    const rebuilt = createExecutionReportV2(draft);
    return _s === rebuilt.schemaVersion && _cd === rebuilt.contentDigestHex;
  } catch { return false; }
}
