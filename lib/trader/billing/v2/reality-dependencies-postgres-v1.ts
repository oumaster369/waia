import { enforceServerOnly } from "@/lib/enforce-server-only";
import { sql } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { assertOrgMembershipPostgres, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { listRealityEventsV2, listRealitySourceReportsV2, listTruthRecordsV2, lockRealityScopeV2,
  readLatestRealityProjectionV2, RealityV2PersistenceConflictError } from "@/lib/trader/reality/v2/repository-postgres";
import { assertBillingRealityOrganizationId, assertBillingRealityScope, assertBillingRealityCandidate, matchBillingRealityDependencies,
  refuseBillingReality, snapshotBillingCommand, type BillingRealityCandidate, type BillingRealityDependenciesMatched } from "./reality-dependencies-v1";

enforceServerOnly();
export type PostgresBillingCloseOptions = {
  assertMembership?: (context: OrgContext & { userId: string }, bound: WaiaPostgresDb) => void | Promise<void>;
};

/** Owns the entire command. Only real stored readers may satisfy admission; no
 * injected reader/validator, saved token or caller-held transaction is accepted. */
export async function runPostgresBillingRealityCommand<T extends BillingRealityCandidate, R>(
  db: WaiaPostgresDb, context: OrgContext, candidate: T, options: PostgresBillingCloseOptions,
  apply: (tx: WaiaPostgresDb, scoped: OrgContext, input: T, proof: BillingRealityDependenciesMatched) => Promise<R>,
): Promise<R> {
  const captured = snapshotBillingCommand({ context, candidate });
  const assertMembership = options.assertMembership;
  if (!db || typeof db.transaction !== "function" || "rollback" in db) {
    refuseBillingReality("BILLING_REALITY_TRANSACTION_OWNER_REQUIRED");
  }
  assertBillingRealityOrganizationId(captured.context.organizationId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
    const scoped = await requireServiceOrgContext(captured.context,
      (actor) => assertMembership ? assertMembership(actor, tx) : assertOrgMembershipPostgres(tx, actor));
    assertBillingRealityScope(scoped.organizationId, captured.candidate.exchangeAccountId);
    assertBillingRealityCandidate(scoped.organizationId, captured.candidate);
    const scope = { ...scoped, accountId: captured.candidate.exchangeAccountId };
    await lockRealityScopeV2(tx, scope);
    let proof: BillingRealityDependenciesMatched;
    try {
      const events = await listRealityEventsV2(tx, scope);
      const projection = await readLatestRealityProjectionV2(tx, scope);
      const sources = await listRealitySourceReportsV2(tx, scope);
      const truths = await listTruthRecordsV2(tx, scope);
      proof = matchBillingRealityDependencies({ organizationId: scoped.organizationId, candidate: captured.candidate,
        projection, ledger: { events, sources, truths } });
    } catch (error) {
      let cause: unknown = error;
      const seen = new Set<unknown>();
      while (cause && typeof cause === "object" && !seen.has(cause)) {
        seen.add(cause);
        if ((cause as { code?: string }).code === "42P01") refuseBillingReality("BILLING_REALITY_SCHEMA_UNAVAILABLE");
        cause = (cause as { cause?: unknown }).cause;
      }
      if (error instanceof RealityV2PersistenceConflictError) refuseBillingReality("BILLING_REALITY_LEDGER_INVALID");
      throw error;
    }
    return apply(tx, scoped, captured.candidate, proof);
  });
}
