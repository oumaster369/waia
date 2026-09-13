import { MANDATORY_BASELINE_IDS } from "@/lib/trader/research/benchmark/baseline-models-v1";
import {
  HOLM_FWER_VERSION,
  holmFwerV1,
  type HolmComparison,
  type HolmResult,
} from "@/lib/trader/research/benchmark/holm-fwer-v1";
import {
  VALIDATION_BOOTSTRAP_B,
  VALIDATION_BOOTSTRAP_VERSION,
} from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HISTORICAL_SCIENTIFIC_ADMISSION_REFUSAL_V1 =
  "waia.trader.historical_scientific_admission_refusal.v1" as const;
export const HISTORICAL_REHEARSAL_STARTED_V1 =
  "waia.trader.historical_rehearsal_started.v1" as const;

export const HISTORICAL_TERMINAL_RUNNER_ORGANIZATION_ID =
  "3c50b4e9-1138-43a5-a29f-e65088124cfc" as const;

export const HISTORICAL_TERMINAL_SURFACES_V1 = [
  { surfaceKey: "BTCUSDT:30", symbol: "BTCUSDT", primaryHorizonMinutes: 30 },
  { surfaceKey: "BTCUSDT:60", symbol: "BTCUSDT", primaryHorizonMinutes: 60 },
  { surfaceKey: "ETHUSDT:30", symbol: "ETHUSDT", primaryHorizonMinutes: 30 },
  { surfaceKey: "ETHUSDT:60", symbol: "ETHUSDT", primaryHorizonMinutes: 60 },
] as const;

export const HISTORICAL_TERMINAL_BASELINE_IDS_V1 = MANDATORY_BASELINE_IDS;

export const SCIENTIFIC_ADMISSION_REFUSAL_REASON_CODES_V1 = [
  "HOLM_FWER_FAIL",
  "BRIER_GATE_FAIL",
  "COVERAGE_INCOMPLETE",
  "MISSING_PROPOSAL",
  "MISSING_RATIFICATION",
  "MISSING_FOUR_SURFACE_AUTHORITY",
  "RELEASE_MISMATCH",
  "CONCURRENT_CLAIMANT",
  "WRONG_LIFECYCLE",
  "HEALTH_MISMATCH",
  "MISSING_ADMIN_OBSERVATION",
  "MISSING_TENANT_OBSERVATION",
  "CROSS_RUN_OBSERVATION",
  "FIXTURE_IDENTITY",
  "UNAUTHENTICATED_OBSERVATION",
  "OBSERVATION_ADAPTER_MISSING",
  "ORGANIZATION_SCOPE",
] as const;

export type ScientificAdmissionRefusalReasonCodeV1 =
  (typeof SCIENTIFIC_ADMISSION_REFUSAL_REASON_CODES_V1)[number];

export const HISTORICAL_TERMINAL_FIXTURE_ORGANIZATION_IDS = Object.freeze([
  "selected-org",
] as const);
export const HISTORICAL_TERMINAL_FIXTURE_RUN_IDS = Object.freeze(["e2e-observation-only"] as const);
export const HISTORICAL_TERMINAL_FIXTURE_ACCOUNT_IDS = Object.freeze(["modeled-account"] as const);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY = /password|secret|cookie|token|authorization|bearer|session/i;

export type HistoricalTerminalSurfaceV1 = (typeof HISTORICAL_TERMINAL_SURFACES_V1)[number];

export type HistoricalComparisonIdentityV1 = Readonly<{
  surfaceKey: (typeof HISTORICAL_TERMINAL_SURFACES_V1)[number]["surfaceKey"];
  baselineId: (typeof HISTORICAL_TERMINAL_BASELINE_IDS_V1)[number];
  comparisonIdentityDigestHex: string;
}>;

export type HistoricalCoverageProofV1 = Readonly<{
  resampleOrdinalStartInclusive: 0;
  resampleOrdinalEndExclusive: typeof VALIDATION_BOOTSTRAP_B;
  bootstrapVersion: typeof VALIDATION_BOOTSTRAP_VERSION;
  coverageDigestHex: string;
}>;

export type HistoricalComparisonStatisticV1 = Readonly<{
  comparisonIdentityDigestHex: string;
  pRaw: number;
  dBar: number;
  tObs: number;
  extremeCount: number;
  n: number;
}>;

