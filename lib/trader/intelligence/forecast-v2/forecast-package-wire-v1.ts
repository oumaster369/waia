import "server-only";
import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import {
  reviveForecastRuntimeJsonV2,
  requireForecastRuntimeAuthorityV2,
  type ForecastRuntimeInputV2,
  type ForecastRuntimeAuthorizedOutcomeV2,
} from "./forecast-runtime-authority-v2";
import {
  hydratePredictivePackageStorageV1,
  type PredictivePackageStorageReferenceV1,
} from "./predictive-package-storage-postgres-v1";
import type { PredictivePackageV1 } from "./rv-state-conditional-empirical-joint-v1";
import { PREDICTIVE_PACKAGE_CODEC_VERSION } from "./predictive-package-codec-v1";

export const FORECAST_PACKAGE_REFERENCE_WIRE_V1 = "waia.trader.forecast_package_reference.v1";
export const FORECAST_SOURCE_VERIFIER_LEGACY_V2 = "waia.forecast-runtime-input-source.verifier.v2";
export const FORECAST_SOURCE_VERIFIER_BOUNDED_V3 = "waia.forecast-runtime-input-source.verifier.v3";
export const FORECAST_WIRE_MAX_BYTES_V1 = 4 * 1024 * 1024;
export type ForecastPackageReferenceWireV1 = {
  schemaVersion: typeof FORECAST_PACKAGE_REFERENCE_WIRE_V1;
  reference: PredictivePackageStorageReferenceV1;
  // Retains the small family binding required by migration 0192 and horizon
  // lookup. It is checked against the fully hydrated immutable package.
  family: PredictivePackageV1["family"];
};
export type ForecastRuntimeInputWireV1 = Omit<ForecastRuntimeInputV2, "predictivePackage"> & {
  predictivePackage: ForecastPackageReferenceWireV1;
};
export type ForecastAuthorizedOutcomeWireV1 = Omit<
  ForecastRuntimeAuthorizedOutcomeV2,
  "issuance"
> & {
  issuance: Omit<ForecastRuntimeAuthorizedOutcomeV2["issuance"], "package"> & {
    package: ForecastPackageReferenceWireV1;
  };
};
export type ForecastPackageWireScopeV1 = { organizationId: string; packageId: string };
function refused(reason: string): never {
  throw new Error(`FORECAST_PACKAGE_WIRE_REFUSED:${reason}`);
}

/** Upper-bound JSON bytes BEFORE serialization; never traverse the replaced package. */
export function cloneBoundedForecastWireJsonV1<T>(value: T): T {
  let remaining = FORECAST_WIRE_MAX_BYTES_V1;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (depth > 64 || (remaining -= 32) < 0) refused("WIRE_TOO_LARGE");
    if (typeof item === "string") {
      if ((remaining -= item.length * 6) < 0) refused("WIRE_TOO_LARGE");
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) refused("NONFINITE");
    } else if (Buffer.isBuffer(item)) {
      if ((remaining -= item.length * 5) < 0) refused("WIRE_TOO_LARGE");
    } else if (item !== null && typeof item === "object") {
      if (seen.has(item)) refused("CYCLE");
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)
        refused("NON_JSON_OBJECT");
      seen.add(item);
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if ((remaining -= key.length * 6 + 4) < 0) refused("WIRE_TOO_LARGE");
        visit((item as Record<string, unknown>)[key], depth + 1);
      }
      seen.delete(item);
    } else if (!["undefined", "boolean"].includes(typeof item) && item !== null) {
      refused("NON_JSON_VALUE");
    }
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > FORECAST_WIRE_MAX_BYTES_V1)
    refused("WIRE_TOO_LARGE");
  return JSON.parse(json) as T;
}

