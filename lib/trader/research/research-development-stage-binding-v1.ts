import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { types as nodeUtilTypes } from "node:util";
import { sql } from "drizzle-orm";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { RESEARCH_EXECUTABLE_ID_V1 } from "@/lib/trader/research/research-experiment-contract-v1";
import * as modeledStageKernel from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import type {
  OwnedResearchStageExecutorV1,
  ResearchModeledStageDescriptorV1,
} from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import type { ResearchModeledStageSourceV1 } from "@/lib/trader/research/research-modeled-stage-source-v1";

function refuse(reason: string): never {
  throw new Error(`RESEARCH_DEVELOPMENT_STAGE_REFUSED:${reason}`);
}

const REGISTRATION_BRAND = Symbol("research-development-stage-registration-v1");
const mintedRegistrations = new WeakSet<object>();
const CALL_KEYS = new Set(["executor", "descriptor", "registration", "stages"]);
const REGISTRATION_KEYS = new Set([
  "attemptId",
  "trialIndex",
  "specSha256",
  "committedBeforeScoring",
]);
const STAGE_KEYS = new Set(["kind", "windowIndex", "payload"]);
const FORGED_CALLBACK_KEYS = new Set([
  "callback",
  "callbacks",
  "scorer",
  "runBacktest",
  "evaluator",
  "metrics",
  "score",
  "result",
  "strategyId",
  "paramsJson",
]);
const FEATURE_SEMANTICS = "closed-prefix-sma-population-zscore/v1" as const;
const REPLAY_SEMANTICS =
  "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const RESEARCH_DEVELOPMENT_STAGE_RECEIPT_V1 =
  "waia.research.development-stage-receipt.v1" as const;

export type DevelopmentStageKindV1 = "train" | "validation" | "walk-forward";

/** Minted only before scoring. A copied object is not registration. */
export type ResearchDevelopmentStageRegistrationV1 = Readonly<{
  [REGISTRATION_BRAND]: true;
  attemptId: string;
  trialIndex: number;
  specSha256: string;
  committedBeforeScoring: true;
}>;

export type ResearchDevelopmentStageReceiptV1 = Readonly<{
  schemaVersion: typeof RESEARCH_DEVELOPMENT_STAGE_RECEIPT_V1;
  organizationId: string;
  attemptId: string;
  trialIndex: number;
  stage: DevelopmentStageKindV1;
  windowIndex: number;
  experimentSpecSha256: string;
  executableId: typeof RESEARCH_EXECUTABLE_ID_V1;
  executableSourceSha256: string;
  featureSemantics: typeof FEATURE_SEMANTICS;
  replaySemantics: typeof REPLAY_SEMANTICS;
  parametersSha256: string;
  costModelDigest: string;
  universeSha256: string;
  partitionContentSha256: string;
  scopeContentDigest: string;
  observedDecisionCount: number;
  observedInvocationCount: number;
  observedOrderCount: number;
  observedFillCount: number;
  observedInvocationDigestHex: string;
  finalAccountingDigestHex: string;
  capitalEligible: false;
  scientificQualified: false;
  provenance: "RUNNER_OBSERVED";
  contentDigestHex: string;
}>;