export type HistoricalScientificAdmissionRefusalReceiptV1 = Readonly<{
  schemaVersion: typeof HISTORICAL_SCIENTIFIC_ADMISSION_REFUSAL_V1;
  releaseSha: string;
  runtimeReleaseBindingReceiptDigestHex: string;
  organizationId: string;
  runId: string;
  surfaces: readonly HistoricalTerminalSurfaceV1[];
  comparisonIdentities: readonly HistoricalComparisonIdentityV1[];
  coverage: HistoricalCoverageProofV1;
  statistics: Readonly<{ comparisons: readonly HistoricalComparisonStatisticV1[] }>;
  holmFwer: Readonly<{
    schemaVersion: typeof HOLM_FWER_VERSION;
    alpha: number;
    familyPass: boolean;
    results: readonly HolmResult[];
  }>;
  reasonCode: ScientificAdmissionRefusalReasonCodeV1;
  contentDigestHex: string;
}>;

export type HistoricalRehearsalStartedReceiptV1 = Readonly<{
  schemaVersion: typeof HISTORICAL_REHEARSAL_STARTED_V1;
  releaseSha: string;
  runtimeReleaseBindingReceiptDigestHex: string;
  organizationId: string;
  accountId: string;
  runId: string;
  proposalId: string;
  proposalContentDigestHex: string;
  ratificationId: string;
  ratificationContentDigestHex: string;
  fourSurfaceAuthorityId: string;
  fourSurfaceAuthorityContentDigestHex: string;
  consumerClaim: Readonly<{
    claimantId: string;
    accepted: true;
    concurrentClaimantCount: 0;
    contentDigestHex: string;
  }>;
  lease: Readonly<{
    leaseKey: string;
    acquired: true;
    contentDigestHex: string;
  }>;
  lifecycle: Readonly<{
    phase: "RUNNING" | "COMPLETED";
    contentDigestHex: string;
  }>;
  imageHealthBinding: Readonly<{
    releaseSha: string;
    imageReleaseSha: string;
    runId: string;
    status: "ok";
    contentDigestHex: string;
  }>;
  adminObservationBinding: Readonly<{
    organizationId: string;
    runId: string;
    lifecycleContentDigestHex: string;
    accountId: string;
    ledgerHeadContentDigestHex: string;
    cycleSequence: number;
    cycleId: string;
    contentDigestHex: string;
  }>;
  tenantObservationBinding: Readonly<{
    organizationId: string;
    runId: string;
    accountId: string;
    lifecycleContentDigestHex: string;
    ledgerHeadContentDigestHex: string;
    cycleSequence: number;
    cycleId: string;
    contentDigestHex: string;
  }>;
  contentDigestHex: string;
}>;

function refuseWriter(code: string): never {
  throw new Error(`HISTORICAL_TERMINAL_RECEIPT_REFUSED:${code}`);
}

function requireSha40(value: string, field: string): void {
  if (!SHA40.test(value)) refuseWriter(`DIGEST:${field}`);
}

function requireSha64(value: string, field: string): void {
  if (!SHA64.test(value)) refuseWriter(`DIGEST:${field}`);
}

function requireUuid(value: string, field: string): void {
  if (!UUID.test(value)) refuseWriter(`IDENTITY:${field}`);
}

function requireIdentity(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    refuseWriter(`IDENTITY:${field}`);
  }
}

export function assertHistoricalTerminalReceiptHasNoSecrets(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertHistoricalTerminalReceiptHasNoSecrets(item, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) refuseWriter(`SECRET:${path}.${key}`);
      assertHistoricalTerminalReceiptHasNoSecrets(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_KEY.test(value)) refuseWriter(`SECRET:${path}`);
}

export function isHistoricalTerminalFixtureIdentityV1(
  input: Readonly<{
    organizationId: string;
    runId: string;
    accountId?: string;
  }>,
): boolean {
  if (
    (HISTORICAL_TERMINAL_FIXTURE_ORGANIZATION_IDS as readonly string[]).includes(
      input.organizationId,
    )
  ) {
    return true;
  }
  if ((HISTORICAL_TERMINAL_FIXTURE_RUN_IDS as readonly string[]).includes(input.runId)) {
    return true;
  }
  if (
    input.accountId &&
    (HISTORICAL_TERMINAL_FIXTURE_ACCOUNT_IDS as readonly string[]).includes(input.accountId)
  ) {
    return true;
  }
  const blob = `${input.organizationId}\n${input.runId}\n${input.accountId ?? ""}`;
  return /e2e|fixture|presentation/i.test(blob);
}

export function buildHistoricalCoverageProofV1(): HistoricalCoverageProofV1 {
  const body = Object.freeze({
    resampleOrdinalStartInclusive: 0 as const,
    resampleOrdinalEndExclusive: VALIDATION_BOOTSTRAP_B,
    bootstrapVersion: VALIDATION_BOOTSTRAP_VERSION,
  });
  return Object.freeze({
    ...body,
    coverageDigestHex: computeSemanticSha256Hex(body),
  });
}

