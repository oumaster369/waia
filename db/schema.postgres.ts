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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  auditActorTypeEnum,
  organizationKindEnum,
  organizationMemberRoleEnum,
  paymentAddressEventTypeEnum,
  paymentAddressStatusEnum,
  paymentDirectionEnum,
  paymentEventTypeEnum,
  paymentFailureReasonEnum,
  paymentStatusEnum,
  paymentSubjectModuleEnum,
  paymentWalletCustodyModelEnum,
  paymentWalletKindEnum,
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

export const paymentEventTypeEnumPg = pgEnum("payment_event_type", [...paymentEventTypeEnum]);
export const paymentDirectionEnumPg = pgEnum("payment_direction", [...paymentDirectionEnum]);
export const paymentSubjectModuleEnumPg = pgEnum("payment_subject_module", [
  ...paymentSubjectModuleEnum,
]);
export const paymentFailureReasonEnumPg = pgEnum("payment_failure_reason", [
  ...paymentFailureReasonEnum,
]);
export const paymentStatusEnumPg = pgEnum("payment_status", [...paymentStatusEnum]);

export const paymentWalletKindEnumPg = pgEnum("payment_wallet_kind", [...paymentWalletKindEnum]);
export const paymentWalletCustodyModelEnumPg = pgEnum("payment_wallet_custody_model", [
  ...paymentWalletCustodyModelEnum,
]);
export const paymentAddressEventTypeEnumPg = pgEnum("payment_address_event_type", [
  ...paymentAddressEventTypeEnum,
]);
export const paymentAddressStatusEnumPg = pgEnum("payment_address_status", [
  ...paymentAddressStatusEnum,
]);

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

/** WAIA Core: append-only payment event ledger (AT-E12 S1 / DEE-312). */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey(),
    paymentId: uuid("payment_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: paymentEventTypeEnumPg("event_type").notNull(),
    direction: paymentDirectionEnumPg("direction").notNull(),
    subjectModule: paymentSubjectModuleEnumPg("subject_module").notNull(),
    subjectInvoiceId: text("subject_invoice_id"),
    idempotencyKey: text("idempotency_key"),
    reason: paymentFailureReasonEnumPg("reason"),
    settlementNetwork: text("settlement_network"),
    settlementAsset: text("settlement_asset"),
    settlementAmount: text("settlement_amount"),
    settlementTxHash: text("settlement_tx_hash"),
    transferIndex: integer("transfer_index"),
    confirmationsRequired: integer("confirmations_required"),
    confirmationsObserved: integer("confirmations_observed"),
    blockHeight: text("block_height"),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    valuedAmountUsd: text("valued_amount_usd"),
    valuationSource: text("valuation_source"),
    valuationAt: timestamp("valuation_at", { withTimezone: true, mode: "date" }),
    evidenceRef: text("evidence_ref"),
    paymentAddressId: uuid("payment_address_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_payment_id_seq_unique").on(t.paymentId, t.seq),
    uniqueIndex("payment_events_org_idempotency_unique")
      .on(t.organizationId, t.idempotencyKey)
      .where(sql`"idempotency_key" IS NOT NULL`),
    uniqueIndex("payment_events_settlement_attribution_unique")
      .on(t.settlementNetwork, t.settlementTxHash, t.transferIndex)
      .where(sql`"settlement_tx_hash" IS NOT NULL`),
    index("payment_events_org_payment_idx").on(t.organizationId, t.paymentId),
    index("payment_events_subject_idx").on(t.subjectModule, t.subjectInvoiceId),
  ],
);

