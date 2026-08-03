import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import {
  accountStatusEventTypeEnum,
  auditActorTypeEnum,
  invoiceCorrectionTypeEnum,
  invoiceDisputeEventTypeEnum,
  invoiceDisputeStatusEnum,
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

/** WAIA Core: append-only payment event ledger (AT-E12 S1 / DEE-312). */
export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type", { enum: [...paymentEventTypeEnum] }).notNull(),
    direction: text("direction", { enum: [...paymentDirectionEnum] }).notNull(),
    subjectModule: text("subject_module", { enum: [...paymentSubjectModuleEnum] }).notNull(),
    subjectInvoiceId: text("subject_invoice_id"),
    idempotencyKey: text("idempotency_key"),
    reason: text("reason", { enum: [...paymentFailureReasonEnum] }),
    settlementNetwork: text("settlement_network"),
    settlementAsset: text("settlement_asset"),
    settlementAmount: text("settlement_amount"),
    settlementTxHash: text("settlement_tx_hash"),
    transferIndex: integer("transfer_index"),
    confirmationsRequired: integer("confirmations_required"),
    confirmationsObserved: integer("confirmations_observed"),
    blockHeight: text("block_height"),
    observedAt: integer("observed_at", { mode: "timestamp_ms" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    valuedAmountUsd: text("valued_amount_usd"),
    valuationSource: text("valuation_source"),
    valuationAt: integer("valuation_at", { mode: "timestamp_ms" }),
    evidenceRef: text("evidence_ref"),
    paymentAddressId: text("payment_address_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const payments = sqliteTable(
  "payments",
  {
    paymentId: text("payment_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status", { enum: [...paymentStatusEnum] }).notNull(),
    direction: text("direction", { enum: [...paymentDirectionEnum] }).notNull(),
    subjectModule: text("subject_module", { enum: [...paymentSubjectModuleEnum] }).notNull(),
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
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("payments_org_status_idx").on(t.organizationId, t.status),
    index("payments_subject_idx").on(t.subjectModule, t.subjectInvoiceId),
  ],
);

/** WAIA Core: payment wallet control-domain anchor (AT-E12 S2 / DEE-315). */
export const paymentWallets = sqliteTable(
  "payment_wallets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    walletKind: text("wallet_kind", { enum: [...paymentWalletKindEnum] }).notNull(),
    custodyModel: text("custody_model", { enum: [...paymentWalletCustodyModelEnum] }).notNull(),
    controlModel: text("control_model").notNull(),
    providerRef: text("provider_ref"),
    derivationScheme: text("derivation_scheme"),
    status: text("status").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("payment_wallets_org_status_idx").on(t.organizationId, t.status)],
);

/** WAIA Core: append-only payment address event ledger (AT-E12 S2 / DEE-315). */
export const paymentAddressEvents = sqliteTable(
  "payment_address_events",
  {
    id: text("id").primaryKey(),
    addressId: text("address_id").notNull(),
    walletId: text("wallet_id"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type", { enum: [...paymentAddressEventTypeEnum] }).notNull(),
    network: text("network").notNull(),
    address: text("address"),
    subjectModule: text("subject_module", { enum: [...paymentSubjectModuleEnum] }),
    subjectRef: text("subject_ref"),
    bindingRef: text("binding_ref"),
    reason: text("reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("payment_address_events_address_id_seq_unique").on(t.addressId, t.seq),
    index("payment_address_events_org_address_idx").on(t.organizationId, t.addressId),
  ],
);

/** WAIA Core: rebuildable payment address projection (AT-E12 S2 / DEE-315). */
export const paymentAddresses = sqliteTable(
  "payment_addresses",
  {
    addressId: text("address_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    walletId: text("wallet_id").references(() => paymentWallets.id, { onDelete: "set null" }),
    network: text("network").notNull(),
    address: text("address").notNull(),
    status: text("status", { enum: [...paymentAddressStatusEnum] }).notNull(),
    subjectModule: text("subject_module", { enum: [...paymentSubjectModuleEnum] }),
    subjectRef: text("subject_ref"),
    bindingRef: text("binding_ref"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("payment_addresses_network_address_unique").on(t.network, t.address),
    uniqueIndex("payment_addresses_org_subject_active_unique")
      .on(t.organizationId, t.subjectModule, t.subjectRef)
      .where(sql`"status" = 'ACTIVATED'`),
    index("payment_addresses_org_status_idx").on(t.organizationId, t.status),
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

/** AI-TRADER: point-in-time position snapshots (DEE-350 / AT-E2). */
export const traderPositionSnapshots = sqliteTable(
  "trader_position_snapshots",
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
    positions: text("positions").notNull(),
    positionCount: integer("position_count").notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderTradeHistorySnapshots = sqliteTable(
  "trader_trade_history_snapshots",
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
    symbol: text("symbol").notNull(),
    trades: text("trades").notNull(),
    tradeCount: integer("trade_count").notNull(),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
    maxRiskPerTradePct: text("max_risk_per_trade_pct").notNull().default("0.01"),
    maxPortfolioRiskPct: text("max_portfolio_risk_pct").notNull().default("0.05"),
    maxConcurrentPositions: integer("max_concurrent_positions").notNull().default(3),
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

export const reportingPeriodStatusEnum = ["OPEN", "CLOSED"] as const;
export type ReportingPeriodStatusDb = (typeof reportingPeriodStatusEnum)[number];

export const hwmEntryTypeEnum = ["BOOTSTRAP", "RATCHET_UP", "ROLLBACK"] as const;
export type HwmEntryTypeDb = (typeof hwmEntryTypeEnum)[number];

export const invoiceStatusEnum = ["DRAFT", "ISSUED", "PAID"] as const;
export type InvoiceStatusDb = (typeof invoiceStatusEnum)[number];

export const accountStatusEnum = ["ACTIVE", "SUSPENDED"] as const;
export type AccountStatusDb = (typeof accountStatusEnum)[number];

export { accountStatusEventTypeEnum };
export type AccountStatusEventTypeDb = (typeof accountStatusEventTypeEnum)[number];

export const settlementOutcomeEnum = ["APPLIED", "EXCEPTION"] as const;
export type SettlementOutcomeDb = (typeof settlementOutcomeEnum)[number];

export const settlementReconciliationCaseStatusEnum = [
  "OPEN",
  "ASSIGNED",
  "UNDER_REVIEW",
  "DECISION_PENDING",
  "RESOLVED",
  "CANCELLED",
  "ESCALATED",
] as const;
export type SettlementReconciliationCaseStatusDb =
  (typeof settlementReconciliationCaseStatusEnum)[number];

export const settlementApplicationSourceEnum = ["AUTO", "MANUAL"] as const;
export type SettlementApplicationSourceDb = (typeof settlementApplicationSourceEnum)[number];

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

/**
 * AI-TRADER MI: append-only Trial Registration ledger (DEE-289 / LD-5a.2b).
 *
 * Immutable pre-registration of an evaluation attempt against a hypothesis version.
 * Pin-only (hypothesis_id + hypothesis_definition_digest); nulls/falsification are
 * sealed transitively via the hypothesis digest and resolved at read time (no snapshot).
 * Integrity is derived (constant `valid`); no stored integrity column (doctrine §6).
 * `research_program` is inert free-text (no enum, no grouping index). Records only that
 * an attempt occurred — no outcome/success/failure/budget/score.
 */
export const traderMiTrial = sqliteTable(
  "trader_mi_trial",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: text("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    researchProgram: text("research_program"),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    registeredBy: text("registered_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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

/** AI-TRADER MI: append-only Confidence Judgment ledger (DEE-293 / LD-5a.3a). */
export const traderMiConfidenceJudgment = sqliteTable(
  "trader_mi_confidence_judgment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hypothesisId: text("hypothesis_id").notNull(), // composite FK enforced in migration SQL
    hypothesisKey: text("hypothesis_key").notNull(),
    hypothesisDefinitionDigest: text("hypothesis_definition_digest").notNull(),
    level: text("level"),
    bandLow: text("band_low"),
    bandHigh: text("band_high"),
    confidenceScaleVersion: text("confidence_scale_version"),
    judgmentKind: text("judgment_kind").notNull(),
    reviewHorizonAt: integer("review_horizon_at", { mode: "timestamp_ms" }),
    forCitationsJson: text("for_citations_json").notNull(),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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

export const traderMiTrialIntegrityEvent = sqliteTable(
  "trader_mi_trial_integrity_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    trialId: text("trial_id").notNull(), // composite FK enforced in migration SQL
    eventType: text("event_type").notNull(),
    reasonCode: text("reason_code"),
    rationale: text("rationale").notNull(),
    causeRef: text("cause_ref"),
    schemaVersion: text("schema_version").notNull(),
    eventTime: integer("event_time", { mode: "timestamp_ms" }).notNull(),
    ingestTime: integer("ingest_time", { mode: "timestamp_ms" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    seq: integer("seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
    researchEvidenceJson: text("research_evidence_json"),
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

/** AI-TRADER: billing reporting period valued-input record (DEE-305 / AT-E11 S1). */
export const traderReportingPeriods = sqliteTable(
  "trader_reporting_periods",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    startingEquity: text("starting_equity").notNull(),
    endingEquity: text("ending_equity"),
    openPositionsSnapshotRef: text("open_positions_snapshot_ref").notNull().default(""),
    realizedPnl: text("realized_pnl"),
    unrealizedPnl: text("unrealized_pnl"),
    netDeposits: text("net_deposits").notNull().default("0"),
    netWithdrawals: text("net_withdrawals").notNull().default("0"),
    valuationSource: text("valuation_source").notNull(),
    startingSnapshotAt: integer("starting_snapshot_at", { mode: "timestamp_ms" }).notNull(),
    endingSnapshotAt: integer("ending_snapshot_at", { mode: "timestamp_ms" }),
    schemaVersion: text("schema_version").notNull(),
    status: text("status", { enum: [...reportingPeriodStatusEnum] }).notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderHwmLedger = sqliteTable(
  "trader_hwm_ledger",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    entryType: text("entry_type", { enum: [...hwmEntryTypeEnum] }).notNull(),
    highWaterMark: text("high_water_mark").notNull(),
    previousHighWaterMark: text("previous_high_water_mark"),
    sourcePeriodId: text("source_period_id"),
    sourceInvoiceId: text("source_invoice_id"),
    valuationSource: text("valuation_source").notNull(),
    effectiveAt: integer("effective_at", { mode: "timestamp_ms" }).notNull(),
    reason: text("reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderInvoices = sqliteTable(
  "trader_invoices",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    reportingPeriodId: text("reporting_period_id").notNull(),
    feeArtifactDigest: text("fee_artifact_digest").notNull(),
    status: text("status", { enum: [...invoiceStatusEnum] }).notNull(),
    currency: text("currency").notNull(),
    periodRealizedStrategyProfit: text("period_realized_strategy_profit").notNull(),
    cumulativeRealizedStrategyProfit: text("cumulative_realized_strategy_profit").notNull(),
    previousHighWaterMark: text("previous_high_water_mark").notNull(),
    newProfitAboveHwm: text("new_profit_above_hwm").notNull(),
    feeRate: text("fee_rate").notNull(),
    performanceFee: text("performance_fee").notNull(),
    proposedNewHighWaterMark: text("proposed_new_high_water_mark").notNull(),
    billable: integer("billable", { mode: "boolean" }).notNull(),
    unrealizedPnl: text("unrealized_pnl"),
    realizedFillFinality: integer("realized_fill_finality", { mode: "boolean" }).notNull(),
    startingEquity: text("starting_equity").notNull(),
    endingEquity: text("ending_equity").notNull(),
    netDeposits: text("net_deposits").notNull(),
    netWithdrawals: text("net_withdrawals").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    valuationSource: text("valuation_source").notNull(),
    feeComputedAt: integer("fee_computed_at", { mode: "timestamp_ms" }).notNull(),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    issuanceApprovedAt: integer("issuance_approved_at", { mode: "timestamp_ms" }),
    issuanceApprovedBy: text("issuance_approved_by"),
    coolingOffUntil: integer("cooling_off_until", { mode: "timestamp_ms" }),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }),
    issuedBy: text("issued_by"),
    settledAmount: text("settled_amount").notNull().default("0"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderInvoiceDisputes = sqliteTable(
  "trader_invoice_disputes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    status: text("status", { enum: [...invoiceDisputeStatusEnum] }).notNull(),
    reason: text("reason"),
    openedBy: text("opened_by"),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolutionReason: text("resolution_reason"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("trader_invoice_disputes_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("trader_invoice_disputes_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** AI-TRADER: append-only invoice dispute event ledger (AT-E11 / DEE-215). */
export const traderInvoiceDisputeEvents = sqliteTable(
  "trader_invoice_dispute_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    disputeId: text("dispute_id")
      .notNull()
      .references(() => traderInvoiceDisputes.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type", { enum: [...invoiceDisputeEventTypeEnum] }).notNull(),
    reason: text("reason"),
    actorType: text("actor_type", { enum: [...auditActorTypeEnum] }).notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("trader_invoice_dispute_events_dispute_seq_unique").on(t.disputeId, t.seq)],
);

/** AI-TRADER: append-only invoice correction ledger (AT-E11 / DEE-215). */
export const traderInvoiceCorrections = sqliteTable(
  "trader_invoice_corrections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    disputeId: text("dispute_id").references(() => traderInvoiceDisputes.id, {
      onDelete: "set null",
    }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    reportingPeriodId: text("reporting_period_id").notNull(),
    correctionType: text("correction_type", { enum: [...invoiceCorrectionTypeEnum] }).notNull(),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    restoredHwm: text("restored_hwm").notNull(),
    hwmLedgerEntryId: text("hwm_ledger_entry_id")
      .notNull()
      .references(() => traderHwmLedger.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    actorType: text("actor_type", { enum: [...auditActorTypeEnum] }).notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("trader_invoice_corrections_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("trader_invoice_corrections_dispute_idx").on(t.disputeId),
  ],
);

/** AI-TRADER: settlement exactly-once anchor (one row per CONFIRMED payment; AT-E12 S3-B). */
export const traderSettlements = sqliteTable(
  "trader_settlements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    paymentId: text("payment_id")
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
    outcome: text("outcome", { enum: [...settlementOutcomeEnum] }).notNull(),
    exceptionReason: text("exception_reason"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("trader_settlements_payment_id_unique").on(t.paymentId),
    index("trader_settlements_org_account_idx").on(t.organizationId, t.exchangeAccountId),
    index("trader_settlements_outcome_idx").on(t.outcome),
  ],
);

/** AI-TRADER: settlement allocation to invoice (AT-E12 S3-B). */
export const traderSettlementApplications = sqliteTable(
  "trader_settlement_applications",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => traderSettlements.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => traderInvoices.id, { onDelete: "cascade" }),
    appliedAmount: text("applied_amount").notNull(),
    invoiceStatusAfter: text("invoice_status_after", { enum: [...invoiceStatusEnum] }).notNull(),
    applicationSource: text("application_source", { enum: [...settlementApplicationSourceEnum] })
      .notNull()
      .default("AUTO"),
    reconciliationCaseId: text("reconciliation_case_id"),
    decisionId: text("decision_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("trader_settlement_applications_settlement_id_unique").on(t.settlementId),
    index("trader_settlement_applications_settlement_idx").on(t.settlementId),
    index("trader_settlement_applications_invoice_idx").on(t.invoiceId),
  ],
);

/** AI-TRADER: exchange account status projection (AT-E12 S3-B). */
export const traderAccountStatus = sqliteTable(
  "trader_account_status",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    status: text("status", { enum: [...accountStatusEnum] }).notNull(),
    reason: text("reason"),
    lastEventSeq: integer("last_event_seq").notNull(),
    lastEventDigest: text("last_event_digest").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.exchangeAccountId] })],
);

/** AI-TRADER: append-only account status event ledger (AT-E12 S3-B). */
export const traderAccountStatusEvents = sqliteTable(
  "trader_account_status_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    seq: integer("seq").notNull(),
    eventType: text("event_type", { enum: [...accountStatusEventTypeEnum] }).notNull(),
    reason: text("reason"),
    sourcePaymentId: text("source_payment_id"),
    sourceInvoiceId: text("source_invoice_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderSettlementReconciliationCases = sqliteTable(
  "trader_settlement_reconciliation_cases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => traderSettlements.id, { onDelete: "cascade" }),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.paymentId, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id").notNull(),
    exceptionReason: text("exception_reason"),
    status: text("status", { enum: [...settlementReconciliationCaseStatusEnum] })
      .notNull()
      .default("OPEN"),
    priority: integer("priority").notNull(),
    resolutionType: text("resolution_type"),
    currentDecisionId: text("current_decision_id"),
    assignedTo: text("assigned_to"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp_ms" }),
    coolingOffUntil: integer("cooling_off_until", { mode: "timestamp_ms" }),
    openedAt: integer("opened_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
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
export const traderSettlementReconciliationEvents = sqliteTable(
  "trader_settlement_reconciliation_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => traderSettlementReconciliationCases.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type", { enum: [...auditActorTypeEnum] }).notNull(),
    actorId: text("actor_id"),
    payload: text("payload").notNull(),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("trader_settlement_reconciliation_events_case_seq_unique").on(t.caseId, t.seq),
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
    index("trader_orders_org_mode_venue_state_idx").on(
      t.organizationId,
      t.executionMode,
      t.venue,
      t.state,
    ),
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
    index("trader_fills_org_order_executed_id_idx").on(
      t.organizationId,
      t.orderId,
      t.executedAt,
      t.id,
    ),
  ],
);

export const positionSideEnum = ["LONG", "SHORT"] as const;
export type PositionSideDb = (typeof positionSideEnum)[number];

export const instrumentKindEnum = ["SPOT", "PERP", "FUTURE"] as const;
export type InstrumentKindDb = (typeof instrumentKindEnum)[number];

export const positionLotStateEnum = ["OPEN", "CLOSED"] as const;
export type PositionLotStateDb = (typeof positionLotStateEnum)[number];

export const tradeStateEnum = ["OPEN", "CLOSED", "FORCED_FLAT"] as const;
export type TradeStateDb = (typeof tradeStateEnum)[number];

export const tradeLegKindEnum = ["OPEN_FILL", "CLOSE_FILL", "FORCED_FLAT"] as const;
export type TradeLegKindDb = (typeof tradeLegKindEnum)[number];

export const lifecycleEventPhaseEnum = [
  "SIGNAL_ACCEPTED",
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "TRADE_OPENED",
  "TRADE_CLOSED",
  "FORCED_FLAT",
  "GUARDIAN_EVALUATED",
  "GUARDIAN_EXIT_INTENT",
] as const;
export type LifecycleEventPhaseDb = (typeof lifecycleEventPhaseEnum)[number];

export const lifecycleEntityTypeEnum = [
  "TRADE",
  "POSITION_LOT",
  "ORDER",
  "FILL",
  "STRATEGY_SIGNAL",
] as const;
export type LifecycleEntityTypeDb = (typeof lifecycleEntityTypeEnum)[number];

/** AI-TRADER: round-trip knowledge records (M1 / DEE-376). */
export const traderTrades = sqliteTable(
  "trader_trades",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    venue: text("venue").notNull(),
    accountKey: text("account_key").notNull(),
    positionSide: text("position_side", { enum: [...positionSideEnum] }).notNull(),
    instrumentKind: text("instrument_kind", { enum: [...instrumentKindEnum] }).notNull(),
    strategySignalId: text("strategy_signal_id").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    state: text("state", { enum: [...tradeStateEnum] }).notNull(),
    semanticsVersion: text("semantics_version").notNull(),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    realizedPnl: text("realized_pnl").notNull().default("0"),
    markedPnl: text("marked_pnl").notNull().default("0"),
    hypothesisId: text("hypothesis_id"),
    patternId: text("pattern_id"),
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
    frozenAt: integer("frozen_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("trader_trades_id_organization_unique").on(t.id, t.organizationId),
    index("trader_trades_org_strategy_signal_idx").on(t.organizationId, t.strategySignalId),
    index("trader_trades_org_state_idx").on(t.organizationId, t.state),
  ],
);

/** AI-TRADER: live position lots (M1 / DEE-376). */
export const traderPositionLots = sqliteTable(
  "trader_position_lots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    venue: text("venue").notNull(),
    accountKey: text("account_key").notNull(),
    positionSide: text("position_side", { enum: [...positionSideEnum] }).notNull(),
    instrumentKind: text("instrument_kind", { enum: [...instrumentKindEnum] }).notNull(),
    strategySignalId: text("strategy_signal_id").notNull(),
    state: text("state", { enum: [...positionLotStateEnum] }).notNull(),
    openQty: text("open_qty").notNull(),
    remainingQty: text("remaining_qty").notNull(),
    avgCost: text("avg_cost").notNull(),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    tradeId: text("trade_id").notNull(),
    hedgeGroupId: text("hedge_group_id"),
    targetLotId: text("target_lot_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderTradeLegs = sqliteTable(
  "trader_trade_legs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tradeId: text("trade_id").notNull(),
    positionLotId: text("position_lot_id").notNull(),
    kind: text("kind", { enum: [...tradeLegKindEnum] }).notNull(),
    orderId: text("order_id").notNull(),
    fillId: text("fill_id"),
    syntheticId: text("synthetic_id"),
    quantity: text("quantity").notNull(),
    price: text("price").notNull(),
    fee: text("fee").notNull().default("0"),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull(),
    legPnl: text("leg_pnl").notNull().default("0"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const traderLifecycleEvents = sqliteTable(
  "trader_lifecycle_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: [...lifecycleEntityTypeEnum] }).notNull(),
    entityId: text("entity_id").notNull(),
    phase: text("phase", { enum: [...lifecycleEventPhaseEnum] }).notNull(),
    payload: text("payload"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    researchRunId: text("research_run_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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

/** AI-TRADER: org-level live-enable projection (DEE-212 / BP-7). One row per organization. */
export const traderOrgLiveEnable = sqliteTable("trader_org_live_enable", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  state: text("state", { enum: [...traderOrgLiveEnableStateEnum] })
    .notNull()
    .default("DISABLED"),
  maxNotionalCap: text("max_notional_cap").notNull(),
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }),
  coolingOffEndsAt: integer("cooling_off_ends_at", { mode: "timestamp_ms" }),
  enabledAt: integer("enabled_at", { mode: "timestamp_ms" }),
  disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
  operatorAckPhraseHash: text("operator_ack_phrase_hash"),
  stateVersion: integer("state_version").notNull().default(1),
  lastEventSeq: integer("last_event_seq").notNull().default(0),
  lastEventDigest: text("last_event_digest"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** AI-TRADER: append-only org live-enable event log (DEE-212 / BP-7). */
export const traderOrgLiveEnableEvents = sqliteTable(
  "trader_org_live_enable_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: text("event_type", { enum: [...traderOrgLiveEnableEventTypeEnum] }).notNull(),
    maxNotionalCap: text("max_notional_cap"),
    reason: text("reason"),
    actorType: text("actor_type", { enum: [...auditActorTypeEnum] }).notNull(),
    actorId: text("actor_id"),
    schemaVersion: text("schema_version").notNull(),
    recordContentDigest: text("record_content_digest").notNull(),
    prevEventDigest: text("prev_event_digest"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("trader_org_live_enable_events_org_seq_unique").on(t.organizationId, t.seq)],
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

/** WAIA Core: payment watcher cursor (AT-E12 S3-A / DEE-321). Network-scoped, mutable. */
export const paymentWatcherCheckpoints = sqliteTable("payment_watcher_checkpoints", {
  network: text("network").primaryKey(),
  lastScannedBlock: text("last_scanned_block").notNull(),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp_ms" }).notNull(),
  leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
  cycleCount: integer("cycle_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
