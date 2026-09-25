import { createPostgresBillingPeriodCloseOrchestrator, createSqliteBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { WaiaDb } from "@/db/types";
import type { CredentialServiceDeps } from "@/lib/trader/credentials/types";
import { createPostgresMiSourceProvenanceRepository, createSqliteMiSourceProvenanceRepository } from "@/lib/trader/mi/repository-adapters";
import { createPostgresBalanceSnapshotService, createSqliteBalanceSnapshotService } from "@/lib/trader/balances/balance-snapshot-service";
import { createPostgresPositionSnapshotService, createSqlitePositionSnapshotService } from "@/lib/trader/positions/position-snapshot-service";
import { createPostgresTradeHistorySnapshotService, createSqliteTradeHistorySnapshotService } from "@/lib/trader/trade-history/trade-history-snapshot-service";
import { createPostgresCredentialService, createSqliteCredentialService } from "@/lib/trader/credentials/credential-service";
import { createPostgresDraftInvoiceService, createSqliteDraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import { createPostgresFeeComputationService, createSqliteFeeComputationService } from "@/lib/trader/billing/fee-computation-service";
import { createPostgresHwmLedgerService, createSqliteHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { createPostgresReportingPeriodLifecycleService, createSqliteReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { createPostgresMiSourceProvenanceService, createSqliteMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import { createPostgresMiObservationService, createSqliteMiObservationService } from "@/lib/trader/mi/observation-service";
import { createPostgresMiMeasurementService, createSqliteMiMeasurementService } from "@/lib/trader/mi/measurement-service";
import { createPostgresMiPatternService, createSqliteMiPatternService } from "@/lib/trader/mi/pattern-service";
import { createPostgresMiHypothesisService, createSqliteMiHypothesisService } from "@/lib/trader/mi/hypothesis-service";
import { createPostgresMiTrialService, createSqliteMiTrialService } from "@/lib/trader/mi/trial-service";
import { createPostgresMiTrialIntegrityService, createSqliteMiTrialIntegrityService } from "@/lib/trader/mi/trial-integrity-service";
import { createPostgresMiEvidenceService, createSqliteMiEvidenceService } from "@/lib/trader/mi/evidence-service";
import { createPostgresMiConfidenceJudgmentService, createSqliteMiConfidenceJudgmentService } from "@/lib/trader/mi/confidence-judgment-service";

type Deps = Partial<Pick<CredentialServiceDeps, "assertMembership" | "writeAudit" | "createProvider">>;

export function createPostgresActorServices(db: WaiaPostgresDb, deps: Deps = {}) {
  const sourceRepository = createPostgresMiSourceProvenanceRepository(db);
  return {
    periodClose: createPostgresBillingPeriodCloseOrchestrator(db, deps),
    balance: createPostgresBalanceSnapshotService(db, deps),
    position: createPostgresPositionSnapshotService(db, deps),
    tradeHistory: createPostgresTradeHistorySnapshotService(db, deps),
    credential: createPostgresCredentialService(db, deps),
    draftInvoice: createPostgresDraftInvoiceService(db, deps),
    fee: createPostgresFeeComputationService(db, deps),
    hwm: createPostgresHwmLedgerService(db, deps),
    period: createPostgresReportingPeriodLifecycleService(db, deps),
    source: createPostgresMiSourceProvenanceService(db, deps),
    observation: createPostgresMiObservationService(db, sourceRepository, deps).observation,
    measurement: createPostgresMiMeasurementService(db, deps).measurement,
    pattern: createPostgresMiPatternService(db, deps).pattern,
    hypothesis: createPostgresMiHypothesisService(db, deps).hypothesis,
    trial: createPostgresMiTrialService(db, deps).trial,
    integrity: createPostgresMiTrialIntegrityService(db, deps).trialIntegrity,
    evidence: createPostgresMiEvidenceService(db, deps).evidence,
    confidence: createPostgresMiConfidenceJudgmentService(db, deps).confidenceJudgment,
  };
}

export function createSqliteActorServices(db: WaiaDb, deps: Deps = {}) {
  const sourceRepository = createSqliteMiSourceProvenanceRepository(db);
  return {
    periodClose: createSqliteBillingPeriodCloseOrchestrator(db, deps),
    balance: createSqliteBalanceSnapshotService(db, deps),
    position: createSqlitePositionSnapshotService(db, deps),
    tradeHistory: createSqliteTradeHistorySnapshotService(db, deps),
    credential: createSqliteCredentialService(db, deps),
    draftInvoice: createSqliteDraftInvoiceService(db, deps),
    fee: createSqliteFeeComputationService(db, deps),
    hwm: createSqliteHwmLedgerService(db, deps),
    period: createSqliteReportingPeriodLifecycleService(db, deps),
    source: createSqliteMiSourceProvenanceService(db, deps),
    observation: createSqliteMiObservationService(db, sourceRepository, deps).observation,
    measurement: createSqliteMiMeasurementService(db, deps).measurement,
    pattern: createSqliteMiPatternService(db, deps).pattern,
    hypothesis: createSqliteMiHypothesisService(db, deps).hypothesis,
    trial: createSqliteMiTrialService(db, deps).trial,
    integrity: createSqliteMiTrialIntegrityService(db, deps).trialIntegrity,
    evidence: createSqliteMiEvidenceService(db, deps).evidence,
    confidence: createSqliteMiConfidenceJudgmentService(db, deps).confidenceJudgment,
  };
}
