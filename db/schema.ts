import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  auditActorTypeEnum,
  organizationKindEnum,
  organizationMemberRoleEnum,
  platformRoleEnum,
  subscriptionStatusEnum,
  waiaModuleEnum,
} from "@/db/core-enums";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    identityLabel: text("identity_label").notNull(),
    email: text("email").notNull(),
    /** Null for OAuth-only accounts (password sign-in not available). */
    passwordHash: text("password_hash"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/** WAIA Core: 1:1 identity extension (WC-E1). */
export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en"),
    avatarRef: text("avatar_ref"),
    settingsJson: text("settings_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("profiles_user_id_unique").on(t.userId)],
);

/** WAIA Core: tenant boundary (WC-E2). */
export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: [...organizationKindEnum] }).notNull(),
    name: text("name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("organizations_owner_user_id_idx").on(t.ownerUserId)],
);

/** WAIA Core: user ↔ organization membership (WC-E2). */
export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberRole: text("member_role", { enum: [...organizationMemberRoleEnum] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("organization_members_org_user_unique").on(t.organizationId, t.userId)],
);

/** WAIA Core: platform-wide role per user (WC-E3). */
export const userPlatformRoles = sqliteTable("user_platform_roles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: [...platformRoleEnum] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** WAIA Core: per-organization module subscription (WC-E4). */
export const organizationSubscriptions = sqliteTable(
  "organization_subscriptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    module: text("module", { enum: [...waiaModuleEnum] }).notNull(),
    status: text("status", { enum: [...subscriptionStatusEnum] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("organization_subscriptions_org_module_unique").on(t.organizationId, t.module),
  ],
);

/** WAIA Core: derived entitlement flags per organization (WC-E4). */
export const organizationEntitlements = sqliteTable(
  "organization_entitlements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    sourceModule: text("source_module", { enum: [...waiaModuleEnum] }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("organization_entitlements_org_key_unique").on(t.organizationId, t.entitlementKey),
  ],
);

/** WAIA Core: append-only platform audit stream (WC-E5). */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorType: text("actor_type", { enum: [...auditActorTypeEnum] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const exchangeCredentialStatusEnum = ["active", "revoked"] as const;
export type ExchangeCredentialStatus = (typeof exchangeCredentialStatusEnum)[number];

/** AI-TRADER: envelope-encrypted exchange API credentials (DEE-233 / AT-E2). */
export const exchangeCredentials = sqliteTable(
  "exchange_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    exchangeAccountId: text("exchange_account_id").notNull(),
    apiKeyMasked: text("api_key_masked"),
    encryptedPayload: text("encrypted_payload"),
    payloadKeyVersion: text("payload_key_version"),
    wrappedDekKeyVersion: text("wrapped_dek_key_version"),
    wrappedDekKey: text("wrapped_dek_key"),
    permissionMetadata: text("permission_metadata"),
    status: text("status", { enum: [...exchangeCredentialStatusEnum] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("exchange_credentials_org_venue_account_idx").on(
      t.organizationId,
      t.venue,
      t.exchangeAccountId,
    ),
  ],
);

/** AI-TRADER: point-in-time balance snapshots (DEE-237 / AT-E2). */
export const traderBalanceSnapshots = sqliteTable(
  "trader_balance_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    credentialId: text("credential_id")
      .notNull()
      .references(() => exchangeCredentials.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    exchangeAccountId: text("exchange_account_id").notNull(),
    balances: text("balances").notNull(),
    assetCount: integer("asset_count").notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("trader_balance_snapshots_org_cred_synced_idx").on(
      t.organizationId,
      t.credentialId,
      t.syncedAt,
    ),
    index("trader_balance_snapshots_org_synced_idx").on(t.organizationId, t.syncedAt),
  ],
);

export const riskLimitsScopeTypeEnum = ["organization", "venue", "strategy"] as const;
export type RiskLimitsScopeType = (typeof riskLimitsScopeTypeEnum)[number];

/** AI-TRADER: org-scoped risk limit configuration (DEE-239 / AT-E7). */
export const traderRiskLimits = sqliteTable(
  "trader_risk_limits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: [...riskLimitsScopeTypeEnum] })
      .notNull()
      .default("organization"),
    scopeRef: text("scope_ref").notNull().default(""),
    allowedSymbolsJson: text("allowed_symbols_json").notNull(),
    maxNotional: text("max_notional").notNull(),
    maxOrdersPerWindow: integer("max_orders_per_window").notNull(),
    windowMs: integer("window_ms").notNull(),
    collarBps: integer("collar_bps").notNull(),
    maxPositionPerSymbol: text("max_position_per_symbol").notNull(),
    maxDailyLoss: text("max_daily_loss").notNull(),
    maxDrawdown: text("max_drawdown").notNull(),
    maxOpenOrders: integer("max_open_orders").notNull(),
    maxQuoteExposure: text("max_quote_exposure").notNull(),
    configVersion: integer("config_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("trader_risk_limits_org_scope_unique").on(
      t.organizationId,
      t.scopeType,
      t.scopeRef,
    ),
    index("trader_risk_limits_org_scope_type_idx").on(t.organizationId, t.scopeType),
  ],
);

export const killSwitchScopeTypeEnum = [
  "platform",
  "organization",
  "venue",
  "strategy",
  "account",
  "instrument",
] as const;
export type KillSwitchScopeType = (typeof killSwitchScopeTypeEnum)[number];

export const killSwitchTypeEnum = [
  "EMERGENCY_STOP",
  "CLOSE_ONLY",
  "PAUSE",
  "DATA_QUALITY",
  "CONTROL_PLANE_LOSS",
  "STALE_STATE",
  "RECON_MISMATCH",
  "ABNORMAL_SLIPPAGE",
  "UNKNOWN_POSITION",
] as const;
export type KillSwitchType = (typeof killSwitchTypeEnum)[number];

export const killSwitchEnforcementModeEnum = ["STOP_ACCOUNT", "CLOSE_ONLY", "REJECT"] as const;
export type KillSwitchEnforcementMode = (typeof killSwitchEnforcementModeEnum)[number];

export const killSwitchStateEnum = ["ACTIVE", "CLEARING", "INACTIVE"] as const;
export type KillSwitchState = (typeof killSwitchStateEnum)[number];

export const killSwitchOriginEnum = ["manual", "automatic"] as const;
export type KillSwitchOrigin = (typeof killSwitchOriginEnum)[number];

/** AI-TRADER: kill switch state (DEE-206A / AT-E7). Single row per scope; history in audit. */
export const traderKillSwitches = sqliteTable(
  "trader_kill_switches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    scopeType: text("scope_type", { enum: [...killSwitchScopeTypeEnum] }).notNull(),
    scopeRef: text("scope_ref").notNull().default(""),
    switchType: text("switch_type", { enum: [...killSwitchTypeEnum] }).notNull(),
    enforcementMode: text("enforcement_mode", {
      enum: [...killSwitchEnforcementModeEnum],
    }).notNull(),
    state: text("state", { enum: [...killSwitchStateEnum] }).notNull(),
    origin: text("origin", { enum: [...killSwitchOriginEnum] }).notNull(),
    reason: text("reason").notNull().default(""),
    clearingStartedAt: integer("clearing_started_at", { mode: "timestamp_ms" }),
    coolingOffMs: integer("cooling_off_ms"),
    trippedAt: integer("tripped_at", { mode: "timestamp_ms" }),
    clearedAt: integer("cleared_at", { mode: "timestamp_ms" }),
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("trader_kill_switches_org_scope_state_idx").on(t.organizationId, t.scopeType, t.state),
  ],
);

export const promotionGovernanceStateEnum = [
  "DRAFT",
  "PENDING_CONFIRM",
  "COOLING_OFF",
  "EFFECTIVE",
  "CANCELLED",
  "REVOKED",
] as const;
export type PromotionGovernanceState = (typeof promotionGovernanceStateEnum)[number];

export const strategyTargetDeploymentStateEnum = ["LIVE_LIMITED"] as const;
export type StrategyTargetDeploymentState = (typeof strategyTargetDeploymentStateEnum)[number];

export const miSourceStatusEnum = ["active", "deprecated"] as const;
export type MiSourceStatusDb = (typeof miSourceStatusEnum)[number];

/** AI-TRADER MI: org-scoped market intelligence source registry (DEE-279 / LD-2a). */
export const traderMiSource = sqliteTable(
  "trader_mi_source",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    feedKind: text("feed_kind").notNull(),
    symbol: text("symbol"),
    description: text("description"),
    status: text("status", { enum: [...miSourceStatusEnum] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_source_id_organization_unique").on(t.id, t.organizationId),
    index("trader_mi_source_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** AI-TRADER MI: append-only PIT trust history (DEE-279 / LD-2a). */
export const traderMiSourceTrust = sqliteTable(
  "trader_mi_source_trust",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    trustScore: text("trust_score").notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    revisionOf: text("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    revisionSeq: integer("revision_seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_source_trust_id_organization_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.sourceId, t.organizationId],
      foreignColumns: [traderMiSource.id, traderMiSource.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("trader_mi_source_trust_org_source_seq_unique").on(
      t.organizationId,
      t.sourceId,
      t.revisionSeq,
    ),
    index("trader_mi_source_trust_org_source_seq_idx").on(
      t.organizationId,
      t.sourceId,
      t.revisionSeq,
    ),
    index("trader_mi_source_trust_org_source_event_time_idx").on(
      t.organizationId,
      t.sourceId,
      t.eventTime,
    ),
  ],
);

export const miObservationKindEnum = ["msv_envelope"] as const;
export type MiObservationKindDb = (typeof miObservationKindEnum)[number];

/** AI-TRADER MI: append-only PIT observations (DEE-281 / LD-2b). */
export const traderMiObservation = sqliteTable(
  "trader_mi_observation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    observationKind: text("observation_kind", { enum: [...miObservationKindEnum] }).notNull(),
    observationKey: text("observation_key").notNull(),
    subjectRef: text("subject_ref").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    observedBy: text("observed_by").notNull(),
    revisionOf: text("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    revisionSeq: integer("revision_seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_observation_id_organization_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.sourceId, t.organizationId],
      foreignColumns: [traderMiSource.id, traderMiSource.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("trader_mi_observation_org_key_seq_unique").on(
      t.organizationId,
      t.observationKey,
      t.revisionSeq,
    ),
    index("trader_mi_observation_org_kind_subject_idx").on(
      t.organizationId,
      t.observationKind,
      t.subjectRef,
    ),
    index("trader_mi_observation_org_key_seq_idx").on(
      t.organizationId,
      t.observationKey,
      t.revisionSeq,
    ),
    index("trader_mi_observation_org_event_time_idx").on(t.organizationId, t.eventTime),
  ],
);

export const miMeasurementKindEnum = ["feature_transform"] as const;
export type MiMeasurementKindDb = (typeof miMeasurementKindEnum)[number];

/** AI-TRADER MI: append-only versioned transform-definition registry (DEE-282 / LD-3). */
export const traderMiMeasurement = sqliteTable(
  "trader_mi_measurement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    measurementKind: text("measurement_kind", { enum: [...miMeasurementKindEnum] }).notNull(),
    measurementKey: text("measurement_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: text("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_measurement_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_measurement_org_key_seq_unique").on(
      t.organizationId,
      t.measurementKey,
      t.versionSeq,
    ),
    index("trader_mi_measurement_org_kind_name_idx").on(
      t.organizationId,
      t.measurementKind,
      t.name,
    ),
    index("trader_mi_measurement_org_key_seq_idx").on(
      t.organizationId,
      t.measurementKey,
      t.versionSeq,
    ),
  ],
);

export const miPatternKindEnum = ["recurring_structure"] as const;
export type MiPatternKindDb = (typeof miPatternKindEnum)[number];

export const miPatternLifecycleStateEnum = ["ACTIVE", "ARCHIVED"] as const;
export type MiPatternLifecycleStateDb = (typeof miPatternLifecycleStateEnum)[number];

/** AI-TRADER MI: append-only versioned recurring-structure registry (DEE-283 / LD-4). */
export const traderMiPattern = sqliteTable(
  "trader_mi_pattern",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternKind: text("pattern_kind", { enum: [...miPatternKindEnum] }).notNull(),
    patternKey: text("pattern_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    structuralSignature: text("structural_signature").notNull(),
    trialBudgetMax: integer("trial_budget_max").notNull(),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: text("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_pattern_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_pattern_org_key_seq_unique").on(
      t.organizationId,
      t.patternKey,
      t.versionSeq,
    ),
    index("trader_mi_pattern_org_kind_name_idx").on(t.organizationId, t.patternKind, t.name),
    index("trader_mi_pattern_org_key_seq_idx").on(t.organizationId, t.patternKey, t.versionSeq),
    index("trader_mi_pattern_org_structural_sig_idx").on(t.organizationId, t.structuralSignature),
  ],
);

/** AI-TRADER MI: append-only Pattern lifecycle (ACTIVE/ARCHIVED) ledger (DEE-283 / LD-4). */
export const traderMiPatternLifecycle = sqliteTable(
  "trader_mi_pattern_lifecycle",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternId: text("pattern_id").notNull(), // composite FK enforced in migration SQL
    patternKey: text("pattern_key").notNull(),
    lifecycleState: text("lifecycle_state", {
      enum: [...miPatternLifecycleStateEnum],
    }).notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_pattern_lifecycle_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_pattern_lifecycle_org_key_seq_unique").on(
      t.organizationId,
      t.patternKey,
      t.seq,
    ),
    index("trader_mi_pattern_lifecycle_org_key_seq_idx").on(t.organizationId, t.patternKey, t.seq),
  ],
);

export const miHypothesisKindEnum = ["market_claim"] as const;
export type MiHypothesisKindDb = (typeof miHypothesisKindEnum)[number];

export const miHypothesisLifecycleStateEnum = [
  "PROPOSED",
  "VALIDATING",
  "VALIDATED",
  "DECAYING",
  "RETIRED",
  "QUARANTINED",
] as const;
export type MiHypothesisLifecycleStateDb = (typeof miHypothesisLifecycleStateEnum)[number];

/** AI-TRADER MI: append-only versioned hypothesis registry (DEE-285 / LD-5a.1a). */
export const traderMiHypothesis = sqliteTable(
  "trader_mi_hypothesis",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisKind: text("hypothesis_kind", { enum: [...miHypothesisKindEnum] }).notNull(),
    hypothesisKey: text("hypothesis_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    supersedesJson: text("supersedes_json"),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: text("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_hypothesis_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_hypothesis_org_key_seq_unique").on(
      t.organizationId,
      t.hypothesisKey,
      t.versionSeq,
    ),
    index("trader_mi_hypothesis_org_kind_name_idx").on(t.organizationId, t.hypothesisKind, t.name),
    index("trader_mi_hypothesis_org_key_seq_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.versionSeq,
    ),
  ],
);

/** AI-TRADER MI: append-only Hypothesis lifecycle ledger (DEE-285 / LD-5a.1a). */
export const traderMiHypothesisLifecycle = sqliteTable(
  "trader_mi_hypothesis_lifecycle",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: text("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    lifecycleState: text("lifecycle_state", {
      enum: [...miHypothesisLifecycleStateEnum],
    }).notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_hypothesis_lifecycle_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_hypothesis_lifecycle_org_key_seq_unique").on(
      t.organizationId,
      t.hypothesisKey,
      t.seq,
    ),
    index("trader_mi_hypothesis_lifecycle_org_key_seq_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.seq,
    ),
  ],
);

