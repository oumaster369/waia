import { parseOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";

export function assertLifecycleOpeningCausalLineage(input: Readonly<{
  organizationId: string;
  symbol: string;
  openingCausalLineageJson?: string | null;
  openingCausalLineageDigest?: string | null;
}>): void {
  const json = input.openingCausalLineageJson ?? null;
  const digest = input.openingCausalLineageDigest ?? null;
  if ((json === null) !== (digest === null)) {
    throw new Error("LIFECYCLE_OPENING_CAUSAL_LINEAGE_INCOMPLETE");
  }
  if (json === null || digest === null) return;
  const lineage = parseOpeningCausalLineageV1(json);
  if (lineage.contentDigest !== digest) {
    throw new Error("LIFECYCLE_OPENING_CAUSAL_LINEAGE_DIGEST_MISMATCH");
  }
  if (lineage.organizationId !== input.organizationId || lineage.symbol !== input.symbol) {
    throw new Error("LIFECYCLE_OPENING_CAUSAL_LINEAGE_SCOPE_MISMATCH");
  }
}
