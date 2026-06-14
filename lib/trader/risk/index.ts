export type {
  RiskCheckName,
  RiskDecision,
  RiskDecisionOutcome,
  RiskResizeHint,
  RiskSnapshot,
} from "@/lib/trader/risk/types";
export {
  riskReasonCodes,
  capitalReasonCodes,
  tradeAbuseReasonCodes,
  type CapitalLimitsReasonCode,
  type RiskReasonCode,
  type TradeAbuseReasonCode,
} from "@/lib/trader/risk/reason-codes";
export {
  approveDecision,
  buildRiskSnapshot,
  closeOnlyDecision,
  isTerminalReject,
  mergeReasonCodes,
  rejectDecision,
  resizeDecision,
  stopAccountDecision,
  type BuildRiskSnapshotInput,
} from "@/lib/trader/risk/decision";
export {
  DECIMAL_SCALE,
  DECIMAL_SCALE_FACTOR,
  InvalidDecimalError,
  absDecimal,
  addDecimal,
  compareDecimal,
  divideDecimal,
  floorDecimal,
  formatDecimal,
  isPositiveDecimal,
  isZeroDecimal,
  minDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
  type ScaledDecimal,
} from "@/lib/trader/risk/numeric";
export {
  createInMemoryOrderRateStore,
  InMemoryOrderRateStore,
} from "@/lib/trader/risk/order-rate-store";
export type {
  AccountRiskState,
  CapitalLimitsConfig,
  CapitalLimitsEvaluationInput,
  CapitalLimitsEvaluationResult,
  CapitalLimitsEvaluatorDeps,
  PositionSnapshot,
} from "@/lib/trader/risk/capital-limits.types";
export { evaluateCapitalLimits } from "@/lib/trader/risk/capital-limits-evaluator";
export type {
  OrderRateStore,
  TradeAbuseEvaluationInput,
  TradeAbuseEvaluationResult,
  TradeAbuseEvaluatorDeps,
  TradeAbuseLimitsConfig,
} from "@/lib/trader/risk/trade-abuse.types";
export { evaluateTradeAbuse } from "@/lib/trader/risk/trade-abuse-evaluator";
export {
  createPostgresRiskLimitsService,
  createRiskLimitsService,
  createSqliteRiskLimitsService,
  DEFAULT_ORG_RISK_LIMITS,
  diffRiskLimitsConfig,
  normalizeAndValidateRiskLimitsInput,
  RiskLimitsValidationError,
  riskLimitsConfigEquals,
  toCapitalLimitsConfig,
  toOrgRiskLimitsMetadata,
  toTradeAbuseLimitsConfig,
  type NormalizedRiskLimitsConfig,
  type OrgRiskLimitsMetadata,
  type RiskLimitsRepository,
  type RiskLimitsService,
  type UpsertOrgRiskLimitsInput,
} from "@/lib/trader/risk/limits";
