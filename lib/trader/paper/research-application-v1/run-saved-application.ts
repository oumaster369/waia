import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { ResearchApplicationRefusal } from "./contract";
import { createSavedApplicationOwner, createSavedDomainApplicationOwner, type SavedApplicationRequest } from "./repository-postgres";
import { ResearchRefusal } from "../research-understanding-v1/contract";
import { RecordedAnalysisRefusal } from "../durable-noncapital/recorded-analysis-v1";

/** Saved-only actual command. No evaluator, source, transport or authority callback input. */
export async function runSavedApplication(pool: postgres.Sql, context: OrgContext, input: SavedApplicationRequest) {
  return runApplicationOwner(createSavedApplicationOwner(pool, context, input));
}
export async function runSavedDomainApplication(pool: postgres.Sql, context: OrgContext, input: SavedApplicationRequest) {
  return runApplicationOwner(createSavedDomainApplicationOwner(pool, context, input));
}
async function runApplicationOwner(owner: ReturnType<typeof createSavedApplicationOwner>) {
  try { return await owner.execute(); }
  catch (error) {
    if (error instanceof ResearchApplicationRefusal || error instanceof ResearchRefusal || error instanceof RecordedAnalysisRefusal)
      return { status: error.code, outcome: "REFUSED" as const };
    if (error instanceof Error && error.message === "RUNTIME_CONTROL_LEASE_STALE_HOLDER")
      return { status: "LEASE_LOST", outcome: "REFUSED" as const };
    // A SQL or COMMIT error can leave a committed immutable stage. Never report rollback
    // or replace an unexpected implementation failure with ordinary market UNAVAILABLE.
    throw error;
  }
}
