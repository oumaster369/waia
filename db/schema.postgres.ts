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
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
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
  treasuryAddressDirectionScopeEnum,
  treasuryAccountKindEnum,
  treasuryAttributionStatusEnum,
  treasuryBalanceReconStatusEnum,
  treasuryBudgetStatusEnum,
  treasuryCommitmentStatusEnum,
  treasuryDetailPublicationEnum,
  treasuryEvidenceKindEnum,
  treasuryEvidenceVisibilityEnum,
  treasuryFundingNeedStatusEnum,
  treasuryIdealBudgetPublicationEnum,
  treasuryIdealBudgetStatusEnum,
  treasuryInceptionStatusEnum,
  treasuryObservationStatusEnum,
  treasuryProvenanceEnum,
  treasuryRunwayPlanStatusEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
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

/** DEE-606 Core Treasury / Transparency enums. */
export const treasuryTxStatusPgEnum = pgEnum("treasury_tx_status", [...treasuryTxStatusEnum]);
export const treasuryDetailPublicationPgEnum = pgEnum("treasury_detail_publication", [
  ...treasuryDetailPublicationEnum,
]);
export const treasuryTxDirectionPgEnum = pgEnum("treasury_tx_direction", [
  ...treasuryTxDirectionEnum,
]);
export const treasuryTxKindPgEnum = pgEnum("treasury_tx_kind", [...treasuryTxKindEnum]);
export const treasuryProvenancePgEnum = pgEnum("treasury_provenance", [...treasuryProvenanceEnum]);
export const treasuryBudgetStatusPgEnum = pgEnum("treasury_budget_status", [
  ...treasuryBudgetStatusEnum,
]);
export const treasuryFundingNeedStatusPgEnum = pgEnum("treasury_funding_need_status", [
  ...treasuryFundingNeedStatusEnum,
]);
export const treasuryCommitmentStatusPgEnum = pgEnum("treasury_commitment_status", [
  ...treasuryCommitmentStatusEnum,
]);
export const treasuryEvidenceKindPgEnum = pgEnum("treasury_evidence_kind", [
  ...treasuryEvidenceKindEnum,
]);
export const treasuryEvidenceVisibilityPgEnum = pgEnum("treasury_evidence_visibility", [
  ...treasuryEvidenceVisibilityEnum,
]);
export const treasuryAttributionStatusPgEnum = pgEnum("treasury_attribution_status", [
  ...treasuryAttributionStatusEnum,
]);
export const treasuryAddressDirectionScopePgEnum = pgEnum("treasury_address_direction_scope", [
  ...treasuryAddressDirectionScopeEnum,
]);
export const treasuryBalanceReconStatusPgEnum = pgEnum("treasury_balance_recon_status", [
  ...treasuryBalanceReconStatusEnum,
]);
export const treasuryInceptionStatusPgEnum = pgEnum("treasury_inception_status", [
  ...treasuryInceptionStatusEnum,
]);
export const treasuryIdealBudgetStatusPgEnum = pgEnum("treasury_ideal_budget_status", [
  ...treasuryIdealBudgetStatusEnum,
]);
export const treasuryIdealBudgetPublicationPgEnum = pgEnum("treasury_ideal_budget_publication", [
  ...treasuryIdealBudgetPublicationEnum,
]);
export const treasuryRunwayPlanStatusPgEnum = pgEnum("treasury_runway_plan_status", [
  ...treasuryRunwayPlanStatusEnum,
]);
export const treasuryObservationStatusPgEnum = pgEnum("treasury_observation_status", [
  ...treasuryObservationStatusEnum,
]);
export const treasuryAccountKindPgEnum = pgEnum("treasury_account_kind", [
  ...treasuryAccountKindEnum,
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
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }),
    ingestTime: timestamp("ingest_time", { withTimezone: true, mode: "date" }).notNull(),
    revisionOf: uuid("revision_of"), // composite self-FK enforced in migration SQL (Drizzle circular-ref limit)
    revisionSeq: integer("revision_seq").notNull(),
    contentDigest: text("content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_mi_source_trust_id_organization_unique").on(t.id, t.organizationId),
    unique("trader_mi_source_trust_id_organization_source_unique").on(
      t.id,
      t.organizationId,
      t.sourceId,
    ),
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

/** DEE-654 Split A: append-only content-addressed Source trust resolution receipt. */
export const traderMiTrustAsOfReceiptV1 = pgTable(
  "trader_mi_trust_as_of_receipt_v1",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    anchorTime: timestamp("anchor_time", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull(),
    unknownReason: text("unknown_reason"),
    selectedTrustRevisionId: uuid("selected_trust_revision_id"),
    selectedRevisionSeq: integer("selected_revision_seq"),
    selectedContentDigest: text("selected_content_digest"),
    selectedTrustScore: text("selected_trust_score"),
    visiblePrefixDigest: text("visible_prefix_digest").notNull(),
    receiptJson: text("receipt_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceId, t.organizationId],
      foreignColumns: [traderMiSource.id, traderMiSource.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.selectedTrustRevisionId, t.organizationId, t.sourceId],
      foreignColumns: [
        traderMiSourceTrust.id,
        traderMiSourceTrust.organizationId,
        traderMiSourceTrust.sourceId,
      ],
    }),
    uniqueIndex("tmtaor_v1_org_source_anchor_digest_uq").on(
      t.organizationId,
      t.sourceId,
      t.anchorTime,
      t.contentDigest,
    ),
    index("tmtaor_v1_org_source_anchor_idx").on(t.organizationId, t.sourceId, t.anchorTime),
    check("tmtaor_v1_id_is_digest_check", sql`${t.id} = ${t.contentDigest}`),
    check("tmtaor_v1_id_hex_check", sql`${t.id} ~ '^[0-9a-f]{64}$'`),
    check(
      "tmtaor_v1_visible_prefix_digest_check",
      sql`${t.visiblePrefixDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tmtaor_v1_selected_content_digest_check",
      sql`${t.selectedContentDigest} IS NULL OR ${t.selectedContentDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tmtaor_v1_status_coherence_check",
      sql`(
        ${t.status} = 'RESOLVED'
        AND ${t.unknownReason} IS NULL
        AND ${t.selectedTrustRevisionId} IS NOT NULL
        AND ${t.selectedRevisionSeq} IS NOT NULL
        AND ${t.selectedContentDigest} IS NOT NULL
        AND ${t.selectedTrustScore} IS NOT NULL
      ) OR (
        ${t.status} = 'UNKNOWN'
        AND ${t.unknownReason} IS NOT NULL
        AND ${t.selectedTrustRevisionId} IS NULL
        AND ${t.selectedRevisionSeq} IS NULL
        AND ${t.selectedContentDigest} IS NULL
        AND ${t.selectedTrustScore} IS NULL
      )`,
    ),
  ],
);

