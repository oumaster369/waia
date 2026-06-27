export { fifoAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
export type { SettlementAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
export { createPostgresConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-postgres";
export { createSqliteConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-sqlite";
export type { ConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader.port";
export {
  evaluateSettlement,
  amountsMatchWithinTolerance,
} from "@/lib/trader/settlement/settlement-matching";
export {
  buildSettlementDepsFromEnv,
  runSettlementCycle,
} from "@/lib/trader/settlement/build-worker-deps";
export {
  createPostgresSettlementService,
  createSettlementService,
  createSqliteSettlementService,
} from "@/lib/trader/settlement/settlement-service";
export type { SettlementService } from "@/lib/trader/settlement/settlement-service";
export type {
  ConfirmedPaymentForSettlement,
  SettlementEvaluation,
  SettlementOutcome,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";
export { parityUsdtUsdValuation } from "@/lib/trader/settlement/valuation-policy";
export type { SettlementValuationPolicy } from "@/lib/trader/settlement/valuation-policy";