/** WAIA Core: rebuildable payment current-state projection (AT-E12 S1 / DEE-312). */
export const payments = pgTable(
  "payments",
  {
    paymentId: uuid("payment_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: paymentStatusEnumPg("status").notNull(),
    direction: paymentDirectionEnumPg("direction").notNull(),
    subjectModule: paymentSubjectModuleEnumPg("subject_module").notNull(),
    subjectInvoiceId: text("subject_invoice_id"),
    settlementAmount: text("settlement_amount"),
    settlementAsset: text("settlement_asset"),
    settlementNetwork: text("settlement_network"),
    settlementTxHash: text("settlement_tx_hash"),
    transferIndex: integer("transfer_index"),
    valuedAmountUsd: text("valued_amount_usd"),
    valuationSource: text("valuation_source"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_org_status_idx").on(t.organizationId, t.status),
    index("payments_subject_idx").on(t.subjectModule, t.subjectInvoiceId),
  ],
);

/** WAIA Core: payment wallet control-domain anchor (AT-E12 S2 / DEE-315). */
export const paymentWallets = pgTable(
  "payment_wallets",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    walletKind: paymentWalletKindEnumPg("wallet_kind").notNull(),
    custodyModel: paymentWalletCustodyModelEnumPg("custody_model").notNull(),
    controlModel: text("control_model").notNull(),
    providerRef: text("provider_ref"),
    derivationScheme: text("derivation_scheme"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("payment_wallets_org_status_idx").on(t.organizationId, t.status)],
);

/** WAIA Core: append-only payment address event ledger (AT-E12 S2 / DEE-315). */
export const paymentAddressEvents = pgTable(
  "payment_address_events",
  {
    id: uuid("id").primaryKey(),
    addressId: uuid("address_id").notNull(),
    walletId: uuid("wallet_id"),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: paymentAddressEventTypeEnumPg("event_type").notNull(),
    network: text("network").notNull(),
    address: text("address"),
    subjectModule: paymentSubjectModuleEnumPg("subject_module"),
    subjectRef: text("subject_ref"),
    bindingRef: text("binding_ref"),
    reason: text("reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_address_events_address_id_seq_unique").on(t.addressId, t.seq),
    index("payment_address_events_org_address_idx").on(t.organizationId, t.addressId),
  ],
);

/** WAIA Core: rebuildable payment address projection (AT-E12 S2 / DEE-315). */
export const paymentAddresses = pgTable(
  "payment_addresses",
  {
    addressId: uuid("address_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id").references(() => paymentWallets.id, { onDelete: "set null" }),
    network: text("network").notNull(),
    address: text("address").notNull(),
    status: paymentAddressStatusEnumPg("status").notNull(),
    subjectModule: paymentSubjectModuleEnumPg("subject_module"),
    subjectRef: text("subject_ref"),
    bindingRef: text("binding_ref"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_addresses_network_address_unique").on(t.network, t.address),
    uniqueIndex("payment_addresses_org_subject_active_unique")
      .on(t.organizationId, t.subjectModule, t.subjectRef)
      .where(sql`"status" = 'ACTIVATED'`),
    index("payment_addresses_org_status_idx").on(t.organizationId, t.status),
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

/** AI-TRADER: point-in-time position snapshots (DEE-350 / AT-E2). */
export const traderPositionSnapshots = pgTable(
  "trader_position_snapshots",
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
    positions: text("positions").notNull(),
    positionCount: integer("position_count").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_position_snapshots_org_cred_synced_idx").on(
      t.organizationId,
      t.credentialId,
      t.syncedAt,
    ),
    index("trader_position_snapshots_org_synced_idx").on(t.organizationId, t.syncedAt),
  ],
);

/** AI-TRADER: point-in-time trade-history snapshots (DEE-350 / AT-E2). */
export const traderTradeHistorySnapshots = pgTable(
  "trader_trade_history_snapshots",
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
    symbol: text("symbol").notNull(),
    trades: text("trades").notNull(),
    tradeCount: integer("trade_count").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_trade_history_snapshots_org_cred_symbol_synced_idx").on(
      t.organizationId,
      t.credentialId,
      t.symbol,
      t.syncedAt,
    ),
    index("trader_trade_history_snapshots_org_synced_idx").on(t.organizationId, t.syncedAt),
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
    maxRiskPerTradePct: text("max_risk_per_trade_pct").notNull().default("0.01"),
    maxPortfolioRiskPct: text("max_portfolio_risk_pct").notNull().default("0.05"),
    maxConcurrentPositions: integer("max_concurrent_positions").notNull().default(3),
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

export const reportingPeriodStatusEnumPg = pgEnum("reporting_period_status", ["OPEN", "CLOSED"]);
export const hwmEntryTypeEnumPg = pgEnum("hwm_entry_type", ["BOOTSTRAP", "RATCHET_UP", "ROLLBACK"]);
export const invoiceStatusEnumPg = pgEnum("invoice_status", ["DRAFT", "ISSUED", "PAID"]);
export const invoiceDisputeStatusEnumPg = pgEnum("invoice_dispute_status", [
  "OPEN",
  "RESOLVED_UPHELD",
  "RESOLVED_CORRECTED",
]);
export const invoiceDisputeEventTypeEnumPg = pgEnum("invoice_dispute_event_type", [
  "OPENED",
  "RESOLVED_UPHELD",
  "RESOLVED_CORRECTED",
]);
export const invoiceCorrectionTypeEnumPg = pgEnum("invoice_correction_type", ["CREDIT", "REFUND"]);
export const accountStatusEnumPg = pgEnum("account_status", ["ACTIVE", "SUSPENDED"]);
export const accountStatusEventTypeEnumPg = pgEnum("account_status_event_type", [
  "SUSPENDED",
  "REACTIVATED",
]);
export const settlementOutcomeEnumPg = pgEnum("settlement_outcome", ["APPLIED", "EXCEPTION"]);
export const settlementReconciliationCaseStatusEnumPg = pgEnum(
  "settlement_reconciliation_case_status",
  ["OPEN", "ASSIGNED", "UNDER_REVIEW", "DECISION_PENDING", "RESOLVED", "CANCELLED", "ESCALATED"],
);
export const settlementApplicationSourceEnumPg = pgEnum("settlement_application_source", [
  "AUTO",
  "MANUAL",
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

/** AI-TRADER M6: append-only pattern catalog score events (DEE-381). */
export const traderMiPatternScore = pgTable(
  "trader_mi_pattern_score",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternKey: text("pattern_key").notNull(),
    definitionDigest: text("definition_digest").notNull(),
    subjectRef: text("subject_ref").notNull(),
    matchScore: text("match_score").notNull(),
    relevanceScore: text("relevance_score").notNull(),
    confidenceMean: text("confidence_mean").notNull(),
    confidenceBandLow: text("confidence_band_low").notNull(),
    confidenceBandHigh: text("confidence_band_high").notNull(),
    priorHits: integer("prior_hits").notNull(),
    priorMisses: integer("prior_misses").notNull(),
    regime: text("regime").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_pattern_score_id_organization_unique").on(t.id, t.organizationId),
    index("trader_mi_pattern_score_org_pattern_subject_idx").on(
      t.organizationId,
      t.patternKey,
      t.subjectRef,
    ),
  ],
);

/** AI-TRADER M6: append-only price-move explanation records (DEE-381). */
export const traderPriceMoveExplanation = pgTable(
  "trader_price_move_explanation",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    priceMoveJson: text("price_move_json").notNull(),
    patternRefsJson: text("pattern_refs_json").notNull(),
    scoreBreakdownJson: text("score_breakdown_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_price_move_explanation_id_organization_unique").on(t.id, t.organizationId),
    index("trader_price_move_explanation_org_subject_idx").on(t.organizationId, t.subjectRef),
  ],
);

/** AI-TRADER M7: append-only external event records (DEE-382). */
export const traderEventRecord = pgTable(
  "trader_event_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    sourceRef: text("source_ref").notNull(),
    symbolScope: text("symbol_scope").notNull(),
    payloadJson: text("payload_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_event_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_event_record_org_digest_unique").on(t.organizationId, t.contentDigest),
    index("trader_event_record_org_key_idx").on(t.organizationId, t.eventKey),
  ],
);

export const traderEventClassification = pgTable(
  "trader_event_classification",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventRecordId: uuid("event_record_id")
      .notNull()
      .references(() => traderEventRecord.id, { onDelete: "cascade" }),
    classificationKind: text("classification_kind").notNull(),
    ruleId: text("rule_id").notNull(),
    confidence: text("confidence").notNull(),
    rationaleJson: text("rationale_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_event_classification_id_organization_unique").on(t.id, t.organizationId),
    index("trader_event_classification_org_event_idx").on(t.organizationId, t.eventRecordId),
  ],
);

export const traderEventAttribution = pgTable(
  "trader_event_attribution",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventRecordId: uuid("event_record_id")
      .notNull()
      .references(() => traderEventRecord.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    subjectKind: text("subject_kind").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true, mode: "date" }).notNull(),
    attributionStrength: text("attribution_strength").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_event_attribution_id_organization_unique").on(t.id, t.organizationId),
    index("trader_event_attribution_org_subject_idx").on(t.organizationId, t.subjectRef),
  ],
);

export const traderEventAttributionConfidence = pgTable(
  "trader_event_attribution_confidence",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventRecordId: uuid("event_record_id")
      .notNull()
      .references(() => traderEventRecord.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    confidenceMean: text("confidence_mean").notNull(),
    confidenceBandLow: text("confidence_band_low").notNull(),
    confidenceBandHigh: text("confidence_band_high").notNull(),
    priorSupporting: integer("prior_supporting").notNull(),
    priorContradicting: integer("prior_contradicting").notNull(),
    rationaleJson: text("rationale_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_event_attribution_confidence_id_organization_unique").on(t.id, t.organizationId),
  ],
);

export const traderEventExplanation = pgTable(
  "trader_event_explanation",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    priceMoveJson: text("price_move_json").notNull(),
    eventRefsJson: text("event_refs_json").notNull(),
    patternRefsJson: text("pattern_refs_json").notNull(),
    scoreBreakdownJson: text("score_breakdown_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_event_explanation_id_organization_unique").on(t.id, t.organizationId),
    index("trader_event_explanation_org_subject_idx").on(t.organizationId, t.subjectRef),
  ],
);

/** AI-TRADER M8: long-lived research campaign container (DEE-383). */
export const traderDiscoveryResearchCampaign = pgTable(
  "trader_discovery_research_campaign",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignKey: text("campaign_key").notNull(),
    name: text("name").notNull(),
    researchProgram: text("research_program").notNull(),
    description: text("description").notNull(),
    symbolScope: text("symbol_scope").notNull(),
    datasetDigest: text("dataset_digest"),
    currentState: text("current_state").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_research_campaign_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_discovery_research_campaign_org_key_unique").on(
      t.organizationId,
      t.campaignKey,
    ),
    uniqueIndex("trader_discovery_research_campaign_org_digest_unique").on(
      t.organizationId,
      t.contentDigest,
    ),
  ],
);