/** DEE-656: append-only private-object reference; raw body bytes never enter Postgres. */
export const traderMiRawStorageBindingV1 = pgTable(
  "trader_mi_raw_storage_binding_v1",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    rawBytesDigest: text("raw_bytes_digest").notNull(),
    storageBackendId: text("storage_backend_id").notNull(),
    objectKey: text("object_key").notNull(),
    objectVersion: text("object_version").notNull(),
    encryptionRequirement: text("encryption_requirement").notNull(),
    accessRequirement: text("access_requirement").notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true, mode: "date" }).notNull(),
    bindingJson: text("binding_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("tmrsb_v1_id_org_source_raw_uq").on(
      t.id,
      t.organizationId,
      t.sourceId,
      t.rawBytesDigest,
    ),
    foreignKey({
      columns: [t.sourceId, t.organizationId],
      foreignColumns: [traderMiSource.id, traderMiSource.organizationId],
    }).onDelete("cascade"),
    index("tmrsb_v1_org_source_raw_idx").on(t.organizationId, t.sourceId, t.rawBytesDigest),
    check("tmrsb_v1_id_is_digest_check", sql`${t.id} = ${t.contentDigest}`),
    check("tmrsb_v1_id_hex_check", sql`${t.id} ~ '^[0-9a-f]{64}$'`),
    check("tmrsb_v1_raw_digest_check", sql`${t.rawBytesDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "tmrsb_v1_security_check",
      sql`${t.encryptionRequirement} = 'PRIVATE_ENCRYPTED' AND ${t.accessRequirement} = 'SERVER_ONLY'`,
    ),
  ],
);

/** DEE-656: append-only raw capture receipt; raw body bytes remain in private object storage. */
export const traderMiRawCaptureReceiptV1 = pgTable(
  "trader_mi_raw_capture_receipt_v1",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    rawBytesDigest: text("raw_bytes_digest").notNull(),
    payloadBytes: bigint("payload_bytes", { mode: "number" }).notNull(),
    maxPayloadBytes: bigint("max_payload_bytes", { mode: "number" }).notNull(),
    retentionSeconds: bigint("retention_seconds", { mode: "number" }).notNull(),
    policyDigest: text("policy_digest").notNull(),
    secretScanReceiptDigest: text("secret_scan_receipt_digest").notNull(),
    storageBindingDigest: text("storage_binding_digest").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "date" }).notNull(),
    authority: text("authority").notNull(),
    receiptJson: text("receipt_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("tmrcr_v1_id_org_source_uq").on(t.id, t.organizationId, t.sourceId),
    uniqueIndex("tmrcr_v1_org_storage_binding_uq").on(t.organizationId, t.storageBindingDigest),
    foreignKey({
      columns: [t.sourceId, t.organizationId],
      foreignColumns: [traderMiSource.id, traderMiSource.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.storageBindingDigest, t.organizationId, t.sourceId, t.rawBytesDigest],
      foreignColumns: [
        traderMiRawStorageBindingV1.id,
        traderMiRawStorageBindingV1.organizationId,
        traderMiRawStorageBindingV1.sourceId,
        traderMiRawStorageBindingV1.rawBytesDigest,
      ],
    }),
    index("tmrcr_v1_org_source_captured_idx").on(t.organizationId, t.sourceId, t.capturedAt),
    check("tmrcr_v1_id_is_digest_check", sql`${t.id} = ${t.contentDigest}`),
    check("tmrcr_v1_id_hex_check", sql`${t.id} ~ '^[0-9a-f]{64}$'`),
    check("tmrcr_v1_raw_digest_check", sql`${t.rawBytesDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "tmrcr_v1_related_digests_check",
      sql`${t.policyDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.secretScanReceiptDigest} ~ '^[0-9a-f]{64}$'
        AND ${t.storageBindingDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tmrcr_v1_payload_bytes_check",
      sql`${t.payloadBytes} >= 0 AND ${t.maxPayloadBytes} > 0
        AND ${t.payloadBytes} <= ${t.maxPayloadBytes} AND ${t.retentionSeconds} > 0`,
    ),
    check(
      "tmrcr_v1_retention_check",
      sql`${t.retentionUntil} = ${t.capturedAt} + (${t.retentionSeconds} * interval '1 second')`,
    ),
    check("tmrcr_v1_authority_check", sql`${t.authority} = 'RECORD_ONLY'`),
  ],
);

/** DEE-656: record-only validation result with database-authored knowledge time. */
export const traderMiRawValidationReceiptV1 = pgTable(
  "trader_mi_raw_validation_receipt_v1",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    captureReceiptDigest: text("capture_receipt_digest").notNull(),
    validatorId: text("validator_id").notNull(),
    validatorVersion: text("validator_version").notNull(),
    status: text("status").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    knownAt: timestamp("known_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`date_trunc('milliseconds', transaction_timestamp())`),
    authority: text("authority").notNull(),
    observationAuthority: text("observation_authority").notNull(),
    measurementAuthority: text("measurement_authority").notNull(),
    receiptJson: text("receipt_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`date_trunc('milliseconds', transaction_timestamp())`),
  },
  (t) => [
    uniqueIndex("tmrvr_v1_org_capture_validator_uq").on(
      t.organizationId,
      t.captureReceiptDigest,
      t.validatorId,
      t.validatorVersion,
    ),
    foreignKey({
      columns: [t.captureReceiptDigest, t.organizationId, t.sourceId],
      foreignColumns: [
        traderMiRawCaptureReceiptV1.id,
        traderMiRawCaptureReceiptV1.organizationId,
        traderMiRawCaptureReceiptV1.sourceId,
      ],
    }),
    index("tmrvr_v1_org_source_known_idx").on(t.organizationId, t.sourceId, t.knownAt),
    check("tmrvr_v1_id_is_digest_check", sql`${t.id} = ${t.contentDigest}`),
    check("tmrvr_v1_id_hex_check", sql`${t.id} ~ '^[0-9a-f]{64}$'`),
    check("tmrvr_v1_capture_digest_check", sql`${t.captureReceiptDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "tmrvr_v1_validator_identity_check",
      sql`length(btrim(${t.validatorId})) > 0 AND length(btrim(${t.validatorVersion})) > 0`,
    ),
    check(
      "tmrvr_v1_status_check",
      sql`jsonb_typeof(${t.reasonCodesJson}::jsonb) = 'array' AND (
        (${t.status} = 'VALID' AND jsonb_array_length(${t.reasonCodesJson}::jsonb) = 0)
        OR (${t.status} = 'REJECTED' AND jsonb_array_length(${t.reasonCodesJson}::jsonb) > 0)
      )`,
    ),
    check(
      "tmrvr_v1_authority_check",
      sql`${t.authority} = 'RECORD_ONLY'
        AND ${t.observationAuthority} = 'NONE'
        AND ${t.measurementAuthority} = 'NONE'`,
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
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }),
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
    riskAllowanceId: uuid("risk_allowance_id"),
    riskAllowanceBindingDigest: text("risk_allowance_binding_digest"),
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
    uniqueIndex("trader_orders_org_risk_allowance_unique")
      .on(t.organizationId, t.riskAllowanceId)
      .where(sql`"risk_allowance_id" IS NOT NULL`),
    check(
      "trader_orders_risk_allowance_binding_complete",
      sql`("risk_allowance_id" IS NULL AND "risk_allowance_binding_digest" IS NULL)
        OR ("risk_allowance_id" IS NOT NULL AND "risk_allowance_binding_digest" IS NOT NULL)`,
    ),
  ],
);

/** DEE-665 / R650-C: mutable per-account Risk accounting and sequencing projection. */
export const traderRiskAccountStateV2 = pgTable(
  "trader_risk_account_state_v2",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    market: text("market").notNull(),
    quoteAsset: text("quote_asset").notNull(),
    posture: text("posture").notNull(),
    killState: text("kill_state").notNull(),
    reconciliationStatus: text("reconciliation_status").notNull(),
    realitySnapshotId: text("reality_snapshot_id").notNull(),
    realityContentDigest: text("reality_content_digest").notNull(),
    reconciliationAuthorityDigest: text("reconciliation_authority_digest").notNull(),
    reconciledInstrumentExposures: jsonb("reconciled_instrument_exposures")
      .$type<readonly Readonly<{
        instrumentIdentityDigestHex: string;
        symbol: string;
        baseQuantity: string;
      }>[]>()
      .notNull(),
    reconciledExposureNotional: numeric("reconciled_exposure_notional", {
      precision: 38,
      scale: 8,
    }).notNull(),
    worstCasePendingExposureNotional: numeric("worst_case_pending_exposure_notional", {
      precision: 38,
      scale: 8,
    }).notNull(),
    outstandingReservationNotional: numeric("outstanding_reservation_notional", {
      precision: 38,
      scale: 8,
    }).notNull(),
    exposureLimitNotional: numeric("exposure_limit_notional", { precision: 38, scale: 8 })
      .notNull(),
    nextAdmissionSequence: bigint("next_admission_sequence", { mode: "bigint" }).notNull(),
    nextEnforcementEventSequence: bigint("next_enforcement_event_sequence", {
      mode: "bigint",
    }).notNull(),
    lastEnforcementEventDigest: text("last_enforcement_event_digest"),
    stateVersion: bigint("state_version", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.accountId] }),
    check("trader_risk_account_state_v2_spot_usdt", sql`"market" = 'SPOT' AND "quote_asset" = 'USDT'`),
    check(
      "trader_risk_account_state_v2_posture",
      sql`"posture" IN ('NORMAL', 'CLOSE_ONLY', 'HALT', 'KILLED')`,
    ),
    check(
      "trader_risk_account_state_v2_kill",
      sql`"kill_state" IN ('CLEAR', 'TRIPPED', 'UNKNOWN')`,
    ),
    check(
      "trader_risk_account_state_v2_reconciliation",
      sql`"reconciliation_status" IN ('RECONCILED', 'DIVERGENT', 'UNAVAILABLE', 'STALE')`,
    ),
    check(
      "trader_risk_account_state_v2_nonnegative",
      sql`"reconciled_exposure_notional" >= 0
        AND "worst_case_pending_exposure_notional" >= 0
        AND "outstanding_reservation_notional" >= 0
        AND "exposure_limit_notional" >= 0
        AND "next_admission_sequence" > 0
        AND "next_enforcement_event_sequence" > 0
        AND "state_version" > 0`,
    ),
    index("trader_risk_account_state_v2_org_posture_idx").on(t.organizationId, t.posture),
  ],
);

