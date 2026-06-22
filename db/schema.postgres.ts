/**
 * Postgres / Supabase target schema (DEE-62).
 *
 * Parallel to `db/schema.ts` (SQLite). The app runtime still uses SQLite until a follow-up swaps `db/client.ts`.
 *
 * - `public.users.id` is `uuid` and MUST match `auth.users.id` from Supabase Auth (enforce via migration / trigger in DEE-63+; not modeled here to avoid Drizzle emitting `auth` DDL).
 * - RLS is out of scope for DEE-62.
 * - JSON payloads use `jsonb`.
 */

import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  auditActorTypeEnum,
  organizationKindEnum,
  organizationMemberRoleEnum,
  platformRoleEnum,
  subscriptionStatusEnum,
  waiaModuleEnum,
} from "@/db/core-enums";

/** Aligned with legacy [`db/schema.ts`](./schema.ts) string union. */
export const oauthProviderEnum = ["google", "apple", "telegram"] as const;
export type OauthProvider = (typeof oauthProviderEnum)[number];

export const oauthProviderEnumPg = pgEnum("oauth_provider", [...oauthProviderEnum]);

export const dialogueRoleEnumPg = pgEnum("dialogue_role", ["user", "assistant", "system"]);

export const organizationKindEnumPg = pgEnum("organization_kind", [...organizationKindEnum]);
export const organizationMemberRoleEnumPg = pgEnum("organization_member_role", [
  ...organizationMemberRoleEnum,
]);
export const platformRoleEnumPg = pgEnum("platform_role", [...platformRoleEnum]);
export const waiaModuleEnumPg = pgEnum("waia_module", [...waiaModuleEnum]);
export const subscriptionStatusEnumPg = pgEnum("subscription_status", [...subscriptionStatusEnum]);
export const auditActorTypeEnumPg = pgEnum("audit_actor_type", [...auditActorTypeEnum]);

/**
 * Application user row in `public.users`.
 * PK must mirror Supabase `auth.users.id` when Auth is wired; FK to `auth.users` is applied in SQL migrations separately.
 *
 * `password_hash` is legacy / transition only (credentials live in Supabase Auth long-term).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    identityLabel: text("identity_label").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/** WAIA Core: 1:1 identity extension (WC-E1). */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en"),
    avatarRef: text("avatar_ref"),
    settingsJson: jsonb("settings_json"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_user_id_unique").on(t.userId)],
);

/** WAIA Core: tenant boundary (WC-E2). */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: organizationKindEnumPg("kind").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("organizations_owner_user_id_idx").on(t.ownerUserId)],
);

/** WAIA Core: user ↔ organization membership (WC-E2). */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberRole: organizationMemberRoleEnumPg("member_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organization_members_org_user_unique").on(t.organizationId, t.userId)],
);

/** WAIA Core: platform-wide role per user (WC-E3). */
export const userPlatformRoles = pgTable("user_platform_roles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: platformRoleEnumPg("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** WAIA Core: per-organization module subscription (WC-E4). */
export const organizationSubscriptions = pgTable(
  "organization_subscriptions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    module: waiaModuleEnumPg("module").notNull(),
    status: subscriptionStatusEnumPg("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_subscriptions_org_module_unique").on(t.organizationId, t.module),
  ],
);

/** WAIA Core: derived entitlement flags per organization (WC-E4). */
export const organizationEntitlements = pgTable(
  "organization_entitlements",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    enabled: boolean("enabled").notNull(),
    sourceModule: waiaModuleEnumPg("source_module"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_entitlements_org_key_unique").on(t.organizationId, t.entitlementKey),
  ],
);