export const traderDiscoveryCampaignStateRecord = pgTable(
  "trader_discovery_campaign_state_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    priorState: text("prior_state"),
    newState: text("new_state").notNull(),
    rationale: text("rationale").notNull(),
    operatorAttestationDigest: text("operator_attestation_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_campaign_state_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    index("trader_discovery_campaign_state_record_org_campaign_idx").on(
      t.organizationId,
      t.campaignId,
    ),
  ],
);

export const traderDiscoveryResearchQuestion = pgTable(
  "trader_discovery_research_question",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    questionText: text("question_text").notNull(),
    researchProgram: text("research_program").notNull(),
    observationRefsJson: text("observation_refs_json").notNull(),
    structureClusterId: uuid("structure_cluster_id"),
    status: text("status").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_research_question_id_organization_unique").on(t.id, t.organizationId),
    index("trader_discovery_research_question_org_campaign_idx").on(t.organizationId, t.campaignId),
  ],
);

export const traderDiscoveryObservation = pgTable(
  "trader_discovery_observation",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    payloadJson: text("payload_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_observation_id_organization_unique").on(t.id, t.organizationId),
    index("trader_discovery_observation_org_campaign_idx").on(t.organizationId, t.campaignId),
  ],
);

export const traderDiscoveryStructureCluster = pgTable(
  "trader_discovery_structure_cluster",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    signatureKey: text("signature_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_structure_cluster_id_organization_unique").on(t.id, t.organizationId),
    index("trader_discovery_structure_cluster_org_campaign_idx").on(t.organizationId, t.campaignId),
  ],
);

export const traderDiscoveryHypothesisProposal = pgTable(
  "trader_discovery_hypothesis_proposal",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    researchQuestionId: uuid("research_question_id")
      .notNull()
      .references(() => traderDiscoveryResearchQuestion.id, { onDelete: "cascade" }),
    payloadJson: text("payload_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_hypothesis_proposal_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    index("trader_discovery_hypothesis_proposal_org_campaign_idx").on(
      t.organizationId,
      t.campaignId,
    ),
  ],
);

export const traderDiscoveryConsolidationRecord = pgTable(
  "trader_discovery_consolidation_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    sourceRefsJson: text("source_refs_json").notNull(),
    canonicalRef: text("canonical_ref"),
    rationale: text("rationale").notNull(),
    operatorAttestationDigest: text("operator_attestation_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_consolidation_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
  ],
);

export const traderDiscoveryStrategySynthesis = pgTable(
  "trader_discovery_strategy_synthesis",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    templateId: text("template_id").notNull(),
    paramsJson: text("params_json").notNull(),
    parentStrategyVersion: text("parent_strategy_version"),
    hypothesisProposalId: uuid("hypothesis_proposal_id"),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_strategy_synthesis_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_discovery_strategy_synthesis_org_strategy_version_unique").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
    ),
  ],
);

export const traderDiscoveryEvidenceRecord = pgTable(
  "trader_discovery_evidence_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    hypothesisRef: text("hypothesis_ref"),
    candidateRef: text("candidate_ref"),
    dimension: text("dimension").notNull(),
    direction: text("direction").notNull(),
    strength: text("strength").notNull(),
    uncertaintyBandLow: text("uncertainty_band_low").notNull(),
    uncertaintyBandHigh: text("uncertainty_band_high").notNull(),
    contradictionRefsJson: text("contradiction_refs_json").notNull(),
    sourceRunDigest: text("source_run_digest").notNull(),
    relevanceScore: text("relevance_score").notNull(),
    rationaleJson: text("rationale_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_evidence_record_id_organization_unique").on(t.id, t.organizationId),
    index("trader_discovery_evidence_record_org_candidate_idx").on(
      t.organizationId,
      t.candidateRef,
    ),
  ],
);

export const traderDiscoveryComparisonScore = pgTable(
  "trader_discovery_comparison_score",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    candidateRef: text("candidate_ref").notNull(),
    dimensionScoresJson: text("dimension_scores_json").notNull(),
    aggregateRankScore: text("aggregate_rank_score").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_comparison_score_id_organization_unique").on(t.id, t.organizationId),
  ],
);

export const traderDiscoveryPromotionProposal = pgTable(
  "trader_discovery_promotion_proposal",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id").notNull(),
    comparisonDigest: text("comparison_digest").notNull(),
    recommends: text("recommends").notNull(),
    rationale: text("rationale").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_promotion_proposal_id_organization_unique").on(t.id, t.organizationId),
  ],
);

export const traderDiscoveryRetirementRecord = pgTable(
  "trader_discovery_retirement_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => traderDiscoveryResearchCampaign.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    subjectKind: text("subject_kind").notNull(),
    rationale: text("rationale").notNull(),
    operatorAttestationDigest: text("operator_attestation_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_discovery_retirement_record_id_organization_unique").on(t.id, t.organizationId),
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
    // Re-typed text -> uuid in migration 0031 to carry the composite FK to trader_mi_trial.
    trialRegistrationRef: uuid("trial_registration_ref"),
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

export const miTrialIntegrityEventTypeEnumPg = pgEnum("mi_trial_integrity_event_type", [
  "invalidated",
  "reinstated",
]);
export const miTrialIntegrityReasonCodeEnumPg = pgEnum("mi_trial_integrity_reason_code", [
  "look_ahead_contamination",
  "pre_registration_breach",
  "computation_defect",
  "provenance_gap",
]);

/** AI-TRADER MI: append-only Confidence Judgment ledger (DEE-293 / LD-5a.3a). */
export const traderMiConfidenceJudgment = pgTable(
  "trader_mi_confidence_judgment",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: uuid("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    level: text("level"),
    bandLow: text("band_low"),
    bandHigh: text("band_high"),
    confidenceScaleVersion: text("confidence_scale_version"),
    judgmentKind: text("judgment_kind").notNull(),
    reviewHorizonAt: timestamp("review_horizon_at", { withTimezone: true, mode: "date" }),
    forCitationsJson: text("for_citations_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_confidence_judgment_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_confidence_judgment_org_key_seq_unique").on(
      t.organizationId,
      t.hypothesisKey,
      t.seq,
    ),
    index("trader_mi_confidence_judgment_org_hypothesis_idx").on(t.organizationId, t.hypothesisId),
    index("trader_mi_confidence_judgment_org_key_seq_idx").on(
      t.organizationId,
      t.hypothesisKey,
      t.seq,
    ),
    index("trader_mi_confidence_judgment_org_hypothesis_ingest_idx").on(
      t.organizationId,
      t.hypothesisId,
      t.ingestTime,
    ),
  ],
);

/** AI-TRADER MI: append-only Trial Integrity invalidation ledger (DEE-291 / LD-5a.2c). */
export const traderMiTrialIntegrityEvent = pgTable(
  "trader_mi_trial_integrity_event",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    trialId: uuid("trial_id").notNull(), // composite FK enforced in migration SQL
    eventType: miTrialIntegrityEventTypeEnumPg("event_type").notNull(),
    reasonCode: miTrialIntegrityReasonCodeEnumPg("reason_code"),
    rationale: text("rationale").notNull(),
    causeRef: text("cause_ref"),
    schemaVersion: text("schema_version").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_trial_integrity_event_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_mi_trial_integrity_event_org_trial_seq_unique").on(
      t.organizationId,
      t.trialId,
      t.seq,
    ),
    index("trader_mi_trial_integrity_event_org_trial_seq_idx").on(
      t.organizationId,
      t.trialId,
      t.seq,
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
    researchEvidenceJson: jsonb("research_evidence_json"),
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

/** AI-TRADER: billing reporting period valued-input record (DEE-305 / AT-E11 S1). */
export const traderReportingPeriods = pgTable(
  "trader_reporting_periods",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }),
    startingEquity: text("starting_equity").notNull(),
    endingEquity: text("ending_equity"),
    openPositionsSnapshotRef: text("open_positions_snapshot_ref").notNull().default(""),
    realizedPnl: text("realized_pnl"),
    unrealizedPnl: text("unrealized_pnl"),
    netDeposits: text("net_deposits").notNull().default("0"),
    netWithdrawals: text("net_withdrawals").notNull().default("0"),
    valuationSource: text("valuation_source").notNull(),
    startingSnapshotAt: timestamp("starting_snapshot_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endingSnapshotAt: timestamp("ending_snapshot_at", { withTimezone: true, mode: "date" }),
    schemaVersion: text("schema_version").notNull(),
    status: reportingPeriodStatusEnumPg("status").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_reporting_periods_org_account_start_idx").on(
      t.organizationId,
      t.exchangeAccountId,
      t.periodStart,
    ),
  ],
);

