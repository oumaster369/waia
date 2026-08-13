import type { A3PhaseIdentityLayersV1 } from "./a3-storage-contract-v1";

export type A3PhaseId = "phase01" | "phase02" | "phase03" | "aggregate";

export type A3InvalidationCause =
  | "storage_surface_change"
  | "phase01_implementation_change"
  | "phase02_implementation_change"
  | "phase03_implementation_change"
  | "aggregate_implementation_change"
  | "dee531_research_only_change"
  | "documentation_provenance_only_change";

/** Explicit invalidation edges — do not infer from filenames at review time. */
export const A3_INVALIDATION_MANIFEST_V1 = {
  schemaVersion: "a3-invalidation-manifest/v1",
  rules: [
    {
      cause: "storage_surface_change" as const,
      invalidates: ["phase01", "phase02"] as const,
      preserves: ["phase03"] as const,
      note: "Physical PostgreSQL surface or measured population encoding changed.",
    },
    {
      cause: "phase01_implementation_change" as const,
      invalidates: ["phase01"] as const,
      preserves: ["phase02", "phase03", "aggregate"] as const,
      dependentSources: [
        "lib/trader/intelligence/forecast-v2/a3-phase01-progress-diagnostics-v1.ts",
        "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
        "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
      ],
    },
    {
      cause: "phase02_implementation_change" as const,
      invalidates: ["phase02"] as const,
      preserves: ["phase01", "phase03"] as const,
      dependentSources: [
        "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
        "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
      ],
    },
    {
      cause: "phase03_implementation_change" as const,
      invalidates: ["phase03"] as const,
      preserves: ["phase01", "phase02"] as const,
      dependentSources: [
        "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
        "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
      ],
    },
    {
      cause: "aggregate_implementation_change" as const,
      invalidates: ["aggregate"] as const,
      preserves: ["phase01", "phase02", "phase03"] as const,
      dependentSources: [
        "lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1.ts",
        "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
        "lib/trader/intelligence/forecast-v2/a3-storage-invalidation-manifest-v1.ts",
      ],
    },
    {
      cause: "dee531_research_only_change" as const,
      invalidates: [] as const,
      preserves: ["phase01", "phase02", "phase03", "aggregate"] as const,
      dependentSources: [
        "lib/trader/research/benchmark/validation-bootstrap-v1.ts",
        "lib/trader/research/benchmark/research-harness-admission-orchestrator-v1.ts",
      ],
    },
    {
      cause: "documentation_provenance_only_change" as const,
      invalidates: [] as const,
      preserves: ["phase01", "phase02", "phase03", "aggregate"] as const,
    },
  ],
} as const;

export type A3ReceiptIdentitySnapshot = {
  a3CanonicalContractDigest: string;
  storageSurfaceDigest?: string;
  phaseImplementationDigest: string;
  expectedPackageSurfaceDigestHex?: string;
  observedPackageSurfaceDigestHex?: string;
  postgresMeasurementEnvironmentDigest?: string;
  phase01PackageFixedBytes?: number;
  phase2PackageFixedContributionBytes?: number;
  worktreeProvenanceDigest: string;
};

export function listInvalidatedPhases(input: {
  stored: A3ReceiptIdentitySnapshot;
  current: A3PhaseIdentityLayersV1;
  phase: A3PhaseId;
}): A3PhaseId[] {
  const invalidated = new Set<A3PhaseId>();

  if (input.stored.a3CanonicalContractDigest !== input.current.a3CanonicalContractDigest) {
    invalidated.add("phase01");
    invalidated.add("phase02");
    invalidated.add("phase03");
    invalidated.add("aggregate");
    return [...invalidated];
  }

  if (
    input.stored.storageSurfaceDigest !== undefined &&
    input.stored.storageSurfaceDigest !== input.current.storageSurfaceDigest
  ) {
    invalidated.add("phase01");
    invalidated.add("phase02");
  }

  if (
    input.stored.phaseImplementationDigest !==
    input.current.phaseImplementationDigests[
      input.phase === "aggregate" ? "aggregate" : input.phase
    ]
  ) {
    invalidated.add(input.phase);
  }

  return [...invalidated];
}

export function assertPhaseReceiptStillValid(input: {
  phase: Exclude<A3PhaseId, "aggregate">;
  stored: A3ReceiptIdentitySnapshot;
  current: A3PhaseIdentityLayersV1;
}): void {
  const invalidated = listInvalidatedPhases({
    stored: input.stored,
    current: input.current,
    phase: input.phase,
  });
  if (invalidated.includes(input.phase)) {
    throw new Error(
      `[a3-invalidation] ${input.phase} receipt invalidated — stored identity no longer compatible`,
    );
  }
}

export function assertAggregateReceiptInputsCompatible(input: {
  current: A3PhaseIdentityLayersV1;
  phase01: A3ReceiptIdentitySnapshot;
  phase02: A3ReceiptIdentitySnapshot;
  phase03: A3ReceiptIdentitySnapshot;
}): void {
  assertPhaseReceiptStillValid({ phase: "phase01", stored: input.phase01, current: input.current });
  assertPhaseReceiptStillValid({ phase: "phase02", stored: input.phase02, current: input.current });
  assertPhaseReceiptStillValid({ phase: "phase03", stored: input.phase03, current: input.current });

  if (input.phase01.a3CanonicalContractDigest !== input.current.a3CanonicalContractDigest) {
    throw new Error("[a3-invalidation] aggregate canonical contract mismatch");
  }
  if (input.phase02.a3CanonicalContractDigest !== input.current.a3CanonicalContractDigest) {
    throw new Error("[a3-invalidation] aggregate canonical contract mismatch (phase02)");
  }
  if (input.phase03.a3CanonicalContractDigest !== input.current.a3CanonicalContractDigest) {
    throw new Error("[a3-invalidation] aggregate canonical contract mismatch (phase03)");
  }

  if (
    input.phase01.storageSurfaceDigest !== undefined &&
    input.phase01.storageSurfaceDigest !== input.current.storageSurfaceDigest
  ) {
    throw new Error("[a3-invalidation] aggregate storage surface mismatch (phase01)");
  }
  if (
    input.phase02.storageSurfaceDigest !== undefined &&
    input.phase02.storageSurfaceDigest !== input.current.storageSurfaceDigest
  ) {
    throw new Error("[a3-invalidation] aggregate storage surface mismatch (phase02)");
  }

  if (
    input.phase01.expectedPackageSurfaceDigestHex !== input.phase02.expectedPackageSurfaceDigestHex
  ) {
    throw new Error("[a3-invalidation] aggregate expected package surface mismatch");
  }

  if (
    input.phase01.observedPackageSurfaceDigestHex !== input.phase02.observedPackageSurfaceDigestHex
  ) {
    throw new Error("[a3-invalidation] aggregate observed package surface mismatch");
  }

  if (
    input.phase01.postgresMeasurementEnvironmentDigest !==
    input.phase02.postgresMeasurementEnvironmentDigest
  ) {
    throw new Error("[a3-invalidation] aggregate postgres measurement environment mismatch");
  }

  if (
    input.phase01.phase01PackageFixedBytes !== undefined &&
    input.phase02.phase2PackageFixedContributionBytes !== undefined &&
    input.phase01.phase01PackageFixedBytes !== input.phase02.phase2PackageFixedContributionBytes
  ) {
    throw new Error("[a3-invalidation] aggregate package-fixed byte identity mismatch");
  }
}
