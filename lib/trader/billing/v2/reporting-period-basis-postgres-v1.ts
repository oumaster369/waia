import { enforceServerOnly } from "@/lib/enforce-server-only";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOrgMembershipPostgres, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { mapReportingPeriodRow } from "../reporting-period-row-mapper";
import type { ReportingPeriodRepository } from "../reporting-period-repository.types";
import { serializeReportingPeriodDigestInput } from "../serialize-reporting-period";
import { canonicalizeSemanticJsonString as canonicalJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { readExactRealityLedgerV2, RealityExactReadUnavailableV2, RealityV2PersistenceConflictError } from "@/lib/trader/reality/v2/repository-postgres";
import { BillingCanonicalProfitAdmissionError } from "./admit-realized-profit-receipt-v2";
import { assertBillingRealityScope, matchBillingRealityDependencies, snapshotBillingCommand,
  type BillingRealityCandidate, type BillingRealityDependenciesMatched } from "./reality-dependencies-v1";
import type { PostgresBillingCloseOptions } from "./reality-dependencies-postgres-v1";
import { buildReportingPeriodBasisV1, candidateFromReportingPeriodBasis, captureReportingPeriodBasisReadSet,
  parseReportingPeriodBasisV1, refusePeriodBasis, REPORTING_PERIOD_BASIS_MAX_BYTES, REPORTING_PERIOD_BASIS_V1,
  type ReportingPeriodBasisReadSetV1, type ReportingPeriodBasisV1, ReportingPeriodBasisError } from "./reporting-period-basis-v1";

enforceServerOnly();
type BasisWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
/** Internal owner output, never a public command option or request payload. */
export type OwnedReportingPeriodBasisInput = Readonly<{
  context: OrgContext; candidate: BillingRealityCandidate;
  dependencies: BillingRealityDependenciesMatched; ledgerReadSet: ReportingPeriodBasisReadSetV1;
}>;

/** Used only in the two private, already-admitted close compositions. */
export function withReportingPeriodBasisRetention(ex: BasisWriteExecutor, repository: ReportingPeriodRepository,
  owned: OwnedReportingPeriodBasisInput): ReportingPeriodRepository {
  return { ...repository, async closePeriod(context, input) {
    if (context.organizationId !== owned.context.organizationId || context.userId !== owned.context.userId) refusePeriodBasis("BASIS_CONTENT_INVALID");
    const period = await repository.closePeriod(context, input);
    const basis = buildReportingPeriodBasisV1({ period, candidate: owned.candidate, dependencies: owned.dependencies,
      ledgerReadSet: owned.ledgerReadSet, actor: owned.context.userId === undefined ? { type: "SERVICE" } : { type: "USER", userId: owned.context.userId } });
    const canonicalJson = canonicalJsonString(basis);
    const t = schema.traderReportingPeriodBasesV1, p = basis.dependencies.binding.projection;
    const inserted = await ex.insert(t).values({ reportingPeriodId: period.id, organizationId: basis.organizationId,
      exchangeAccountId: basis.exchangeAccountId, schemaVersion: basis.schemaVersion, periodRecordContentDigest: period.recordContentDigest,
      receiptContentDigest: basis.receipt.contentDigestHex, contentDigest: basis.contentDigestHex, realityProjectionId: p.projectionId,
      realityFrontierSequence: BigInt(p.frontierSequence), realityFrontierEventDigest: p.frontierEventDigestHex,
      realityKnowledgeAsOf: new Date(p.knowledgeAsOfUtc), canonicalJson }).onConflictDoNothing().returning({ id: t.reportingPeriodId });
    if (!inserted.length) {
      const rows = await ex.select({ matches: sql<boolean>`${t.canonicalJson} = ${canonicalJson} AND ${t.contentDigest} = ${basis.contentDigestHex}` })
        .from(t).where(and(eq(t.reportingPeriodId, period.id), eq(t.organizationId, basis.organizationId), eq(t.exchangeAccountId, basis.exchangeAccountId))).limit(1);
      if (rows[0]?.matches !== true) refusePeriodBasis("BASIS_CONTENT_INVALID");
    }
    return period;
  } };
}

export type ReportingPeriodBasisReadInput = Readonly<{ periodId: string; exchangeAccountId: string }>;
export type ReportingPeriodBasisReadResult =
  | { status: "BASIS_MISSING"; basis: null }
  | { status: "BASIS_REPLAYED_AT_CLOSE"; basis: ReportingPeriodBasisV1; currentEconomicValidity: "NOT_ASSESSED" }
  | { status: "BASIS_SOURCE_REPLAY_UNAVAILABLE"; basis: ReportingPeriodBasisV1; currentEconomicValidity: "NOT_ASSESSED"; reason: "MISSING_IDENTITIES" | "CAPACITY_EXCEEDED" };

export function assertReportingPeriodBasisReadScope(context: OrgContext, input: ReportingPeriodBasisReadInput): void {
  try {
    assertBillingRealityScope(context.organizationId, input.exchangeAccountId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.periodId)) throw new Error();
  } catch { refusePeriodBasis("BASIS_INVALID_INPUT"); }
}

function isMissingTable(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ((error as { code?: string }).code === "42P01") return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}

/** Historical read owns one stable read-only snapshot. No provider, current
 * projection fallback, repair, invoice/HWM side effect or caller-held transaction. */
