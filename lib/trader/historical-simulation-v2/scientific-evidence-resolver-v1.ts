import { AsyncLocalStorage } from "node:async_hooks";
import type { PredictivePackageV1 } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { PREDICTIVE_TERMINAL_CHECKPOINT_STAGE } from "@/lib/trader/research/benchmark/cdf-evidence-protocol-v2";
import type { PackageBuildInputV1 } from "./scientific-checkpoint-context-v1";

export const STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1 =
  "waia.strict-scientific-evidence-resolver.v1" as const;

/** Preserved origin O. Historical fact about sealed artifacts; not a future evaluator release. */
export const PRESERVED_ORIGIN_RELEASE_SHA_V1 = "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67" as const;
export const PRESERVED_ORIGIN_RUNTIME_V1 = Object.freeze({
  node: "v22.23.2",
  os: "linux",
  arch: "x64",
});

export type ScientificRuntimeTupleV1 = Readonly<{
  node: string;
  os: string;
  arch: string;
}>;
export type ScientificNamespaceIdentityV1 = Readonly<{
  releaseSha: string;
  runtime: ScientificRuntimeTupleV1;
}>;
export type ScientificEvidenceNamespaceV1 = "origin" | "producer" | "evaluator";

/** Launch API: load sealed evidence. No builder callback exists on this type. */
export interface StrictScientificEvidenceResolverV1 {
  readonly contractVersion: typeof STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1;
  readonly identities: Readonly<{
    origin: ScientificNamespaceIdentityV1;
    producer: ScientificNamespaceIdentityV1 | undefined;
    evaluator: ScientificNamespaceIdentityV1;
  }>;
  resolvePackage(input: PackageBuildInputV1): PredictivePackageV1;
  resolveEvidence<T>(stage: string, input: unknown, namespace: ScientificEvidenceNamespaceV1): T;
  resolveEvidenceAsync<T>(
    stage: string,
    input: unknown,
    namespace: ScientificEvidenceNamespaceV1,
  ): Promise<T>;
}

const resolvers = new AsyncLocalStorage<StrictScientificEvidenceResolverV1>();
function refuse(reason: string): never {
  throw new Error(`STRICT_SCIENTIFIC_EVIDENCE_REFUSED:${reason}`);
}

export function withStrictScientificResolverV1<T>(
  resolver: StrictScientificEvidenceResolverV1,
  work: () => T,
): T {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") {
    refuse("NODE_CLI");
  }
  if (resolver.contractVersion !== STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1) {
    refuse("CONTRACT");
  }
  if (resolvers.getStore()) refuse("NESTED_SCOPE");
  return resolvers.run(resolver, work);
}

export function boundStrictScientificResolverV1(): StrictScientificEvidenceResolverV1 {
  const resolver = resolvers.getStore();
  if (!resolver) refuse("RESOLVER_REQUIRED");
  return resolver;
}

export function resolveScientificPackageV1(input: PackageBuildInputV1): PredictivePackageV1 {
  return boundStrictScientificResolverV1().resolvePackage(input);
}

export function resolveScientificEvidenceV1<T>(
  stage: string,
  input: unknown,
  namespace: ScientificEvidenceNamespaceV1,
): T {
  return boundStrictScientificResolverV1().resolveEvidence(stage, input, namespace);
}

export function resolveScientificEvidenceAsyncV1<T>(
  stage: string,
  input: unknown,
  namespace: ScientificEvidenceNamespaceV1,
): Promise<T> {
  return boundStrictScientificResolverV1().resolveEvidenceAsync(stage, input, namespace);
}

export function scientificForecastEvidenceNamespaceV1(
  surfaceKey: string,
): ScientificEvidenceNamespaceV1 {
  if (surfaceKey === "BTCUSDT:30") return "origin";
  if (surfaceKey === "BTCUSDT:60" || surfaceKey === "ETHUSDT:30" || surfaceKey === "ETHUSDT:60") {
    return "producer";
  }
  refuse("SURFACE");
}

export function isEvaluatorDurableBootstrapStageV1(stage: string): boolean {
  return (
    stage === PREDICTIVE_TERMINAL_CHECKPOINT_STAGE ||
    /^wf-predictive-bootstrap-range(?:-[a-z0-9]+)+$/.test(stage)
  );
}

export function scientificNamespaceIdentityKeyV1(identity: ScientificNamespaceIdentityV1): string {
  return `${identity.releaseSha}:${identity.runtime.node}:${identity.runtime.os}:${identity.runtime.arch}`;
}

export function assertScientificEvidenceIdentityV1(
  namespace: ScientificEvidenceNamespaceV1,
  expected: ScientificNamespaceIdentityV1,
  actual: ScientificNamespaceIdentityV1,
): void {
  if (
    actual.runtime.node !== expected.runtime.node ||
    actual.runtime.os !== expected.runtime.os ||
    actual.runtime.arch !== expected.runtime.arch
  ) {
    refuse("WRONG_RUNTIME");
  }
  if (actual.releaseSha !== expected.releaseSha) {
    refuse(
      namespace === "origin"
        ? "CROSS_ORIGIN"
        : namespace === "producer"
          ? "WRONG_PRODUCER"
          : "WRONG_EVALUATOR",
    );
  }
}