export const miEvidenceDirectionEnum = ["FOR", "AGAINST", "NEUTRAL"] as const;
export type MiEvidenceDirectionDb = (typeof miEvidenceDirectionEnum)[number];

export const miEvidenceKindEnum = ["observed"] as const;
export type MiEvidenceKindDb = (typeof miEvidenceKindEnum)[number];

/** AI-TRADER MI: append-only Evidence ledger (DEE-289 / LD-5a.2a). */
export const traderMiEvidence = sqliteTable(
  "trader_mi_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    evidenceKind: text("evidence_kind", { enum: [...miEvidenceKindEnum] }).notNull(),
    direction: text("direction", { enum: [...miEvidenceDirectionEnum] }).notNull(),
    hypothesisId: text("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    measurementRefsJson: text("measurement_refs_json").notNull(),
    observationRefsJson: text("observation_refs_json").notNull(),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    nullComparatorRef: text("null_comparator_ref"),
    regimeContextRef: text("regime_context_ref"),
    trialRegistrationRef: text("trial_registration_ref"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_mi_evidence_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_evidence_org_key_seq_unique").on(
      t.organizationId,
      t.hypothesisKey,
      t.seq,
    ),
    index("trader_mi_evidence_org_hypothesis_idx").on(t.organizationId, t.hypothesisId),
    index("trader_mi_evidence_org_key_seq_idx").on(t.organizationId, t.hypothesisKey, t.seq),
    index("trader_mi_evidence_org_key_event_time_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.eventTime,
    ),
    index("trader_mi_evidence_org_key_direction_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.direction,
    ),
  ],
);

