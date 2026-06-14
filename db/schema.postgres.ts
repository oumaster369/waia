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
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