type ObservedStage = Readonly<{
  kind: DevelopmentStageKindV1;
  windowIndex: number;
  payload: ResearchModeledStageSourceV1;
  specSha256: string;
  parametersSha256: string;
  costModelDigest: string;
  universeSha256: string;
  partitionContentSha256: string;
  scopeContentDigest: string;
  executableSourceSha256: string;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProxyLike(value: unknown): boolean {
  return (
    Boolean(value) &&
    (typeof value === "object" || typeof value === "function") &&
    nodeUtilTypes.isProxy(value)
  );
}

function readOwnProperty(
  record: object,
  key: string,
): { present: boolean; accessor: boolean; value: unknown } {
  const property = Object.getOwnPropertyDescriptor(record, key);
  if (!property) return { present: false, accessor: false, value: undefined };
  if (property.get !== undefined || property.set !== undefined || !("value" in property)) {
    return { present: true, accessor: true, value: undefined };
  }
  return { present: true, accessor: false, value: property.value };
}

function snapshotPlainData(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse("STAGE_PAYLOAD");
    return value;
  }
  if (typeof value !== "object") refuse("STAGE_PAYLOAD");
  if (isProxyLike(value)) refuse("STAGE_PAYLOAD");
  if (depth > 32) refuse("STAGE_PAYLOAD");
  const visiting = seen ?? new WeakSet<object>();
  if (visiting.has(value)) refuse("STAGE_PAYLOAD");
  visiting.add(value);
  if (Object.getPrototypeOf(value) === Array.prototype) {
    const lengthRead = readOwnProperty(value, "length");
    if (
      !lengthRead.present ||
      lengthRead.accessor ||
      typeof lengthRead.value !== "number" ||
      !Number.isSafeInteger(lengthRead.value) ||
      lengthRead.value < 0
    ) {
      refuse("STAGE_PAYLOAD");
    }
    const copy: unknown[] = [];
    for (let index = 0; index < lengthRead.value; index += 1) {
      const entry = readOwnProperty(value, String(index));
      if (!entry.present || entry.accessor) refuse("STAGE_PAYLOAD");
      copy.push(snapshotPlainData(entry.value, depth + 1, visiting));
    }
    visiting.delete(value);
    return Object.freeze(copy);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) refuse("STAGE_PAYLOAD");
  if (Object.getOwnPropertySymbols(value).length !== 0) refuse("STAGE_PAYLOAD");
  const copy: Record<string, unknown> = {};
  for (const name of Object.getOwnPropertyNames(value)) {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (
      !property ||
      property.get !== undefined ||
      property.set !== undefined ||
      !("value" in property)
    ) {
      refuse("STAGE_PAYLOAD");
    }
    copy[name] = snapshotPlainData(property.value, depth + 1, visiting);
  }
  visiting.delete(value);
  return Object.freeze(copy);
}

function refuseExtraKeys(record: object, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (FORGED_CALLBACK_KEYS.has(key)) refuse("FORGED_CALLBACK");
    if (!allowed.has(key)) refuse("UNTRUSTED_STAGE_INPUT");
  }
}

function requireData(record: object, key: string): unknown {
  const read = readOwnProperty(record, key);
  if (!read.present || read.accessor) refuse("STAGE_INPUT");
  return read.value;
}

function requireSha256(value: unknown, reason: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) refuse(reason);
  return value;
}

/** Records that the experiment spec was committed before any stage score.
 * Bars, callbacks, scores, and stage results cannot be sealed as registration. */
export function sealResearchDevelopmentStageRegistrationV1(
  input: Readonly<{
    attemptId: string;
    trialIndex: number;
    specSha256: string;
    committedBeforeScoring: true;
  }>,
): ResearchDevelopmentStageRegistrationV1 {
  if (!isPlainRecord(input) || isProxyLike(input)) refuse("LATE_REGISTRATION");
  refuseExtraKeys(input, REGISTRATION_KEYS);
  const attemptId = requireData(input, "attemptId");
  const trialIndex = requireData(input, "trialIndex");
  const specSha256 = requireData(input, "specSha256");
  const committedBeforeScoring = requireData(input, "committedBeforeScoring");
  if (typeof attemptId !== "string" || !UUID.test(attemptId)) refuse("LATE_REGISTRATION");
  if (
    typeof trialIndex !== "number" ||
    !Number.isInteger(trialIndex) ||
    trialIndex < 0 ||
    trialIndex > 31
  ) {
    refuse("LATE_REGISTRATION");
  }
  if (typeof specSha256 !== "string" || !SHA256.test(specSha256)) refuse("LATE_REGISTRATION");
  if (committedBeforeScoring !== true) refuse("LATE_REGISTRATION");
  const registration = Object.freeze({
    [REGISTRATION_BRAND]: true as const,
    attemptId,
    trialIndex,
    specSha256,
    committedBeforeScoring: true as const,
  });
  mintedRegistrations.add(registration);
  return registration;
}

