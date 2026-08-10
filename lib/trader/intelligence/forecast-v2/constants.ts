/** Frozen Forecast V2 contract version pins (DEE-518 §2). */
export const QUANTIZER_VERSION = "quantizeScale8HalfUp/v1" as const;
export const SAMPLER_CONTRACT_VERSION = "waia-cbrng/sha256-ctr/v1" as const;
export const STATIONARY_BOOTSTRAP_VERSION = "stationary-bootstrap/v1" as const;
export const DISTRIBUTION_SEMANTIC_VERSION = "dist-sem-v1" as const;
export const MODEL_TRANSFORM_VERSION = "rv-state-conditional-empirical-joint/v1" as const;
export const COMPONENT_LAYOUT_VERSION = "exec-opp-13d-v1" as const;
export const ENERGY_MC_VERSION = "energy-mc/v1" as const;

export const WAIA_CBRNG_MAGIC = "WAIACBR1" as const;

export const CBRNG_DOMAIN_EPIBOOT1 = "EPIBOOT1" as const;
export const CBRNG_DOMAIN_ALEDRAW1 = "ALEDRAW1" as const;
export const CBRNG_DOMAIN_SCORECRN1 = "SCORECRN1" as const;
export const CBRNG_DOMAIN_VALBOOT1 = "VALBOOT1" as const;

export const BOOTSTRAP_ROOT_PREFIX_16 = "WAIAEPIBOOTROOT1" as const;
export const ALEATORIC_ROOT_PREFIX_16 = "WAIAALEDRAWROOT1" as const;
export const SCORE_ROOT_PREFIX_16 = "WAIASCOREROOT001" as const;
export const VALIDATION_BOOTSTRAP_ROOT_PREFIX_16 = "WAIAVALBOOTROOT1" as const;

export const BOOTSTRAP_ROOT_PREFIX_HEX = "57414941455049424f4f54524f4f5431" as const;
export const ALEATORIC_ROOT_PREFIX_HEX = "57414941414c4544524157524f4f5431" as const;
export const SCORE_ROOT_PREFIX_HEX = "5741494153434f5245524f4f54303031" as const;
export const VALIDATION_BOOTSTRAP_ROOT_PREFIX_HEX = "5741494156414c424f4f54524f4f5431" as const;

export const ALPHA_EPI_CONFIG_SCALE8 = "0.10000000" as const;

export const K_MAX = 50 as const;
export const M_MAX = 80 as const;
export const REPLICA_ARTIFACT_MAX_BYTES = 65536 as const;

export const TARGET_ROLE_TERMINAL = "TERMINAL_RETURN" as const;
export const TARGET_ROLE_EXECUTION = "EXECUTION_OPPORTUNITY" as const;

export const REPRESENTATION_DISCRETE_SCENARIO = "DISCRETE_SCENARIO" as const;
export const REPRESENTATION_SAMPLE_ENSEMBLE = "SAMPLE_ENSEMBLE" as const;