/** AI-TRADER: per-account high-water mark append-only ledger (DEE-307 / AT-E11 S3). */
export const traderHwmLedger = pgTable(
  "trader_hwm_ledger",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    entryType: hwmEntryTypeEnumPg("entry_type").notNull(),
    highWaterMark: text("high_water_mark").notNull(),
    previousHighWaterMark: text("previous_high_water_mark"),
    sourcePeriodId: text("source_period_id"),
    sourceInvoiceId: text("source_invoice_id"),
    valuationSource: text("valuation_source").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
    reason: text("reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_hwm_ledger_org_account_effective_idx").on(
      t.organizationId,
      t.exchangeAccountId,
      t.effectiveAt,
    ),
  ],
);

/** AI-TRADER: immutable draft invoice financial commitment record (DEE-310 / AT-E11 S5). */
export const traderInvoices = pgTable(
  "trader_invoices",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    reportingPeriodId: text("reporting_period_id").notNull(),
    feeArtifactDigest: text("fee_artifact_digest").notNull(),
    status: invoiceStatusEnumPg("status").notNull(),
    currency: text("currency").notNull(),
    periodRealizedStrategyProfit: text("period_realized_strategy_profit").notNull(),
    cumulativeRealizedStrategyProfit: text("cumulative_realized_strategy_profit").notNull(),
    previousHighWaterMark: text("previous_high_water_mark").notNull(),
    newProfitAboveHwm: text("new_profit_above_hwm").notNull(),
    feeRate: text("fee_rate").notNull(),
    performanceFee: text("performance_fee").notNull(),
    proposedNewHighWaterMark: text("proposed_new_high_water_mark").notNull(),
    billable: boolean("billable").notNull(),
    unrealizedPnl: text("unrealized_pnl"),
    realizedFillFinality: boolean("realized_fill_finality").notNull(),
    startingEquity: text("starting_equity").notNull(),
    endingEquity: text("ending_equity").notNull(),
    netDeposits: text("net_deposits").notNull(),
    netWithdrawals: text("net_withdrawals").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }).notNull(),
    valuationSource: text("valuation_source").notNull(),
    feeComputedAt: timestamp("fee_computed_at", { withTimezone: true, mode: "date" }).notNull(),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    issuanceApprovedAt: timestamp("issuance_approved_at", {
      withTimezone: true,
      mode: "date",
    }),
    issuanceApprovedBy: text("issuance_approved_by"),
    coolingOffUntil: timestamp("cooling_off_until", { withTimezone: true, mode: "date" }),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }),
    issuedBy: text("issued_by"),
    settledAmount: text("settled_amount").notNull().default("0"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_invoices_org_account_created_idx").on(
      t.organizationId,
      t.exchangeAccountId,
      t.createdAt,
    ),
    uniqueIndex("trader_invoices_org_account_period_unique").on(
      t.organizationId,
      t.exchangeAccountId,
      t.reportingPeriodId,
    ),
  ],
);

/** AI-TRADER: invoice dispute projection (AT-E11 / DEE-215). */
export const traderInvoiceDisputes = pgTable(
  "trader_invoice_disputes",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    status: invoiceDisputeStatusEnumPg("status").notNull(),
    reason: text("reason"),
    openedBy: text("opened_by"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolutionReason: text("resolution_reason"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_invoice_disputes_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("trader_invoice_disputes_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** AI-TRADER: append-only invoice dispute event ledger (AT-E11 / DEE-215). */
export const traderInvoiceDisputeEvents = pgTable(
  "trader_invoice_dispute_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => traderInvoiceDisputes.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: invoiceDisputeEventTypeEnumPg("event_type").notNull(),
    reason: text("reason"),
    actorType: auditActorTypeEnumPg("actor_type").notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trader_invoice_dispute_events_dispute_seq_unique").on(t.disputeId, t.seq)],
);

/** AI-TRADER: append-only invoice correction ledger (AT-E11 / DEE-215). */
export const traderInvoiceCorrections = pgTable(
  "trader_invoice_corrections",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    disputeId: uuid("dispute_id").references(() => traderInvoiceDisputes.id, {
      onDelete: "set null",
    }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    reportingPeriodId: text("reporting_period_id").notNull(),
    correctionType: invoiceCorrectionTypeEnumPg("correction_type").notNull(),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    restoredHwm: text("restored_hwm").notNull(),
    hwmLedgerEntryId: uuid("hwm_ledger_entry_id")
      .notNull()
      .references(() => traderHwmLedger.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    actorType: auditActorTypeEnumPg("actor_type").notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_invoice_corrections_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("trader_invoice_corrections_dispute_idx").on(t.disputeId),
  ],
);

/** AI-TRADER: settlement exactly-once anchor (one row per CONFIRMED payment; AT-E12 S3-B). */
export const traderSettlements = pgTable(
  "trader_settlements",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.paymentId, { onDelete: "cascade" }),
    settlementNetwork: text("settlement_network"),
    settlementTxHash: text("settlement_tx_hash"),
    transferIndex: integer("transfer_index"),
    blockHeight: text("block_height"),
    asset: text("asset"),
    onChainAmount: text("on_chain_amount"),
    valuedAmount: text("valued_amount"),
    valuationCurrency: text("valuation_currency"),
    valuationBasis: text("valuation_basis"),
    outcome: settlementOutcomeEnumPg("outcome").notNull(),
    exceptionReason: text("exception_reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_settlements_payment_id_unique").on(t.paymentId),
    index("trader_settlements_org_account_idx").on(t.organizationId, t.exchangeAccountId),
    index("trader_settlements_outcome_idx").on(t.outcome),
  ],
);

/** AI-TRADER: settlement allocation to invoice (AT-E12 S3-B). */
export const traderSettlementApplications = pgTable(
  "trader_settlement_applications",
  {
    id: uuid("id").primaryKey(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => traderSettlements.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    appliedAmount: text("applied_amount").notNull(),
    invoiceStatusAfter: invoiceStatusEnumPg("invoice_status_after").notNull(),
    applicationSource: settlementApplicationSourceEnumPg("application_source")
      .notNull()
      .default("AUTO"),
    reconciliationCaseId: uuid("reconciliation_case_id"),
    decisionId: uuid("decision_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_settlement_applications_settlement_id_unique").on(t.settlementId),
    index("trader_settlement_applications_settlement_idx").on(t.settlementId),
    index("trader_settlement_applications_invoice_idx").on(t.invoiceId),
  ],
);

/** AI-TRADER: exchange account status projection (AT-E12 S3-B). */
export const traderAccountStatus = pgTable(
  "trader_account_status",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    status: accountStatusEnumPg("status").notNull(),
    reason: text("reason"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.exchangeAccountId] })],
);

/** AI-TRADER: append-only account status event ledger (AT-E12 S3-B). */
export const traderAccountStatusEvents = pgTable(
  "trader_account_status_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    seq: integer("seq").notNull(),
    eventType: accountStatusEventTypeEnumPg("event_type").notNull(),
    reason: text("reason"),
    sourcePaymentId: uuid("source_payment_id"),
    sourceInvoiceId: uuid("source_invoice_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_account_status_events_org_account_seq_unique").on(
      t.organizationId,
      t.exchangeAccountId,
      t.seq,
    ),
  ],
);