/** AI-TRADER: strategy validation gate promotion record (DEE-272 / DEE-178 S1). */
export const traderStrategyPromotionRecords = sqliteTable(
  "trader_strategy_promotion_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    gitCommitSha: text("git_commit_sha").notNull(),
    targetDeploymentState: text("target_deployment_state", {
      enum: [...strategyTargetDeploymentStateEnum],
    }).notNull(),
    hypothesis: text("hypothesis").notNull(),
    intendedRegime: text("intended_regime").notNull(),
    costModelJson: text("cost_model_json").notNull(),
    failureModesJson: text("failure_modes_json").notNull(),
    reasonCodeDistributionJson: text("reason_code_distribution_json").notNull(),
    paperTradingEvidenceJson: text("paper_trading_evidence_json").notNull(),
    evidenceContentDigest: text("evidence_content_digest").notNull(),
    confidenceAttestationJson: text("confidence_attestation_json").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    state: text("state", { enum: [...promotionGovernanceStateEnum] }).notNull(),
    actorId: text("actor_id"),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    coolingOffEndsAt: integer("cooling_off_ends_at", { mode: "timestamp_ms" }),
    effectiveAt: integer("effective_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    supersededByRecordId: text("superseded_by_record_id"),
    stateVersion: integer("state_version").notNull().default(1),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("trader_strategy_promotion_org_strategy_state_idx").on(
      t.organizationId,
      t.strategyId,
      t.state,
    ),
  ],
);

