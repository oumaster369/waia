// Auto-derived from Human-bound staging: .cursor/plans/dee-415-htr-wp13-wp16-staging/timeframe-evidence-lane-authority-matrix-v1.json
// DO NOT edit semantic bytes manually.

export const TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DATA = {
  "matrixId": "TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1",
  "schemaVersion": 2,
  "boundToProfile": "HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1",
  "FHV_SCOPE_LIMITATION": "PRICE_ONLY_GROUNDED_EVIDENCE",
  "MULTI_SOURCE_HISTORICAL_VALIDATION": "NOT_PERFORMED",
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
  "groundingBasisEnum": [
    "EXISTING_CANON",
    "EXISTING_CODE_POLICY",
    "PROVIDER_PUBLISHED_CADENCE",
    "DATASET_INTERVAL_DERIVATION",
    "HUMAN_POLICY_RECOMMENDATION_WITH_RATIONALE",
    "UNAVAILABLE_NO_NUMBER"
  ],
  "timeframeAuthority": [
    {
      "timeframe": "1d",
      "question": "Is it acceptable to search for trades today?",
      "authority": "GLOBAL_STRUCTURAL_SCENARIO",
      "output": "dailyPermission: TRADE_ALLOWED|REDUCE_RISK|WAIT|PRESERVE_CAPITAL|ONLY_CLOSE",
      "grounding": "EXISTING_CANON",
      "groundingRef": "AI-TRADER-TARGET-ARCHITECTURE.md §10"
    },
    {
      "timeframe": "4h",
      "question": "Who controls the market?",
      "authority": "MAJOR_STRUCTURE_REGIME",
      "output": "dominantScenario",
      "grounding": "EXISTING_CANON",
      "groundingRef": "AI-TRADER-TARGET-ARCHITECTURE.md §10"
    },
    {
      "timeframe": "1h",
      "question": "What working scenario is developing now?",
      "authority": "OPERATIONAL_STRUCTURE_CONTEXT",
      "output": "operationalHypothesis",
      "grounding": "EXISTING_CANON",
      "groundingRef": "AI-TRADER-TARGET-ARCHITECTURE.md §10"
    },
    {
      "timeframe": "15m",
      "question": "Has a real opportunity appeared?",
      "authority": "TACTICAL_SETUP_CONTEXT",
      "output": "setupValidation",
      "grounding": "EXISTING_CANON",
      "groundingRef": "AI-TRADER-TARGET-ARCHITECTURE.md §10"
    },
    {
      "timeframe": "1m",
      "question": "Can execution be done safely now?",
      "authority": "EXECUTION_SAFETY_PRECISION_ONLY",
      "output": "executionReadiness",
      "cannotCreateHtfStructure": true,
      "grounding": "EXISTING_CANON",
      "groundingRef": "AI-TRADER-TARGET-ARCHITECTURE.md §10, §12.1"
    }
  ],
  "lanes": [
    {
      "laneId": "price_klines_1m",
      "providerClass": "HTX_SPOT_KLINES",
      "marketQuestion": "What is the closed-bar price/volume truth?",
      "historicalReplaySource": "FHV_DATASET_MANIFEST_V1_HTX_SPOT_1M",
      "refreshCadence": "60s (closed 1m bar)",
      "refreshCadenceGrounding": "DATASET_INTERVAL_DERIVATION",
      "maxAgeFreshness": "1 closed bar (60s)",
      "maxAgeGrounding": "DATASET_INTERVAL_DERIVATION",
      "pitAvailabilityRule": "bar available only at/after its closeTime; half-open [open,close)",
      "timeframesAllowedToRead": [
        "1m",
        "15m",
        "1h",
        "4h",
        "1d"
      ],
      "fieldsItMayInfluence": [
        "canvas.oneMinuteRing",
        "canvas.mtf",
        "canvas.reconstruction",
        "features",
        "understanding",
        "hypothesis",
        "conviction",
        "msv",
        "executionReadiness"
      ],
      "decisionsForbidden": [
        "none-beyond-timeframe-authority; 1m may not create/override HTF structure"
      ],
      "absenceReasonCode": "INGRESS_INTEGRITY_GATE_FAIL_CLOSED",
      "degradationReasonCode": "N/A_PRIMARY_LANE_FAIL_CLOSED",
      "fallbackPolicy": "NONE_FAIL_CLOSED",
      "historicalAvailability": "AVAILABLE_ON_REAL_DATASET_ACQUISITION"
    },
    {
      "laneId": "fear_greed_index",
      "providerClass": "SENTIMENT_INDEX",
      "marketQuestion": "What is crowd fear/greed context?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "liveProviderCadenceDoc": "1/day",
      "liveCadenceGrounding": "PROVIDER_PUBLISHED_CADENCE",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h",
        "1h"
      ],
      "fieldsItMayInfluence": [
        "futureContext",
        "understanding",
        "hypothesis.support"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup",
        "size position"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "fear_greed_index_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "global_market_stats",
      "providerClass": "GLOBAL_MARKET_AGGREGATE",
      "marketQuestion": "What is total-market cap/dominance context?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "futureContext",
        "understanding"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup",
        "size position"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "global_market_stats_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "cross_exchange_confirmation",
      "providerClass": "CROSS_VENUE_PRICE",
      "marketQuestion": "Do other venues agree on price?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1m",
        "15m"
      ],
      "fieldsItMayInfluence": [
        "dataTruthStatus",
        "dataQualityScore"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup",
        "increase permission"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "cross_exchange_confirmation_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "order_book_snapshot",
      "providerClass": "L2_ORDERBOOK",
      "marketQuestion": "What is book imbalance/liquidity at execution?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1m"
      ],
      "fieldsItMayInfluence": [
        "executionReadiness",
        "spread",
        "slippageState"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "create HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "order_book_snapshot_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "market_trades_snapshot",
      "providerClass": "PUBLIC_TRADES",
      "marketQuestion": "What is recent trade flow at execution?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1m"
      ],
      "fieldsItMayInfluence": [
        "executionReadiness",
        "microstructureSafety"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "create HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "market_trades_snapshot_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "macro_series",
      "providerClass": "MACRO_TIMESERIES",
      "marketQuestion": "What is the macro backdrop (rates, DXY, etc.)?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "futureContext",
        "eventRisk"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "macro_series_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "macro_calendar_event",
      "providerClass": "MACRO_CALENDAR",
      "marketQuestion": "Is a scheduled macro event imminent?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h",
        "1h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "macro_calendar_event_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "macro_probability",
      "providerClass": "MACRO_PROBABILITY",
      "marketQuestion": "What is the probability of a macro outcome?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "macro_probability_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "news_headline",
      "providerClass": "NEWS",
      "marketQuestion": "Is there market-moving news?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h",
        "1h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "news_headline_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "news_event_cluster",
      "providerClass": "NEWS_CLUSTER",
      "marketQuestion": "Is there a clustered news regime?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h",
        "1h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "news_event_cluster_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "exchange_announcement",
      "providerClass": "EXCHANGE_ANNOUNCEMENT",
      "marketQuestion": "Is there an exchange-level event (listing/halt)?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h",
        "1h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "dataTruthStatus"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "exchange_announcement_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "protocol_release",
      "providerClass": "PROTOCOL_RELEASE",
      "marketQuestion": "Is there a protocol/upgrade event?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "protocol_release_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "blockchain_network_stats",
      "providerClass": "ONCHAIN_STATS",
      "marketQuestion": "What is on-chain network context?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup",
        "act as direct trigger"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "blockchain_network_stats_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "regulatory_filing",
      "providerClass": "REGULATORY",
      "marketQuestion": "Is there a regulatory event?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "eventRisk",
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "regulatory_filing_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    },
    {
      "laneId": "mempool_stats",
      "providerClass": "MEMPOOL",
      "marketQuestion": "What is mempool congestion/fee context?",
      "historicalReplaySource": "UNAVAILABLE",
      "refreshCadence": "UNAVAILABLE",
      "refreshCadenceGrounding": "UNAVAILABLE_NO_NUMBER",
      "maxAgeFreshness": "UNAVAILABLE",
      "maxAgeGrounding": "UNAVAILABLE_NO_NUMBER",
      "pitAvailabilityRule": "sidecar-v3 PIT timestamp <= closed bar closeTime",
      "timeframesAllowedToRead": [
        "1d",
        "4h"
      ],
      "fieldsItMayInfluence": [
        "futureContext"
      ],
      "decisionsForbidden": [
        "create BUY/SELL",
        "override HTF structure",
        "create setup",
        "act as direct trigger"
      ],
      "absenceReasonCode": "SIDECAR_LANE_ABSENT",
      "degradationReasonCode": "mempool_stats_unavailable:SIDECAR_LANE_ABSENT",
      "fallbackPolicy": "EXPLICIT_UNAVAILABLE_NO_SYNTHESIS",
      "historicalAvailability": "UNAVAILABLE"
    }
  ],
  "hardInvariants": [
    "no timeframe directly calls a provider",
    "every lane enters through buildHistoricalIngressContext (sanctioned ingress/fusion path)",
    "1D global structural/scenario authority",
    "4H major structure/regime authority",
    "1H operational structure/context authority",
    "15m tactical setup/context authority",
    "1m execution-safety precision only",
    "1m cannot create or override 15m/1h/4h/1d structure",
    "HTF state changes only on closed-bar boundaries",
    "slow context cannot independently create a BUY/SELL",
    "missing lane remains explicit UNAVAILABLE (SIDECAR_LANE_ABSENT); no synthesis",
    "no partial HTF bar leakage; no lookahead"
  ],
  "notes": [
    "For HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1, only the primary HTX spot 1m price lane (and its closed-bar 15m/1h/4h/1d derivations) has a real historical replay source (FHV dataset manifest v1). All 15 optional sidecar lanes are UNAVAILABLE for the historical profile because no real HTX 2020-2025 PIT sidecar dataset has been acquired or qualified (WP12 gap-closure semantics; WP23 owns final dataset pinning).",
    "liveProviderCadenceDoc/liveCadenceGrounding fields are documentation of live-runtime provider cadence and are NOT authoritative historical numbers; historical numbers remain UNAVAILABLE_NO_NUMBER until a real sidecar dataset is acquired via a separate Human dataset-source decision."
  ]
} as const;