/** AI-TRADER: settlement exception reconciliation case projection (AT-E12 S3-C-A). */
export const traderSettlementReconciliationCases = pgTable(
  "trader_settlement_reconciliation_cases",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => traderSettlements.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.paymentId, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    exceptionReason: text("exception_reason"),
    status: settlementReconciliationCaseStatusEnumPg("status").notNull().default("OPEN"),
    priority: integer("priority").notNull(),
    resolutionType: text("resolution_type"),
    currentDecisionId: uuid("current_decision_id"),
    assignedTo: uuid("assigned_to"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true, mode: "date" }),
    coolingOffUntil: timestamp("cooling_off_until", { withTimezone: true, mode: "date" }),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
  },
  (t) => [
    uniqueIndex("trader_settlement_reconciliation_cases_settlement_id_unique").on(t.settlementId),
    index("trader_settlement_reconciliation_cases_org_status_priority_idx").on(
      t.organizationId,
      t.status,
      t.priority,
      t.openedAt,
    ),
  ],
);

/** AI-TRADER: append-only settlement reconciliation event ledger (AT-E12 S3-C-A). */
export const traderSettlementReconciliationEvents = pgTable(
  "trader_settlement_reconciliation_events",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => traderSettlementReconciliationCases.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    actorType: auditActorTypeEnumPg("actor_type").notNull(),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").notNull(),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_settlement_reconciliation_events_case_seq_unique").on(t.caseId, t.seq),
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

export const positionSideEnumPg = pgEnum("trader_position_side", ["LONG", "SHORT"]);
export const instrumentKindEnumPg = pgEnum("trader_instrument_kind", ["SPOT", "PERP", "FUTURE"]);
export const positionLotStateEnumPg = pgEnum("trader_position_lot_state", ["OPEN", "CLOSED"]);
export const tradeStateEnumPg = pgEnum("trader_trade_state", ["OPEN", "CLOSED", "FORCED_FLAT"]);
export const tradeLegKindEnumPg = pgEnum("trader_trade_leg_kind", [
  "OPEN_FILL",
  "CLOSE_FILL",
  "FORCED_FLAT",
]);
export const lifecycleEventPhaseEnumPg = pgEnum("trader_lifecycle_event_phase", [
  "SIGNAL_ACCEPTED",
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "TRADE_OPENED",
  "TRADE_CLOSED",
  "FORCED_FLAT",
  "GUARDIAN_EVALUATED",
  "GUARDIAN_EXIT_INTENT",
]);
export const lifecycleEntityTypeEnumPg = pgEnum("trader_lifecycle_entity_type", [
  "TRADE",
  "POSITION_LOT",
  "ORDER",
  "FILL",
  "STRATEGY_SIGNAL",
]);

/** AI-TRADER: round-trip knowledge records (M1 / DEE-376). */
export const traderTrades = pgTable(
  "trader_trades",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    venue: text("venue").notNull(),
    accountKey: text("account_key").notNull(),
    positionSide: positionSideEnumPg("position_side").notNull(),
    instrumentKind: instrumentKindEnumPg("instrument_kind").notNull(),
    strategySignalId: text("strategy_signal_id").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    state: tradeStateEnumPg("state").notNull(),
    semanticsVersion: text("semantics_version").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    realizedPnl: text("realized_pnl").notNull().default("0"),
    markedPnl: text("marked_pnl").notNull().default("0"),
    hypothesisId: uuid("hypothesis_id"),
    patternId: uuid("pattern_id"),
    riskDecisionId: text("risk_decision_id").notNull(),
    allocationDecisionId: text("allocation_decision_id"),
    reasoningSessionId: text("reasoning_session_id"),
    signalConfidence: text("signal_confidence"),
    openingRegime: text("opening_regime"),
    openingMsvId: text("opening_msv_id"),
    openingFeatureSetId: text("opening_feature_set_id"),
    closingMsvId: text("closing_msv_id"),
    closingFeatureSetId: text("closing_feature_set_id"),
    closingRegime: text("closing_regime"),
    frozenAt: timestamp("frozen_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_trades_id_organization_unique").on(t.id, t.organizationId),
    index("trader_trades_org_strategy_signal_idx").on(t.organizationId, t.strategySignalId),
    index("trader_trades_org_state_idx").on(t.organizationId, t.state),
  ],
);

/** AI-TRADER: live position lots (M1 / DEE-376). */
export const traderPositionLots = pgTable(
  "trader_position_lots",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    venue: text("venue").notNull(),
    accountKey: text("account_key").notNull(),
    positionSide: positionSideEnumPg("position_side").notNull(),
    instrumentKind: instrumentKindEnumPg("instrument_kind").notNull(),
    strategySignalId: text("strategy_signal_id").notNull(),
    state: positionLotStateEnumPg("state").notNull(),
    openQty: text("open_qty").notNull(),
    remainingQty: text("remaining_qty").notNull(),
    avgCost: text("avg_cost").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    tradeId: uuid("trade_id").notNull(),
    hedgeGroupId: uuid("hedge_group_id"),
    targetLotId: uuid("target_lot_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_position_lots_id_organization_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.tradeId, t.organizationId],
      foreignColumns: [traderTrades.id, traderTrades.organizationId],
    }).onDelete("cascade"),
    index("trader_position_lots_org_state_idx").on(t.organizationId, t.state),
    index("trader_position_lots_org_symbol_strategy_idx").on(
      t.organizationId,
      t.symbol,
      t.strategySignalId,
    ),
  ],
);

