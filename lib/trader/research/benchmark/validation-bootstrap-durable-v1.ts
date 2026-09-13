import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import {
  CBRNG_DOMAIN_VALBOOT1,
  SAMPLER_CONTRACT_VERSION,
  VALIDATION_BOOTSTRAP_ROOT_PREFIX_16,
} from "../../intelligence/forecast-v2/constants";
import { MANDATORY_BASELINE_IDS } from "./baseline-models-v1";
import { holmFwerV1, type HolmComparison } from "./holm-fwer-v1";
import {
  deriveValidationBootstrapRoot,
  VALIDATION_BOOTSTRAP_B,
  VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
  VALIDATION_BOOTSTRAP_RANGE_SIZE,
  VALIDATION_BOOTSTRAP_VERSION,
  type ValidationBootstrapNullCenteredResultV1,
} from "./validation-bootstrap-v1";

export const VALIDATION_BOOTSTRAP_DURABLE_RECORD_VERSION =
  "validation-bootstrap-durable-range/v1" as const;
export const VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION =
  "validation-bootstrap-durable-scheduler/v1" as const;
export const VALIDATION_BOOTSTRAP_DURABLE_RESULT_VERSION =
  "validation-bootstrap-durable-result/v1" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RELEASE_SHA = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SURFACE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const NATIVE_MAGIC = "WAIAVB01";
const NATIVE_EXPERIMENT = "native-bootstrap-range-experiment/v1";

export type MandatoryBaselineIdV1 = (typeof MANDATORY_BASELINE_IDS)[number];

export type DeclaredHistoricalRunTupleV1 = Readonly<{
  organizationId: string;
  runId: string;
  releaseSha: string;
}>;

export type ValidationBootstrapSchedulerRuntimeIdentityV1 = Readonly<{
  version: typeof VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION;
  runtime: Readonly<{ node: string; os: string; arch: string }>;
}>;

export type ValidationBootstrapRngIdentityV1 = Readonly<{
  domain: typeof CBRNG_DOMAIN_VALBOOT1;
  samplerContractVersion: typeof SAMPLER_CONTRACT_VERSION;
  rootPrefix: typeof VALIDATION_BOOTSTRAP_ROOT_PREFIX_16;
}>;

export type ValidationBootstrapDurableRangeIdentityV1 = Readonly<{
  declaredTuple: DeclaredHistoricalRunTupleV1;
  surface: string;
  baseline: MandatoryBaselineIdV1;
  trialIdentityDigestHex: string;
  inputDigestHex: string;
  rootSeedHex: string;
  start: number;
  endExclusive: number;
}>;

export type ValidationBootstrapSealedRangeRecordV1 = Readonly<{
  schemaVersion: typeof VALIDATION_BOOTSTRAP_DURABLE_RECORD_VERSION;
  bootstrapVersion: typeof VALIDATION_BOOTSTRAP_VERSION;
  R: typeof VALIDATION_BOOTSTRAP_B;
  surface: string;
  baseline: MandatoryBaselineIdV1;
  trialIdentityDigestHex: string;
  inputDigestHex: string;
  rootSeedHex: string;
  rngIdentity: ValidationBootstrapRngIdentityV1;
  start: number;
  endExclusive: number;
  extremeCount: number;
  n: number;
  dBarBits: string;
  tObsBits: string;
  centeredMeanBits: string;
  resultDigestHex: string;
  schedulerIdentity: ValidationBootstrapSchedulerRuntimeIdentityV1;
  declaredTuple: DeclaredHistoricalRunTupleV1;
}>;

export interface ValidationBootstrapDurableStoreV1 {
  declaredTuple(): DeclaredHistoricalRunTupleV1;
  bindRequestTuple(tuple: DeclaredHistoricalRunTupleV1): void;
  loadSealedRange(
    identity: ValidationBootstrapDurableRangeIdentityV1,
  ): ValidationBootstrapSealedRangeRecordV1 | null;
  sealRange(record: ValidationBootstrapSealedRangeRecordV1): void;
  listSealedRanges(
    identity: Omit<ValidationBootstrapDurableRangeIdentityV1, "start" | "endExclusive">,
  ): readonly ValidationBootstrapSealedRangeRecordV1[];
}

function fail(reason: string): never {
  throw new Error(`VALIDATION_BOOTSTRAP_DURABLE_REFUSED:${reason}`);
}