/** DEE-665 / R650-C: immutable, digest-sealed Risk V2 verdicts. */
export const traderRiskVerdictsV2 = pgTable(
  "trader_risk_verdicts_v2",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    admissionSequence: bigint("admission_sequence", { mode: "bigint" }).notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    baseAsset: text("base_asset").notNull(),
    quoteAsset: text("quote_asset").notNull(),
    instrumentIdentityDigest: text("instrument_identity_digest").notNull(),
    decisionId: text("decision_id").notNull(),
    decisionSemanticDigest: text("decision_semantic_digest").notNull(),
    decisionContentDigest: text("decision_content_digest").notNull(),
    decisionAction: text("decision_action").notNull(),
    economicSizeSetId: text("economic_size_set_id").notNull(),
    economicSizeSetDigest: text("economic_size_set_digest").notNull(),
    riskPolicyVersion: text("risk_policy_version").notNull(),
    riskPolicyDigest: text("risk_policy_digest").notNull(),
    limitVersions: jsonb("limit_versions").notNull(),
    realitySnapshotId: text("reality_snapshot_id").notNull(),
    realityContentDigest: text("reality_content_digest").notNull(),
    realityAsOf: timestamp("reality_as_of", { withTimezone: true, mode: "date" }).notNull(),
    reconciliationAuthorityDigest: text("reconciliation_authority_digest").notNull(),
    referencePriceAuthorityId: text("reference_price_authority_id").notNull(),
    referencePriceAuthorityVersion: text("reference_price_authority_version").notNull(),
    referencePriceContentDigest: text("reference_price_content_digest").notNull(),
    referencePrice: numeric("reference_price", { precision: 38, scale: 8 }).notNull(),
    verdict: text("verdict").notNull(),
    approvedQualifiedQuantity: numeric("approved_qualified_quantity", {
      precision: 38,
      scale: 8,
    }),
    bindingLayers: jsonb("binding_layers").notNull(),
    reasonCodes: jsonb("reason_codes").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    semanticDigest: text("semantic_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_risk_verdicts_v2_id_org_account_unique").on(
      t.id,
      t.organizationId,
      t.accountId,
    ),
    uniqueIndex("trader_risk_verdicts_v2_org_account_sequence_unique").on(
      t.organizationId,
      t.accountId,
      t.admissionSequence,
    ),
    uniqueIndex("trader_risk_verdicts_v2_org_account_decision_unique").on(
      t.organizationId,
      t.accountId,
      t.decisionContentDigest,
    ),
    uniqueIndex("trader_risk_verdicts_v2_org_content_digest_unique").on(
      t.organizationId,
      t.contentDigest,
    ),
    index("trader_risk_verdicts_v2_org_account_issued_idx").on(
      t.organizationId,
      t.accountId,
      t.issuedAt,
    ),
  ],
);

/** DEE-665 / R650-C: single-use allowance lifecycle projection. */
export const traderRiskAllowancesV2 = pgTable(
  "trader_risk_allowances_v2",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    riskVerdictId: uuid("risk_verdict_id").notNull(),
    riskVerdictContentDigest: text("risk_verdict_content_digest").notNull(),
    admissionSequence: bigint("admission_sequence", { mode: "bigint" }).notNull(),
    nonce: uuid("nonce").notNull(),
    venue: text("venue").notNull(),
    market: text("market").notNull(),
    symbol: text("symbol").notNull(),
    baseAsset: text("base_asset").notNull(),
    quoteAsset: text("quote_asset").notNull(),
    instrumentIdentityDigest: text("instrument_identity_digest").notNull(),
    decisionId: text("decision_id").notNull(),
    decisionSemanticDigest: text("decision_semantic_digest").notNull(),
    decisionContentDigest: text("decision_content_digest").notNull(),
    decisionAction: text("decision_action").notNull(),
    economicSizeSetId: text("economic_size_set_id").notNull(),
    economicSizeSetDigest: text("economic_size_set_digest").notNull(),
    riskPolicyVersion: text("risk_policy_version").notNull(),
    riskPolicyDigest: text("risk_policy_digest").notNull(),
    realitySnapshotId: text("reality_snapshot_id").notNull(),
    realityContentDigest: text("reality_content_digest").notNull(),
    reconciliationAuthorityDigest: text("reconciliation_authority_digest").notNull(),
    postureAtIssuance: text("posture_at_issuance").notNull(),
    strictExposureReduction: boolean("strict_exposure_reduction").notNull(),
    exactQualifiedQuantity: numeric("exact_qualified_quantity", { precision: 38, scale: 8 })
      .notNull(),
    reservedExposureNotional: numeric("reserved_exposure_notional", { precision: 38, scale: 8 })
      .notNull(),
    lifecycleState: text("lifecycle_state").notNull(),
    boundOrderId: uuid("bound_order_id"),
    boundOrderDigest: text("bound_order_digest"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
    terminalReasonCode: text("terminal_reason_code"),
    lastEnforcementEventSequence: bigint("last_enforcement_event_sequence", {
      mode: "bigint",
    }).notNull(),
    lastEnforcementEventDigest: text("last_enforcement_event_digest").notNull(),
    semanticDigest: text("semantic_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_risk_allowances_v2_id_org_account_unique").on(
      t.id,
      t.organizationId,
      t.accountId,
    ),
    unique("trader_risk_allowances_v2_id_org_unique").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.riskVerdictId, t.organizationId, t.accountId],
      foreignColumns: [
        traderRiskVerdictsV2.id,
        traderRiskVerdictsV2.organizationId,
        traderRiskVerdictsV2.accountId,
      ],
      name: "trader_risk_allowances_v2_verdict_scope_fk",
    }),
    foreignKey({
      columns: [t.boundOrderId, t.organizationId],
      foreignColumns: [traderOrders.id, traderOrders.organizationId],
      name: "trader_risk_allowances_v2_bound_order_scope_fk",
    }),
    uniqueIndex("trader_risk_allowances_v2_org_verdict_unique").on(
      t.organizationId,
      t.riskVerdictId,
    ),
    uniqueIndex("trader_risk_allowances_v2_org_account_nonce_unique").on(
      t.organizationId,
      t.accountId,
      t.nonce,
    ),
    index("trader_risk_allowances_v2_org_account_state_expiry_idx").on(
      t.organizationId,
      t.accountId,
      t.lifecycleState,
      t.validUntil,
    ),
    check(
      "trader_risk_allowances_v2_order_binding_complete",
      sql`("bound_order_id" IS NULL AND "bound_order_digest" IS NULL)
        OR ("bound_order_id" IS NOT NULL AND "bound_order_digest" IS NOT NULL)`,
    ),
  ],
);