/** AI-TRADER: append-only trade legs (M1 / DEE-376). */
export const traderTradeLegs = pgTable(
  "trader_trade_legs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tradeId: uuid("trade_id").notNull(),
    positionLotId: uuid("position_lot_id").notNull(),
    kind: tradeLegKindEnumPg("kind").notNull(),
    orderId: uuid("order_id").notNull(),
    fillId: uuid("fill_id"),
    syntheticId: text("synthetic_id"),
    quantity: text("quantity").notNull(),
    price: text("price").notNull(),
    fee: text("fee").notNull().default("0"),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "date" }).notNull(),
    legPnl: text("leg_pnl").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_trade_legs_id_organization_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.tradeId, t.organizationId],
      foreignColumns: [traderTrades.id, traderTrades.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.positionLotId, t.organizationId],
      foreignColumns: [traderPositionLots.id, traderPositionLots.organizationId],
    }).onDelete("cascade"),
    index("trader_trade_legs_org_trade_idx").on(t.organizationId, t.tradeId),
  ],
);

/** AI-TRADER: append-only lifecycle trace (M1 / DEE-376). */
export const traderLifecycleEvents = pgTable(
  "trader_lifecycle_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: lifecycleEntityTypeEnumPg("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    phase: lifecycleEventPhaseEnumPg("phase").notNull(),
    payload: text("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    researchRunId: uuid("research_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_lifecycle_events_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    index("trader_lifecycle_events_org_phase_idx").on(t.organizationId, t.phase),
  ],
);

/** AI-TRADER: org-level live-enable governance states (DEE-212 / BP-7). */
export const traderOrgLiveEnableStateEnum = [
  "DISABLED",
  "REQUESTED",
  "COOLING_OFF",
  "ENABLED",
  "CANCELLED",
] as const;
export type TraderOrgLiveEnableState = (typeof traderOrgLiveEnableStateEnum)[number];

export const traderOrgLiveEnableEventTypeEnum = [
  "REQUESTED",
  "CONFIRMED",
  "ENABLED",
  "DISABLED",
  "CANCELLED",
] as const;
export type TraderOrgLiveEnableEventType = (typeof traderOrgLiveEnableEventTypeEnum)[number];

export const traderOrgLiveEnableStateEnumPg = pgEnum(
  "trader_org_live_enable_state",
  traderOrgLiveEnableStateEnum,
);
export const traderOrgLiveEnableEventTypeEnumPg = pgEnum(
  "trader_org_live_enable_event_type",
  traderOrgLiveEnableEventTypeEnum,
);

/** AI-TRADER: org-level live-enable projection (DEE-212 / BP-7). One row per organization. */
export const traderOrgLiveEnable = pgTable("trader_org_live_enable", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  state: traderOrgLiveEnableStateEnumPg("state").notNull().default("DISABLED"),
  maxNotionalCap: text("max_notional_cap").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }),
  coolingOffEndsAt: timestamp("cooling_off_ends_at", { withTimezone: true, mode: "date" }),
  enabledAt: timestamp("enabled_at", { withTimezone: true, mode: "date" }),
  disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
  operatorAckPhraseHash: text("operator_ack_phrase_hash"),
  stateVersion: integer("state_version").notNull().default(1),
  lastEventSeq: integer("last_event_seq").notNull().default(0),
  lastEventDigest: text("last_event_digest"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** AI-TRADER: append-only org live-enable event log (DEE-212 / BP-7). */
export const traderOrgLiveEnableEvents = pgTable(
  "trader_org_live_enable_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: traderOrgLiveEnableEventTypeEnumPg("event_type").notNull(),
    maxNotionalCap: text("max_notional_cap"),
    reason: text("reason"),
    actorType: auditActorTypeEnumPg("actor_type").notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trader_org_live_enable_events_org_seq_unique").on(t.organizationId, t.seq)],
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

/** WAIA Core: payment watcher cursor (AT-E12 S3-A / DEE-321). Network-scoped, mutable. */
export const paymentWatcherCheckpoints = pgTable("payment_watcher_checkpoints", {
  network: text("network").primaryKey(),
  lastScannedBlock: text("last_scanned_block").notNull(),
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true, mode: "date" }).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: "date" }),
  cycleCount: integer("cycle_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** RI-P1: canonical append-only OHLCV history (ADR-0018). */
export const traderMarketBars = pgTable(
  "trader_market_bars",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    barOpenTime: timestamp("bar_open_time", { withTimezone: true, mode: "date" }).notNull(),
    barCloseTime: timestamp("bar_close_time", { withTimezone: true, mode: "date" }).notNull(),
    open: text("open").notNull(),
    high: text("high").notNull(),
    low: text("low").notNull(),
    close: text("close").notNull(),
    volume: text("volume").notNull(),
    contentDigest: text("content_digest").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_market_bars_org_symbol_interval_open_unique").on(
      t.organizationId,
      t.symbol,
      t.interval,
      t.barOpenTime,
    ),
    index("trader_market_bars_org_symbol_time_idx").on(t.organizationId, t.symbol, t.barOpenTime),
  ],
);

/** RI-P1: extensible Layer-1 market facts. */
export const traderMarketFacts = pgTable(
  "trader_market_facts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    factKind: text("fact_kind").notNull(),
    subjectRef: text("subject_ref").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_market_facts_org_digest_unique").on(t.organizationId, t.contentDigest),
    index("trader_market_facts_org_kind_subject_idx").on(
      t.organizationId,
      t.factKind,
      t.subjectRef,
    ),
  ],
);

export const researchDatasetSplitEnumPg = pgEnum("research_dataset_split", [
  "train",
  "validation",
  "blind",
]);

/** RI-P1: sealed research datasets with train/validation/blind splits. */
export const researchDataset = pgTable(
  "research_dataset",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    trainBarCount: integer("train_bar_count").notNull(),
    validationBarCount: integer("validation_bar_count").notNull(),
    blindBarCount: integer("blind_bar_count").notNull(),
    trainDigest: text("train_digest").notNull(),
    validationDigest: text("validation_digest").notNull(),
    blindDigest: text("blind_digest").notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true, mode: "date" }).notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("research_dataset_org_name_unique").on(t.organizationId, t.name)],
);

export const backtestRunStatusEnumPg = pgEnum("backtest_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

/** RI-P2: backtest run registry. */
export const traderBacktestRuns = pgTable(
  "trader_backtest_runs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => researchDataset.id, { onDelete: "restrict" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    costModelVersion: text("cost_model_version").notNull(),
    split: researchDatasetSplitEnumPg("split").notNull(),
    status: backtestRunStatusEnumPg("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    evidenceDigest: text("evidence_digest"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_backtest_runs_org_strategy_idx").on(t.organizationId, t.strategyId, t.createdAt),
  ],
);

/** RI-P2: per-regime backtest result slices. */
export const traderBacktestResults = pgTable(
  "trader_backtest_results",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => traderBacktestRuns.id, { onDelete: "cascade" }),
    regimeLabel: text("regime_label").notNull(),
    metricsJson: text("metrics_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("trader_backtest_results_run_regime_idx").on(t.runId, t.regimeLabel)],
);

export const strategyCandidateStatusEnumPg = pgEnum("strategy_candidate_status", [
  "draft",
  "registered",
  "backtested",
  "walk_forward_validated",
  "blind_validated",
  "rejected",
]);

