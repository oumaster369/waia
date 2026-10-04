import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { randomUUID } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import { sql } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertModelMatchesD5 } from "@/lib/trader/execution/historical-execution-model";
import { captureHistoricalMockLedgerScope, type HistoricalMockLedgerScope } from "@/lib/trader/execution/historical-mock-ledger-scope";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";
import { RESEARCH_EXECUTABLE_ID_V1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
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
const FORBIDDEN_SNAPSHOT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
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

/** Committed claim that the validation identity is already taken. Not a score. */
const VALIDATION_RESERVATION_V1 =
  "waia.research.development-stage-validation-reservation.v1" as const;

export type DevelopmentStageKindV1 = "train" | "validation" | "walk-forward";

/** In-process registration assertion. A copied object is rejected; this token
 * alone does not prove durable preregistration or source disclosure order. */
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
  historicalExecutionModelSha256: string;
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
  organizationId: string;
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
  historicalExecutionModelSha256: string;
  ledgerScope: HistoricalMockLedgerScope;
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
    const names = Object.getOwnPropertyNames(value);
    const indexes = new Set<string>();
    for (const name of names) {
      if (name === "length") continue;
      if (FORBIDDEN_SNAPSHOT_KEYS.has(name) || !/^(?:0|[1-9]\d*)$/.test(name)) {
        refuse("STAGE_PAYLOAD");
      }
      if (Number(name) >= lengthRead.value) refuse("STAGE_PAYLOAD");
      indexes.add(name);
    }
    if (indexes.size !== lengthRead.value || Object.getOwnPropertySymbols(value).length !== 0) {
      refuse("STAGE_PAYLOAD");
    }
    const copy: unknown[] = [];
    for (let index = 0; index < lengthRead.value; index += 1) {
      const entry = readOwnProperty(value, String(index));
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry.present || entry.accessor || !property?.enumerable) refuse("STAGE_PAYLOAD");
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
      FORBIDDEN_SNAPSHOT_KEYS.has(name) ||
      !property ||
      !property.enumerable ||
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
  if (Object.getPrototypeOf(record) !== Object.prototype) refuse("UNTRUSTED_STAGE_INPUT");
  if (Object.getOwnPropertySymbols(record).length !== 0) refuse("UNTRUSTED_STAGE_INPUT");
  for (const key of Object.getOwnPropertyNames(record)) {
    if (FORGED_CALLBACK_KEYS.has(key)) refuse("FORGED_CALLBACK");
    if (!allowed.has(key)) refuse("UNTRUSTED_STAGE_INPUT");
    const property = Object.getOwnPropertyDescriptor(record, key);
    if (!property?.enumerable) refuse("UNTRUSTED_STAGE_INPUT");
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
  if (
    isProxyLike(input) ||
    !isPlainRecord(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    refuse("LATE_REGISTRATION");
  }
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

function observeStage(
  stage: object,
  descriptor: ResearchModeledStageDescriptorV1,
  runtimeIdentity: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>,
  actualModelSha256: string,
): ObservedStage {
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
  if (
    isProxyLike(payloadValue) ||
    !isPlainRecord(payloadValue) ||
    Object.getPrototypeOf(payloadValue) !== Object.prototype
  ) {
    refuse("STAGE_PAYLOAD");
  }
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
  const specOrganizationId = requireData(spec, "organizationId");
  const ledgerScope = readRecord(scope, "ledgerScope", "STAGE_PAYLOAD_IDENTITY");
  const ledgerOrganizationId = requireData(ledgerScope, "organizationId");
  if (
    typeof specOrganizationId !== "string" ||
    !UUID.test(specOrganizationId) ||
    specOrganizationId.toLowerCase() !== organizationId.toLowerCase() ||
    typeof ledgerOrganizationId !== "string" ||
    !UUID.test(ledgerOrganizationId) ||
    ledgerOrganizationId.toLowerCase() !== organizationId.toLowerCase()
  ) {
    refuse("STAGE_PAYLOAD_IDENTITY");
  }
  let checkedLedgerScope: HistoricalMockLedgerScope;
  try {
    checkedLedgerScope = captureHistoricalMockLedgerScope(ledgerScope as HistoricalMockLedgerScope);
  } catch {
    refuse("STAGE_LEDGER_SCOPE");
  }
  const specSha256 = computeStableJsonDigest(spec);
  const replay = readRecord(spec, "replay", "REPLAY_MODEL_MISMATCH");
  const declaredModelSha256 = requireSha256(
    requireData(replay, "historicalExecutionModelSha256"),
    "REPLAY_MODEL_MISMATCH",
  );
  if (
    declaredModelSha256 !== descriptor.policy.historicalExecutionModelSha256 ||
    declaredModelSha256 !== actualModelSha256
  ) {
    refuse("REPLAY_MODEL_MISMATCH");
  }
  const executable = readRecord(spec, "executable", "EVALUATOR_MISMATCH");
  const executableId = requireData(executable, "id");
  const featureSemantics = requireData(executable, "featureSemantics");
  const replaySemantics = requireData(executable, "replaySemantics");
  const executableSourceSha256 = requireSha256(
    requireData(executable, "sourceSha256"),
    "EVALUATOR_MISMATCH",
  );
  if (
    executableId !== runtimeIdentity.executableId ||
    featureSemantics !== runtimeIdentity.featureSemantics ||
    replaySemantics !== runtimeIdentity.replaySemantics ||
    executableSourceSha256 !== runtimeIdentity.sourceSha256 ||
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
    organizationId: organizationId.toLowerCase(),
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
    historicalExecutionModelSha256: actualModelSha256,
    ledgerScope: checkedLedgerScope,
  });
}

function assertSameIdentities(stages: readonly ObservedStage[]): void {
  const first = stages[0];
  if (!first) refuse("STAGE_INPUT");
  const seen = new Set<string>();
  const ledgerRuns = new Set<string>();
  const ledgerAccounts = new Set<string>();
  let previous: DevelopmentStageKindV1 | null = null;
  let previousWindow = -1;
  for (const stage of stages) {
    if (stage.organizationId !== first.organizationId) refuse("STAGE_PAYLOAD_IDENTITY");
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
    // Some mock projections are account-key scoped. A distinct run alone does
    // not isolate stages; both namespaces must differ before any reservation.
    if (ledgerRuns.has(stage.ledgerScope.historicalRunId) ||
        ledgerAccounts.has(stage.ledgerScope.historicalAccountKey)) {
      refuse("STAGE_LEDGER_REUSED");
    }
    ledgerRuns.add(stage.ledgerScope.historicalRunId);
    ledgerAccounts.add(stage.ledgerScope.historicalAccountKey);
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
    historicalExecutionModelSha256: input.historicalExecutionModelSha256,
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
    body.executableId !== RESEARCH_EXECUTABLE_ID_V1 ||
    typeof body.historicalExecutionModelSha256 !== "string" ||
    !SHA256.test(body.historicalExecutionModelSha256)
  ) {
    refuse("STORED_RECEIPT_INVALID");
  }
  return parsed as ResearchDevelopmentStageReceiptV1;
}

type StoredValidationV1 =
  | { readonly kind: "receipt"; readonly receipt: ResearchDevelopmentStageReceiptV1 }
  | { readonly kind: "reservation"; readonly token: string; readonly digest: string };

function readStoredValidation(raw: unknown): StoredValidationV1 {
  if (typeof raw !== "string") refuse("STORED_RECEIPT_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    refuse("STORED_RECEIPT_INVALID");
  }
  if (!isPlainRecord(parsed)) refuse("STORED_RECEIPT_INVALID");
  if (parsed.schemaVersion === VALIDATION_RESERVATION_V1) {
    const digest = parsed.reservationDigestHex;
    const body: Record<string, unknown> = {};
    for (const name of Object.getOwnPropertyNames(parsed)) {
      if (name === "reservationDigestHex") continue;
      const property = Object.getOwnPropertyDescriptor(parsed, name);
      if (
        !property ||
        property.get !== undefined ||
        property.set !== undefined ||
        !("value" in property)
      ) {
        refuse("STORED_RECEIPT_INVALID");
      }
      body[name] = property.value;
    }
    if (typeof digest !== "string" || computeStableJsonDigest(body) !== digest) {
      refuse("STORED_RECEIPT_INVALID");
    }
    if (
      body.stage !== "validation" ||
      body.capitalEligible !== false ||
      body.scientificQualified !== false ||
      body.provenance !== "VALIDATION_RESERVATION" ||
      typeof body.reservationToken !== "string" ||
      !UUID.test(body.reservationToken)
    ) {
      refuse("STORED_RECEIPT_INVALID");
    }
    return { kind: "reservation", token: body.reservationToken, digest };
  }
  return { kind: "receipt", receipt: parseStoredValidation(raw) };
}

function reservationRecord(
  identity: { organizationId: string; attemptId: string; trialIndex: number },
  token: string,
): { readonly canonical: string; readonly digest: string } {
  const body = Object.freeze({
    schemaVersion: VALIDATION_RESERVATION_V1,
    organizationId: identity.organizationId,
    attemptId: identity.attemptId,
    trialIndex: identity.trialIndex,
    stage: "validation" as const,
    reservationToken: token,
    capitalEligible: false as const,
    scientificQualified: false as const,
    provenance: "VALIDATION_RESERVATION" as const,
  });
  const digest = computeStableJsonDigest(body);
  return {
    canonical: canonicalJsonString({ ...body, reservationDigestHex: digest }),
    digest,
  };
}

/** Empty storage may be claimed. A foreign claim or a finished receipt may not. */
function assertStoredValidation(
  stored: readonly StoredValidationV1[],
  stages: readonly ObservedStage[],
  attemptId: string,
  trialIndex: number,
  reservationToken: string | null,
): string | null {
  if (stored.length > 1) refuse("REPEATED_VALIDATION_SELECTION");
  const existing = stored[0];
  if (!existing) {
    if (reservationToken !== null) refuse("REPEATED_VALIDATION_SELECTION");
    return null;
  }
  if (existing.kind === "reservation") {
    if (reservationToken === null || existing.token !== reservationToken) {
      refuse("REPEATED_VALIDATION_SELECTION");
    }
    return existing.digest;
  }
  const receipt = existing.receipt;
  const includesValidation = stages.some((stage) => stage.kind === "validation");
  if (includesValidation || receipt.trialIndex !== trialIndex || receipt.attemptId !== attemptId) {
    refuse("REPEATED_VALIDATION_SELECTION");
  }
  const observed = stages[0]!;
  if (receipt.parametersSha256 !== observed.parametersSha256) refuse("PARAMS_MISMATCH");
  if (receipt.costModelDigest !== observed.costModelDigest) refuse("COST_MISMATCH");
  if (receipt.universeSha256 !== observed.universeSha256) refuse("UNIVERSE_MISMATCH");
  if (receipt.executableSourceSha256 !== observed.executableSourceSha256) {
    refuse("EVALUATOR_MISMATCH");
  }
  if (receipt.historicalExecutionModelSha256 !== observed.historicalExecutionModelSha256) {
    refuse("REPLAY_MODEL_MISMATCH");
  }
  if (receipt.experimentSpecSha256 !== observed.specSha256) refuse("SPEC_MISMATCH");
  return null;
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

function snapshotStageList(value: unknown): readonly object[] {
  if (isProxyLike(value)) refuse("STAGE_INPUT");
  if (typeof value !== "object" || value === null) refuse("STAGE_INPUT");
  if (Object.getPrototypeOf(value) !== Array.prototype) refuse("STAGE_INPUT");
  const lengthRead = readOwnProperty(value, "length");
  if (
    !lengthRead.present ||
    lengthRead.accessor ||
    typeof lengthRead.value !== "number" ||
    !Number.isSafeInteger(lengthRead.value) ||
    lengthRead.value < 1 ||
    lengthRead.value > 1026
  ) {
    refuse("STAGE_INPUT");
  }
  const length = lengthRead.value;
  const names = Object.getOwnPropertyNames(value);
  const indexes = new Set<string>();
  for (const name of names) {
    if (name === "length") continue;
    if (!/^(?:0|[1-9]\d*)$/.test(name)) refuse("STAGE_INPUT");
    const index = Number(name);
    if (index >= length) refuse("STAGE_INPUT");
    indexes.add(name);
  }
  if (indexes.size !== length || Object.getOwnPropertySymbols(value).length !== 0) {
    refuse("STAGE_INPUT");
  }
  const copy: object[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = readOwnProperty(value, String(index));
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !entry.present ||
      entry.accessor ||
      !property?.enumerable ||
      isProxyLike(entry.value) ||
      !isPlainRecord(entry.value) ||
      Object.getPrototypeOf(entry.value) !== Object.prototype
    ) {
      refuse("STAGE_INPUT");
    }
    copy.push(entry.value);
  }
  return copy;
}

function refuseUnlessFalseData(
  record: object,
  key: "scientificQualified" | "capitalEligible",
): void {
  const property = Object.getOwnPropertyDescriptor(record, key);
  if (
    !property ||
    property.get !== undefined ||
    property.set !== undefined ||
    !("value" in property) ||
    property.value !== false
  ) {
    refuse("SCIENTIFIC_QUALIFICATION_UNAVAILABLE");
  }
}

async function lockValidationIdentity(
  tx: OwnedResearchStageExecutorV1,
  organizationId: string,
  attemptId: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(
      ${`research-development-validation-v1:${organizationId}:${attemptId}`}, 0
    ))
  `);
}

async function readValidationRows(
  tx: OwnedResearchStageExecutorV1,
  organizationId: string,
  attemptId: string,
): Promise<readonly StoredValidationV1[]> {
  return rowsOf(
    await tx.execute(sql`
      select receipt_canonical_json
      from public.trader_research_development_stage_receipts_v1
      where organization_id = ${organizationId}::uuid
        and attempt_id = ${attemptId}::uuid
        and stage = 'validation'
    `),
  ).map((row) => readStoredValidation(row.receipt_canonical_json));
}

/**
 * DEVELOPMENT train, validation, and walk-forward may run only through the sealed
 * modeled-stage kernel. The caller supplies a root database, a frozen descriptor,
 * an in-process registration assertion, and stage payloads. The production owner
 * must still establish durable preregistration and source provenance before use.
 * Callbacks, mismatched params, evaluator, cost, or universe, late registration,
 * and a second validation selection refuse. Receipts record runner-observed
 * identities. `scientificQualified` and `capitalEligible` stay false. Blind
 * replay is not accepted here.
 */
export async function runBoundDevelopmentModeledStagesV1(
  input: Readonly<{
    executor: WaiaPostgresDb;
    descriptor: ResearchModeledStageDescriptorV1;
    registration: ResearchDevelopmentStageRegistrationV1;
    stages: readonly Readonly<{
      kind: DevelopmentStageKindV1;
      windowIndex: number;
      payload: ResearchModeledStageSourceV1;
    }>[];
  }>,
): Promise<readonly ResearchDevelopmentStageReceiptV1[]> {
  if (
    isProxyLike(input) ||
    !isPlainRecord(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    refuse("STAGE_INPUT");
  }
  const suppliedExecutor = readOwnProperty(input, "executor");
  if (!suppliedExecutor.present || suppliedExecutor.accessor) refuse("STAGE_INPUT");
  const db = suppliedExecutor.value;
  if (isProxyLike(db)) refuse("STAGE_INPUT");
  assertResearchRootPostgresDbV1(db);
  refuseExtraKeys(input, CALL_KEYS);
  const executor = requireData(input, "executor");
  const descriptor = requireData(input, "descriptor");
  try {
    modeledStageKernel.assertSealedResearchModeledStageDescriptorV1(descriptor);
  } catch {
    refuse("STAGE_DESCRIPTOR");
  }
  const registrationRead = readOwnProperty(input, "registration");
  if (!registrationRead.present || registrationRead.accessor) refuse("LATE_REGISTRATION");
  const registration = registrationRead.value;
  const stagesValue = requireData(input, "stages");
  if (!isPlainRecord(descriptor) || isProxyLike(descriptor)) refuse("STAGE_INPUT");
  const policy = requireData(descriptor, "policy");
  if (!isPlainRecord(policy) || isProxyLike(policy)) refuse("STAGE_INPUT");
  refuseUnlessFalseData(policy, "scientificQualified");
  refuseUnlessFalseData(policy, "capitalEligible");
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
  const runtimeIdentity = resolveCurrentResearchExecutableIdentityV1();
  const actualModelSha256 = computeStableJsonDigest(requireData(descriptor, "model"));
  if (
    actualModelSha256 !== descriptor.policy.historicalExecutionModelSha256 ||
    !SHA256.test(actualModelSha256)
  ) {
    refuse("REPLAY_MODEL_MISMATCH");
  }
  try {
    assertModelMatchesD5(requireData(descriptor, "model") as Parameters<typeof assertModelMatchesD5>[0]);
  } catch {
    refuse("REPLAY_MODEL_MISMATCH");
  }
  const stageList = snapshotStageList(stagesValue);
  const stages = stageList.map((stage) =>
    observeStage(
      stage,
      descriptor as ResearchModeledStageDescriptorV1,
      runtimeIdentity,
      actualModelSha256,
    ),
  );
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
  if (executor !== db) refuse("STAGE_INPUT");
  const includesValidation = stages.some((stage) => stage.kind === "validation");
  const reservationToken = includesValidation ? randomUUID() : null;
  const identity = { organizationId, attemptId, trialIndex };
  // The receipt table has no journal migration, so uniqueness is not enforced by
  // schema. This claim commits under the advisory lock before any stage score.
  if (reservationToken !== null) {
    const claim = reservationRecord(identity, reservationToken);
    await db.transaction(async (tx) => {
      await lockValidationIdentity(tx, organizationId, attemptId);
      const stored = await readValidationRows(tx, organizationId, attemptId);
      assertStoredValidation(stored, stages, attemptId, trialIndex, null);
      await tx.execute(sql`
        insert into public.trader_research_development_stage_receipts_v1 (
          organization_id, attempt_id, trial_index, stage, window_index,
          receipt_canonical_json, receipt_sha256
        ) values (
          ${organizationId}::uuid, ${attemptId}::uuid, ${trialIndex},
          'validation', 0, ${claim.canonical}, ${claim.digest}
        )
      `);
    });
  }
  return db.transaction(async (tx) => {
    await lockValidationIdentity(tx, organizationId, attemptId);
    const stored = await readValidationRows(tx, organizationId, attemptId);
    const reservationDigest = assertStoredValidation(
      stored,
      stages,
      attemptId,
      trialIndex,
      reservationToken,
    );
    const receipts: ResearchDevelopmentStageReceiptV1[] = [];
    for (const stage of stages) {
      const result = await modeledStageKernel.runOwnedResearchModeledStageV1({
        executor: tx,
        descriptor: descriptor as ResearchModeledStageDescriptorV1,
        payload: stage.payload,
      });
      const receipt = runnerReceipt(stage, result, identity);
      const canonical = canonicalJsonString(receipt);
      if (stage.kind === "validation") {
        if (reservationDigest === null) refuse("REPEATED_VALIDATION_SELECTION");
        const updated = rowsOf(
          await tx.execute(sql`
            update public.trader_research_development_stage_receipts_v1
            set trial_index = ${trialIndex},
                window_index = ${stage.windowIndex},
                receipt_canonical_json = ${canonical},
                receipt_sha256 = ${receipt.contentDigestHex}
            where organization_id = ${organizationId}::uuid
              and attempt_id = ${attemptId}::uuid
              and stage = 'validation'
              and receipt_sha256 = ${reservationDigest}
            returning receipt_sha256
          `),
        );
        if (updated.length !== 1) refuse("REPEATED_VALIDATION_SELECTION");
      } else {
        await tx.execute(sql`
          insert into public.trader_research_development_stage_receipts_v1 (
            organization_id, attempt_id, trial_index, stage, window_index,
            receipt_canonical_json, receipt_sha256
          ) values (
            ${organizationId}::uuid, ${attemptId}::uuid, ${trialIndex},
            ${stage.kind}, ${stage.windowIndex}, ${canonical}, ${receipt.contentDigestHex}
          )
        `);
      }
      receipts.push(receipt);
    }
    return Object.freeze(receipts);
  });
}
