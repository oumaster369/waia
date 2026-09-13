import { AsyncLocalStorage } from "node:async_hooks";
import type { PredictivePackageV1, buildPredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

export type PackageBuildInputV1 = Parameters<typeof buildPredictivePackageV1>[0];
/** Internal Node CLI resource, never an HTTP input or scientific authority. */
export interface ScientificCheckpointStoreV1 {
  package(input: PackageBuildInputV1, build: () => PredictivePackageV1): PredictivePackageV1;
  evidence<T>(stage: string, input: unknown, build: () => T): T;
  evidenceAsync<T>(stage: string, input: unknown, build: () => Promise<T>): Promise<T>;
}
const stores = new AsyncLocalStorage<ScientificCheckpointStoreV1>();
export function withScientificCheckpointsV1<T>(store: ScientificCheckpointStoreV1, work: () => T): T {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("SCIENTIFIC_CHECKPOINT_NODE_CLI_REQUIRED");
  }
  if (stores.getStore()) throw new Error("SCIENTIFIC_CHECKPOINT_NESTED_SCOPE");
  return stores.run(store, work);
}
export function reuseScientificPackageV1(input: PackageBuildInputV1, build: () => PredictivePackageV1) {
  return stores.getStore()?.package(input, build) ?? build();
}
export function reuseScientificEvidenceV1<T>(stage: string, input: unknown, build: () => T): T {
  const store = stores.getStore();
  return store ? store.evidence(stage, input, build) : build();
}
export function reuseScientificEvidenceAsyncV1<T>(stage: string, input: unknown, build: () => Promise<T>): Promise<T> {
  const store = stores.getStore();
  return store ? store.evidenceAsync(stage, input, build) : build();
}