/** RI-P3: strategy candidate experiment registry. */
export const traderStrategyCandidates = pgTable(
  "trader_strategy_candidates",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    hypothesisId: uuid("hypothesis_id"),
    trialId: uuid("trial_id"),
    status: strategyCandidateStatusEnumPg("status").notNull(),
    paramsJson: text("params_json").notNull(),
    blindUsed: boolean("blind_used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_strategy_candidates_org_strategy_version_unique").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
    ),
  ],
);

/** RI-P3: walk-forward window results. */
export const traderWalkForwardWindows = pgTable(
  "trader_walk_forward_windows",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => traderStrategyCandidates.id, { onDelete: "cascade" }),
    windowIndex: integer("window_index").notNull(),
    inSampleDigest: text("in_sample_digest").notNull(),
    outOfSampleDigest: text("out_of_sample_digest").notNull(),
    metricsJson: text("metrics_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_walk_forward_windows_candidate_idx_unique").on(
      t.candidateId,
      t.windowIndex,
    ),
  ],
);

/** RI-P3: immutable blind validation result (single-shot). */
export const traderBlindValidationResults = pgTable(
  "trader_blind_validation_results",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => traderStrategyCandidates.id, { onDelete: "restrict" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => researchDataset.id, { onDelete: "restrict" }),
    metricsJson: text("metrics_json").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trader_blind_validation_results_candidate_unique").on(t.candidateId)],
);

/** RI-P4: Layer-2 market events. */
export const traderMarketEvents = pgTable(
  "trader_market_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKind: text("event_kind").notNull(),
    subjectRef: text("subject_ref").notNull(),
    payloadJson: text("payload_json").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    confidence: text("confidence").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_market_events_org_digest_unique").on(t.organizationId, t.contentDigest),
  ],
);

/** RI-P4: Layer-3 knowledge edges (correlational hypotheses). */
export const traderKnowledgeEdges = pgTable(
  "trader_knowledge_edges",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    relationKind: text("relation_kind").notNull(),
    confidence: text("confidence").notNull(),
    strength: text("strength").notNull(),
    regimeScope: text("regime_scope").notNull(),
    failureCasesJson: text("failure_cases_json").notNull(),
    hypothesisId: uuid("hypothesis_id"),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("trader_knowledge_edges_org_from_to_idx").on(t.organizationId, t.fromRef, t.toRef)],
);

/** RI-P4: market predictions for verify->learn loop. */
export const traderMarketPredictions = pgTable(
  "trader_market_predictions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectRef: text("subject_ref").notNull(),
    predictionJson: text("prediction_json").notNull(),
    predictedAt: timestamp("predicted_at", { withTimezone: true, mode: "date" }).notNull(),
    outcomeJson: text("outcome_json"),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    verificationResult: text("verification_result"),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("trader_market_predictions_org_subject_idx").on(
      t.organizationId,
      t.subjectRef,
      t.predictedAt,
    ),
  ],
);

/** RI-P5: AI operator action audit log (append-only). */
export const traderOperatorAudit = pgTable(
  "trader_operator_audit",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actionKind: text("action_kind").notNull(),
    actionPayloadJson: text("action_payload_json").notNull(),
    recommendationJson: text("recommendation_json"),
    actorKind: text("actor_kind").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("trader_operator_audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

/** DEE-415 / HTR-WP13: per-cycle intelligence envelope (append-only). */
export const traderIntelligenceCycleEnvelope = pgTable(
  "trader_intelligence_cycle_envelope",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    historicalProfileId: text("historical_profile_id").notNull(),
    historicalProfileDigest: text("historical_profile_digest").notNull(),
    matrixDigest: text("matrix_digest").notNull(),
    terminalReasonCode: text("terminal_reason_code").notNull(),
    inputSemanticDigest: text("input_semantic_digest").notNull(),
    outputSemanticDigest: text("output_semantic_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_cycle_envelope_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_intelligence_cycle_envelope_org_run_cycle_symbol_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
    ),
    index("trader_intelligence_cycle_envelope_org_run_evaluated_idx").on(
      t.organizationId,
      t.runId,
      t.evaluatedAt,
    ),
  ],
);

/** DEE-415 / HTR-WP13: per-cycle hypothesis records (append-only). */
export const traderIntelligenceHypothesisRecord = pgTable(
  "trader_intelligence_hypothesis_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleEnvelopeId: uuid("cycle_envelope_id").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    hypothesisType: text("hypothesis_type").notNull(),
    hypothesisStatus: text("hypothesis_status").notNull(),
    confidenceValue: text("confidence_value").notNull(),
    thesisDigest: text("thesis_digest").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    miHypothesisId: uuid("mi_hypothesis_id"),
    authoritativeLinkDigest: text("authoritative_link_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_hypothesis_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("trader_intelligence_hypothesis_record_org_run_cycle_symbol_type_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
      t.hypothesisType,
    ),
    index("trader_intelligence_hypothesis_record_org_cycle_envelope_idx").on(
      t.organizationId,
      t.cycleEnvelopeId,
    ),
  ],
);

/** DEE-415 / HTR-WP13: per-cycle conviction record (Model B, append-only). */
export const traderIntelligenceConvictionRecord = pgTable(
  "trader_intelligence_conviction_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleEnvelopeId: uuid("cycle_envelope_id").notNull(),
    activeHypothesisRecordId: uuid("active_hypothesis_record_id"),
    convictionScope: text("conviction_scope").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    convictionValue: text("conviction_value").notNull(),
    convictionClass: text("conviction_class").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    sustainedCycles: integer("sustained_cycles").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_conviction_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("trader_intelligence_conviction_record_org_run_cycle_symbol_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
    ),
    index("trader_intelligence_conviction_record_org_cycle_envelope_idx").on(
      t.organizationId,
      t.cycleEnvelopeId,
    ),
  ],
);

export const traderIntelligenceForecastRecord = pgTable(
  "trader_intelligence_forecast_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleEnvelopeId: uuid("cycle_envelope_id").notNull(),
    hypothesisRecordId: uuid("hypothesis_record_id").notNull(),
    convictionRecordId: uuid("conviction_record_id").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    forecastKeyDigest: text("forecast_key_digest").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    evidenceCutoffAt: timestamp("evidence_cutoff_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    targetWindowStartAt: timestamp("target_window_start_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    targetWindowEndAt: timestamp("target_window_end_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    marketQuestion: text("market_question").notNull(),
    invalidationConditionsJson: text("invalidation_conditions_json").notNull(),
    scenarioSetJson: text("scenario_set_json").notNull(),
    forecastConfidenceJson: text("forecast_confidence_json").notNull(),
    historicalProfileId: text("historical_profile_id").notNull(),
    historicalProfileDigest: text("historical_profile_digest").notNull(),
    matrixDigest: text("matrix_digest").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    authoritativeLinkDigest: text("authoritative_link_digest").notNull(),
    forecastModelVersion: text("forecast_model_version").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_forecast_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_intelligence_forecast_record_org_run_cycle_symbol_key_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
      t.forecastKeyDigest,
    ),
    index("trader_intelligence_forecast_record_org_cycle_envelope_idx").on(
      t.organizationId,
      t.cycleEnvelopeId,
    ),
  ],
);