export const orderSideEnum = ["buy", "sell"] as const;
export type OrderSideDb = (typeof orderSideEnum)[number];

export const orderTypeEnum = ["limit", "market"] as const;
export type OrderTypeDb = (typeof orderTypeEnum)[number];

export const orderStateEnum = [
  "CREATED",
  "RISK_APPROVED",
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;
export type OrderStateDb = (typeof orderStateEnum)[number];

export const orderExecutionModeEnum = ["mock", "paper", "live"] as const;
export type OrderExecutionModeDb = (typeof orderExecutionModeEnum)[number];

/** AI-TRADER: durable order header (DEE-247 / AT-E8 S1). */
export const traderOrders = sqliteTable(
  "trader_orders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").references(() => exchangeCredentials.id, {
      onDelete: "set null",
    }),
    venue: text("venue").notNull(),
    executionMode: text("execution_mode", { enum: [...orderExecutionModeEnum] }).notNull(),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: [...orderSideEnum] }).notNull(),
    type: text("type", { enum: [...orderTypeEnum] }).notNull(),
    price: text("price"),
    quantity: text("quantity").notNull(),
    filledQuantity: text("filled_quantity").notNull().default("0"),
    avgFillPrice: text("avg_fill_price"),
    state: text("state", { enum: [...orderStateEnum] }).notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    exchangeOrderId: text("exchange_order_id"),
    clientOrderId: text("client_order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    riskDecisionId: text("risk_decision_id").notNull(),
    strategySignalId: text("strategy_signal_id"),
    allocationDecisionId: text("allocation_decision_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_orders_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_orders_org_client_order_id_unique").on(t.organizationId, t.clientOrderId),
    uniqueIndex("trader_orders_org_idempotency_key_unique").on(t.organizationId, t.idempotencyKey),
    index("trader_orders_org_state_idx").on(t.organizationId, t.state),
    index("trader_orders_org_execution_mode_state_idx").on(
      t.organizationId,
      t.executionMode,
      t.state,
    ),
    index("trader_orders_org_venue_symbol_idx").on(t.organizationId, t.venue, t.symbol),
    index("trader_orders_exchange_order_id_idx").on(t.exchangeOrderId),
  ],
);