/** WAIA Core: append-only platform audit stream (WC-E5). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorType: auditActorTypeEnumPg("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const exchangeCredentialStatusEnumPg = pgEnum("exchange_credential_status", [
  "active",
  "revoked",
]);

/** AI-TRADER: envelope-encrypted exchange API credentials (DEE-233 / AT-E2). */
export const exchangeCredentials = pgTable(
  "exchange_credentials",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
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
    status: exchangeCredentialStatusEnumPg("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
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
export const traderBalanceSnapshots = pgTable(
  "trader_balance_snapshots",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => exchangeCredentials.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    exchangeAccountId: text("exchange_account_id").notNull(),
    balances: text("balances").notNull(),
    assetCount: integer("asset_count").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const riskLimitsScopeTypeEnumPg = pgEnum("risk_limits_scope_type", [
  "organization",
  "venue",
  "strategy",
]);

/** AI-TRADER: org-scoped risk limit configuration (DEE-239 / AT-E7). */
export const traderRiskLimits = pgTable(
  "trader_risk_limits",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeType: riskLimitsScopeTypeEnumPg("scope_type").notNull().default("organization"),
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const killSwitchScopeTypeEnumPg = pgEnum("kill_switch_scope_type", [
  "platform",
  "organization",
  "venue",
  "strategy",
  "account",
  "instrument",
]);

export const killSwitchTypeEnumPg = pgEnum("kill_switch_type", [
  "EMERGENCY_STOP",
  "CLOSE_ONLY",
  "PAUSE",
  "DATA_QUALITY",
  "CONTROL_PLANE_LOSS",
  "STALE_STATE",
  "RECON_MISMATCH",
  "ABNORMAL_SLIPPAGE",
  "UNKNOWN_POSITION",
]);

export const killSwitchEnforcementModeEnumPg = pgEnum("kill_switch_enforcement_mode", [
  "STOP_ACCOUNT",
  "CLOSE_ONLY",
  "REJECT",
]);

export const killSwitchStateEnumPg = pgEnum("kill_switch_state", [
  "ACTIVE",
  "CLEARING",
  "INACTIVE",
]);

export const killSwitchOriginEnumPg = pgEnum("kill_switch_origin", ["manual", "automatic"]);

/** AI-TRADER: kill switch state (DEE-206A / AT-E7). Single row per scope; history in audit. */
export const traderKillSwitches = pgTable(
  "trader_kill_switches",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    scopeType: killSwitchScopeTypeEnumPg("scope_type").notNull(),
    scopeRef: text("scope_ref").notNull().default(""),
    switchType: killSwitchTypeEnumPg("switch_type").notNull(),
    enforcementMode: killSwitchEnforcementModeEnumPg("enforcement_mode").notNull(),
    state: killSwitchStateEnumPg("state").notNull(),
    origin: killSwitchOriginEnumPg("origin").notNull(),
    reason: text("reason").notNull().default(""),
    clearingStartedAt: timestamp("clearing_started_at", { withTimezone: true, mode: "date" }),
    coolingOffMs: integer("cooling_off_ms"),
    trippedAt: timestamp("tripped_at", { withTimezone: true, mode: "date" }),
    clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "date" }),
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_kill_switches_org_scope_state_idx").on(t.organizationId, t.scopeType, t.state),
  ],
);

export const promotionGovernanceStateEnumPg = pgEnum("strategy_promotion_governance_state", [
  "DRAFT",
  "PENDING_CONFIRM",
  "COOLING_OFF",
  "EFFECTIVE",
  "CANCELLED",
  "REVOKED",
]);

export const strategyTargetDeploymentStateEnumPg = pgEnum("strategy_target_deployment_state", [
  "LIVE_LIMITED",
]);

export const miSourceStatusEnumPg = pgEnum("mi_source_status", ["active", "deprecated"]);

/** AI-TRADER MI: org-scoped market intelligence source registry (DEE-279 / LD-2a). */
export const traderMiSource = pgTable(
  "trader_mi_source",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    feedKind: text("feed_kind").notNull(),
    symbol: text("symbol"),
    description: text("description"),
    status: miSourceStatusEnumPg("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_source_id_organization_unique").on(t.id, t.organizationId),
    index("trader_mi_source_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** AI-TRADER MI: append-only PIT trust history (DEE-279 / LD-2a). */
export const traderMiSourceTrust = pgTable(
  "trader_mi_source_trust",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    trustScore: text("trust_score").notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    revisionSeq: integer("revision_seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const miObservationKindEnumPg = pgEnum("mi_observation_kind", ["msv_envelope"]);

/** AI-TRADER MI: append-only PIT observations (DEE-281 / LD-2b). */
export const traderMiObservation = pgTable(
  "trader_mi_observation",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    observationKind: miObservationKindEnumPg("observation_kind").notNull(),
    observationKey: text("observation_key").notNull(),
    subjectRef: text("subject_ref").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    observedBy: text("observed_by").notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    revisionSeq: integer("revision_seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const miMeasurementKindEnumPg = pgEnum("mi_measurement_kind", ["feature_transform"]);

/** AI-TRADER MI: append-only versioned transform-definition registry (DEE-282 / LD-3). */
export const traderMiMeasurement = pgTable(
  "trader_mi_measurement",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    measurementKind: miMeasurementKindEnumPg("measurement_kind").notNull(),
    measurementKey: text("measurement_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const miPatternKindEnumPg = pgEnum("mi_pattern_kind", ["recurring_structure"]);
export const miPatternLifecycleStateEnumPg = pgEnum("mi_pattern_lifecycle_state", [
  "ACTIVE",
  "ARCHIVED",
]);

/** AI-TRADER MI: append-only versioned recurring-structure registry (DEE-283 / LD-4). */
export const traderMiPattern = pgTable(
  "trader_mi_pattern",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternKind: miPatternKindEnumPg("pattern_kind").notNull(),
    patternKey: text("pattern_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    structuralSignature: text("structural_signature").notNull(),
    trialBudgetMax: integer("trial_budget_max").notNull(),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
export const traderMiPatternLifecycle = pgTable(
  "trader_mi_pattern_lifecycle",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternId: uuid("pattern_id").notNull(), // composite FK enforced in migration SQL
    patternKey: text("pattern_key").notNull(),
    lifecycleState: miPatternLifecycleStateEnumPg("lifecycle_state").notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const miHypothesisKindEnumPg = pgEnum("mi_hypothesis_kind", ["market_claim"]);
export const miHypothesisLifecycleStateEnumPg = pgEnum("mi_hypothesis_lifecycle_state", [
  "PROPOSED",
  "VALIDATING",
  "VALIDATED",
  "DECAYING",
  "RETIRED",
  "QUARANTINED",
]);

/** AI-TRADER MI: append-only versioned hypothesis registry (DEE-285 / LD-5a.1a). */
export const traderMiHypothesis = pgTable(
  "trader_mi_hypothesis",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisKind: miHypothesisKindEnumPg("hypothesis_kind").notNull(),
    hypothesisKey: text("hypothesis_key").notNull(),
    name: text("name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    definitionJson: text("definition_json").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    supersedesJson: text("supersedes_json"),
    versionSeq: integer("version_seq").notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    authoredBy: text("authored_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
export const traderMiHypothesisLifecycle = pgTable(
  "trader_mi_hypothesis_lifecycle",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: uuid("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    lifecycleState: miHypothesisLifecycleStateEnumPg("lifecycle_state").notNull(),
    rationale: text("rationale").notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

export const miEvidenceDirectionEnumPg = pgEnum("mi_evidence_direction", [
  "FOR",
  "AGAINST",
  "NEUTRAL",
]);
export const miEvidenceKindEnumPg = pgEnum("mi_evidence_kind", ["observed"]);

/** AI-TRADER MI: append-only Evidence ledger (DEE-289 / LD-5a.2a). */
export const traderMiEvidence = pgTable(
  "trader_mi_evidence",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    evidenceKind: miEvidenceKindEnumPg("evidence_kind").notNull(),
    direction: miEvidenceDirectionEnumPg("direction").notNull(),
    hypothesisId: uuid("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    measurementRefsJson: text("measurement_refs_json").notNull(),
    observationRefsJson: text("observation_refs_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    nullComparatorRef: text("null_comparator_ref"),
    regimeContextRef: text("regime_context_ref"),
    trialRegistrationRef: text("trial_registration_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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

/**
 * AI-TRADER MI: append-only Trial Registration ledger (DEE-289 / LD-5a.2b).
 *
 * Immutable pre-registration of an evaluation attempt against a hypothesis version.
 * Pin-only; integrity derived (no stored column); `research_program` inert free-text.
 * `trader_mi_evidence.trial_registration_ref` composite FK to this table enforced in migration SQL.
 */
export const traderMiTrial = pgTable(
  "trader_mi_trial",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: uuid("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    researchProgram: text("research_program"),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    registeredBy: text("registered_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_trial_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_trial_org_key_seq_unique").on(t.organizationId, t.hypothesisKey, t.seq),
    index("trader_mi_trial_org_hypothesis_idx").on(t.organizationId, t.hypothesisId),
    index("trader_mi_trial_org_key_seq_idx").on(t.organizationId, t.hypothesisKey, t.seq),
    index("trader_mi_trial_org_key_event_time_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.eventTime,
    ),
  ],
);

/** AI-TRADER: strategy validation gate promotion record (DEE-272 / DEE-178 S1). */
export const traderStrategyPromotionRecords = pgTable(
  "trader_strategy_promotion_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    gitCommitSha: text("git_commit_sha").notNull(),
    targetDeploymentState: strategyTargetDeploymentStateEnumPg("target_deployment_state").notNull(),
    hypothesis: text("hypothesis").notNull(),
    intendedRegime: text("intended_regime").notNull(),
    costModelJson: jsonb("cost_model_json").notNull(),
    failureModesJson: jsonb("failure_modes_json").notNull(),
    reasonCodeDistributionJson: jsonb("reason_code_distribution_json").notNull(),
    paperTradingEvidenceJson: jsonb("paper_trading_evidence_json").notNull(),
    evidenceContentDigest: text("evidence_content_digest").notNull(),
    confidenceAttestationJson: jsonb("confidence_attestation_json").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    state: promotionGovernanceStateEnumPg("state").notNull(),
    actorId: text("actor_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    coolingOffEndsAt: timestamp("cooling_off_ends_at", { withTimezone: true, mode: "date" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    supersededByRecordId: uuid("superseded_by_record_id"),
    stateVersion: integer("state_version").notNull().default(1),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_strategy_promotion_org_strategy_state_idx").on(
      t.organizationId,
      t.strategyId,
      t.state,
    ),
  ],
);

export const orderSideEnumPg = pgEnum("order_side", ["buy", "sell"]);
export const orderTypeEnumPg = pgEnum("order_type", ["limit", "market"]);
export const orderStateEnumPg = pgEnum("order_state", [
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
]);
export const orderExecutionModeEnumPg = pgEnum("order_execution_mode", ["mock", "paper", "live"]);

/** AI-TRADER: durable order header (DEE-247 / AT-E8 S1). */
export const traderOrders = pgTable(
  "trader_orders",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id").references(() => exchangeCredentials.id, {
      onDelete: "set null",
    }),
    venue: text("venue").notNull(),
    executionMode: orderExecutionModeEnumPg("execution_mode").notNull(),
    symbol: text("symbol").notNull(),
    side: orderSideEnumPg("side").notNull(),
    type: orderTypeEnumPg("type").notNull(),
    price: text("price"),
    quantity: text("quantity").notNull(),
    filledQuantity: text("filled_quantity").notNull().default("0"),
    avgFillPrice: text("avg_fill_price"),
    state: orderStateEnumPg("state").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    exchangeOrderId: text("exchange_order_id"),
    clientOrderId: text("client_order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    riskDecisionId: text("risk_decision_id").notNull(),
    strategySignalId: text("strategy_signal_id"),
    allocationDecisionId: text("allocation_decision_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
export const traderOrderEvents = pgTable(
  "trader_order_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    seq: integer("seq").notNull(),
    fromState: orderStateEnumPg("from_state"),
    toState: orderStateEnumPg("to_state").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
export const traderFills = pgTable(
  "trader_fills",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    exchangeTradeId: text("exchange_trade_id").notNull(),
    price: text("price").notNull(),
    quantity: text("quantity").notNull(),
    fee: text("fee").notNull().default("0"),
    feeAsset: text("fee_asset").notNull().default(""),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
export const traderOrgProfiles = pgTable(
  "trader_org_profiles",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trader_org_profiles_organization_id_unique").on(t.organizationId)],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: oauthProviderEnumPg("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("oauth_accounts_provider_subject_unique").on(t.provider, t.providerUserId)],
);

/** OAuth CSRF state + PKCE verifier (nullable for Telegram). Deleted after callback. */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  provider: oauthProviderEnumPg("provider").notNull(),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
});

/**
 * @deprecated Legacy opaque session cookie store (email auth MVP). Replace with Supabase session handling;
 * table remains temporarily for transitional dual-read/dual-write or data migration.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const twinProfiles = pgTable(
  "twin_profiles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("twin_profiles_user_id_unique").on(t.userId)],
);

/** Materialized ReadinessInput projection; formula stays in computeReadinessResult. */
export const twinReadinessState = pgTable("twin_readiness_state", {
  twinProfileId: uuid("twin_profile_id")
    .primaryKey()
    .references(() => twinProfiles.id, { onDelete: "cascade" }),
  /** JSON array of six ints in INDICATOR_KEYS_ORDER. */
  indicatorsJson: jsonb("indicators_json").notNull(),
  socializationCompleted: boolean("socialization_completed").notNull(),
  finalStateMessageShown: boolean("final_state_message_shown").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const twinDialogueTurns = pgTable(
  "twin_dialogue_turns",
  {
    id: uuid("id").primaryKey(),
    twinProfileId: uuid("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: dialogueRoleEnumPg("role").notNull(),
    content: text("content").notNull(),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: jsonb("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("twin_dialogue_turns_idempotency_key_unique").on(t.idempotencyKey),
    index("twin_dialogue_turns_twin_seq_idx").on(t.twinProfileId, t.sequence),
  ],
);

/** Diary source persistence (AI-Twin memory v1 — DEE-27). */
export const diaryEntries = pgTable(
  "diary_entries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: uuid("twin_profile_id").references(() => twinProfiles.id, {
      onDelete: "cascade",
    }),
    body: text("body"),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: jsonb("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("diary_entries_user_created_idx").on(t.userId, t.createdAt)],
);

/** Scenario answers persisted per twin profile (AI-Twin memory v1 — DEE-27). */
export const scenarioAnswers = pgTable(
  "scenario_answers",
  {
    id: uuid("id").primaryKey(),
    twinProfileId: uuid("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    scenarioKey: text("scenario_key").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    idempotencyKey: text("idempotency_key"),
    embeddingJson: jsonb("embedding_json"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("scenario_answers_profile_created_idx").on(t.twinProfileId, t.createdAt)],
);

/** User verification of twin predictions (DEE-34); optional client predictionId, no FK. */
export const twinPredictionVerifications = pgTable(
  "twin_prediction_verifications",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: uuid("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    predictionId: text("prediction_id"),
    scenario: text("scenario").notNull(),
    verification: text("verification").notNull(),
    correction: text("correction"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("twin_prediction_verifications_user_created_idx").on(t.userId, t.createdAt),
    index("twin_prediction_verifications_profile_created_idx").on(t.twinProfileId, t.createdAt),
  ],
);

/** Repeatability signals over verification + scenario (DEE-28); no FK to predictions. */
export const twinRepeatabilityRecords = pgTable(
  "twin_repeatability_records",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    twinProfileId: uuid("twin_profile_id")
      .notNull()
      .references(() => twinProfiles.id, { onDelete: "cascade" }),
    scenarioHash: text("scenario_hash").notNull(),
    patternType: text("pattern_type").notNull(),
    predictionOutcome: text("prediction_outcome").notNull(),
    verificationResult: text("verification_result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("twin_repeatability_records_user_created_idx").on(t.userId, t.createdAt),
    index("twin_repeatability_records_scenario_hash_idx").on(t.scenarioHash),
    index("twin_repeatability_records_pattern_type_idx").on(t.patternType),
  ],
);

/** Stub: verification feedback (future). */
export const verificationFeedback = pgTable("verification_feedback", {
  id: uuid("id").primaryKey(),
  twinProfileId: uuid("twin_profile_id")
    .notNull()
    .references(() => twinProfiles.id, { onDelete: "cascade" }),
  payloadJson: jsonb("payload_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Postgres transaction integration validation table (DEE-64 D6-core).
 * Used only by opt-in `tests/integration/postgres-transaction-rollback.test.ts` to verify commit/rollback semantics.
 * No foreign keys; disposable ephemeral data.
 */
export const waiaPostgresTxValidation = pgTable("waia_postgres_tx_validation", {
  id: uuid("id").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
