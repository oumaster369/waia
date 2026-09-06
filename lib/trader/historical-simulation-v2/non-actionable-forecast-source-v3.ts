import "server-only";
import type postgres from "postgres";
import { isDeepStrictEqual } from "node:util";
import {
  cloneBoundedForecastWireJsonV1,
  encodeForecastRuntimeInputWireV1,
  hydrateForecastRuntimeInputWireV1,
  forecastPackageWireVersionV1,
  type ForecastRuntimeInputWireV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-package-wire-v1";
import type { PredictivePackageStorageReferenceV1 } from
  "@/lib/trader/intelligence/forecast-v2/predictive-package-storage-postgres-v1";
import type { ForecastRuntimeInputV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertPermittedAbstention,
  assertHistoricalForecastNonActionableSourceV2,
  assertHistoricalForecastNonActionableVerificationV2,
  HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2,
  type HistoricalForecastNonActionableSourceV2,
  type HistoricalForecastNonActionableVerificationV2,
} from "./non-actionable-forecast-source-v2";

export const HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V3 =
  "waia.trader.historical_forecast_non_actionable_source.v3" as const;
export const HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V3 =
  "waia.trader.historical_forecast_non_actionable_verification.v3" as const;
const VERIFIER = "historical-forecast-non-actionable-verifier/2" as const;

type SourceScope = Pick<HistoricalForecastNonActionableSourceV2,
  "organizationId" | "accountId" | "runId" | "cycleId" | "symbol" |
  "pitAnchor" | "datasetMembershipContentDigestHex">;
export type HistoricalForecastNonActionableSourceV3 = Omit<
  HistoricalForecastNonActionableSourceV2, "schemaVersion" | "runtimeInput"
> & Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V3;
  runtimeInput: ForecastRuntimeInputWireV1;
}>;
export type HistoricalForecastNonActionableVerificationV3 = Omit<
  HistoricalForecastNonActionableVerificationV2, "schemaVersion" | "verifierVersion"
> & Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V3;
  verifierVersion: typeof VERIFIER;
}>;
export type HistoricalForecastNonActionableSource =
  HistoricalForecastNonActionableSourceV2 | HistoricalForecastNonActionableSourceV3;
export type HistoricalForecastNonActionableVerification =
  HistoricalForecastNonActionableVerificationV2 | HistoricalForecastNonActionableVerificationV3;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_FORECAST_NON_ACTIONABLE_REFUSED:${code}`);
}

/** The seal describes the bounded wire, NOT a redefinition of legacy V2 hashes. */
function assertWireIdentity(source: HistoricalForecastNonActionableSourceV3, scope: SourceScope): void {
  const { contentDigestHex, ...body } = source;
  if (source.schemaVersion !== HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V3 ||
      (["organizationId", "accountId", "runId", "cycleId", "symbol", "pitAnchor",
        "datasetMembershipContentDigestHex"] as const).some((key) =>
        typeof scope[key] !== "string" || !scope[key] || source[key] !== scope[key]) ||
      !/^[0-9a-f]{64}$/.test(source.datasetMembershipContentDigestHex) ||
      !Number.isFinite(Date.parse(source.pitAnchor)) ||
      new Date(source.pitAnchor).toISOString() !== source.pitAnchor ||
      forecastPackageWireVersionV1(source.runtimeInput?.predictivePackage) !== "REFERENCE_V1" ||
      source.runtimeInput.predictivePackage.family?.symbol !== scope.symbol ||
      source.runtimeInputContentDigestHex !== computeSemanticSha256Hex(source.runtimeInput) ||
      contentDigestHex !== computeSemanticSha256Hex(body)) refuse("SOURCE_IDENTITY");
}

function verificationFor(source: HistoricalForecastNonActionableSourceV3, releaseSha: string):
  HistoricalForecastNonActionableVerificationV3 {
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) refuse("RELEASE_SHA");
  const body = {
    schemaVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_VERIFICATION_V3,
    organizationId: source.organizationId,
    accountId: source.accountId,
    runId: source.runId,
    cycleId: source.cycleId,
    sourceContentDigestHex: source.contentDigestHex,
    outcomeContentDigestHex: source.outcome.contentDigestHex,
    verifierVersion: VERIFIER,
    verifierBuildDigestHex: computeSemanticSha256Hex({ verifierVersion: VERIFIER, releaseSha }),
    verified: true as const,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

/** Call only after publishing the complete package inside the caller's transaction.
 * Scientific abstention is replayed on the full input; only its transport is replaced.
 */
export function createHistoricalForecastNonActionableEvidenceV3(input: SourceScope & Readonly<{
  runtimeInput: ForecastRuntimeInputV2;
  outcome: HistoricalForecastNonActionableSourceV2["outcome"];
  reference: PredictivePackageStorageReferenceV1;
  releaseSha: string;
}>): Readonly<{
  source: HistoricalForecastNonActionableSourceV3;
  verification: HistoricalForecastNonActionableVerificationV3;
}> {
  if (input.reference.organizationId !== input.organizationId) refuse("SOURCE_IDENTITY");
  assertPermittedAbstention(input.runtimeInput, input.outcome);
  const runtimeInput = encodeForecastRuntimeInputWireV1(input.runtimeInput, input.reference);
  const body = {
    schemaVersion: HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V3,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    datasetMembershipContentDigestHex: input.datasetMembershipContentDigestHex,
    runtimeInputContentDigestHex: computeSemanticSha256Hex(runtimeInput),
    runtimeInput,
    outcome: cloneBoundedForecastWireJsonV1(input.outcome),
  };
  const source = Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
  assertWireIdentity(source, {
    organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
    cycleId: input.cycleId, symbol: input.symbol, pitAnchor: input.pitAnchor,
    datasetMembershipContentDigestHex: input.datasetMembershipContentDigestHex,
  });
  return Object.freeze({ source, verification: verificationFor(source, input.releaseSha) });
}

/** Commit/resume must call this before using an abstention as source authority.
 * Verifies scope, release and wire seals before IO, then hydrates the exact same-org
 * canonical package and replays the unchanged sole HYPOTHESIS_NOT_APPLICABLE rule.
 * A verification hash by itself is never Forecast or Human authority.
 */
export async function verifyHistoricalForecastNonActionableEvidenceV3(
  sql: postgres.Sql,
  source: HistoricalForecastNonActionableSource,
  verification: HistoricalForecastNonActionableVerification,
  scope: SourceScope,
  releaseSha: string,
): Promise<ForecastRuntimeInputV2> {
  if (source?.schemaVersion === HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V2) {
    assertHistoricalForecastNonActionableSourceV2(source, scope);
    assertHistoricalForecastNonActionableVerificationV2(
      verification as HistoricalForecastNonActionableVerificationV2, { source, releaseSha });
    return source.runtimeInput;
  }
  if (!source || source.schemaVersion !== HISTORICAL_FORECAST_NON_ACTIONABLE_SOURCE_V3)
    refuse("SOURCE_SHAPE");
  // Own all durable metadata across awaits. No package/corpus exists in this wire.
  const owned = cloneBoundedForecastWireJsonV1(source);
  assertWireIdentity(owned, scope);
  if (!isDeepStrictEqual(verification, verificationFor(owned, releaseSha)))
    refuse("VERIFICATION_IDENTITY");
  const reference = owned.runtimeInput.predictivePackage.reference;
  const runtimeInput = await hydrateForecastRuntimeInputWireV1(sql, owned.runtimeInput, {
    organizationId: scope.organizationId, packageId: reference.packageId,
  });
  assertPermittedAbstention(runtimeInput, owned.outcome);
  return runtimeInput;
}