/** AI-TRADER: append-only order lifecycle events (DEE-247 / AT-E8 S1). */
export const traderOrderEvents = sqliteTable(
  "trader_order_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    seq: integer("seq").notNull(),
    fromState: text("from_state", { enum: [...orderStateEnum] }),
    toState: text("to_state", { enum: [...orderStateEnum] }).notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.organizationId],
      foreignColumns: [traderOrders.id, traderOrders.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("trader_order_events_order_seq_unique").on(t.orderId, t.seq),
    index("trader_order_events_org_order_seq_idx").on(t.organizationId, t.orderId, t.seq),
  ],
);

/** AI-TRADER: per-fill rows for partial fills and reconciliation (DEE-247 / AT-E8 S1). */
export const traderFills = sqliteTable(
  "trader_fills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    exchangeTradeId: text("exchange_trade_id").notNull(),
    price: text("price").notNull(),
    quantity: text("quantity").notNull(),
    fee: text("fee").notNull().default("0"),
    feeAsset: text("fee_asset").notNull().default(""),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.orderId, t.organizationId],
      foreignColumns: [traderOrders.id, traderOrders.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("trader_fills_order_exchange_trade_id_unique").on(t.orderId, t.exchangeTradeId),
    index("trader_fills_org_order_idx").on(t.organizationId, t.orderId),
  ],
);