/** DEE-665 / R650-C: append-only, per-account digest-chained enforcement ledger. */
export const traderRiskEnforcementEventsV2 = pgTable(
  "trader_risk_enforcement_events_v2",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    eventSequence: bigint("event_sequence", { mode: "bigint" }).notNull(),
    riskVerdictId: uuid("risk_verdict_id"),
    riskAllowanceId: uuid("risk_allowance_id"),
    eventType: text("event_type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    reasonCode: text("reason_code"),
    boundOrderId: uuid("bound_order_id"),
    boundOrderDigest: text("bound_order_digest"),
    eventPayload: jsonb("event_payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    previousEventDigest: text("previous_event_digest"),
    contentDigest: text("content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_risk_enforcement_events_v2_org_account_sequence_unique").on(
      t.organizationId,
      t.accountId,
      t.eventSequence,
    ),
    uniqueIndex("trader_risk_enforcement_events_v2_org_digest_unique").on(
      t.organizationId,
      t.contentDigest,
    ),
    foreignKey({
      columns: [t.riskAllowanceId, t.organizationId, t.accountId],
      foreignColumns: [
        traderRiskAllowancesV2.id,
        traderRiskAllowancesV2.organizationId,
        traderRiskAllowancesV2.accountId,
      ],
      name: "trader_risk_enforcement_events_v2_allowance_scope_fk",
    }),
    index("trader_risk_enforcement_events_v2_org_allowance_idx").on(
      t.organizationId,
      t.riskAllowanceId,
      t.eventSequence,
    ),
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
    uniqueIndex("trader_fills_id_organization_unique").on(t.id, t.organizationId),
    index("trader_fills_org_order_idx").on(t.organizationId, t.orderId),
  ],
);

/** HTR-WP17: append-only historical fill economics decomposition. */
export const traderFillExecutionEconomics = pgTable(
  "trader_fill_execution_economics",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fillId: uuid("fill_id").notNull(),
    orderId: uuid("order_id").notNull(),
    exchangeTradeId: text("exchange_trade_id").notNull(),
    fillSequence: integer("fill_sequence").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    quantity: text("quantity").notNull(),
    grossFillPrice: text("gross_fill_price").notNull(),
    grossNotional: text("gross_notional").notNull(),
    feeAmount: text("fee_amount").notNull(),
    feeAsset: text("fee_asset").notNull(),
    spreadCost: text("spread_cost").notNull(),
    impactSlippageCost: text("impact_slippage_cost").notNull(),
    totalExecutionCost: text("total_execution_cost").notNull(),
    netFillPrice: text("net_fill_price").notNull(),
    netCashEffect: text("net_cash_effect").notNull(),
    remainingQuantityAfter: text("remaining_quantity_after").notNull(),
    executionModelId: text("execution_model_id").notNull(),
    executionModelSchemaVersion: text("execution_model_schema_version").notNull(),
    simulatorId: text("simulator_id").notNull(),
    simulatorVersion: text("simulator_version").notNull(),
    sourceBarTimestamp: timestamp("source_bar_timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceBarIndex: integer("source_bar_index").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }).notNull(),
    fillTimestamp: timestamp("fill_timestamp", { withTimezone: true, mode: "date" }).notNull(),
    submitLatencyMs: integer("submit_latency_ms").notNull(),
    cancelLatencyMs: integer("cancel_latency_ms"),
    executionFactKind: text("execution_fact_kind").notNull(),
    economicsContentDigest: text("economics_content_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.fillId, t.organizationId],
      foreignColumns: [traderFills.id, traderFills.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.orderId, t.organizationId],
      foreignColumns: [traderOrders.id, traderOrders.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("trader_fill_execution_economics_org_fill_unique").on(t.organizationId, t.fillId),
    uniqueIndex("trader_fill_execution_economics_org_order_seq_unique").on(
      t.organizationId,
      t.orderId,
      t.fillSequence,
    ),
    index("trader_fill_execution_economics_org_digest_idx").on(
      t.organizationId,
      t.economicsContentDigest,
    ),
    index("trader_fill_execution_economics_org_order_idx").on(t.organizationId, t.orderId),
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

export const traderAccountingFrontier = pgTable(
  "trader_accounting_frontier",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountKey: text("account_key").notNull(),
    runId: text("run_id").notNull(),
    accountingSequence: bigint("accounting_sequence", { mode: "bigint" }).notNull(),
    frontierAsOf: timestamp("frontier_as_of", { withTimezone: true, mode: "date" }).notNull(),
    cash: text("cash").notNull(),
    positionQuantityJson: jsonb("position_quantity_json").notNull(),
    grossPositionBasisJson: jsonb("gross_position_basis_json").notNull(),
    netPositionBasisJson: jsonb("net_position_basis_json").notNull(),
    grossRealizedPnl: text("gross_realized_pnl").notNull(),
    netRealizedPnl: text("net_realized_pnl").notNull(),
    marksJson: jsonb("marks_json").notNull(),
    equity: text("equity").notNull(),
    equityHwm: text("equity_hwm").notNull(),
    accountDrawdownBps: integer("account_drawdown_bps").notNull(),
    sourceFillId: uuid("source_fill_id"),
    sourceEconomicsDigest: text("source_economics_digest").notNull(),
    semanticContentDigest: text("semantic_content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_accounting_frontier_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("taf_org_acct_run_seq_uq").on(
      t.organizationId,
      t.accountKey,
      t.runId,
      t.accountingSequence,
    ),
    uniqueIndex("taf_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
    index("taf_org_acct_run_asof_ix").on(t.organizationId, t.accountKey, t.runId, t.frontierAsOf),
  ],
);

/** DEE-415 / HTR-WP21: forecast outcome record (append-only). */
export const traderForecastOutcomeRecord = pgTable(
  "trader_forecast_outcome_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    forecastRecordId: uuid("forecast_record_id").notNull(),
    decisionRecordId: uuid("decision_record_id"),
    hypothesisRecordId: uuid("hypothesis_record_id"),
    modelVersion: text("model_version").notNull(),
    strategyVersion: text("strategy_version"),
    regime: text("regime").notNull(),
    horizon: text("horizon").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }),
    outcomeClass: text("outcome_class").notNull(),
    outcomeVerdict: text("outcome_verdict"),
    score: text("score"),
    sourceRecordIdsJson: text("source_record_ids_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_forecast_outcome_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("tfor_org_run_cycle_symbol_forecast_uq").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
      t.forecastRecordId,
    ),
    uniqueIndex("tfor_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

export const traderHypothesisOutcomeRecord = pgTable(
  "trader_hypothesis_outcome_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    hypothesisRecordId: uuid("hypothesis_record_id").notNull(),
    decisionRecordId: uuid("decision_record_id"),
    forecastOutcomeIdsJson: text("forecast_outcome_ids_json").notNull(),
    modelVersion: text("model_version").notNull(),
    strategyVersion: text("strategy_version"),
    regime: text("regime").notNull(),
    horizon: text("horizon").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }),
    outcomeClass: text("outcome_class").notNull(),
    score: text("score"),
    sourceRecordIdsJson: text("source_record_ids_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_hypothesis_outcome_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("thor_org_run_cycle_symbol_hypothesis_uq").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
      t.hypothesisRecordId,
    ),
    uniqueIndex("thor_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

export const traderCalibrationObservationRecord = pgTable(
  "trader_calibration_observation_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    forecastRecordId: uuid("forecast_record_id").notNull(),
    forecastOutcomeId: uuid("forecast_outcome_id").notNull(),
    modelVersion: text("model_version").notNull(),
    strategyVersion: text("strategy_version"),
    regime: text("regime").notNull(),
    horizon: text("horizon").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    probability: text("probability"),
    outcomeEncoding: text("outcome_encoding"),
    brierScore: text("brier_score"),
    logLossScore: text("log_loss_score"),
    scoringEligible: boolean("scoring_eligible").notNull(),
    nonScoringReason: text("non_scoring_reason"),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_calibration_observation_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("tcor_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

export const traderCalibrationSnapshotRecord = pgTable(
  "trader_calibration_snapshot_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    forecastModelVersion: text("forecast_model_version").notNull(),
    regime: text("regime").notNull(),
    horizon: text("horizon").notNull(),
    sampleCount: integer("sample_count").notNull(),
    scoringSampleCount: integer("scoring_sample_count").notNull(),
    brierMean: text("brier_mean"),
    logLossMean: text("log_loss_mean"),
    calibrationStatus: text("calibration_status").notNull(),
    calibrationWindow: text("calibration_window").notNull(),
    survivorshipCountsJson: text("survivorship_counts_json").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    score: text("score"),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_calibration_snapshot_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("tcsr_org_run_partition_uq").on(
      t.organizationId,
      t.runId,
      t.forecastModelVersion,
      t.regime,
      t.horizon,
    ),
    uniqueIndex("tcsr_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

export const traderAbstentionOutcomeRecord = pgTable(
  "trader_abstention_outcome_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    decisionRecordId: uuid("decision_record_id").notNull(),
    forecastRecordId: uuid("forecast_record_id"),
    forecastOutcomeId: uuid("forecast_outcome_id"),
    modelVersion: text("model_version"),
    strategyVersion: text("strategy_version"),
    regime: text("regime").notNull(),
    horizon: text("horizon").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    outcomeClass: text("outcome_class").notNull(),
    score: text("score"),
    observedOutcomeJson: text("observed_outcome_json").notNull(),
    counterfactualTradeSimJson: text("counterfactual_trade_sim_json"),
    sourceRecordIdsJson: text("source_record_ids_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_abstention_outcome_record_id_organization_unique").on(t.id, t.organizationId),
    uniqueIndex("taor_org_run_cycle_symbol_decision_uq").on(
      t.organizationId,
      t.runId,
      t.cycleId,
      t.symbol,
      t.decisionRecordId,
    ),
    uniqueIndex("taor_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

export const traderKnowledgeConfidenceUpdateRecord = pgTable(
  "trader_knowledge_confidence_update_record",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    symbol: text("symbol").notNull(),
    knowledgeEdgeId: uuid("knowledge_edge_id").notNull(),
    updateKind: text("update_kind").notNull(),
    updateModelVersion: text("update_model_version").notNull(),
    priorConfidence: text("prior_confidence").notNull(),
    posteriorConfidence: text("posterior_confidence").notNull(),
    delta: text("delta").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    eligibleResolutionAt: timestamp("eligible_resolution_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    pitEvidenceBoundary: timestamp("pit_evidence_boundary", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    outcomeClass: text("outcome_class").notNull(),
    score: text("score"),
    sourceRecordIdsJson: text("source_record_ids_json").notNull(),
    contentDigest: text("content_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    terminalReason: text("terminal_reason").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("trader_knowledge_confidence_update_record_id_organization_unique").on(
      t.id,
      t.organizationId,
    ),
    uniqueIndex("tkcur_org_idempotency_key_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

/**
 * DEE-606 Core Treasury / Transparency persistence (WP-1 schema mirror).
 * SQL authority: 0149_treasury_transparency_ledger_foundation.sql + 0150 RLS + 0151 observation lifecycle guard.
 * Circular FKs (transactions ↔ ledger_inceptions; latest_revision pointer) are enforced in SQL.
 */

export const treasuryFundBuckets = pgTable(
  "treasury_fund_buckets",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "treasury_fund_buckets_pk", columns: [t.organizationId, t.code] })],
);

export const treasuryWatchedAddresses = pgTable(
  "treasury_watched_addresses",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    address: text("address").notNull(),
    tokenContract: text("token_contract").notNull(),
    assetCode: text("asset_code").notNull(),
    directionScope: treasuryAddressDirectionScopePgEnum("direction_scope").notNull(),
    includeInBalanceRecon: boolean("include_in_balance_recon").notNull().default(true),
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_watched_addresses_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_watched_addresses_network_address_contract_unique").on(
      t.network,
      t.address,
      t.tokenContract,
    ),
    index("treasury_watched_addresses_org_active_idx").on(t.organizationId, t.isActive),
  ],
);

/** DEE-661 admin-only counterparty catalog. Public identity remains attribution-consent owned. */
export const treasuryCounterparties = pgTable(
  "treasury_counterparties",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    websiteUrl: text("website_url"),
    email: text("email"),
    phone: text("phone"),
    paymentInstructions: text("payment_instructions"),
    waiaUserId: uuid("waia_user_id").references(() => users.id, { onDelete: "set null" }),
    waiaUsername: text("waia_username"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_counterparties_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_counterparties_org_username_unique").on(t.organizationId, t.waiaUsername),
    uniqueIndex("treasury_counterparties_org_waia_user_unique").on(t.organizationId, t.waiaUserId),
    index("treasury_counterparties_org_active_name_idx").on(
      t.organizationId,
      t.isActive,
      t.displayName,
    ),
    check("treasury_counterparties_display_name_nonempty", sql`length(btrim("display_name")) > 0`),
  ],
);

/** DEE-661 safe display/accounting identities only; custody secrets are forbidden by service validation. */
export const treasuryAccounts = pgTable(
  "treasury_accounts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    kind: treasuryAccountKindPgEnum("kind").notNull(),
    currency: text("currency").notNull(),
    network: text("network"),
    address: text("address"),
    maskedRequisites: text("masked_requisites"),
    watchedAddressId: uuid("watched_address_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_accounts_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_accounts_org_name_unique").on(t.organizationId, t.displayName),
    foreignKey({
      columns: [t.watchedAddressId, t.organizationId],
      foreignColumns: [treasuryWatchedAddresses.id, treasuryWatchedAddresses.organizationId],
      name: "treasury_accounts_watched_address_same_org_fk",
    }).onDelete("restrict"),
    index("treasury_accounts_org_active_name_idx").on(t.organizationId, t.isActive, t.displayName),
    index("treasury_accounts_watched_address_idx").on(t.watchedAddressId),
    check("treasury_accounts_display_name_nonempty", sql`length(btrim("display_name")) > 0`),
    check("treasury_accounts_currency_nonempty", sql`length(btrim("currency")) > 0`),
  ],
);

/** DEE-661 mutable granular budget inputs; annual publication remains snapshot-owned. */
export const treasuryCategories = pgTable(
  "treasury_categories",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    groupName: text("group_name").notNull().default("Other"),
    description: text("description"),
    monthlyBudgetMicros: bigint("monthly_budget_micros", { mode: "bigint" }).notNull().default(0n),
    currency: text("currency").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_categories_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_categories_org_code_unique").on(t.organizationId, t.code),
    uniqueIndex("treasury_categories_org_name_unique").on(t.organizationId, t.name),
    index("treasury_categories_org_active_name_idx").on(t.organizationId, t.isActive, t.name),
    check("treasury_categories_code_nonempty", sql`length(btrim("code")) > 0`),
    check("treasury_categories_name_nonempty", sql`length(btrim("name")) > 0`),
    check("treasury_categories_group_name_nonempty", sql`length(btrim("group_name")) > 0`),
    check("treasury_categories_monthly_budget_nonneg", sql`"monthly_budget_micros" >= 0`),
    check("treasury_categories_currency_nonempty", sql`length(btrim("currency")) > 0`),
  ],
);

/** DEE-671 effective-month category limits; the latest row at/before a month is authoritative. */
export const treasuryCategoryBudgetHistory = pgTable(
  "treasury_category_budget_history",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull(),
    effectiveMonth: date("effective_month").notNull(),
    groupName: text("group_name").notNull(),
    monthlyBudgetMicros: bigint("monthly_budget_micros", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_category_budget_history_id_org_unique_fk_source").on(
      t.id,
      t.organizationId,
    ),
    foreignKey({
      columns: [t.categoryId, t.organizationId],
      foreignColumns: [treasuryCategories.id, treasuryCategories.organizationId],
      name: "treasury_category_budget_history_category_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_category_budget_history_org_category_month_unique").on(
      t.organizationId,
      t.categoryId,
      t.effectiveMonth,
    ),
    index("treasury_category_budget_history_org_month_idx").on(
      t.organizationId,
      t.effectiveMonth,
    ),
    check(
      "treasury_category_budget_history_month_start",
      sql`"effective_month" = date_trunc('month', "effective_month")::date`,
    ),
    check(
      "treasury_category_budget_history_group_name_nonempty",
      sql`length(btrim("group_name")) > 0`,
    ),
    check(
      "treasury_category_budget_history_monthly_nonneg",
      sql`"monthly_budget_micros" >= 0`,
    ),
    check(
      "treasury_category_budget_history_currency_nonempty",
      sql`length(btrim("currency")) > 0`,
    ),
  ],
);

/** DEE-661 organization-scoped project/module catalog. */
export const treasuryProjects = pgTable(
  "treasury_projects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_projects_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_projects_org_name_unique").on(t.organizationId, t.name),
    index("treasury_projects_org_active_name_idx").on(t.organizationId, t.isActive, t.name),
    check("treasury_projects_name_nonempty", sql`length(btrim("name")) > 0`),
    check(
      "treasury_projects_date_order",
      sql`"starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"`,
    ),
  ],
);

export const treasuryWatcherCheckpoints = pgTable(
  "treasury_watcher_checkpoints",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    checkpointKey: text("checkpoint_key").notNull(),
    lastScannedBlock: text("last_scanned_block").notNull(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true, mode: "date" }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: "date" }),
    cycleCount: integer("cycle_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "treasury_watcher_checkpoints_pk",
      columns: [t.organizationId, t.checkpointKey],
    }),
  ],
);

export const treasuryEvidenceObjects = pgTable(
  "treasury_evidence_objects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storageBackend: text("storage_backend").notNull(),
    objectKey: text("object_key").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    sha256: text("sha256").notNull(),
    kind: treasuryEvidenceKindPgEnum("kind").notNull(),
    visibility: treasuryEvidenceVisibilityPgEnum("visibility").notNull().default("ADMIN_ONLY"),
    source: text("source").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("treasury_evidence_objects_id_org_unique_fk_source").on(t.id, t.organizationId)],
);

