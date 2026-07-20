export {
  CanonicalCrossBackendAccountingEngineV1,
  advanceAccountingFrontier,
  applyAccountingFill,
  attachAccountingMarks,
  assertAccountingIdempotency,
  computeAccountingSemanticDigest,
  createInitialAccountingState,
  grossUnrealizedPnl,
  netUnrealizedPnl,
  remainingGrossPositionBasis,
  remainingNetPositionBasis,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";

export {
  ACCOUNTING_BASIS_METHOD,
  ACCOUNTING_ENGINE_ID,
  ACCOUNTING_FRONTIER_SCHEMA_VERSION,
  AccountingIdempotencyConflictError,
  AccountingInvariantError,
  HTR_PNL_REPORT_SCHEMA_VERSION,
} from "@/lib/trader/accounting/accounting-frontier.types";

export type {
  AccountingFillInput,
  AccountingFrontierV1,
  AccountingStateV1,
  AdvanceAccountingFrontierInput,
  MarksJsonV1,
  SymbolPositionBasis,
} from "@/lib/trader/accounting/accounting-frontier.types";

export {
  appendAccountingFrontier,
  createAccountingFrontierRepositoryMemory,
  createAccountingFrontierRepositoryPostgres,
  loadLatestAccountingFrontier,
} from "@/lib/trader/accounting/accounting-frontier-repository-postgres";

export type {
  AccountingFrontierRepository,
  AppendAccountingFrontierInput,
} from "@/lib/trader/accounting/accounting-frontier-repository-postgres";

export { buildHtrPnlReportV1 } from "@/lib/trader/accounting/build-htr-pnl-report-v1";
export {
  computeHtrPnlReportDigest,
  serializeHtrPnlReportV1,
} from "@/lib/trader/accounting/serialize-htr-pnl-report-v1";
export type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