/** AI-TRADER: org-scoped module anchor (AT-E1 / DEE-193). One row per organization. */
export const traderOrgProfiles = sqliteTable(
  "trader_org_profiles",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("trader_org_profiles_organization_id_unique").on(t.organizationId)],
);

export const oauthProviderEnum = ["google", "apple", "telegram"] as const;
export type OauthProvider = (typeof oauthProviderEnum)[number];

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    provider: text("provider", {
      enum: [...oauthProviderEnum],
    }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("oauth_accounts_provider_subject_unique").on(t.provider, t.providerUserId)],
);

/** OAuth CSRF state + PKCE verifier (nullable for Telegram). Deleted after callback. */
export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  provider: text("provider", { enum: [...oauthProviderEnum] }).notNull(),
  codeVerifier: text("code_verifier"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const twinProfiles = sqliteTable(
  "twin_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("twin_profiles_user_id_unique").on(t.userId)],
);

/** Materialized ReadinessInput projection; formula stays in computeReadinessResult. */
export const twinReadinessState = sqliteTable("twin_readiness_state", {
  twinProfileId: text("twin_profile_id")
    .primaryKey()
    .references(() => twinProfiles.id, { onDelete: "cascade" }),
  /** JSON array of six ints in INDICATOR_KEYS_ORDER. */
  indicatorsJson: text("indicators_json").notNull(),
  socializationCompleted: integer("socialization_completed", { mode: "boolean" }).notNull(),
  finalStateMessageShown: integer("final_state_message_shown", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const twinDialogueTurns = sqliteTable(
  "twin_dialogue_turns",
  {
    id: text("id").primaryKey(),
    twinProfileId: text("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: text("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("twin_dialogue_turns_idempotency_key_unique").on(t.idempotencyKey),
    index("twin_dialogue_turns_twin_seq_idx").on(t.twinProfileId, t.sequence),
  ],
);

/** Diary source persistence (AI-Twin memory v1 — DEE-27). */
export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: text("twin_profile_id").references(() => twinProfiles.id, {
      onDelete: "cascade",
    }),
    body: text("body"),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: text("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("diary_entries_user_created_idx").on(t.userId, t.createdAt)],
);

/** Scenario answers persisted per twin profile (AI-Twin memory v1 — DEE-27). */
export const scenarioAnswers = sqliteTable(
  "scenario_answers",
  {
    id: text("id").primaryKey(),
    twinProfileId: text("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    scenarioKey: text("scenario_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: text("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("scenario_answers_profile_created_idx").on(t.twinProfileId, t.createdAt)],
);

/** User verification of twin predictions (DEE-34); optional client predictionId, no FK. */
export const twinPredictionVerifications = sqliteTable(
  "twin_prediction_verifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: text("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    predictionId: text("prediction_id"),
    scenario: text("scenario").notNull(),
    verification: text("verification").notNull(),
    correction: text("correction"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("twin_prediction_verifications_user_created_idx").on(t.userId, t.createdAt),
    index("twin_prediction_verifications_profile_created_idx").on(t.twinProfileId, t.createdAt),
  ],
);

/** Repeatability signals over verification + scenario (DEE-28); no FK to predictions. */
export const twinRepeatabilityRecords = sqliteTable(
  "twin_repeatability_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: text("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    scenarioHash: text("scenario_hash").notNull(),
    patternType: text("pattern_type").notNull(),
    predictionOutcome: text("prediction_outcome").notNull(),
    verificationResult: text("verification_result").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("twin_repeatability_records_user_created_idx").on(t.userId, t.createdAt),
    index("twin_repeatability_records_scenario_hash_idx").on(t.scenarioHash),
    index("twin_repeatability_records_pattern_type_idx").on(t.patternType),
  ],
);

/** Stub: verification feedback (future). */
export const verificationFeedback = sqliteTable("verification_feedback", {
  id: text("id").primaryKey(),
  twinProfileId: text("twin_profile_id")
    .notNull()
    .references(() => twinProfiles.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