export async function readReportingPeriodBasisV1Postgres(db: WaiaPostgresDb, context: OrgContext,
  input: ReportingPeriodBasisReadInput, options: PostgresBillingCloseOptions = {}): Promise<ReportingPeriodBasisReadResult> {
  const captured = snapshotBillingCommand({ context, input }), assertMembership = options.assertMembership;
  if (!db || typeof db.transaction !== "function" || "rollback" in db) refusePeriodBasis("BASIS_TRANSACTION_OWNER_REQUIRED");
  assertReportingPeriodBasisReadScope(captured.context, captured.input);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
      const scoped = await requireServiceOrgContext(captured.context,
        (actor) => assertMembership ? assertMembership(actor, tx) : assertOrgMembershipPostgres(tx, actor));
      const p = schema.traderReportingPeriods, t = schema.traderReportingPeriodBasesV1;
      // All three scope predicates precede validated mapping: foreign corrupted
      // content must not leak a mismatch in place of the ordinary not-found result.
      const periods = await tx.select().from(p).where(and(eq(p.organizationId, scoped.organizationId),
        eq(p.exchangeAccountId, captured.input.exchangeAccountId), eq(p.id, captured.input.periodId))).limit(1);
      if (!periods[0]) refusePeriodBasis("BASIS_PERIOD_NOT_FOUND");
      if (periods[0].status !== "CLOSED") refusePeriodBasis("PERIOD_NOT_CLOSED");
      let period;
      try { period = mapReportingPeriodRow(periods[0]); } catch { refusePeriodBasis("BASIS_PERIOD_MISMATCH"); }
      const where = and(eq(t.organizationId, scoped.organizationId), eq(t.exchangeAccountId, captured.input.exchangeAccountId), eq(t.reportingPeriodId, period.id));
      const headers = await tx.select({ schemaVersion: t.schemaVersion, reportingPeriodId: t.reportingPeriodId, organizationId: t.organizationId,
        exchangeAccountId: t.exchangeAccountId, periodRecordContentDigest: t.periodRecordContentDigest, receiptContentDigest: t.receiptContentDigest,
        contentDigest: t.contentDigest, realityProjectionId: t.realityProjectionId, realityFrontierSequence: t.realityFrontierSequence,
        realityFrontierEventDigest: t.realityFrontierEventDigest, realityKnowledgeAsOf: t.realityKnowledgeAsOf,
        bytes: sql<number>`octet_length(${t.canonicalJson})` }).from(t).where(where).limit(1);
      const header = headers[0];
      if (!header) return { status: "BASIS_MISSING", basis: null };
      if (header.bytes > REPORTING_PERIOD_BASIS_MAX_BYTES) refusePeriodBasis("BASIS_CAPACITY_EXCEEDED");
      if (header.schemaVersion !== REPORTING_PERIOD_BASIS_V1) refusePeriodBasis("BASIS_VERSION_UNSUPPORTED");
      const bodies = await tx.select({ canonicalJson: t.canonicalJson }).from(t).where(where).limit(1);
      if (!bodies[0]) refusePeriodBasis("BASIS_CONTENT_INVALID");
      const basis = parseReportingPeriodBasisV1(bodies[0].canonicalJson), projection = basis.dependencies.binding.projection;
      if (basis.reportingPeriodId !== header.reportingPeriodId || basis.organizationId !== header.organizationId || basis.exchangeAccountId !== header.exchangeAccountId ||
        basis.contentDigestHex !== header.contentDigest || basis.period.recordContentDigest !== header.periodRecordContentDigest ||
        basis.receipt.contentDigestHex !== header.receiptContentDigest || projection.projectionId !== header.realityProjectionId ||
        projection.frontierSequence !== header.realityFrontierSequence.toString() || projection.frontierEventDigestHex !== header.realityFrontierEventDigest ||
        projection.knowledgeAsOfUtc !== header.realityKnowledgeAsOf.toISOString()) refusePeriodBasis("BASIS_CONTENT_INVALID");
      if (canonicalJsonString(basis.period) !== canonicalJsonString({ ...serializeReportingPeriodDigestInput(period), recordContentDigest: period.recordContentDigest })) {
        refusePeriodBasis("BASIS_PERIOD_MISMATCH");
      }
      try {
        const manifest = basis.ledgerReadSet;
        const stored = await readExactRealityLedgerV2(tx, { ...scoped, accountId: basis.exchangeAccountId }, {
          sourceIds: manifest.sources.map((r) => r.id), truthIds: manifest.truths.map((r) => r.id), eventIds: manifest.events.map((r) => r.id), projectionId: manifest.projectionId });
        if (canonicalJsonString(captureReportingPeriodBasisReadSet(stored.ledger, stored.projection)) !== canonicalJsonString(manifest)) refusePeriodBasis("BASIS_SOURCE_REPLAY_MISMATCH");
        const matched = matchBillingRealityDependencies({ organizationId: basis.organizationId, candidate: candidateFromReportingPeriodBasis(basis), ...stored });
        if (canonicalJsonString(matched) !== canonicalJsonString(basis.dependencies)) refusePeriodBasis("BASIS_SOURCE_REPLAY_MISMATCH");
      } catch (error) {
        if (error instanceof RealityExactReadUnavailableV2) return { status: "BASIS_SOURCE_REPLAY_UNAVAILABLE", basis,
          currentEconomicValidity: "NOT_ASSESSED", reason: error.reason };
        if (error instanceof RealityV2PersistenceConflictError || error instanceof BillingCanonicalProfitAdmissionError || error instanceof ReportingPeriodBasisError) {
          refusePeriodBasis("BASIS_SOURCE_REPLAY_MISMATCH");
        }
        throw error;
      }
      return { status: "BASIS_REPLAYED_AT_CLOSE", basis, currentEconomicValidity: "NOT_ASSESSED" };
    });
  } catch (error) { if (isMissingTable(error)) refusePeriodBasis("BASIS_SCHEMA_UNAVAILABLE"); throw error; }
}