export const treasuryBudgets = pgTable(
  "treasury_budgets",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    currency: text("currency").notNull(),
    plannedAmountMicros: bigint("planned_amount_micros", { mode: "bigint" }).notNull(),
    status: treasuryBudgetStatusPgEnum("status").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_budgets_id_org_unique_fk_source").on(t.id, t.organizationId),
    uniqueIndex("treasury_budgets_org_code_unique").on(t.organizationId, t.code),
    check("treasury_budgets_planned_positive", sql`"planned_amount_micros" > 0`),
  ],
);

export const treasuryFundingNeeds = pgTable(
  "treasury_funding_needs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    publicExplanation: text("public_explanation"),
    targetStage: text("target_stage"),
    requiredAmountMicros: bigint("required_amount_micros", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    status: treasuryFundingNeedStatusPgEnum("status").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    budgetId: uuid("budget_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_funding_needs_id_org_unique_fk_source").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.budgetId, t.organizationId],
      foreignColumns: [treasuryBudgets.id, treasuryBudgets.organizationId],
      name: "treasury_funding_needs_budget_same_org_fk",
    }).onDelete("set null"),
    check("treasury_funding_needs_required_positive", sql`"required_amount_micros" > 0`),
  ],
);

export const treasuryRunwayPlans = pgTable(
  "treasury_runway_plans",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    method: text("method").notNull().default("APPROVED_PLANNED_BURN"),
    currency: text("currency").notNull(),
    dailyBurnMicros: bigint("daily_burn_micros", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    status: treasuryRunwayPlanStatusPgEnum("status").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_runway_plans_id_org_unique_fk_source").on(t.id, t.organizationId),
    check("treasury_runway_plans_burn_positive", sql`"daily_burn_micros" > 0`),
  ],
);

