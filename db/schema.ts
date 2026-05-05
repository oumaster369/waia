import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    twinProfileId: text("twin_profile_id").references(() => twinProfiles.id, { onDelete: "cascade" }),
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