export function buildHistoricalComparisonIdentitiesV1(): readonly HistoricalComparisonIdentityV1[] {
  const identities = HISTORICAL_TERMINAL_SURFACES_V1.flatMap((surface) =>
    HISTORICAL_TERMINAL_BASELINE_IDS_V1.map((baselineId) => {
      const body = Object.freeze({ surfaceKey: surface.surfaceKey, baselineId });
      return Object.freeze({
        ...body,
        comparisonIdentityDigestHex: computeSemanticSha256Hex(body),
      });
    }),
  );
  if (identities.length !== 20) refuseWriter("COMPARISON_COUNT");
  return Object.freeze(identities);
}

export function buildRuntimeReleaseBindingReceiptDigestV1(releaseSha: string): string {
  requireSha40(releaseSha, "releaseSha");
  return computeSemanticSha256Hex(
    Object.freeze({
      schemaVersion: "waia.trader.runtime_release_binding.v1",
      releaseSha,
    }),
  );
}

function seal<T extends Record<string, unknown>>(body: T): T & { contentDigestHex: string } {
  assertHistoricalTerminalReceiptHasNoSecrets(body);
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function buildHistoricalScientificAdmissionRefusalReceiptV1(
  input: Readonly<{
    releaseSha: string;
    runtimeReleaseBindingReceiptDigestHex?: string;
    organizationId: string;
    runId: string;
    reasonCode: ScientificAdmissionRefusalReasonCodeV1;
    statistics: readonly HistoricalComparisonStatisticV1[];
    holmComparisons: readonly HolmComparison[];
    alpha?: number;
  }>,
): HistoricalScientificAdmissionRefusalReceiptV1 {
  requireSha40(input.releaseSha, "releaseSha");
  requireIdentity(input.organizationId, "organizationId");
  requireIdentity(input.runId, "runId");
  if (
    !(SCIENTIFIC_ADMISSION_REFUSAL_REASON_CODES_V1 as readonly string[]).includes(input.reasonCode)
  ) {
    refuseWriter("REASON_CODE");
  }
  const comparisonIdentities = buildHistoricalComparisonIdentitiesV1();
  const coverage = buildHistoricalCoverageProofV1();
  const expectedDigests = comparisonIdentities.map((row) => row.comparisonIdentityDigestHex);
  if (input.statistics.length !== 20 || input.holmComparisons.length !== 20) {
    refuseWriter("COMPARISON_COUNT");
  }
  const statisticDigests = input.statistics.map((row) => row.comparisonIdentityDigestHex);
  if (
    JSON.stringify([...statisticDigests].sort()) !== JSON.stringify([...expectedDigests].sort())
  ) {
    refuseWriter("STATISTICS_IDENTITY");
  }
  for (const row of input.statistics) {
    if (!Number.isFinite(row.pRaw) || row.pRaw < 0 || row.pRaw > 1) refuseWriter("P_RAW");
    if (
      !Number.isFinite(row.dBar) ||
      !Number.isFinite(row.tObs) ||
      !Number.isSafeInteger(row.extremeCount) ||
      row.extremeCount < 0 ||
      !Number.isSafeInteger(row.n) ||
      row.n <= 0
    ) {
      refuseWriter("STATISTICS");
    }
  }
  const holmIds = input.holmComparisons.map((row) => row.comparisonId).sort();
  if (JSON.stringify(holmIds) !== JSON.stringify([...expectedDigests].sort())) {
    refuseWriter("HOLM_IDENTITY");
  }
  const alpha = input.alpha ?? 0.05;
  const results = holmFwerV1(input.holmComparisons, alpha);
  const familyPass = results.every((row) => row.rejected);
  const runtimeReleaseBindingReceiptDigestHex =
    input.runtimeReleaseBindingReceiptDigestHex ??
    buildRuntimeReleaseBindingReceiptDigestV1(input.releaseSha);
  requireSha64(runtimeReleaseBindingReceiptDigestHex, "runtimeReleaseBindingReceiptDigestHex");
  const body = {
    schemaVersion: HISTORICAL_SCIENTIFIC_ADMISSION_REFUSAL_V1,
    releaseSha: input.releaseSha,
    runtimeReleaseBindingReceiptDigestHex,
    organizationId: input.organizationId,
    runId: input.runId,
    surfaces: HISTORICAL_TERMINAL_SURFACES_V1,
    comparisonIdentities,
    coverage,
    statistics: Object.freeze({ comparisons: Object.freeze([...input.statistics]) }),
    holmFwer: Object.freeze({
      schemaVersion: HOLM_FWER_VERSION,
      alpha,
      familyPass,
      results,
    }),
    reasonCode: input.reasonCode,
  };
  return seal(body) as HistoricalScientificAdmissionRefusalReceiptV1;
}

export function buildHistoricalRehearsalStartedReceiptV1(
  input: Omit<
    HistoricalRehearsalStartedReceiptV1,
    | "schemaVersion"
    | "contentDigestHex"
    | "consumerClaim"
    | "lease"
    | "lifecycle"
    | "imageHealthBinding"
    | "adminObservationBinding"
    | "tenantObservationBinding"
  > &
    Readonly<{
      consumerClaim: Omit<HistoricalRehearsalStartedReceiptV1["consumerClaim"], "contentDigestHex">;
      lease: Omit<HistoricalRehearsalStartedReceiptV1["lease"], "contentDigestHex">;
      lifecycle: HistoricalRehearsalStartedReceiptV1["lifecycle"];
      imageHealthBinding: Omit<
        HistoricalRehearsalStartedReceiptV1["imageHealthBinding"],
        "contentDigestHex"
      >;
      adminObservationBinding: Omit<
        HistoricalRehearsalStartedReceiptV1["adminObservationBinding"],
        "contentDigestHex"
      >;
      tenantObservationBinding: Omit<
        HistoricalRehearsalStartedReceiptV1["tenantObservationBinding"],
        "contentDigestHex"
      >;
    }>,
): HistoricalRehearsalStartedReceiptV1 {
  requireSha40(input.releaseSha, "releaseSha");
  requireSha64(
    input.runtimeReleaseBindingReceiptDigestHex,
    "runtimeReleaseBindingReceiptDigestHex",
  );
  requireUuid(input.organizationId, "organizationId");
  requireIdentity(input.accountId, "accountId");
  requireIdentity(input.runId, "runId");
  requireUuid(input.proposalId, "proposalId");
  requireSha64(input.proposalContentDigestHex, "proposalContentDigestHex");
  requireUuid(input.ratificationId, "ratificationId");
  requireSha64(input.ratificationContentDigestHex, "ratificationContentDigestHex");
  requireUuid(input.fourSurfaceAuthorityId, "fourSurfaceAuthorityId");
  requireSha64(input.fourSurfaceAuthorityContentDigestHex, "fourSurfaceAuthorityContentDigestHex");
  requireSha64(input.lifecycle.contentDigestHex, "lifecycle.contentDigestHex");
  if (input.lifecycle.phase !== "RUNNING" && input.lifecycle.phase !== "COMPLETED") {
    refuseWriter("LIFECYCLE");
  }
  if (input.consumerClaim.accepted !== true || input.consumerClaim.concurrentClaimantCount !== 0) {
    refuseWriter("CLAIM");
  }
  if (input.lease.acquired !== true) refuseWriter("LEASE");
  if (
    input.imageHealthBinding.releaseSha !== input.releaseSha ||
    input.imageHealthBinding.imageReleaseSha !== input.releaseSha ||
    input.imageHealthBinding.runId !== input.runId ||
    input.imageHealthBinding.status !== "ok"
  ) {
    refuseWriter("HEALTH");
  }
  const consumerClaim = seal({ ...input.consumerClaim });
  const lease = seal({ ...input.lease });
  const imageHealthBinding = seal({ ...input.imageHealthBinding });
  const adminObservationBinding = seal({ ...input.adminObservationBinding });
  const tenantObservationBinding = seal({ ...input.tenantObservationBinding });
  const body = {
    schemaVersion: HISTORICAL_REHEARSAL_STARTED_V1,
    releaseSha: input.releaseSha,
    runtimeReleaseBindingReceiptDigestHex: input.runtimeReleaseBindingReceiptDigestHex,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    proposalId: input.proposalId,
    proposalContentDigestHex: input.proposalContentDigestHex,
    ratificationId: input.ratificationId,
    ratificationContentDigestHex: input.ratificationContentDigestHex,
    fourSurfaceAuthorityId: input.fourSurfaceAuthorityId,
    fourSurfaceAuthorityContentDigestHex: input.fourSurfaceAuthorityContentDigestHex,
    consumerClaim,
    lease,
    lifecycle: Object.freeze({ ...input.lifecycle }),
    imageHealthBinding,
    adminObservationBinding,
    tenantObservationBinding,
  };
  return seal(body) as HistoricalRehearsalStartedReceiptV1;
}