export const treasuryPublicationSettings = pgTable(
  "treasury_publication_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    breathEnabled: boolean("breath_enabled").notNull().default(false),
    stageLabel: text("stage_label"),
    workSummary: text("work_summary"),
    methodologyNote: text("methodology_note").notNull(),
    recentActivityLimit: integer("recent_activity_limit").notNull().default(5),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("treasury_publication_settings_recent_limit_positive", sql`"recent_activity_limit" > 0`),
  ],
);

export const treasuryIdealAnnualBudgets = pgTable(
  "treasury_ideal_annual_budgets",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    currency: text("currency").notNull(),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    status: treasuryIdealBudgetStatusPgEnum("status").notNull(),
    publicationState: treasuryIdealBudgetPublicationPgEnum("publication_state").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("treasury_ideal_annual_budgets_active_public_unique")
      .on(t.organizationId, t.periodYear)
      .where(sql`"status" = 'ACTIVE' AND "publication_state" = 'PUBLIC'`),
    check("treasury_ideal_annual_budgets_amount_positive", sql`"amount_micros" > 0`),
  ],
);

export const treasuryChainObservations = pgTable(
  "treasury_chain_observations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    watchedAddressId: uuid("watched_address_id").notNull(),
    network: text("network").notNull(),
    tokenContract: text("token_contract").notNull(),
    assetCode: text("asset_code").notNull(),
    txHash: text("tx_hash").notNull(),
    transferIndex: integer("transfer_index").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    direction: treasuryTxDirectionPgEnum("direction").notNull(),
    nativeAmountAtomic: bigint("native_amount_atomic", { mode: "bigint" }).notNull(),
    nativeDecimals: smallint("native_decimals").notNull(),
    blockHeight: text("block_height").notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true, mode: "date" }),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    confirmationsObserved: integer("confirmations_observed").notNull(),
    confirmationsRequired: integer("confirmations_required").notNull(),
    observationStatus: treasuryObservationStatusPgEnum("observation_status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    ingestionSource: text("ingestion_source").notNull(),
    rawEventDigest: text("raw_event_digest").notNull(),
    relatedPaymentId: uuid("related_payment_id").references(() => payments.paymentId, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_chain_observations_id_org_unique_fk_source").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.watchedAddressId, t.organizationId],
      foreignColumns: [treasuryWatchedAddresses.id, treasuryWatchedAddresses.organizationId],
      name: "treasury_chain_observations_watched_address_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_chain_observations_idempotency_unique").on(t.idempotencyKey),
    uniqueIndex("treasury_chain_observations_transfer_address_unique").on(
      t.network,
      t.txHash,
      t.transferIndex,
      t.watchedAddressId,
    ),
    index("treasury_chain_observations_org_observed_idx").on(t.organizationId, t.observedAt),
    check("treasury_chain_observations_direction_scope", sql`"direction" IN ('INFLOW', 'OUTFLOW')`),
    check("treasury_chain_observations_native_nonneg", sql`"native_amount_atomic" >= 0`),
    check("treasury_chain_observations_decimals_nonneg", sql`"native_decimals" >= 0`),
    check(
      "treasury_chain_observations_confirmations_nonneg",
      sql`"confirmations_observed" >= 0 AND "confirmations_required" > 0`,
    ),
  ],
);

