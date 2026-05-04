/** DEE-47: Twin Chat vs Diary as distinct memory-input channels — contract types only (no persistence). */

export const TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION = "twin-memory-channel-contracts-v1" as const;

export type TwinMemoryChannelContractsSchemaVersion = typeof TWIN_MEMORY_CHANNEL_CONTRACTS_SCHEMA_VERSION;

/** Canonical channel ids aligned with Twin unlock features (subset). */
export const TWIN_MEMORY_CHANNEL_IDS = ["diary", "twin_chat"] as const;

export type TwinMemoryChannelId = (typeof TWIN_MEMORY_CHANNEL_IDS)[number];

export type TwinMemoryChannelContract = {
  purpose: string;
  /** What the human is broadly trying to do in this surface. */
  userIntent: string;
  /** How input typically reads when healthy (tone, granularity). */
  expectedInputStyle: string;
  /** What this input counts as relative to Twin formation. */
  inputRole: string;
  /** How stored memory from this channel is intended to behave in the Twin model. */
  memoryRole: string;
  /** One entry per downstream surface; each string starts with stable token prefix `token:` for machine checks. */
  downstreamSignals: readonly string[];
};

export type TwinMemoryChannelsContractBundle = {
  schemaVersion: TwinMemoryChannelContractsSchemaVersion;
  channels: Record<TwinMemoryChannelId, TwinMemoryChannelContract>;
};

export type TwinMemoryInputKind =
  | "question"
  | "reflection"
  | "event"
  | "decision"
  | "emotional_state"
  | "contradiction_hint"
  | "desire"
  | "avoidance_hint";

export type TwinMemoryInputClassification = {
  kind: TwinMemoryInputKind;
  channel: TwinMemoryChannelId;
  /** Stable short tag for assertions; plain language, never clinical framing. */
  reason: string;
};