function isSealedRegistration(value: unknown): value is ResearchDevelopmentStageRegistrationV1 {
  if (!isPlainRecord(value) || !Object.isFrozen(value) || isProxyLike(value)) return false;
  if (!mintedRegistrations.has(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== REGISTRATION_KEYS.size) return false;
  for (const name of names) {
    if (!REGISTRATION_KEYS.has(name)) return false;
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (
      !property ||
      property.get !== undefined ||
      property.set !== undefined ||
      !("value" in property)
    ) {
      return false;
    }
  }
  const symbols = Object.getOwnPropertySymbols(value);
  const brand = Object.getOwnPropertyDescriptor(value, REGISTRATION_BRAND);
  return (
    symbols.length === 1 &&
    symbols[0] === REGISTRATION_BRAND &&
    brand?.value === true &&
    brand.get === undefined &&
    brand.set === undefined
  );
}

function readRecord(parent: object, key: string, reason: string): Record<string, unknown> {
  const read = readOwnProperty(parent, key);
  if (!read.present || read.accessor || !isPlainRecord(read.value) || isProxyLike(read.value)) {
    refuse(reason);
  }
  return read.value;
}

function observeStage(stage: object, descriptor: ResearchModeledStageDescriptorV1): ObservedStage {
  refuseExtraKeys(stage, STAGE_KEYS);
  const kind = requireData(stage, "kind");
  const windowIndex = requireData(stage, "windowIndex");
  const payloadValue = requireData(stage, "payload");
  if (kind === "blind") refuse("BLIND_OUT_OF_SCOPE");
  if (kind !== "train" && kind !== "validation" && kind !== "walk-forward") refuse("STAGE_KIND");
  if (
    typeof windowIndex !== "number" ||
    !Number.isInteger(windowIndex) ||
    windowIndex < 0 ||
    windowIndex > 1023
  ) {
    refuse("PARTITION_MISMATCH");
  }
  if ((kind === "train" || kind === "validation") && windowIndex !== 0)
    refuse("PARTITION_MISMATCH");
  if (!isPlainRecord(payloadValue) || isProxyLike(payloadValue)) refuse("STAGE_PAYLOAD");
  const payload = snapshotPlainData(payloadValue) as ResearchModeledStageSourceV1;
  const scope = readRecord(payload, "scope", "STAGE_PAYLOAD_IDENTITY");
  const identity = readRecord(scope, "identity", "STAGE_PAYLOAD_IDENTITY");
  const attemptId = requireData(identity, "attemptId");
  const trialIndex = requireData(identity, "trialIndex");
  if (attemptId !== descriptor.attemptId || trialIndex !== descriptor.trialIndex) {
    refuse("STAGE_PAYLOAD_IDENTITY");
  }
  const organizationId = requireData(identity, "organizationId");
  if (typeof organizationId !== "string" || !UUID.test(organizationId))
    refuse("STAGE_PAYLOAD_IDENTITY");
  const parameters = snapshotPlainData(requireData(identity, "parameters"));
  const experiment = readRecord(payload, "experiment", "STAGE_PAYLOAD");
  const spec = snapshotPlainData(requireData(experiment, "spec"));
  if (!isPlainRecord(spec)) refuse("STAGE_PAYLOAD");
  const specSha256 = computeStableJsonDigest(spec);
  const executable = readRecord(spec, "executable", "EVALUATOR_MISMATCH");
  const executableId = requireData(executable, "id");
  const featureSemantics = requireData(executable, "featureSemantics");
  const replaySemantics = requireData(executable, "replaySemantics");
  const executableSourceSha256 = requireSha256(
    requireData(executable, "sourceSha256"),
    "EVALUATOR_MISMATCH",
  );
  if (
    executableId !== RESEARCH_EXECUTABLE_ID_V1 ||
    featureSemantics !== FEATURE_SEMANTICS ||
    replaySemantics !== REPLAY_SEMANTICS ||
    executableSourceSha256 !== descriptor.policy.requestedExecutableSourceSha256
  ) {
    refuse("EVALUATOR_MISMATCH");
  }
  const costs = snapshotPlainData(requireData(spec, "costs"));
  if (canonicalJsonString(costs) !== canonicalJsonString(descriptor.policy.costAuthority)) {
    refuse("COST_MISMATCH");
  }
  const costModelDigest = requireSha256(
    isPlainRecord(costs) ? requireData(costs, "costModelDigest") : undefined,
    "COST_MISMATCH",
  );
  const universe = snapshotPlainData(requireData(spec, "universe"));
  if (!isPlainRecord(universe)) refuse("UNIVERSE_MISMATCH");
  const pointInTime = requireSha256(
    requireData(universe, "pointInTimeEvidenceSha256"),
    "UNIVERSE_MISMATCH",
  );
  if (
    requireData(universe, "venue") !== "HTX" ||
    requireData(universe, "market") !== "SPOT" ||
    (requireData(universe, "symbol") !== "BTCUSDT" &&
      requireData(universe, "symbol") !== "ETHUSDT") ||
    requireData(universe, "interval") !== "1m" ||
    pointInTime !== descriptor.policy.requestedPointInTimeEvidenceSha256
  ) {
    refuse("UNIVERSE_MISMATCH");
  }
  const orderedTrials = requireData(spec, "orderedTrials");
  if (!Array.isArray(orderedTrials) || orderedTrials.length <= descriptor.trialIndex)
    refuse("PARAMS_MISMATCH");
  const declared = snapshotPlainData(orderedTrials[descriptor.trialIndex]);
  if (canonicalJsonString(parameters) !== canonicalJsonString(declared)) refuse("PARAMS_MISMATCH");
  const partitions = readRecord(spec, "partitions", "PARTITION_MISMATCH");
  const partition = readRecord(payload, "partition", "PARTITION_MISMATCH");
  const partitionContentSha256 = requireSha256(
    requireData(partition, "contentSha256"),
    "PARTITION_MISMATCH",
  );
  const expectedPartition =
    kind === "train"
      ? readRecord(partitions, "train", "PARTITION_MISMATCH")
      : kind === "validation"
        ? readRecord(partitions, "validation", "PARTITION_MISMATCH")
        : (() => {
            const windows = requireData(partitions, "walkForward");
            if (!Array.isArray(windows) || windowIndex >= windows.length)
              refuse("PARTITION_MISMATCH");
            const window = windows[windowIndex];
            if (!isPlainRecord(window)) refuse("PARTITION_MISMATCH");
            return window;
          })();
  if (
    requireSha256(requireData(expectedPartition, "contentSha256"), "PARTITION_MISMATCH") !==
    partitionContentSha256
  ) {
    refuse("PARTITION_MISMATCH");
  }
  const scopeContentDigest = requireSha256(
    requireData(scope, "contentDigest"),
    "STAGE_PAYLOAD_IDENTITY",
  );
  return Object.freeze({
    kind,
    windowIndex,
    payload,
    specSha256,
    parametersSha256: computeStableJsonDigest(parameters),
    costModelDigest,
    universeSha256: computeStableJsonDigest(universe),
    partitionContentSha256,
    scopeContentDigest,
    executableSourceSha256,
  });
}

function assertSameIdentities(stages: readonly ObservedStage[]): void {
  const first = stages[0];
  if (!first) refuse("STAGE_INPUT");
  const seen = new Set<string>();
  let previous: DevelopmentStageKindV1 | null = null;
  let previousWindow = -1;
  for (const stage of stages) {
    const key = stage.kind === "walk-forward" ? `walk-forward:${stage.windowIndex}` : stage.kind;
    if (seen.has(key)) {
      refuse(stage.kind === "validation" ? "REPEATED_VALIDATION_SELECTION" : "REPEATED_STAGE");
    }
    seen.add(key);
    if (previous === "validation" && stage.kind === "train") refuse("STAGE_ORDER");
    if (previous === "walk-forward" && stage.kind !== "walk-forward") refuse("STAGE_ORDER");
    if (
      stage.kind === "walk-forward" &&
      stage.windowIndex <= previousWindow &&
      previous === "walk-forward"
    ) {
      refuse("PARTITION_MISMATCH");
    }
    if (
      stage.specSha256 !== first.specSha256 ||
      stage.parametersSha256 !== first.parametersSha256 ||
      stage.costModelDigest !== first.costModelDigest ||
      stage.universeSha256 !== first.universeSha256 ||
      stage.executableSourceSha256 !== first.executableSourceSha256
    ) {
      if (stage.parametersSha256 !== first.parametersSha256) refuse("PARAMS_MISMATCH");
      if (stage.costModelDigest !== first.costModelDigest) refuse("COST_MISMATCH");
      if (stage.universeSha256 !== first.universeSha256) refuse("UNIVERSE_MISMATCH");
      if (stage.executableSourceSha256 !== first.executableSourceSha256)
        refuse("EVALUATOR_MISMATCH");
      refuse("SPEC_MISMATCH");
    }
    previous = stage.kind;
    if (stage.kind === "walk-forward") previousWindow = stage.windowIndex;
  }
}

function receiptBody(
  input: ObservedStage & {
    organizationId: string;
    attemptId: string;
    trialIndex: number;
    observedDecisionCount: number;
    observedInvocationCount: number;
    observedOrderCount: number;
    observedFillCount: number;
    observedInvocationDigestHex: string;
    finalAccountingDigestHex: string;
  },
) {
  return Object.freeze({
    schemaVersion: RESEARCH_DEVELOPMENT_STAGE_RECEIPT_V1,
    organizationId: input.organizationId,
    attemptId: input.attemptId,
    trialIndex: input.trialIndex,
    stage: input.kind,
    windowIndex: input.windowIndex,
    experimentSpecSha256: input.specSha256,
    executableId: RESEARCH_EXECUTABLE_ID_V1,
    executableSourceSha256: input.executableSourceSha256,
    featureSemantics: FEATURE_SEMANTICS,
    replaySemantics: REPLAY_SEMANTICS,
    parametersSha256: input.parametersSha256,
    costModelDigest: input.costModelDigest,
    universeSha256: input.universeSha256,
    partitionContentSha256: input.partitionContentSha256,
    scopeContentDigest: input.scopeContentDigest,
    observedDecisionCount: input.observedDecisionCount,
    observedInvocationCount: input.observedInvocationCount,
    observedOrderCount: input.observedOrderCount,
    observedFillCount: input.observedFillCount,
    observedInvocationDigestHex: input.observedInvocationDigestHex,
    finalAccountingDigestHex: input.finalAccountingDigestHex,
    capitalEligible: false as const,
    scientificQualified: false as const,
    provenance: "RUNNER_OBSERVED" as const,
  });
}

function sealReceipt(body: ReturnType<typeof receiptBody>): ResearchDevelopmentStageReceiptV1 {
  const contentDigestHex = computeStableJsonDigest(body);
  return Object.freeze({ ...body, contentDigestHex });
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter(isPlainRecord);
  if (isPlainRecord(result) && Array.isArray(result.rows)) return result.rows.filter(isPlainRecord);
  refuse("STORED_RECEIPT_INVALID");
}

function parseStoredValidation(raw: unknown): ResearchDevelopmentStageReceiptV1 {
  if (typeof raw !== "string") refuse("STORED_RECEIPT_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    refuse("STORED_RECEIPT_INVALID");
  }
  if (!isPlainRecord(parsed)) refuse("STORED_RECEIPT_INVALID");
  const { contentDigestHex, ...body } = parsed;
  if (typeof contentDigestHex !== "string" || computeStableJsonDigest(body) !== contentDigestHex) {
    refuse("STORED_RECEIPT_INVALID");
  }
  if (
    body.schemaVersion !== RESEARCH_DEVELOPMENT_STAGE_RECEIPT_V1 ||
    body.stage !== "validation" ||
    body.capitalEligible !== false ||
    body.scientificQualified !== false ||
    body.provenance !== "RUNNER_OBSERVED" ||
    body.executableId !== RESEARCH_EXECUTABLE_ID_V1
  ) {
    refuse("STORED_RECEIPT_INVALID");
  }
  return parsed as ResearchDevelopmentStageReceiptV1;
}

function assertAgainstStoredValidation(
  stored: readonly ResearchDevelopmentStageReceiptV1[],
  stages: readonly ObservedStage[],
  attemptId: string,
  trialIndex: number,
): void {
  if (stored.length > 1) refuse("REPEATED_VALIDATION_SELECTION");
  const existing = stored[0];
  if (!existing) return;
  const includesValidation = stages.some((stage) => stage.kind === "validation");
  if (
    includesValidation ||
    existing.trialIndex !== trialIndex ||
    existing.attemptId !== attemptId
  ) {
    refuse("REPEATED_VALIDATION_SELECTION");
  }
  const observed = stages[0]!;
  if (existing.parametersSha256 !== observed.parametersSha256) refuse("PARAMS_MISMATCH");
  if (existing.costModelDigest !== observed.costModelDigest) refuse("COST_MISMATCH");
  if (existing.universeSha256 !== observed.universeSha256) refuse("UNIVERSE_MISMATCH");
  if (existing.executableSourceSha256 !== observed.executableSourceSha256)
    refuse("EVALUATOR_MISMATCH");
  if (existing.experimentSpecSha256 !== observed.specSha256) refuse("SPEC_MISMATCH");
}

function runnerReceipt(
  stage: ObservedStage,
  result: unknown,
  identity: {
    organizationId: string;
    attemptId: string;
    trialIndex: number;
  },
): ResearchDevelopmentStageReceiptV1 {
  if (!isPlainRecord(result)) refuse("RUNNER_RECEIPT");
  const decisions = requireData(result, "decisions");
  const invocations = requireData(result, "invocations");
  const orderRows = requireData(result, "orderRows");
  const fillDetails = requireData(result, "fillDetails");
  const accounting = requireData(result, "accounting");
  if (
    !Array.isArray(decisions) ||
    !Array.isArray(invocations) ||
    !Array.isArray(orderRows) ||
    !Array.isArray(fillDetails)
  ) {
    refuse("RUNNER_RECEIPT");
  }
  if (!isPlainRecord(accounting)) refuse("RUNNER_RECEIPT");
  const invocationDigests = invocations.map((entry) => {
    if (!isPlainRecord(entry)) refuse("RUNNER_RECEIPT");
    return requireSha256(requireData(entry, "contentDigestHex"), "RUNNER_RECEIPT");
  });
  return sealReceipt(
    receiptBody({
      ...stage,
      ...identity,
      observedDecisionCount: decisions.length,
      observedInvocationCount: invocations.length,
      observedOrderCount: orderRows.length,
      observedFillCount: fillDetails.length,
      observedInvocationDigestHex: computeStableJsonDigest(invocationDigests),
      finalAccountingDigestHex: requireSha256(
        requireData(accounting, "semanticContentDigest"),
        "RUNNER_RECEIPT",
      ),
    }),
  );
}

/**
 * DEVELOPMENT train, validation, and walk-forward may run only through the sealed
 * modeled-stage kernel. The caller supplies an owned executor, a frozen descriptor,
 * a registration sealed before scoring, and already verified stage payloads.
 * Callbacks, mismatched params, evaluator, cost, or universe, late registration,
 * and a second validation selection refuse. Receipts record runner-observed
 * identities. `scientificQualified` and `capitalEligible` stay false. Blind
 * replay is not accepted here.
 */
export async function runBoundDevelopmentModeledStagesV1(
  input: Readonly<{
    executor: OwnedResearchStageExecutorV1;
    descriptor: ResearchModeledStageDescriptorV1;
    registration: ResearchDevelopmentStageRegistrationV1;
    stages: readonly Readonly<{
      kind: DevelopmentStageKindV1;
      windowIndex: number;
      payload: ResearchModeledStageSourceV1;
    }>[];
  }>,
): Promise<readonly ResearchDevelopmentStageReceiptV1[]> {
  if (!isPlainRecord(input) || isProxyLike(input)) refuse("STAGE_INPUT");
  refuseExtraKeys(input, CALL_KEYS);
  const executor = requireData(input, "executor");
  const descriptor = requireData(input, "descriptor");
  const registrationRead = readOwnProperty(input, "registration");
  if (!registrationRead.present || registrationRead.accessor) refuse("LATE_REGISTRATION");
  const registration = registrationRead.value;
  const stagesValue = requireData(input, "stages");
  if (!isPlainRecord(executor) || isProxyLike(executor) || typeof executor.execute !== "function") {
    refuse("STAGE_INPUT");
  }
  if (!isPlainRecord(descriptor) || isProxyLike(descriptor)) refuse("STAGE_INPUT");
  const policy = requireData(descriptor, "policy");
  if (
    !isPlainRecord(policy) ||
    policy.scientificQualified !== false ||
    policy.capitalEligible !== false
  ) {
    refuse("SCIENTIFIC_QUALIFICATION_UNAVAILABLE");
  }
  const attemptId = requireData(descriptor, "attemptId");
  const trialIndex = requireData(descriptor, "trialIndex");
  if (typeof attemptId !== "string" || typeof trialIndex !== "number") refuse("STAGE_INPUT");
  if (!isSealedRegistration(registration)) refuse("LATE_REGISTRATION");
  if (
    registration.attemptId !== attemptId ||
    registration.trialIndex !== trialIndex ||
    registration.committedBeforeScoring !== true
  ) {
    refuse("LATE_REGISTRATION");
  }
  if (!Array.isArray(stagesValue) || stagesValue.length < 1 || stagesValue.length > 1026) {
    refuse("STAGE_INPUT");
  }
  const stages = stagesValue.map((stage) => {
    if (!isPlainRecord(stage) || isProxyLike(stage)) refuse("STAGE_INPUT");
    return observeStage(stage, descriptor as ResearchModeledStageDescriptorV1);
  });
  assertSameIdentities(stages);
  if (stages.some((stage) => stage.specSha256 !== registration.specSha256))
    refuse("LATE_REGISTRATION");
  const organizationId = (() => {
    const scope = readRecord(stages[0]!.payload, "scope", "STAGE_PAYLOAD_IDENTITY");
    const identity = readRecord(scope, "identity", "STAGE_PAYLOAD_IDENTITY");
    const value = requireData(identity, "organizationId");
    if (typeof value !== "string" || !UUID.test(value)) refuse("STAGE_PAYLOAD_IDENTITY");
    return value;
  })();
  const owned = executor as OwnedResearchStageExecutorV1;
  const prior = rowsOf(
    await owned.execute(sql`
    select receipt_canonical_json
    from public.trader_research_development_stage_receipts_v1
    where organization_id = ${organizationId}::uuid
      and attempt_id = ${attemptId}::uuid
      and stage = 'validation'
  `),
  ).map((row) => parseStoredValidation(row.receipt_canonical_json));
  assertAgainstStoredValidation(prior, stages, attemptId, trialIndex);
  const receipts: ResearchDevelopmentStageReceiptV1[] = [];
  for (const stage of stages) {
    const result = await modeledStageKernel.runOwnedResearchModeledStageV1({
      executor: owned,
      descriptor: descriptor as ResearchModeledStageDescriptorV1,
      payload: stage.payload,
    });
    const receipt = runnerReceipt(stage, result, { organizationId, attemptId, trialIndex });
    const canonical = canonicalJsonString(receipt);
    await owned.execute(sql`
      insert into public.trader_research_development_stage_receipts_v1 (
        organization_id, attempt_id, trial_index, stage, window_index,
        receipt_canonical_json, receipt_sha256
      ) values (
        ${organizationId}::uuid, ${attemptId}::uuid, ${trialIndex},
        ${stage.kind}, ${stage.windowIndex}, ${canonical}, ${receipt.contentDigestHex}
      )
    `);
    receipts.push(receipt);
  }
  return Object.freeze(receipts);
}