export const treasuryTransactions = pgTable(
  "treasury_transactions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: treasuryTxStatusPgEnum("status").notNull(),
    detailPublication: treasuryDetailPublicationPgEnum("detail_publication")
      .notNull()
      .default("PRIVATE"),
    provenance: treasuryProvenancePgEnum("provenance").notNull(),
    canonicalNetwork: text("canonical_network"),
    canonicalTokenContract: text("canonical_token_contract"),
    canonicalTxHash: text("canonical_tx_hash"),
    canonicalTransferIndex: integer("canonical_transfer_index"),
    direction: treasuryTxDirectionPgEnum("direction").notNull(),
    kind: treasuryTxKindPgEnum("kind"),
    fundBucketCode: text("fund_bucket_code").notNull().default("UNASSIGNED"),
    nativeAmountAtomic: bigint("native_amount_atomic", { mode: "bigint" }).notNull(),
    nativeDecimals: smallint("native_decimals").notNull(),
    nativeAsset: text("native_asset").notNull(),
    nativeContract: text("native_contract"),
    accountingAmountMicros: bigint("accounting_amount_micros", { mode: "bigint" }),
    accountingDenominationPolicy: text("accounting_denomination_policy"),
    cashEffectMicros: bigint("cash_effect_micros", { mode: "bigint" }),
    counterpartyIsInternal: boolean("counterparty_is_internal").notNull().default(false),
    counterpartyId: uuid("counterparty_id"),
    accountId: uuid("account_id"),
    categoryId: uuid("category_id"),
    projectId: uuid("project_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    purpose: text("purpose"),
    category: text("category"),
    counterpartyDisplay: text("counterparty_display"),
    publishCounterparty: boolean("publish_counterparty").notNull().default(false),
    projectModule: text("project_module"),
    milestoneStage: text("milestone_stage"),
    budgetId: uuid("budget_id"),
    fundingNeedId: uuid("funding_need_id"),
    description: text("description"),
    internalNotes: text("internal_notes"),
    publicDescription: text("public_description"),
    txHash: text("tx_hash"),
    correctsTransactionId: uuid("corrects_transaction_id"),
    duplicateOfTransactionId: uuid("duplicate_of_transaction_id"),
    detailSupersededById: uuid("detail_superseded_by_id"),
    ledgerInceptionId: uuid("ledger_inception_id"), // composite FK in SQL (circular with treasury_ledger_inceptions)
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    detailPublishedAt: timestamp("detail_published_at", { withTimezone: true, mode: "date" }),
    detailPublishedByUserId: uuid("detail_published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    latestRevisionId: uuid("latest_revision_id"), // pointer; FK not modeled (circular)
    recordContentDigest: text("record_content_digest").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_transactions_id_org_unique_fk_source").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.organizationId, t.fundBucketCode],
      foreignColumns: [treasuryFundBuckets.organizationId, treasuryFundBuckets.code],
      name: "treasury_transactions_fund_bucket_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.budgetId, t.organizationId],
      foreignColumns: [treasuryBudgets.id, treasuryBudgets.organizationId],
      name: "treasury_transactions_budget_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.fundingNeedId, t.organizationId],
      foreignColumns: [treasuryFundingNeeds.id, treasuryFundingNeeds.organizationId],
      name: "treasury_transactions_funding_need_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.counterpartyId, t.organizationId],
      foreignColumns: [treasuryCounterparties.id, treasuryCounterparties.organizationId],
      name: "treasury_transactions_counterparty_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.accountId, t.organizationId],
      foreignColumns: [treasuryAccounts.id, treasuryAccounts.organizationId],
      name: "treasury_transactions_account_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.categoryId, t.organizationId],
      foreignColumns: [treasuryCategories.id, treasuryCategories.organizationId],
      name: "treasury_transactions_category_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [treasuryProjects.id, treasuryProjects.organizationId],
      name: "treasury_transactions_project_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.correctsTransactionId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "treasury_transactions_corrects_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.duplicateOfTransactionId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "treasury_transactions_duplicate_of_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.detailSupersededById, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "treasury_transactions_detail_superseded_same_org_fk",
    }).onDelete("set null"),
    uniqueIndex("treasury_transactions_canonical_transfer_unique")
      .on(
        t.organizationId,
        t.canonicalNetwork,
        t.canonicalTokenContract,
        t.canonicalTxHash,
        t.canonicalTransferIndex,
      )
      .where(sql`"canonical_tx_hash" IS NOT NULL`),
    index("treasury_transactions_org_status_idx").on(t.organizationId, t.status),
    index("treasury_transactions_org_detail_pub_idx").on(t.organizationId, t.detailPublication),
    index("treasury_transactions_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("treasury_transactions_budget_idx").on(t.budgetId),
    index("treasury_transactions_kind_status_idx").on(t.kind, t.status),
    index("treasury_transactions_org_counterparty_idx").on(t.organizationId, t.counterpartyId),
    index("treasury_transactions_org_account_idx").on(t.organizationId, t.accountId),
    index("treasury_transactions_org_category_idx").on(t.organizationId, t.categoryId),
    index("treasury_transactions_org_project_idx").on(t.organizationId, t.projectId),
    check("treasury_transactions_native_nonneg", sql`"native_amount_atomic" >= 0`),
    check("treasury_transactions_decimals_nonneg", sql`"native_decimals" >= 0`),
    check(
      "treasury_transactions_accounting_nonneg",
      sql`"accounting_amount_micros" IS NULL OR "accounting_amount_micros" >= 0`,
    ),
    check(
      "treasury_transactions_kind_direction",
      sql`"kind" IS NULL OR (
			("kind" = 'OPENING_BALANCE' AND "direction" = 'INFLOW') OR
			("kind" = 'CONTRIBUTION' AND "direction" = 'INFLOW') OR
			("kind" = 'EXTERNAL_INFLOW' AND "direction" = 'INFLOW') OR
			("kind" = 'EXPENSE' AND "direction" = 'OUTFLOW') OR
			("kind" = 'EXTERNAL_OUTFLOW' AND "direction" = 'OUTFLOW') OR
			("kind" = 'INTERNAL_TRANSFER' AND "direction" = 'INTERNAL') OR
			("kind" = 'REFUND' AND "direction" IN ('INFLOW', 'OUTFLOW')) OR
			("kind" = 'CORRECTION' AND "direction" IN ('INFLOW', 'OUTFLOW')) OR
			("kind" = 'BALANCE_ADJUSTMENT' AND "direction" IN ('INFLOW', 'OUTFLOW'))
		)`,
    ),
    check(
      "treasury_transactions_cash_effect_consistency",
      sql`"kind" IS NULL OR "cash_effect_micros" IS NULL OR "accounting_amount_micros" IS NULL OR (
			("kind" = 'INTERNAL_TRANSFER' AND "cash_effect_micros" = 0) OR
			("kind" IN ('OPENING_BALANCE', 'CONTRIBUTION', 'EXTERNAL_INFLOW') AND "cash_effect_micros" = "accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
			("kind" IN ('EXPENSE', 'EXTERNAL_OUTFLOW') AND "cash_effect_micros" = -"accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
			("kind" = 'REFUND' AND (
				("direction" = 'INFLOW' AND "cash_effect_micros" = "accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
				("direction" = 'OUTFLOW' AND "cash_effect_micros" = -"accounting_amount_micros" AND "accounting_amount_micros" > 0)
			)) OR
			("kind" IN ('CORRECTION', 'BALANCE_ADJUSTMENT') AND "cash_effect_micros" <> 0 AND (
				("cash_effect_micros" > 0 AND "direction" = 'INFLOW') OR
				("cash_effect_micros" < 0 AND "direction" = 'OUTFLOW')
			))
		)`,
    ),
    check(
      "treasury_transactions_canonical_tuple_complete",
      sql`("canonical_network" IS NULL AND "canonical_token_contract" IS NULL AND "canonical_tx_hash" IS NULL AND "canonical_transfer_index" IS NULL)
		OR
		("canonical_network" IS NOT NULL AND "canonical_token_contract" IS NOT NULL AND "canonical_tx_hash" IS NOT NULL AND "canonical_transfer_index" IS NOT NULL)`,
    ),
  ],
);

