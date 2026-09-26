import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createReportingPeriodLifecycleService, type ReportingPeriodLifecycleServiceDeps } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { createPostgresReportingPeriodRepository, createSqliteReportingPeriodRepository } from "@/lib/trader/billing/repository-adapters";
import { createPostgresDraftInvoiceService, createSqliteDraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import { createSqliteHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { createBillingPeriodCloseOrchestrator, type BillingPeriodCloseOrchestratorDeps } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { assertOrgMembershipPostgres, assertOrgMembershipSqlite } from "@/lib/waia-core/scope/org-context";

/** Lower-level fixtures for existing historical fee/issuance/serializer tests.
 * These exercise the old persisted financial chain, NOT production source
 * admission. The public PostgreSQL close boundary has separate native tests. */
export function createHistoricalSqliteLifecycleFixture(db: WaiaDb, deps: Partial<ReportingPeriodLifecycleServiceDeps> = {}) {
  const assertMembership = deps.assertMembership ?? ((actor) => assertOrgMembershipSqlite(db, actor));
  return createReportingPeriodLifecycleService({ repository: createSqliteReportingPeriodRepository(db),
    writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    draftInvoiceService: createSqliteDraftInvoiceService(db, { assertMembership }), assertMembership, ...deps });
}
export function createHistoricalPostgresLifecycleFixture(db: WaiaPostgresDb) {
  const assertMembership: NonNullable<ReportingPeriodLifecycleServiceDeps["assertMembership"]> = (actor) => assertOrgMembershipPostgres(db, actor);
  return createReportingPeriodLifecycleService({ repository: createPostgresReportingPeriodRepository(db),
    writeAudit: (input) => writeTraderAuditLogPostgres(db, input),
    draftInvoiceService: createPostgresDraftInvoiceService(db, { assertMembership }), assertMembership });
}
export function createHistoricalSqliteCloseFixture(db: WaiaDb, deps: Partial<BillingPeriodCloseOrchestratorDeps> = {}) {
  const assertMembership = deps.assertMembership ?? ((actor) => assertOrgMembershipSqlite(db, actor));
  return createBillingPeriodCloseOrchestrator({ assertMembership,
    reportingPeriodLifecycle: createHistoricalSqliteLifecycleFixture(db, { assertMembership }),
    hwmLedger: createSqliteHwmLedgerService(db, { assertMembership }),
    draftInvoiceService: createSqliteDraftInvoiceService(db, { assertMembership }), ...deps });
}