function assertReference(reference: PredictivePackageStorageReferenceV1): void {
  if (
    !reference ||
    !isDeepStrictEqual(Object.keys(reference).sort(), [
      "codecVersion",
      "contentDigestHex",
      "generationDigestHex",
      "manifestDigestHex",
      "organizationId",
      "packageId",
    ]) ||
    reference.codecVersion !== PREDICTIVE_PACKAGE_CODEC_VERSION ||
    ![reference.contentDigestHex, reference.generationDigestHex, reference.manifestDigestHex].every(
      (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v),
    ) ||
    ![reference.organizationId, reference.packageId].every(
      (v) => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v),
    )
  )
    refused("REFERENCE_IDENTITY");
}

function referenceWire(
  pkg: PredictivePackageV1,
  reference: PredictivePackageStorageReferenceV1,
): ForecastPackageReferenceWireV1 {
  assertReference(reference);
  if (
    pkg.family.organizationId !== reference.organizationId ||
    pkg.predictivePackageGenerationIdentityDigest.toString("hex") !==
      reference.generationDigestHex ||
    pkg.predictivePackageContentDigest.toString("hex") !== reference.contentDigestHex
  )
    refused("PACKAGE_REFERENCE_IDENTITY");
  return {
    schemaVersion: FORECAST_PACKAGE_REFERENCE_WIRE_V1,
    reference: { ...reference },
    family: { ...pkg.family },
  };
}

export function encodeForecastRuntimeInputWireV1(
  input: ForecastRuntimeInputV2,
  reference: PredictivePackageStorageReferenceV1,
): ForecastRuntimeInputWireV1 {
  if (!input.predictivePackage) refused("MISSING_PACKAGE");
  return cloneBoundedForecastWireJsonV1({
    ...input,
    predictivePackage: referenceWire(input.predictivePackage, reference),
  });
}
export function encodeForecastAuthorizedOutcomeWireV1(
  outcome: ForecastRuntimeAuthorizedOutcomeV2,
  reference: PredictivePackageStorageReferenceV1,
): ForecastAuthorizedOutcomeWireV1 {
  return cloneBoundedForecastWireJsonV1({
    ...outcome,
    issuance: { ...outcome.issuance, package: referenceWire(outcome.issuance.package, reference) },
  });
}

export function forecastPackageWireVersionV1(value: unknown): "REFERENCE_V1" | "LEGACY" {
  if (value && typeof value === "object" && Object.hasOwn(value, "schemaVersion")) {
    if ((value as { schemaVersion: unknown }).schemaVersion !== FORECAST_PACKAGE_REFERENCE_WIRE_V1)
      refused("UNSUPPORTED_PACKAGE_WIRE");
    return "REFERENCE_V1";
  }
  return "LEGACY";
}

/** A stored source version binds its transport; neither downgrade nor mixed wires is valid. */
export function assertForecastSourceWireVersionV1(
  verifierVersion: string,
  inputPackage: unknown,
  outcomePackage?: unknown,
): void {
  const expected = verifierVersion === FORECAST_SOURCE_VERIFIER_BOUNDED_V3
    ? "REFERENCE_V1"
    : verifierVersion === FORECAST_SOURCE_VERIFIER_LEGACY_V2 ? "LEGACY" : null;
  if (!expected || forecastPackageWireVersionV1(inputPackage) !== expected ||
      (outcomePackage !== undefined && forecastPackageWireVersionV1(outcomePackage) !== expected)) {
    refused("SOURCE_VERIFIER_WIRE_VERSION");
  }
}

/** PostgreSQL JSON values only, plus native Buffers used by in-process readers.
 * Preserves the old JSON round-trip's values without a package-sized string.
 * Executable/custom-prototype objects cannot come from jsonb and are refused.
 */
export function reviveLegacyForecastPackageJsonV1<T>(value: T): T {
  const active = new Set<object>();
  function revive(item: unknown): unknown {
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number") return Number.isFinite(item) ? (item === 0 ? 0 : item) : null;
    if (item === undefined) return undefined;
    if (Buffer.isBuffer(item)) return Buffer.from(item);
    if (typeof item !== "object") refused("LEGACY_NON_JSON_VALUE");
    if (active.has(item)) refused("LEGACY_CYCLE");
    active.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      result = Array.from({ length: item.length }, (_, index) => revive(item[index]) ?? null);
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) refused("LEGACY_NON_JSON_OBJECT");
      const object: Record<string, unknown> = {};
      for (const key of Object.keys(item)) {
        const child = revive((item as Record<string, unknown>)[key]);
        if (child !== undefined) Object.defineProperty(object, key,
          { value: child, enumerable: true, writable: true, configurable: true });
      }
      result = object.type === "Buffer" && Array.isArray(object.data) ? Buffer.from(object.data) : object;
    }
    active.delete(item);
    return result;
  }
  return revive(value) as T;
}