export const treasuryLedgerInceptions = pgTable(
  "treasury_ledger_inceptions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    tokenContract: text("token_contract").notNull(),
    assetCode: text("asset_code").notNull(),
    inceptionBlock: text("inception_block").notNull(),
    inceptionBlockHash: text("inception_block_hash"),
    inceptionTime: timestamp("inception_time", { withTimezone: true, mode: "date" }).notNull(),
    openingBalanceTransactionId: uuid("opening_balance_transaction_id").notNull(),
    watcherStartBlock: text("watcher_start_block").notNull(),
    evidenceObjectId: uuid("evidence_object_id"),
    status: treasuryInceptionStatusPgEnum("status").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_ledger_inceptions_id_org_unique_fk_source").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.openingBalanceTransactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_ledger_inceptions_opening_balance_same_org_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.evidenceObjectId, t.organizationId],
      foreignColumns: [treasuryEvidenceObjects.id, treasuryEvidenceObjects.organizationId],
      name: "treasury_ledger_inceptions_evidence_same_org_fk",
    }).onDelete("set null"),
    uniqueIndex("treasury_ledger_inceptions_active_unique")
      .on(t.organizationId, t.network, t.tokenContract)
      .where(sql`"status" = 'ACTIVE'`),
  ],
);

export const treasuryTransactionObservationLinks = pgTable(
  "treasury_transaction_observation_links",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    observationRole: text("observation_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.transactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_tx_obs_links_tx_same_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.observationId, t.organizationId],
      foreignColumns: [treasuryChainObservations.id, treasuryChainObservations.organizationId],
      name: "treasury_tx_obs_links_obs_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_tx_obs_links_tx_obs_unique").on(t.transactionId, t.observationId),
    uniqueIndex("treasury_tx_obs_links_observation_unique").on(t.observationId),
    check(
      "treasury_tx_obs_links_role_check",
      sql`"observation_role" IN ('PRIMARY', 'INTERNAL_COUNTERPARTY', 'SECONDARY')`,
    ),
  ],
);

export const treasuryTransactionRevisions = pgTable(
  "treasury_transaction_revisions",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    patchJson: jsonb("patch_json").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    reason: text("reason"),
    contentDigest: text("content_digest").notNull(),
    prevRevisionDigest: text("prev_revision_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.transactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_transaction_revisions_tx_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_transaction_revisions_tx_seq_unique").on(t.transactionId, t.seq),
  ],
);

export const treasuryEvidenceLinks = pgTable(
  "treasury_evidence_links",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    evidenceObjectId: uuid("evidence_object_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.transactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_evidence_links_tx_same_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.evidenceObjectId, t.organizationId],
      foreignColumns: [treasuryEvidenceObjects.id, treasuryEvidenceObjects.organizationId],
      name: "treasury_evidence_links_evidence_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_evidence_links_tx_evidence_unique").on(
      t.transactionId,
      t.evidenceObjectId,
    ),
  ],
);

export const treasuryContributionAttributions = pgTable(
  "treasury_contribution_attributions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    status: treasuryAttributionStatusPgEnum("status").notNull(),
    contributorUserId: uuid("contributor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    attributionMethod: text("attribution_method").notNull(),
    consentPublicIdentity: boolean("consent_public_identity").notNull().default(false),
    note: text("note"),
    attributedByUserId: uuid("attributed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    attributedAt: timestamp("attributed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.transactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_contribution_attributions_tx_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_contribution_attributions_open_tx_unique")
      .on(t.transactionId)
      .where(sql`"revoked_at" IS NULL`),
  ],
);

export const treasuryCommitments = pgTable(
  "treasury_commitments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    budgetId: uuid("budget_id"),
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    purpose: text("purpose").notNull(),
    counterpartyDisplay: text("counterparty_display"),
    publishCounterparty: boolean("publish_counterparty").notNull().default(false),
    detailPublication: treasuryDetailPublicationPgEnum("detail_publication")
      .notNull()
      .default("PRIVATE"),
    expectedAt: date("expected_at"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    status: treasuryCommitmentStatusPgEnum("status").notNull(),
    evidenceObjectId: uuid("evidence_object_id"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    releasedByUserId: uuid("released_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
    fulfilledByUserId: uuid("fulfilled_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true, mode: "date" }),
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    fulfillsTransactionId: uuid("fulfills_transaction_id"),
    recordContentDigest: text("record_content_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("treasury_commitments_id_org_unique_fk_source").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.budgetId, t.organizationId],
      foreignColumns: [treasuryBudgets.id, treasuryBudgets.organizationId],
      name: "treasury_commitments_budget_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.evidenceObjectId, t.organizationId],
      foreignColumns: [treasuryEvidenceObjects.id, treasuryEvidenceObjects.organizationId],
      name: "treasury_commitments_evidence_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.fulfillsTransactionId, t.organizationId],
      foreignColumns: [treasuryTransactions.id, treasuryTransactions.organizationId],
      name: "treasury_commitments_fulfills_tx_same_org_fk",
    }).onDelete("set null"),
    check("treasury_commitments_amount_positive", sql`"amount_micros" > 0`),
  ],
);

export const treasuryCommitmentRevisions = pgTable(
  "treasury_commitment_revisions",
  {
    id: uuid("id").primaryKey(),
    commitmentId: uuid("commitment_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    patchJson: jsonb("patch_json").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    reason: text("reason"),
    contentDigest: text("content_digest").notNull(),
    prevRevisionDigest: text("prev_revision_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.commitmentId, t.organizationId],
      foreignColumns: [treasuryCommitments.id, treasuryCommitments.organizationId],
      name: "treasury_commitment_revisions_commitment_same_org_fk",
    }).onDelete("cascade"),
    uniqueIndex("treasury_commitment_revisions_commitment_seq_unique").on(t.commitmentId, t.seq),
  ],
);

export const treasuryRunwaySnapshots = pgTable(
  "treasury_runway_snapshots",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runwayPlanId: uuid("runway_plan_id").notNull(),
    runwayAsOf: timestamp("runway_as_of", { withTimezone: true, mode: "date" }).notNull(),
    freeFundsAtAsOfMicros: bigint("free_funds_at_as_of_micros", { mode: "bigint" }).notNull(),
    approvedDailyBurnMicros: bigint("approved_daily_burn_micros", { mode: "bigint" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    inputDigest: text("input_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runwayPlanId, t.organizationId],
      foreignColumns: [treasuryRunwayPlans.id, treasuryRunwayPlans.organizationId],
      name: "treasury_runway_snapshots_plan_same_org_fk",
    }).onDelete("cascade"),
    check("treasury_runway_snapshots_burn_positive", sql`"approved_daily_burn_micros" > 0`),
    check("treasury_runway_snapshots_free_nonneg", sql`"free_funds_at_as_of_micros" >= 0`),
  ],
);

export const treasuryBalanceReconciliations = pgTable(
  "treasury_balance_reconciliations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ledgerInceptionId: uuid("ledger_inception_id"),
    asOfBlock: text("as_of_block").notNull(),
    asOfTime: timestamp("as_of_time", { withTimezone: true, mode: "date" }).notNull(),
    observedOnchainBalanceAtomic: bigint("observed_onchain_balance_atomic", { mode: "bigint" }),
    accountingCashBalanceMicros: bigint("accounting_cash_balance_micros", { mode: "bigint" }),
    deltaMicros: bigint("delta_micros", { mode: "bigint" }),
    explainedPendingMicros: bigint("explained_pending_micros", { mode: "bigint" })
      .notNull()
      .default(0n),
    unexplainedResidualMicros: bigint("unexplained_residual_micros", { mode: "bigint" }),
    status: treasuryBalanceReconStatusPgEnum("status").notNull(),
    toleranceMicros: bigint("tolerance_micros", { mode: "bigint" }).notNull().default(0n),
    evidenceObjectId: uuid("evidence_object_id"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.ledgerInceptionId, t.organizationId],
      foreignColumns: [treasuryLedgerInceptions.id, treasuryLedgerInceptions.organizationId],
      name: "treasury_balance_reconciliations_inception_same_org_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.evidenceObjectId, t.organizationId],
      foreignColumns: [treasuryEvidenceObjects.id, treasuryEvidenceObjects.organizationId],
      name: "treasury_balance_reconciliations_evidence_same_org_fk",
    }).onDelete("set null"),
    index("treasury_balance_reconciliations_org_created_idx").on(t.organizationId, t.createdAt),
    check("treasury_balance_recon_tolerance_nonneg", sql`"tolerance_micros" >= 0`),
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