export const traderIntelligenceDecisionRecord = pgTable(
  "trader_intelligence_decision_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleEnvelopeId: uuid("cycle_envelope_id").notNull(),
    convictionRecordId: uuid("conviction_record_id").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true, mode: "date" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    decisionClass: text("decision_class").notNull(),
    universalTerminalReasonCode: text("universal_terminal_reason_code").notNull(),
    whyNotCashJson: text("why_not_cash_json"),
    whyCashOrAbstainJson: text("why_cash_or_abstain_json"),
    grossExpectedReward: text("gross_expected_reward"),
    expectedFees: text("expected_fees"),
    expectedSlippage: text("expected_slippage"),
    expectedOtherCosts: text("expected_other_costs"),
    expectedRewardAfterCosts: text("expected_reward_after_costs"),
    costModelId: text("cost_model_id"),
    costModelVersion: text("cost_model_version"),
    costEvidenceState: text("cost_evidence_state").notNull(),
    cdeMsvPermissionSnapshotJson: text("cde_msv_permission_snapshot_json").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    strategyId: text("strategy_id"),
    strategyVersion: text("strategy_version"),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_decision_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_intelligence_decision_record_org_run_cycle_symbol_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
    ),
    index("trader_intelligence_decision_record_org_cycle_envelope_idx").on(
      t.organizationId,
      t.cycleEnvelopeId,
    ),
  ],
);

export const traderIntelligenceDecisionForecastLink = pgTable(
  "trader_intelligence_decision_forecast_link",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    decisionRecordId: uuid("decision_record_id").notNull(),
    forecastRecordId: uuid("forecast_record_id").notNull(),
    linkRole: text("link_role").notNull(),
    ordinal: integer("ordinal").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_decision_forecast_link_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("trader_intelligence_decision_forecast_link_org_decision_forecast_unique").on(
      t.organizationId,
      t.decisionRecordId,
      t.forecastRecordId,
    ),
    uniqueIndex("trader_intelligence_decision_forecast_link_org_decision_ordinal_unique").on(
      t.organizationId,
      t.decisionRecordId,
      t.ordinal,
    ),
  ],
);

export const traderIntelligenceEntryPurposeRecord = pgTable(
  "trader_intelligence_entry_purpose_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    decisionRecordId: uuid("decision_record_id").notNull(),
    primaryForecastRecordId: uuid("primary_forecast_record_id").notNull(),
    hypothesisRecordId: uuid("hypothesis_record_id").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    originalThesisJson: text("original_thesis_json").notNull(),
    expectedPath: text("expected_path").notNull(),
    forecastHorizon: text("forecast_horizon").notNull(),
    entryReason: text("entry_reason").notNull(),
    entryConditionJson: text("entry_condition_json").notNull(),
    invalidationConditionJson: text("invalidation_condition_json").notNull(),
    initialStopModelJson: text("initial_stop_model_json").notNull(),
    targetModelJson: text("target_model_json").notNull(),
    optionalPartialTargetsJson: text("optional_partial_targets_json"),
    maximumHoldingUntil: timestamp("maximum_holding_until", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    whyNotCashJson: text("why_not_cash_json").notNull(),
    riskAmountJson: text("risk_amount_json").notNull(),
    expectedRewardAfterCosts: text("expected_reward_after_costs").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_intelligence_entry_purpose_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("trader_intelligence_entry_purpose_record_org_decision_unique").on(
      t.organizationId,
      t.decisionRecordId,
    ),
    uniqueIndex("trader_intelligence_entry_purpose_record_org_run_cycle_symbol_unique").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
    ),
  ],
);

export const traderStrategyLifecycleEvent = pgTable(
  "trader_strategy_lifecycle_event",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actor: text("actor").notNull(),
    approvalRef: text("approval_ref"),
    reasonCode: text("reason_code"),
    seq: integer("seq").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
    runId: text("run_id"),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_strategy_lifecycle_event_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_strategy_lifecycle_event_org_strategy_version_seq_unique").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
      t.seq,
    ),
    index("trader_strategy_lifecycle_event_org_strategy_version_effective_idx").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
      t.effectiveAt,
    ),
  ],
);

export const traderStrategyTrial = pgTable(
  "trader_strategy_trial",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    accountKey: text("account_key").notNull(),
    portfolioId: text("portfolio_id").notNull(),
    seq: integer("seq").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true, mode: "date" }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    registeredBy: text("registered_by").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_strategy_trial_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("trader_strategy_trial_org_strategy_run_cycle_symbol_unique").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
      t.runId,
      t.cycleId,
      t.symbol,
    ),
    uniqueIndex("trader_strategy_trial_org_strategy_run_seq_unique").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
      t.runId,
      t.seq,
    ),
    index("trader_strategy_trial_org_strategy_run_event_time_idx").on(
      t.organizationId,
      t.strategyId,
      t.strategyVersion,
      t.runId,
      t.eventTime,
    ),
  ],
);

export const traderAccountDrawdownCheckpoint = pgTable(
  "trader_account_drawdown_checkpoint",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountKey: text("account_key").notNull(),
    portfolioId: text("portfolio_id").notNull(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    monthKey: text("month_key").notNull(),
    equityUsdt: text("equity_usdt").notNull(),
    accountPeakHwm: text("account_peak_hwm").notNull(),
    monthlyPeakHwm: text("monthly_peak_hwm").notNull(),
    accountDrawdownBps: integer("account_drawdown_bps").notNull(),
    monthlyDrawdownBps: integer("monthly_drawdown_bps").notNull(),
    breachState: text("breach_state").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_account_drawdown_checkpoint_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("tadd_chkpt_org_acct_run_seq_uq").on(
      t.organizationId,
      t.accountKey,
      t.portfolioId,
      t.runId,
      t.seq,
    ),
    index("tadd_chkpt_org_acct_run_asof_ix").on(
      t.organizationId,
      t.accountKey,
      t.portfolioId,
      t.runId,
      t.asOf,
    ),
  ],
);

export const traderStrategyDrawdownCheckpoint = pgTable(
  "trader_strategy_drawdown_checkpoint",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountKey: text("account_key").notNull(),
    portfolioId: text("portfolio_id").notNull(),
    runId: text("run_id").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    seq: integer("seq").notNull(),
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    strategyAllocationUsdt: text("strategy_allocation_usdt").notNull(),
    strategyEquityUsdt: text("strategy_equity_usdt").notNull(),
    strategyPeakHwm: text("strategy_peak_hwm").notNull(),
    strategyDrawdownBps: integer("strategy_drawdown_bps").notNull(),
    breachState: text("breach_state").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_strategy_drawdown_checkpoint_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("tsdd_chkpt_org_acct_run_strat_ver_seq_uq").on(
      t.organizationId,
      t.accountKey,
      t.portfolioId,
      t.runId,
      t.strategyId,
      t.strategyVersion,
      t.seq,
    ),
    index("tsdd_chkpt_org_acct_run_strat_ver_asof_ix").on(
      t.organizationId,
      t.accountKey,
      t.portfolioId,
      t.runId,
      t.strategyId,
      t.strategyVersion,
      t.asOf,
    ),
  ],
);

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