function ieee754BitsBE(value: number): string {
  if (!Number.isFinite(value)) fail("NON_FINITE_STATISTIC");
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(value);
  return bytes.toString("hex");
}

function readIeee754BitsBE(bits: string): number {
  if (!/^[0-9a-f]{16}$/.test(bits)) fail("STATISTIC_BITS");
  return Buffer.from(bits, "hex").readDoubleBE();
}

export function assertDeclaredHistoricalRunTupleV1(
  tuple: DeclaredHistoricalRunTupleV1,
): DeclaredHistoricalRunTupleV1 {
  if (!UUID.test(tuple.organizationId)) fail("ORGANIZATION_ID");
  if (!RUN_ID.test(tuple.runId)) fail("RUN_ID");
  if (!RELEASE_SHA.test(tuple.releaseSha)) fail("RELEASE_SHA");
  return Object.freeze({
    organizationId: tuple.organizationId,
    runId: tuple.runId,
    releaseSha: tuple.releaseSha.toLowerCase(),
  });
}

export function assertDeclaredHistoricalRunTupleMatchV1(
  bound: DeclaredHistoricalRunTupleV1,
  requested: DeclaredHistoricalRunTupleV1,
): void {
  const expected = assertDeclaredHistoricalRunTupleV1(bound);
  const actual = assertDeclaredHistoricalRunTupleV1(requested);
  if (
    expected.organizationId !== actual.organizationId ||
    expected.runId !== actual.runId ||
    expected.releaseSha !== actual.releaseSha
  ) {
    fail("DECLARED_TUPLE_MISMATCH");
  }
}

export function assertMandatoryBaselineIdV1(value: string): MandatoryBaselineIdV1 {
  if (!(MANDATORY_BASELINE_IDS as readonly string[]).includes(value)) fail("BASELINE");
  return value as MandatoryBaselineIdV1;
}

export function assertDurableSurfaceV1(value: string): string {
  if (!SURFACE.test(value)) fail("SURFACE");
  return value;
}

function assertHex64(value: string, reason: string): string {
  if (!HEX64.test(value)) fail(reason);
  return value;
}

