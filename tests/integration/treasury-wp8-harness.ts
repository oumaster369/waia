/**
 * DEE-606 WP-8 dedicated Postgres harness.
 * Refuses 54329 / generic validation / production identities before any mutation.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import { createTreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import { createPostgresTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/postgres-catalog-repository";
import {
  createPostgresTreasuryBreathFactsRepository,
  createTreasuryBreathReadModel,
} from "@/lib/waia-core/treasury/breath";
import {
  createPostgresTreasuryDomainServices,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
  TREASURY_USDT_V1_NETWORK,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  USDT_NOMINAL_USD_POLICY_V1,
  type TreasuryActorContext,
  type TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury";
import {
  createContributionShareEngine,
  createPostgresContributionShareFactsRepository,
} from "@/lib/waia-core/treasury/share";
import { createPostgresTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher";
import type { TreasuryChainObservationRecord } from "@/lib/waia-core/treasury/watcher/types";
import { ORG_A, ORG_B, USER_A, actorA, ctxA, ctxB } from "@/tests/unit/helpers/treasury-wp2";
import { ADDR_A, ADDR_B, ADDR_EXT, ADDR_EXT_2 } from "@/tests/unit/helpers/treasury-wp3";

export {
  ADDR_A,
  ADDR_B,
  ORG_A,
  ORG_B,
  USER_A,
  actorA,
  ctxA,
  ctxB,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  USDT_NOMINAL_USD_POLICY_V1,
};

export const USER_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
export const actorB: TreasuryActorContext = { actorType: "user", actorUserId: USER_B };

export const WP8_COMPOSE_FILE = "docker-compose.postgres-treasury-validate.yml";
export const WP8_COMPOSE_PROJECT = "waia-postgres-treasury-validate";
export const WP8_HOST = "127.0.0.1";
export const WP8_PORT = 54339;
export const WP8_DB = "waia_treasury_validate";
export const WP8_USER = "waia_treasury_validate";
export const WP8_PASSWORD = "waia_treasury_validate_local_only";
export const WP8_DATABASE_URL = `postgresql://${WP8_USER}:${WP8_PASSWORD}@${WP8_HOST}:${WP8_PORT}/${WP8_DB}`;

export const wp8IsolationEnabled = process.env.WAIA_TREASURY_PG_ISOLATION === "1";

const FORBIDDEN_PORTS = new Set([54329, "54329"]);
const FORBIDDEN_DB_NAMES = new Set(["waia_validate", "postgres", "waia"]);
const FORBIDDEN_HOST_FRAGMENTS = [
  "supabase.co",
  "pooler.supabase",
  "supabase.com",
  "neon.tech",
  "rds.amazonaws.com",
];

export class Wp8TopologyError extends Error {
  constructor(detail: string) {
    super(`DEE_606_WP8_R5_TOPOLOGY_IDENTITY_UNSAFE: ${detail}`);
    this.name = "Wp8TopologyError";
  }
}

export function resolveWp8DatabaseUrl(): string {
  const raw = process.env.DATABASE_URL_POSTGRES?.trim() || WP8_DATABASE_URL;
  assertWp8DedicatedTopology(raw);
  return raw;
}

export function assertWp8DedicatedTopology(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString.replace(/^postgresql:\/\//i, "http://"));
  } catch {
    throw new Wp8TopologyError("DATABASE_URL_POSTGRES is not a valid URL");
  }

  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;
  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
  const user = decodeURIComponent(parsed.username);
  const lower = connectionString.toLowerCase();

  if (FORBIDDEN_PORTS.has(port) || FORBIDDEN_PORTS.has(String(port))) {
    throw new Wp8TopologyError(`forbidden port ${port} (54329 is never in WP-8 scope)`);
  }
  if (port !== WP8_PORT) {
    throw new Wp8TopologyError(`expected port ${WP8_PORT}, got ${port}`);
  }
  if (host !== WP8_HOST && host !== "localhost") {
    throw new Wp8TopologyError(`expected host ${WP8_HOST}, got ${host}`);
  }
  if (dbName !== WP8_DB || FORBIDDEN_DB_NAMES.has(dbName)) {
    throw new Wp8TopologyError(`expected database ${WP8_DB}, got ${dbName}`);
  }
  if (user !== WP8_USER) {
    throw new Wp8TopologyError(`expected user ${WP8_USER}, got ${user}`);
  }
  if (FORBIDDEN_HOST_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    throw new Wp8TopologyError("production/Supabase/remote identity is forbidden");
  }
  if (lower.includes("waia-postgres-validate-1") || lower.includes("54329")) {
    throw new Wp8TopologyError("generic validation topology leaked into connection string");
  }
}

export type Wp8PostgresHandle = {
  url: string;
  sql: postgres.Sql;
  db: WaiaPostgresDb;
  close: () => Promise<void>;
};

export function openWp8Postgres(): Wp8PostgresHandle {
  const url = resolveWp8DatabaseUrl();
  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql, { schema: pgSchema }) as WaiaPostgresDb;
  return {
    url,
    sql,
    db,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

export function openWp8Services(db: WaiaPostgresDb) {
  const writeAudit = (input: Parameters<typeof writeAuditLogPostgres>[1]) =>
    writeAuditLogPostgres(db, input);
  const domain = createPostgresTreasuryDomainServices(db);
  const catalogRepo = createPostgresTreasuryCatalogRepository(db);
  const catalog = createTreasuryCatalogService({
    catalog: catalogRepo,
    treasury: domain.repository,
    writeAudit,
  });
  const watcher = createPostgresTreasuryWatcherRepository(db);
  const breathFacts = createPostgresTreasuryBreathFactsRepository(db);
  const breath = createTreasuryBreathReadModel({ facts: breathFacts, writeAudit });
  const shareFacts = createPostgresContributionShareFactsRepository(db);
  const shareEngine = createContributionShareEngine(shareFacts);
  return {
    domain,
    catalog,
    catalogRepo,
    watcher,
    breathFacts,
    breath,
    shareFacts,
    shareEngine,
    writeAudit,
  };
}

export type Wp8Services = ReturnType<typeof openWp8Services>;

export async function seedWp8Identity(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [USER_A]);
  await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [USER_B]);
  await sql.unsafe(
    `INSERT INTO users (id, identity_label, email, password_hash)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, "WP8 User A", "wp8-user-a@treasury.validate"],
  );
  await sql.unsafe(
    `INSERT INTO users (id, identity_label, email, password_hash)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [USER_B, "WP8 User B", "wp8-user-b@treasury.validate"],
  );
}

export async function resetWp8Tenants(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    DO $$
    DECLARE rec record;
    BEGIN
      FOR rec IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'treasury_%'
      LOOP
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', rec.tablename);
      END LOOP;
    END
    $$;
  `);
  await sql.unsafe(
    `INSERT INTO organizations (id, owner_user_id, kind, name)
     VALUES ($1, $2, 'business', 'WP8 ORG_A')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, USER_A],
  );
  await sql.unsafe(
    `INSERT INTO organizations (id, owner_user_id, kind, name)
     VALUES ($1, $2, 'business', 'WP8 ORG_B')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_B, USER_B],
  );
  await sql.unsafe(
    `INSERT INTO treasury_fund_buckets (organization_id, code, title, is_active)
     VALUES ($1, 'UNASSIGNED', 'Unassigned', true), ($2, 'UNASSIGNED', 'Unassigned', true)`,
    [ORG_A, ORG_B],
  );
}

export async function expectPostgresRejects(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("expected Postgres to reject the statement");
}

export function verifiedManualTx(
  input: Partial<TreasuryTransactionRecord> &
    Pick<TreasuryTransactionRecord, "id" | "organizationId" | "direction" | "kind">,
): TreasuryTransactionRecord {
  const amount = input.accountingAmountMicros ?? 1_000_000n;
  const now = input.occurredAt ?? new Date("2026-08-01T00:00:00.000Z");
  const cash =
    input.cashEffectMicros ??
    (input.direction === "OUTFLOW" ? -amount : input.direction === "INTERNAL" ? 0n : amount);
  return {
    status: "VERIFIED",
    detailPublication: "PRIVATE",
    provenance: "MANUAL",
    canonicalNetwork: null,
    canonicalTokenContract: null,
    canonicalTxHash: null,
    canonicalTransferIndex: null,
    fundBucketCode: "UNASSIGNED",
    nativeAmountAtomic: amount,
    nativeDecimals: TREASURY_USDT_V1_DECIMALS,
    nativeAsset: TREASURY_USDT_V1_ASSET,
    nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    accountingAmountMicros: amount,
    accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
    cashEffectMicros: cash,
    counterpartyIsInternal: input.direction === "INTERNAL",
    occurredAt: now,
    purpose: "wp8",
    category: null,
    counterpartyDisplay: null,
    publishCounterparty: false,
    projectModule: null,
    milestoneStage: null,
    budgetId: null,
    fundingNeedId: null,
    description: null,
    internalNotes: null,
    publicDescription: null,
    txHash: null,
    correctsTransactionId: null,
    duplicateOfTransactionId: null,
    detailSupersededById: null,
    ledgerInceptionId: null,
    verifiedAt: now,
    verifiedByUserId: USER_A,
    detailPublishedAt: null,
    detailPublishedByUserId: null,
    latestRevisionId: null,
    recordContentDigest: `wp8-${input.id}`,
    createdByUserId: USER_A,
    createdAt: now,
    updatedAt: now,
    ...input,
    counterpartyId: input.counterpartyId ?? null,
    accountId: input.accountId ?? null,
    categoryId: input.categoryId ?? null,
    projectId: input.projectId ?? null,
  };
}

export async function createVerifiedUsdtDraft(
  services: Wp8Services,
  input: {
    organizationId: string;
    actor: TreasuryActorContext;
    direction: TreasuryTransactionRecord["direction"];
    kind: NonNullable<TreasuryTransactionRecord["kind"]>;
    amountMicros?: bigint;
    budgetId?: string | null;
    internalNotes?: string | null;
    counterpartyDisplay?: string | null;
    occurredAt?: Date;
    correctsTransactionId?: string | null;
  },
): Promise<TreasuryTransactionRecord> {
  const ctx = input.organizationId === ORG_B ? ctxB : ctxA;
  const amount = input.amountMicros ?? 1_000_000n;
  const draft = await services.domain.transactions.createManualDraft(ctx, input.actor, {
    direction: input.direction,
    kind: input.kind,
    nativeAmountAtomic: amount,
    nativeDecimals: TREASURY_USDT_V1_DECIMALS,
    nativeAsset: TREASURY_USDT_V1_ASSET,
    nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    accountingAmountMicros: amount,
    accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
    occurredAt: input.occurredAt ?? new Date("2026-08-01T00:00:00.000Z"),
    purpose: "wp8",
    budgetId: input.budgetId ?? null,
    correctsTransactionId: input.correctsTransactionId ?? null,
    reason: "wp8 draft",
  });
  if (input.internalNotes || input.counterpartyDisplay) {
    await services.domain.repository.updateTransaction(ctx, draft.id, {
      internalNotes: input.internalNotes ?? draft.internalNotes,
      counterpartyDisplay: input.counterpartyDisplay ?? draft.counterpartyDisplay,
    });
  }
  await services.domain.transactions.submitForReview(ctx, input.actor, {
    transactionId: draft.id,
    reason: "wp8 review",
  });
  await services.domain.transactions.classify(ctx, input.actor, {
    transactionId: draft.id,
    reason: "wp8 classify",
    patch: { kind: input.kind, direction: input.direction },
  });
  return services.domain.transactions.getTransaction(ctx, draft.id);
}

export async function registerMetadataEvidence(
  services: Wp8Services,
  organizationId: string,
  actor: TreasuryActorContext,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date("2026-08-01T00:00:00.000Z");
  await services.catalog.registerEvidenceObject(
    actor,
    {
      id,
      organizationId,
      storageBackend: "metadata-only",
      objectKey: `wp8/${organizationId}/${id}`,
      mediaType: "text/plain",
      byteSize: 12n,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "DOCUMENT",
      visibility: "ADMIN_ONLY",
      source: "wp8-fixture",
      uploadedByUserId: actor.actorUserId ?? null,
      observedAt: now,
      createdAt: now,
    },
    "wp8 evidence metadata",
  );
  return id;
}

export async function insertWatchedPair(
  services: Wp8Services,
  organizationId: string,
): Promise<{ watchedA: string; watchedB: string }> {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const watchedA = crypto.randomUUID();
  const watchedB = crypto.randomUUID();
  const addressA = organizationId === ORG_B ? ADDR_EXT : ADDR_A;
  const addressB = organizationId === ORG_B ? ADDR_EXT_2 : ADDR_B;
  await services.watcher.insertWatchedAddress({
    id: watchedA,
    organizationId,
    network: TREASURY_USDT_V1_NETWORK,
    address: addressA,
    tokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    assetCode: TREASURY_USDT_V1_ASSET,
    directionScope: "BOTH",
    includeInBalanceRecon: true,
    label: "A",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await services.watcher.insertWatchedAddress({
    id: watchedB,
    organizationId,
    network: TREASURY_USDT_V1_NETWORK,
    address: addressB,
    tokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    assetCode: TREASURY_USDT_V1_ASSET,
    directionScope: "BOTH",
    includeInBalanceRecon: true,
    label: "B",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { watchedA, watchedB };
}

export async function seedActiveInception(
  services: Wp8Services,
  input?: { inceptionBlock?: string; watcherStartBlock?: string; openingAmount?: bigint },
): Promise<{ inceptionId: string; openingId: string }> {
  const opening = await createVerifiedUsdtDraft(services, {
    organizationId: ORG_A,
    actor: actorA,
    direction: "INFLOW",
    kind: "OPENING_BALANCE",
    amountMicros: input?.openingAmount ?? 1_000_000n,
  });
  const evidenceId = await registerMetadataEvidence(services, ORG_A, actorA);
  await services.catalog.linkEvidence(ctxA, actorA, {
    transactionId: opening.id,
    evidenceObjectId: evidenceId,
    reason: "opening evidence",
  });
  const verified = await services.domain.transactions.verify(ctxA, actorA, {
    transactionId: opening.id,
    reason: "verify opening",
  });
  const inception = await services.domain.inceptions.createActive(ctxA, actorA, {
    network: TREASURY_USDT_V1_NETWORK,
    tokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    assetCode: TREASURY_USDT_V1_ASSET,
    inceptionBlock: input?.inceptionBlock ?? "90",
    inceptionTime: new Date("2026-08-01T00:00:00.000Z"),
    openingBalanceTransactionId: verified.id,
    watcherStartBlock: input?.watcherStartBlock ?? "100",
    evidenceObjectId: evidenceId,
    reason: "wp8 inception",
  });
  return { inceptionId: inception.id, openingId: verified.id };
}

export async function insertChainObservationFixture(
  services: Wp8Services,
  input: {
    id?: string;
    organizationId: string;
    watchedAddressId: string;
    txHash: string;
    transferIndex?: number;
    fromAddress: string;
    toAddress: string;
    direction: "INFLOW" | "OUTFLOW";
    observationStatus: TreasuryChainObservationRecord["observationStatus"];
    confirmationsObserved: number;
    confirmationsRequired?: number;
    blockHeight: string;
    nativeAmountAtomic?: bigint;
  },
): Promise<TreasuryChainObservationRecord> {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const record: TreasuryChainObservationRecord = {
    id: input.id ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    watchedAddressId: input.watchedAddressId,
    network: TREASURY_USDT_V1_NETWORK,
    tokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    assetCode: TREASURY_USDT_V1_ASSET,
    txHash: input.txHash,
    transferIndex: input.transferIndex ?? 0,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    direction: input.direction,
    nativeAmountAtomic: input.nativeAmountAtomic ?? 1_000_000n,
    nativeDecimals: TREASURY_USDT_V1_DECIMALS,
    blockHeight: input.blockHeight,
    blockTimestamp: now,
    observedAt: now,
    confirmationsObserved: input.confirmationsObserved,
    confirmationsRequired: input.confirmationsRequired ?? 20,
    observationStatus: input.observationStatus,
    idempotencyKey: `${input.organizationId}:${input.txHash}:${input.transferIndex ?? 0}:${input.watchedAddressId}`,
    ingestionSource: "treasury-watcher",
    rawEventDigest: `digest-${input.txHash}-${input.watchedAddressId}`,
    relatedPaymentId: null,
    createdAt: now,
  };
  await services.watcher.insertChainObservation(record);
  return record;
}
