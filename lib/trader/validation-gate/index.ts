export {
  STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION,
  promotionGovernanceStates,
  strategyTargetDeploymentStates,
  type AssembleStrategyPromotionRecordInput,
  type ConfidenceAttestation,
  type InsertPromotionRecordInput,
  type PromotionActor,
  type PromotionCostModel,
  type PromotionGovernancePatch,
  type PromotionGovernanceState,
  type PromotionPreview,
  type PromotionTransitionInput,
  type RequestPromotionInput,
  type StrategyLiveAuthorizationInput,
  type StrategyPromotionRecordPayload,
  type StrategyPromotionRecordSchemaVersion,
  type StrategyPromotionRecordView,
  type StrategyTargetDeploymentState,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";

export {
  StrategyPromotionConflictError,
  StrategyPromotionConcurrencyError,
  StrategyPromotionCoolingOffNotElapsedError,
  StrategyPromotionError,
  StrategyPromotionNotFoundError,
  StrategyPromotionRequiredError,
  StrategyPromotionValidationError,
  StrategyPromotionVersionMismatchError,
} from "@/lib/trader/validation-gate/strategy-promotion-record.errors";

export { assembleStrategyPromotionRecord } from "@/lib/trader/validation-gate/assemble-strategy-promotion-record";

export {
  DEFAULT_PROMOTION_COOLING_OFF_MS,
  effectivePromotionCoolingOffMs,
} from "@/lib/trader/validation-gate/config";

export {
  buildPaperTradingEvidenceSlot,
  buildStrategyPromotionRecordPayload,
  canonicalizeStrategyPromotionDigestInput,
  computeStrategyPromotionRecordDigest,
  type StrategyPromotionRecordDigestInput,
} from "@/lib/trader/validation-gate/serialize-strategy-promotion-record";

export { assertAllowedPromotionTransition } from "@/lib/trader/validation-gate/transitions";

export {
  buildPromotionPreview,
  createPostgresStrategyPromotionRepository,
  createPostgresStrategyPromotionService,
  createSqliteStrategyPromotionRepository,
  createSqliteStrategyPromotionService,
  createStrategyPromotionService,
  type StrategyPromotionRepository,
  type StrategyPromotionService,
} from "@/lib/trader/validation-gate/promotion-service";

export { assertStrategyLiveAuthorized } from "@/lib/trader/validation-gate/assert-strategy-live-authorized";

export {
  OperatorEvidenceError,
  parsePaperEvaluationExportDocument,
  summarizePaperEvidence,
  type EvidenceSummary,
} from "@/lib/trader/validation-gate/operator-evidence";

export {
  REQUIRED_EFFECTIVE_ACK,
  OperatorRunwayInputError,
  parseOperatorPromotionInputs,
  assertEffectiveAck,
  buildAssembleInput,
  type OperatorPromotionInputs,
} from "@/lib/trader/validation-gate/operator-promotion-inputs";