export function digestValidationBootstrapInputV1(differentials: readonly number[]): string {
  const hash = createHash("sha256");
  hash.update(`f64be:${differentials.length}:`);
  const bytes = Buffer.alloc(8);
  for (let i = 0; i < differentials.length; i += 1) {
    const value = differentials[i];
    if (typeof value !== "number" || !Number.isFinite(value)) fail("INPUT_NUMBER");
    bytes.writeDoubleBE(value);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function validationBootstrapRngIdentityV1(): ValidationBootstrapRngIdentityV1 {
  return Object.freeze({
    domain: CBRNG_DOMAIN_VALBOOT1,
    samplerContractVersion: SAMPLER_CONTRACT_VERSION,
    rootPrefix: VALIDATION_BOOTSTRAP_ROOT_PREFIX_16,
  });
}

export function validationBootstrapSchedulerRuntimeIdentityV1(): ValidationBootstrapSchedulerRuntimeIdentityV1 {
  if (
    typeof process === "undefined" ||
    process.release?.name !== "node" ||
    !process.versions?.node
  ) {
    fail("NODE_RUNTIME");
  }
  return Object.freeze({
    version: VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION,
    runtime: Object.freeze({
      node: process.version,
      os: process.platform,
      arch: process.arch,
    }),
  });
}

export function partitionValidationBootstrapDurableRangesV1(): readonly Readonly<{
  start: number;
  endExclusive: number;
}>[] {
  if (VALIDATION_BOOTSTRAP_B % VALIDATION_BOOTSTRAP_RANGE_SIZE !== 0) fail("RANGE_SIZE");
  const ranges: Array<Readonly<{ start: number; endExclusive: number }>> = [];
  for (let start = 0; start < VALIDATION_BOOTSTRAP_B; start += VALIDATION_BOOTSTRAP_RANGE_SIZE) {
    ranges.push(
      Object.freeze({
        start,
        endExclusive: start + VALIDATION_BOOTSTRAP_RANGE_SIZE,
      }),
    );
  }
  return Object.freeze(ranges);
}

export function computeValidationBootstrapRangeResultDigestV1(
  input: Readonly<{
    trialIdentityDigestHex: string;
    inputDigestHex: string;
    rootSeedHex: string;
    start: number;
    endExclusive: number;
    extremeCount: number;
    n: number;
    dBarBits: string;
    tObsBits: string;
    centeredMeanBits: string;
  }>,
): string {
  return createHash("sha256")
    .update(
      [
        VALIDATION_BOOTSTRAP_DURABLE_RESULT_VERSION,
        VALIDATION_BOOTSTRAP_VERSION,
        String(VALIDATION_BOOTSTRAP_B),
        CBRNG_DOMAIN_VALBOOT1,
        input.trialIdentityDigestHex,
        input.inputDigestHex,
        input.rootSeedHex,
        String(input.start),
        String(input.endExclusive),
        String(input.extremeCount),
        String(input.n),
        input.dBarBits,
        input.tObsBits,
        input.centeredMeanBits,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

export function durableRangeIdentityKeyV1(
  identity: ValidationBootstrapDurableRangeIdentityV1,
  schedulerIdentity = validationBootstrapSchedulerRuntimeIdentityV1(),
): string {
  const tuple = assertDeclaredHistoricalRunTupleV1(identity.declaredTuple);
  return createHash("sha256")
    .update(
      [
        VALIDATION_BOOTSTRAP_DURABLE_RECORD_VERSION,
        schedulerIdentity.version,
        schedulerIdentity.runtime.node,
        schedulerIdentity.runtime.os,
        schedulerIdentity.runtime.arch,
        tuple.organizationId,
        tuple.runId,
        tuple.releaseSha,
        assertDurableSurfaceV1(identity.surface),
        assertMandatoryBaselineIdV1(identity.baseline),
        assertHex64(identity.trialIdentityDigestHex, "TRIAL"),
        assertHex64(identity.inputDigestHex, "INPUT"),
        assertHex64(identity.rootSeedHex, "ROOT"),
        String(VALIDATION_BOOTSTRAP_B),
        String(identity.start),
        String(identity.endExclusive),
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

function assertAlignedRange(start: number, endExclusive: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endExclusive) ||
    start < 0 ||
    start >= endExclusive ||
    endExclusive > VALIDATION_BOOTSTRAP_B ||
    start % VALIDATION_BOOTSTRAP_RANGE_SIZE !== 0 ||
    endExclusive - start !== VALIDATION_BOOTSTRAP_RANGE_SIZE
  ) {
    fail("RANGE_SIZE");
  }
}

function assertNoWorkerFields(value: object): void {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (/worker/i.test(key) || key === "WAIA_FHV_VALIDATION_WORKERS")
      fail("WORKER_COUNT_FORBIDDEN");
  }
  const scheduler = record.schedulerIdentity;
  if (scheduler && typeof scheduler === "object") {
    for (const key of Object.keys(scheduler as object)) {
      if (/worker/i.test(key)) fail("WORKER_COUNT_FORBIDDEN");
    }
  }
}

export function refuseNativeBootstrapLedgerAdmissionV1(input: unknown): void {
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 8) fail("NATIVE_LEDGER");
    if (value == null) return;
    if (typeof value === "string") {
      if (
        value.startsWith(NATIVE_MAGIC) ||
        value.includes(NATIVE_EXPERIMENT) ||
        value.includes("NATIVE_BOOTSTRAP")
      ) {
        throw new Error("VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED");
      }
      return;
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const magic = Buffer.from(value.subarray(0, 8)).toString("ascii");
      if (magic === NATIVE_MAGIC) throw new Error("VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED");
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      record.version === NATIVE_EXPERIMENT ||
      record.schemaVersion === NATIVE_EXPERIMENT ||
      (record.admission === "NOT_ESTABLISHED" && typeof record.statisticDigest === "string") ||
      record.nativeLedger != null
    ) {
      throw new Error("VALIDATION_BOOTSTRAP_NATIVE_LEDGER_REFUSED");
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    }
  };
  visit(input);
}

export function sealValidationBootstrapRangeRecordV1(
  input: Readonly<{
    declaredTuple: DeclaredHistoricalRunTupleV1;
    surface: string;
    baseline: string;
    trialIdentityDigest32: Buffer;
    differentials: readonly number[];
    start: number;
    endExclusive: number;
    extremeCount: number;
    n: number;
    dBar: number;
    tObs: number;
    centeredMean: number;
    schedulerIdentity?: ValidationBootstrapSchedulerRuntimeIdentityV1;
  }>,
): ValidationBootstrapSealedRangeRecordV1 {
  refuseNativeBootstrapLedgerAdmissionV1(input);
  assertAlignedRange(input.start, input.endExclusive);
  if (input.trialIdentityDigest32.length !== 32) fail("TRIAL");
  if (
    !Number.isSafeInteger(input.extremeCount) ||
    input.extremeCount < 0 ||
    input.extremeCount > VALIDATION_BOOTSTRAP_RANGE_SIZE
  )
    fail("EXTREME_COUNT");
  const declaredTuple = assertDeclaredHistoricalRunTupleV1(input.declaredTuple);
  const trialIdentityDigestHex = input.trialIdentityDigest32.toString("hex");
  const inputDigestHex = digestValidationBootstrapInputV1(input.differentials);
  const rootSeedHex = deriveValidationBootstrapRoot(input.trialIdentityDigest32).toString("hex");
  const dBarBits = ieee754BitsBE(input.dBar);
  const tObsBits = ieee754BitsBE(input.tObs);
  const centeredMeanBits = ieee754BitsBE(input.centeredMean);
  const resultDigestHex = computeValidationBootstrapRangeResultDigestV1({
    trialIdentityDigestHex,
    inputDigestHex,
    rootSeedHex,
    start: input.start,
    endExclusive: input.endExclusive,
    extremeCount: input.extremeCount,
    n: input.n,
    dBarBits,
    tObsBits,
    centeredMeanBits,
  });
  const record: ValidationBootstrapSealedRangeRecordV1 = Object.freeze({
    schemaVersion: VALIDATION_BOOTSTRAP_DURABLE_RECORD_VERSION,
    bootstrapVersion: VALIDATION_BOOTSTRAP_VERSION,
    R: VALIDATION_BOOTSTRAP_B,
    surface: assertDurableSurfaceV1(input.surface),
    baseline: assertMandatoryBaselineIdV1(input.baseline),
    trialIdentityDigestHex,
    inputDigestHex,
    rootSeedHex,
    rngIdentity: validationBootstrapRngIdentityV1(),
    start: input.start,
    endExclusive: input.endExclusive,
    extremeCount: input.extremeCount,
    n: input.n,
    dBarBits,
    tObsBits,
    centeredMeanBits,
    resultDigestHex,
    schedulerIdentity: input.schedulerIdentity ?? validationBootstrapSchedulerRuntimeIdentityV1(),
    declaredTuple,
  });
  assertNoWorkerFields(record);
  return record;
}

export function assertValidationBootstrapSealedRangeRecordV1(
  record: ValidationBootstrapSealedRangeRecordV1,
): ValidationBootstrapSealedRangeRecordV1 {
  refuseNativeBootstrapLedgerAdmissionV1(record);
  assertNoWorkerFields(record);
  if (record.schemaVersion !== VALIDATION_BOOTSTRAP_DURABLE_RECORD_VERSION) fail("SCHEMA");
  if (record.bootstrapVersion !== VALIDATION_BOOTSTRAP_VERSION) fail("BOOTSTRAP_VERSION");
  if (record.R !== VALIDATION_BOOTSTRAP_B) fail("R");
  if (record.schedulerIdentity.version !== VALIDATION_BOOTSTRAP_DURABLE_SCHEDULER_VERSION) {
    fail("SCHEDULER");
  }
  assertAlignedRange(record.start, record.endExclusive);
  assertDeclaredHistoricalRunTupleV1(record.declaredTuple);
  assertDurableSurfaceV1(record.surface);
  assertMandatoryBaselineIdV1(record.baseline);
  assertHex64(record.trialIdentityDigestHex, "TRIAL");
  assertHex64(record.inputDigestHex, "INPUT");
  assertHex64(record.rootSeedHex, "ROOT");
  if (
    !Number.isSafeInteger(record.extremeCount) ||
    record.extremeCount < 0 ||
    record.extremeCount > VALIDATION_BOOTSTRAP_RANGE_SIZE
  )
    fail("EXTREME_COUNT");
  if (!Number.isSafeInteger(record.n) || record.n < 1) fail("N");
  const expected = computeValidationBootstrapRangeResultDigestV1(record);
  if (expected !== record.resultDigestHex) fail("RESULT_DIGEST");
  if (
    record.rngIdentity.domain !== CBRNG_DOMAIN_VALBOOT1 ||
    record.rngIdentity.rootPrefix !== VALIDATION_BOOTSTRAP_ROOT_PREFIX_16 ||
    record.rngIdentity.samplerContractVersion !== SAMPLER_CONTRACT_VERSION
  )
    fail("RNG");
  return record;
}

export type ValidationBootstrapCoverageExpectationV1 = Readonly<{
  declaredTuple: DeclaredHistoricalRunTupleV1;
  surface: string;
  baseline: MandatoryBaselineIdV1;
  trialIdentityDigestHex: string;
  inputDigestHex: string;
  rootSeedHex: string;
  schedulerIdentity?: ValidationBootstrapSchedulerRuntimeIdentityV1;
}>;

export function aggregateValidationBootstrapCoverageV1(
  records: readonly ValidationBootstrapSealedRangeRecordV1[],
  expected: ValidationBootstrapCoverageExpectationV1,
): ValidationBootstrapNullCenteredResultV1 {
  refuseNativeBootstrapLedgerAdmissionV1(records);
  const schedulerIdentity =
    expected.schedulerIdentity ?? validationBootstrapSchedulerRuntimeIdentityV1();
  const declaredTuple = assertDeclaredHistoricalRunTupleV1(expected.declaredTuple);
  const surface = assertDurableSurfaceV1(expected.surface);
  const baseline = assertMandatoryBaselineIdV1(expected.baseline);
  const trialIdentityDigestHex = assertHex64(expected.trialIdentityDigestHex, "TRIAL");
  const inputDigestHex = assertHex64(expected.inputDigestHex, "INPUT");
  const rootSeedHex = assertHex64(expected.rootSeedHex, "ROOT");
  const coverage = new Uint8Array(VALIDATION_BOOTSTRAP_B);
  let extremeCount = 0;
  let n: number | undefined;
  let dBarBits: string | undefined;
  let tObsBits: string | undefined;
  let centeredMeanBits: string | undefined;
  const seen = new Set<string>();
  for (const raw of records) {
    const record = assertValidationBootstrapSealedRangeRecordV1(raw);
    assertDeclaredHistoricalRunTupleMatchV1(declaredTuple, record.declaredTuple);
    if (record.surface !== surface) fail("SURFACE");
    if (record.baseline !== baseline) fail("BASELINE");
    if (record.trialIdentityDigestHex !== trialIdentityDigestHex) fail("TRIAL");
    if (record.inputDigestHex !== inputDigestHex) fail("INPUT");
    if (record.rootSeedHex !== rootSeedHex) fail("ROOT");
    if (record.R !== VALIDATION_BOOTSTRAP_B) fail("R");
    if (
      record.schedulerIdentity.version !== schedulerIdentity.version ||
      record.schedulerIdentity.runtime.node !== schedulerIdentity.runtime.node ||
      record.schedulerIdentity.runtime.os !== schedulerIdentity.runtime.os ||
      record.schedulerIdentity.runtime.arch !== schedulerIdentity.runtime.arch
    )
      fail("RUNTIME");
    const key = `${record.start}:${record.endExclusive}`;
    if (seen.has(key)) fail("DUPLICATE");
    seen.add(key);
    for (let ordinal = record.start; ordinal < record.endExclusive; ordinal += 1) {
      if (coverage[ordinal] !== 0) fail("OVERLAP");
      coverage[ordinal] = 1;
    }
    if (n === undefined) {
      n = record.n;
      dBarBits = record.dBarBits;
      tObsBits = record.tObsBits;
      centeredMeanBits = record.centeredMeanBits;
    } else if (
      record.n !== n ||
      record.dBarBits !== dBarBits ||
      record.tObsBits !== tObsBits ||
      record.centeredMeanBits !== centeredMeanBits
    ) {
      fail("STATISTIC_MISMATCH");
    }
    extremeCount += record.extremeCount;
  }
  if (coverage.some((value) => value !== 1)) fail("GAP");
  if (
    !Number.isSafeInteger(extremeCount) ||
    extremeCount < 0 ||
    extremeCount > VALIDATION_BOOTSTRAP_B
  )
    fail("EXTREME_COUNT");
  return {
    pRaw: (extremeCount + 1) / VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
    dBar: readIeee754BitsBE(dBarBits!),
    tObs: readIeee754BitsBE(tObsBits!),
    extremeCount,
    centeredMean: readIeee754BitsBE(centeredMeanBits!),
    n: n!,
  };
}

export function aggregateValidationBootstrapMandatoryFamilyV1(
  input: Readonly<{
    declaredTuple: DeclaredHistoricalRunTupleV1;
    surface: string;
    coverageByBaseline: Readonly<
      Record<MandatoryBaselineIdV1, readonly ValidationBootstrapSealedRangeRecordV1[]>
    >;
    expectationByBaseline: Readonly<
      Record<
        MandatoryBaselineIdV1,
        Omit<ValidationBootstrapCoverageExpectationV1, "declaredTuple" | "surface" | "baseline">
      >
    >;
  }>,
): Readonly<{
  pRawByBaseline: Readonly<Record<MandatoryBaselineIdV1, number>>;
  holmComparisons: readonly HolmComparison[];
  holmResults: ReturnType<typeof holmFwerV1>;
}> {
  const pRawByBaseline = {} as Record<MandatoryBaselineIdV1, number>;
  const holmComparisons: HolmComparison[] = [];
  for (const baseline of MANDATORY_BASELINE_IDS) {
    if (!input.coverageByBaseline[baseline] || !input.expectationByBaseline[baseline]) {
      fail("MANDATORY_BASELINE_FAMILY_INCOMPLETE");
    }
  }
  for (const baseline of MANDATORY_BASELINE_IDS) {
    const records = input.coverageByBaseline[baseline];
    const expectation = input.expectationByBaseline[baseline];
    const result = aggregateValidationBootstrapCoverageV1(records, {
      ...expectation,
      declaredTuple: input.declaredTuple,
      surface: input.surface,
      baseline,
    });
    pRawByBaseline[baseline] = result.pRaw;
    holmComparisons.push({ comparisonId: baseline, pValue: result.pRaw });
  }
  return Object.freeze({
    pRawByBaseline: Object.freeze(pRawByBaseline),
    holmComparisons: Object.freeze(holmComparisons),
    holmResults: holmFwerV1(holmComparisons, 0.05),
  });
}

const stores = new AsyncLocalStorage<ValidationBootstrapDurableStoreV1>();

export function withValidationBootstrapDurableStoreV1<T>(
  store: ValidationBootstrapDurableStoreV1,
  work: () => T,
): T {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") {
    fail("NODE_CLI");
  }
  if (stores.getStore()) fail("NESTED_SCOPE");
  return stores.run(store, work);
}

export function getValidationBootstrapDurableStoreV1():
  | ValidationBootstrapDurableStoreV1
  | undefined {
  return stores.getStore();
}

export function createValidationBootstrapDurableMemoryStoreV1(
  declaredTuple: DeclaredHistoricalRunTupleV1,
): ValidationBootstrapDurableStoreV1 {
  const bound = assertDeclaredHistoricalRunTupleV1(declaredTuple);
  const records = new Map<string, ValidationBootstrapSealedRangeRecordV1>();
  return {
    declaredTuple: () => bound,
    bindRequestTuple(tuple) {
      assertDeclaredHistoricalRunTupleMatchV1(bound, tuple);
    },
    loadSealedRange(identity) {
      const loaded = records.get(durableRangeIdentityKeyV1(identity));
      return loaded ? assertValidationBootstrapSealedRangeRecordV1(loaded) : null;
    },
    sealRange(record) {
      const sealed = assertValidationBootstrapSealedRangeRecordV1(record);
      assertDeclaredHistoricalRunTupleMatchV1(bound, sealed.declaredTuple);
      const key = durableRangeIdentityKeyV1(
        {
          declaredTuple: sealed.declaredTuple,
          surface: sealed.surface,
          baseline: sealed.baseline,
          trialIdentityDigestHex: sealed.trialIdentityDigestHex,
          inputDigestHex: sealed.inputDigestHex,
          rootSeedHex: sealed.rootSeedHex,
          start: sealed.start,
          endExclusive: sealed.endExclusive,
        },
        sealed.schedulerIdentity,
      );
      if (records.has(key)) fail("DUPLICATE");
      records.set(key, sealed);
    },
    listSealedRanges(identity) {
      return [...records.values()].filter(
        (record) =>
          record.surface === identity.surface &&
          record.baseline === identity.baseline &&
          record.trialIdentityDigestHex === identity.trialIdentityDigestHex &&
          record.inputDigestHex === identity.inputDigestHex &&
          record.rootSeedHex === identity.rootSeedHex &&
          record.declaredTuple.organizationId === identity.declaredTuple.organizationId &&
          record.declaredTuple.runId === identity.declaredTuple.runId &&
          record.declaredTuple.releaseSha === identity.declaredTuple.releaseSha,
      );
    },
  };
}