async function hydratePackage(
  sql: postgres.Sql,
  value: unknown,
  scope: ForecastPackageWireScopeV1,
): Promise<PredictivePackageV1> {
  if (forecastPackageWireVersionV1(value) === "LEGACY") {
    const pkg = reviveLegacyForecastPackageJsonV1(value) as PredictivePackageV1;
    if (
      !pkg?.family ||
      pkg.family.organizationId !== scope.organizationId ||
      !Array.isArray(pkg.canonicalSourceCorpus) ||
      !Array.isArray(pkg.replicaArtifacts)
    )
      refused("LEGACY_PACKAGE_SCOPE_OR_SHAPE");
    return pkg; // Existing scientific replay validators remain mandatory.
  }
  const wire = cloneBoundedForecastWireJsonV1(value) as ForecastPackageReferenceWireV1;
  assertReference(wire.reference);
  if (
    !isDeepStrictEqual(Object.keys(wire).sort(), ["family", "reference", "schemaVersion"]) ||
    wire.reference?.organizationId !== scope.organizationId ||
    wire.reference?.packageId !== scope.packageId ||
    wire.family?.organizationId !== scope.organizationId
  )
    refused("REFERENCE_SCOPE_OR_SHAPE");
  const pkg = await hydratePredictivePackageStorageV1(sql, wire.reference);
  if (!isDeepStrictEqual(wire.family, pkg.family)) refused("FAMILY_SUBSTITUTION");
  return pkg;
}

/** Transport only; never substitutes for issueForecastRuntimeV2/replay admission. */
export async function hydrateForecastRuntimeInputWireV1(
  sql: postgres.Sql,
  wire: ForecastRuntimeInputWireV1 | ForecastRuntimeInputV2,
  scope: ForecastPackageWireScopeV1,
): Promise<ForecastRuntimeInputV2> {
  const { predictivePackage, ...rest } = wire;
  const metadata = reviveForecastRuntimeJsonV2(cloneBoundedForecastWireJsonV1(rest));
  return { ...metadata, predictivePackage: await hydratePackage(sql, predictivePackage, scope) };
}
export async function hydrateForecastAuthorizedOutcomeWireV1(
  sql: postgres.Sql,
  wire: ForecastAuthorizedOutcomeWireV1 | ForecastRuntimeAuthorizedOutcomeV2,
  scope: ForecastPackageWireScopeV1,
): Promise<ForecastRuntimeAuthorizedOutcomeV2> {
  // Persisted JSON is untrusted despite this transport type. Preserve the
  // canonical authority rejection before destructuring or loading a package.
  if (!wire || typeof wire !== "object" || !wire.authority ||
      typeof wire.authority !== "object" || Array.isArray(wire.authority)) {
    throw new Error("FORECAST_RUNTIME_AUTHORITY_INVALID");
  }
  requireForecastRuntimeAuthorityV2(cloneBoundedForecastWireJsonV1(wire.authority));
  if (!wire.issuance || typeof wire.issuance !== "object" || Array.isArray(wire.issuance))
    refused("ISSUANCE_SHAPE");
  const { issuance, ...rest } = wire;
  const { package: pkg, ...issuanceMetadata } = issuance;
  const metadata = reviveForecastRuntimeJsonV2(
    cloneBoundedForecastWireJsonV1({ ...rest, issuance: issuanceMetadata }),
  );
  return {
    ...metadata,
    issuance: { ...metadata.issuance, package: await hydratePackage(sql, pkg, scope) },
  };
}
