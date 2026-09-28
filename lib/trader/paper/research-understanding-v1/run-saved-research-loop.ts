import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { claimBoundedResearchRuntimeControlLeaseV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { RecordedAnalysisRefusal, assertEnvironment } from "../durable-noncapital/recorded-analysis-v1";
import { ResearchRefusal } from "./contract";
import { createSavedResearchOwner, createSavedDomainResearchOwner, type ResearchRequest } from "./repository-postgres";

/** Saved source only. There is no provider, evaluator, capital or actor callback input. */
export async function runSavedResearchLoop(pool: postgres.Sql, context: OrgContext, supplied: ResearchRequest) {
  assertEnvironment(); const owner = createSavedResearchOwner(pool, context, supplied);
  const completed: Array<{ sequence: number; sourceSequence: number; outcome: "COMMITTED" | "REPLAYED";
    disposition: string; completionDigest: string; packetDigest: string }> = [];
  let holder: Awaited<ReturnType<typeof claimBoundedResearchRuntimeControlLeaseV2>> = null;
  try {
    for (let offset = 0; offset < owner.range.count; offset++) {
      const sourceSequence = owner.range.startSequence + offset;
      let result: Awaited<ReturnType<typeof owner.complete>> | null = await owner.replay(sourceSequence);
      if (!result) {
        // Only absent work claims exclusion. A completed restart never claims or samples a new PIT.
        if (!holder) holder = await claimBoundedResearchRuntimeControlLeaseV2(drizzle(pool, { schema }), {
          organizationId: owner.organizationId, runtimeInstanceId: `research-understanding:${randomUUID()}`, durationMs: owner.range.leaseDurationMs });
        if (!holder) return { status: "LEASE_BUSY" as const, completed };
        result = await owner.complete(sourceSequence, holder);
      }
      const c = result.completion;
      completed.push({ sequence: c.sequence, sourceSequence, outcome: result.outcome, disposition: c.output.disposition,
        completionDigest: c.contentDigest, packetDigest: c.packetDigest });
    }
    return { status: "COMPLETE" as const, completed };
  } catch (error) {
    if (error instanceof ResearchRefusal || error instanceof RecordedAnalysisRefusal) return { status: error.code, completed };
    if (error instanceof Error && error.message === "RUNTIME_CONTROL_LEASE_STALE_HOLDER") return { status: "LEASE_LOST", completed };
    // Missing membership, unexpected SQL/persistence errors and implementation failures are not market UNAVAILABLE.
    throw error;
  }
}

/** Fixed saved-domain command; the original loop above retains legacy ownership. */
export async function runSavedDomainResearchLoop(pool: postgres.Sql, context: OrgContext, supplied: ResearchRequest) {
  assertEnvironment(); return createSavedDomainResearchOwner(pool, context, supplied).execute();
}
