// Auto-derived from Human-bound staging: .cursor/plans/dee-415-htr-wp13-wp16-staging/htr-historical-intelligence-profile-v1.json
// DO NOT edit semantic bytes manually.

export const HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DATA = {
  "profileId": "HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1",
  "schemaVersion": 2,
  "supersedesProposedDraftDigest": "fac1a44f06642748c7f42bfe10790cd2e0a341fa730af1a7a83ffeec43adbec2",
  "historicalEvidenceCapability": "PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE",
  "activation": {
    "isGlobalDefault": false,
    "explicitActivationOnly": true,
    "activationSeam": "runBacktest historicalProfile input -> runEvaluationCycle miCoreEnabled",
    "globalDefaultProhibited": true,
    "liveProviderCallProhibited": true,
    "paperProhibited": true,
    "liveProhibited": true,
    "holdoutAccessProhibited": true
  },
  "venueScope": "HTX_ONLY",
  "marketType": "SPOT",
  "symbols": [
    "BTCUSDT",
    "ETHUSDT"
  ],
  "baseInterval": "1m",
  "derivedIntervals": [
    "15m",
    "1h",
    "4h",
    "1d"
  ],
  "derivedIntervalRule": "CLOSED_BARS_ONLY",
  "enabledIntelligenceStages": [
    "historical_ingress_pit",
    "context_fusion",
    "market_canvas",
    "incremental_mtf",
    "incremental_reconstruction",
    "market_understanding",
    "hypothesis_engine",
    "conviction_accumulation",
    "cde_msv_permission_gate",
    "strategy_consumers",
    "decision_chain_terminal_reason"
  ],
  "recordLevelOnly": true,
  "matureAutonomousEnginesProhibited": true,
  "strategyConsumerPolicy": {
    "portfolioMode": "SHARED_MULTI_INSTRUMENT",
    "enabledHistoricalConsumers": [
      "liquidity_sweep_reversal_v0",
      "mean_reversion_v0"
    ],
    "researchOnly": [
      "trend_momentum_v0"
    ],
    "researchOnlySemantics": "EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE",
    "researchOnlyProhibitions": [
      "must not enter trade-eligible aggregation",
      "must not produce an executable order intent",
      "must not reach capital authority",
      "must not be treated as promoted",
      "must not contribute to approved-strategy PnL",
      "must not bypass WP14 Decision/Risk"
    ],
    "enablementIsNotStrategyValidationGateApproval": true,
    "enablementIsNotEdgeOrProfitabilityVerdict": true,
    "strategySelfPromotionProhibited": true,
    "versionSelectionRule": "PIN_EXACT_REGISTERED_VERSION_AT_WP16",
    "versionPinningAndLifecycleGatingOwnedByWP16": "STRAT_TM_STRATEGY_NOT_ALLOWED enforced at WP16",
    "liveAndPaperActivationProhibited": true,
    "profileRecordsEnablementButDoesNotSelfPromote": true
  },
  "providerEvidenceLanePolicy": {
    "ingress": "buildHistoricalIngressContext only; no direct provider import by timeframe/strategy/CDE",
    "sidecar": "PIT sidecar-v3; timestamp <= closed bar closeTime",
    "missingLane": "EXPLICIT_UNAVAILABLE (SIDECAR_LANE_ABSENT); no synthesis",
    "matrixDigestCanonical": "6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6"
  },
  "pitPolicy": "no observation with timestamp after the current closed-bar closeTime may enter fusion; future evidence neutralized (guardNoLookahead)",
  "closedBarPolicy": "HTF state changes only on closed-bar boundaries; no partial HTF bar leakage",
  "terminalReasonPolicy": "every evaluation cycle emits exactly one universal terminal reason code, including every no-trade cycle",
  "hypothesisLinkPolicy": "authoritative deterministic hypothesis identity/link (DUP-14) between in-cycle hypothesis and record; traceable",
  "convictionRecordPolicy": "conviction is recorded per cycle; sustained-conviction accumulation is deterministic; no trade without sustained conviction",
  "noTradePolicyBoundary": "a justified NO_TRADE is a valid successful terminal outcome; slow context alone cannot create BUY/SELL",
  "deterministicClockIdPolicy": "deterministic clock + deterministic IDs (ADR-0021); byte-identical replay",
  "checkpointSerializationOwnership": "canvas/runtime checkpoint serialization owned by WP05/WP09 substrate; WP13 adds intelligence-record serialization within existing bounded contract (no unbounded retention)",
  "evidenceTraceOwnership": "WP13 owns Market Canvas -> Market Understanding semantic-trace boundaries; per-module semantic-boundary record per FHV inside-out contract v1 §3.2",
  "hardRequirements": [
    "historical profile is explicit, never global default",
    "no live provider call",
    "no direct provider import by timeframe, strategy or CDE",
    "no partial HTF bar leakage",
    "no lookahead",
    "missing evidence lane is explicit UNAVAILABLE",
    "1m cannot create HTF structure",
    "slow context cannot independently create BUY/SELL",
    "all terminal paths emit an explicit reason",
    "no strategy self-promotion",
    "no capital authority"
  ],
  "activatesOnlyRecordLevelChainApprovedByD1": true,
  "priceOnlyScopeDisclosure": "This profile validates the price-grounded intelligence path. It does not constitute a full historical validation of the multi-source intelligence stack.",
  "notes": [
    "Bound to TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1 (matrix digest pinned in providerEvidenceLanePolicy.matrixDigestCanonical).",
    "historicalEvidenceCapability = PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE: for the historical profile all 15 optional sidecar lanes are UNAVAILABLE (no real HTX 2020-2025 PIT sidecar dataset acquired); only the HTX spot 1m price lane + closed-bar derivations are available on real dataset acquisition.",
    "strategyConsumerPolicy defines the runtime consumer set: enabled liquidity_sweep_reversal_v0 and mean_reversion_v0; research-only trend_momentum_v0 is EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE.",
    "Prior proposed-draft digest fac1a44f06642748c7f42bfe10790cd2e0a341fa730af1a7a83ffeec43adbec2 is SUPERSEDED_PROPOSED_DRAFT lineage only (not a runtime governance state)."
  ]
} as const;
