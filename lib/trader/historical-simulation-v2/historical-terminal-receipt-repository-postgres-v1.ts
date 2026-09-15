import "server-only";

import type postgres from "postgres";
import { z } from "zod";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HOLM_FWER_VERSION } from "@/lib/trader/research/benchmark/holm-fwer-v1";
import {
  HISTORICAL_REHEARSAL_STARTED_V1,
  HISTORICAL_SCIENTIFIC_ADMISSION_REFUSAL_V1,
  HISTORICAL_TERMINAL_BASELINE_IDS_V1,
  HISTORICAL_TERMINAL_SURFACES_V1,
  SCIENTIFIC_ADMISSION_REFUSAL_REASON_CODES_V1,
  assertHistoricalTerminalReceiptHasNoSecrets,
  buildHistoricalComparisonIdentitiesV1,
  buildHistoricalCoverageProofV1,
  buildRuntimeReleaseBindingReceiptDigestV1,
  isHistoricalTerminalFixtureIdentityV1,
  type HistoricalRehearsalStartedReceiptV1,
  type HistoricalScientificAdmissionRefusalReceiptV1,
} from "./historical-terminal-receipts-v1";
import { withPostgresSerializableTransactionRetryV2 } from "./postgres-session-transaction-v2";

export type HistoricalTerminalReceiptKindV1 =
  | "SCIENTIFIC_ADMISSION_REFUSED"
  | "HISTORICAL_REHEARSAL_STARTED";

export type HistoricalTerminalReceiptPersistenceResultV1 = Readonly<{
  inserted: boolean;
  kind: HistoricalTerminalReceiptKindV1;
  contentDigestHex: string;
}>;

export type HistoricalTerminalReceiptPersistenceRefusalCodeV1 =
  | "CONFIG"
  | "SCOPE"
  | "RECEIPT_SCHEMA"
  | "RECEIPT_DIGEST"
  | "TERMINAL_KIND_CONFLICT"
  | "CONTENT_CONFLICT";

export class HistoricalTerminalReceiptPersistenceRefusalV1 extends Error {
  readonly code: HistoricalTerminalReceiptPersistenceRefusalCodeV1;

  constructor(code: HistoricalTerminalReceiptPersistenceRefusalCodeV1) {
    super(`HISTORICAL_TERMINAL_PERSISTENCE_REFUSED:${code}`);
    this.name = "HistoricalTerminalReceiptPersistenceRefusalV1";
    this.code = code;
  }
}

const refuse = (code: HistoricalTerminalReceiptPersistenceRefusalCodeV1): never => {
  throw new HistoricalTerminalReceiptPersistenceRefusalV1(code);
};

const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() === value);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const sha40 = z.string().regex(/^[0-9a-f]{40}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const count = z.number().int().nonnegative().safe();

const surfaceSchema = z
  .object({
    surfaceKey: z.enum(["BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60"]),
    symbol: z.enum(["BTCUSDT", "ETHUSDT"]),
    primaryHorizonMinutes: z.union([z.literal(30), z.literal(60)]),
  })
  .strict();

const comparisonIdentitySchema = z
  .object({
    surfaceKey: z.enum(["BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60"]),
    baselineId: z.enum(HISTORICAL_TERMINAL_BASELINE_IDS_V1),
    comparisonIdentityDigestHex: digest,
  })
  .strict();

const statisticSchema = z
  .object({
    comparisonIdentityDigestHex: digest,
    pRaw: finite.min(0).max(1),
    dBar: finite,
    tObs: finite,
    extremeCount: count,
    n: count.min(1),
  })
  .strict();

const holmResultSchema = z
  .object({
    comparisonId: digest,
    pValue: finite.min(0).max(1),
    rank: count.min(1).max(20),
    criticalValue: finite.min(0).max(1),
    rejected: z.boolean(),
  })
  .strict();

const scientificRefusalSchema = z
  .object({
    schemaVersion: z.literal(HISTORICAL_SCIENTIFIC_ADMISSION_REFUSAL_V1),
    releaseSha: sha40,
    runtimeReleaseBindingReceiptDigestHex: digest,
    organizationId: uuid,
    runId: identity,
    surfaces: z.array(surfaceSchema).length(4),
    comparisonIdentities: z.array(comparisonIdentitySchema).length(20),
    coverage: z
      .object({
        resampleOrdinalStartInclusive: z.literal(0),
        resampleOrdinalEndExclusive: z.literal(10_000),
        bootstrapVersion: identity,
        coverageDigestHex: digest,
      })
      .strict(),
    statistics: z.object({ comparisons: z.array(statisticSchema).length(20) }).strict(),
    holmFwer: z
      .object({
        schemaVersion: z.literal(HOLM_FWER_VERSION),
        alpha: finite.min(Number.MIN_VALUE).max(1 - Number.EPSILON),
        familyPass: z.boolean(),
        results: z.array(holmResultSchema).length(20),
      })
      .strict(),
    reasonCode: z.enum(SCIENTIFIC_ADMISSION_REFUSAL_REASON_CODES_V1),
    contentDigestHex: digest,
  })
  .strict();

const observationBindingSchema = z
  .object({
    organizationId: uuid,
    runId: identity,
    lifecycleContentDigestHex: digest,
    accountId: identity,
    ledgerHeadContentDigestHex: digest,
    cycleSequence: count,
    cycleId: identity,
    contentDigestHex: digest,
  })
  .strict();

const rehearsalStartedSchema = z
  .object({
    schemaVersion: z.literal(HISTORICAL_REHEARSAL_STARTED_V1),
    releaseSha: sha40,
    runtimeReleaseBindingReceiptDigestHex: digest,
    organizationId: uuid,
    accountId: identity,
    runId: identity,
    proposalId: uuid,
    proposalContentDigestHex: digest,
    ratificationId: uuid,
    ratificationContentDigestHex: digest,
    fourSurfaceAuthorityId: uuid,
    fourSurfaceAuthorityContentDigestHex: digest,
    consumerClaim: z
      .object({
        claimantId: identity,
        accepted: z.literal(true),
        concurrentClaimantCount: z.literal(0),
        contentDigestHex: digest,
      })
      .strict(),
    lease: z
      .object({
        leaseKey: identity,
        acquired: z.literal(true),
        contentDigestHex: digest,
      })
      .strict(),
    lifecycle: z
      .object({
        phase: z.enum(["RUNNING", "COMPLETED"]),
        contentDigestHex: digest,
      })
      .strict(),
    imageHealthBinding: z
      .object({
        releaseSha: sha40,
        imageReleaseSha: sha40,
        runId: identity,
        status: z.literal("ok"),
        contentDigestHex: digest,
      })
      .strict(),
    adminObservationBinding: observationBindingSchema,
    tenantObservationBinding: observationBindingSchema,
    contentDigestHex: digest,
  })
  .strict();

function hasSemanticDigest(value: Readonly<Record<string, unknown>>): boolean {
  const { contentDigestHex, ...body } = value;
  return (
    typeof contentDigestHex === "string" && computeSemanticSha256Hex(body) === contentDigestHex
  );
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

function validateScientificRefusal(
  value: HistoricalScientificAdmissionRefusalReceiptV1,
): HistoricalScientificAdmissionRefusalReceiptV1 {
  const parsed = scientificRefusalSchema.safeParse(value);
  if (!parsed.success) return refuse("RECEIPT_SCHEMA");
  try {
    assertHistoricalTerminalReceiptHasNoSecrets(parsed.data);
  } catch {
    return refuse("RECEIPT_SCHEMA");
  }
  const expectedSurfaces = JSON.stringify(HISTORICAL_TERMINAL_SURFACES_V1);
  const expectedIdentities = buildHistoricalComparisonIdentitiesV1();
  const expectedIdentityDigests = expectedIdentities.map(
    (item) => item.comparisonIdentityDigestHex,
  );
  const coverage = parsed.data.coverage;
  const { coverageDigestHex, ...coverageBody } = coverage;
  if (
    JSON.stringify(parsed.data.surfaces) !== expectedSurfaces ||
    JSON.stringify(parsed.data.comparisonIdentities) !== JSON.stringify(expectedIdentities) ||
    !exactStringSet(
      parsed.data.statistics.comparisons.map((item) => item.comparisonIdentityDigestHex),
      expectedIdentityDigests,
    ) ||
    !exactStringSet(
      parsed.data.holmFwer.results.map((item) => item.comparisonId),
      expectedIdentityDigests,
    ) ||
    coverage.bootstrapVersion !== buildHistoricalCoverageProofV1().bootstrapVersion
  ) {
    return refuse("RECEIPT_SCHEMA");
  }
  if (
    computeSemanticSha256Hex(coverageBody) !== coverageDigestHex ||
    parsed.data.comparisonIdentities.some((item) => {
      const { comparisonIdentityDigestHex, ...body } = item;
      return computeSemanticSha256Hex(body) !== comparisonIdentityDigestHex;
    }) ||
    parsed.data.runtimeReleaseBindingReceiptDigestHex !==
      buildRuntimeReleaseBindingReceiptDigestV1(parsed.data.releaseSha) ||
    !hasSemanticDigest(parsed.data)
  ) {
    return refuse("RECEIPT_DIGEST");
  }
  return parsed.data as HistoricalScientificAdmissionRefusalReceiptV1;
}

function validateRehearsalStarted(
  value: HistoricalRehearsalStartedReceiptV1,
): HistoricalRehearsalStartedReceiptV1 {
  const parsed = rehearsalStartedSchema.safeParse(value);
  if (!parsed.success) return refuse("RECEIPT_SCHEMA");
  try {
    assertHistoricalTerminalReceiptHasNoSecrets(parsed.data);
  } catch {
    return refuse("RECEIPT_SCHEMA");
  }
  const receipt = parsed.data;
  const nested = [
    receipt.consumerClaim,
    receipt.lease,
    receipt.imageHealthBinding,
    receipt.adminObservationBinding,
    receipt.tenantObservationBinding,
  ];
  if (
    receipt.imageHealthBinding.releaseSha !== receipt.releaseSha ||
    receipt.imageHealthBinding.imageReleaseSha !== receipt.releaseSha ||
    receipt.imageHealthBinding.runId !== receipt.runId ||
    receipt.adminObservationBinding.organizationId !== receipt.organizationId ||
    receipt.adminObservationBinding.runId !== receipt.runId ||
    receipt.adminObservationBinding.accountId !== receipt.accountId ||
    receipt.tenantObservationBinding.organizationId !== receipt.organizationId ||
    receipt.tenantObservationBinding.runId !== receipt.runId ||
    receipt.tenantObservationBinding.accountId !== receipt.accountId ||
    receipt.adminObservationBinding.lifecycleContentDigestHex !==
      receipt.lifecycle.contentDigestHex ||
    receipt.tenantObservationBinding.lifecycleContentDigestHex !==
      receipt.lifecycle.contentDigestHex
  ) {
    return refuse("RECEIPT_SCHEMA");
  }
  if (
    receipt.runtimeReleaseBindingReceiptDigestHex !==
      buildRuntimeReleaseBindingReceiptDigestV1(receipt.releaseSha) ||
    nested.some((item) => !hasSemanticDigest(item)) ||
    !hasSemanticDigest(receipt)
  ) {
    return refuse("RECEIPT_DIGEST");
  }
  return receipt as HistoricalRehearsalStartedReceiptV1;
}

type ExistingReceiptRow = Readonly<{
  content_digest_hex: string;
  receipt_json: unknown;
}>;

function isExactReceipt(
  row: ExistingReceiptRow | undefined,
  receipt: Readonly<Record<string, unknown>>,
): boolean {
  if (!row) return false;
  return (
    row.content_digest_hex === receipt.contentDigestHex &&
    computeSemanticSha256Hex(row.receipt_json) === computeSemanticSha256Hex(receipt)
  );
}

function retryWithFreshSerializableSnapshot(): never {
  throw Object.assign(new Error("HISTORICAL_TERMINAL_PERSISTENCE_SERIALIZATION_RETRY"), {
    code: "40001",
  });
}

export function createPostgresHistoricalTerminalReceiptRepositoryV1(
  input: Readonly<{
    sql: postgres.Sql;
    scope: Readonly<{ organizationId: string; runId: string }>;
  }>,
) {
  const parsedScope = z
    .object({ organizationId: uuid, runId: identity })
    .strict()
    .safeParse(input.scope);
  const scope = parsedScope.success ? Object.freeze(parsedScope.data) : refuse("CONFIG");
  if (typeof input.sql !== "function") refuse("CONFIG");
  if (isHistoricalTerminalFixtureIdentityV1(scope)) refuse("CONFIG");
  const lockKey = `historical-terminal-receipt-v1:${scope.organizationId}:${scope.runId}`;

  const assertScope = (receipt: Readonly<{ organizationId: string; runId: string }>) => {
    if (receipt.organizationId !== scope.organizationId || receipt.runId !== scope.runId) {
      refuse("SCOPE");
    }
  };

  async function loadScientific(sql: postgres.Sql): Promise<readonly ExistingReceiptRow[]> {
    return sql<ExistingReceiptRow[]>`
      SELECT content_digest_hex, receipt_json
      FROM trader_historical_scientific_admission_refusal_v1
      WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
    `;
  }

  async function loadRehearsal(sql: postgres.Sql): Promise<readonly ExistingReceiptRow[]> {
    return sql<ExistingReceiptRow[]>`
      SELECT content_digest_hex, receipt_json
      FROM trader_historical_rehearsal_started_v1
      WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
    `;
  }

  return Object.freeze({
    async persistScientificAdmissionRefusal(
      candidate: HistoricalScientificAdmissionRefusalReceiptV1,
    ): Promise<HistoricalTerminalReceiptPersistenceResultV1> {
      const receipt = validateScientificRefusal(candidate);
      assertScope(receipt);
      return withPostgresSerializableTransactionRetryV2(input.sql, async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
        const [existingScientific, existingRehearsal] = await Promise.all([
          loadScientific(tx),
          loadRehearsal(tx),
        ]);
        if (existingRehearsal.length > 0) return refuse("TERMINAL_KIND_CONFLICT");
        if (existingScientific.length > 0) {
          if (!isExactReceipt(existingScientific[0], receipt)) return refuse("CONTENT_CONFLICT");
          return Object.freeze({
            inserted: false,
            kind: "SCIENTIFIC_ADMISSION_REFUSED" as const,
            contentDigestHex: receipt.contentDigestHex,
          });
        }
        const inserted = await tx<ExistingReceiptRow[]>`
          INSERT INTO trader_historical_scientific_admission_refusal_v1 (
            organization_id, run_id, release_sha, runtime_release_binding_receipt_digest_hex,
            reason_code, coverage_digest_hex, holm_family_pass, receipt_json,
            content_digest_hex, schema_version
          ) VALUES (
            ${receipt.organizationId}::uuid, ${receipt.runId}, ${receipt.releaseSha},
            ${receipt.runtimeReleaseBindingReceiptDigestHex}, ${receipt.reasonCode},
            ${receipt.coverage.coverageDigestHex}, ${receipt.holmFwer.familyPass},
            ${JSON.stringify(receipt)}::text::jsonb, ${receipt.contentDigestHex},
            ${receipt.schemaVersion}
          )
          ON CONFLICT (organization_id, run_id) DO NOTHING
          RETURNING content_digest_hex, receipt_json
        `;
        const durable = inserted[0] ? inserted : await loadScientific(tx);
        if (inserted.length === 0 && !durable[0]) retryWithFreshSerializableSnapshot();
        if (!isExactReceipt(durable[0], receipt)) return refuse("CONTENT_CONFLICT");
        return Object.freeze({
          inserted: inserted.length === 1,
          kind: "SCIENTIFIC_ADMISSION_REFUSED" as const,
          contentDigestHex: receipt.contentDigestHex,
        });
      });
    },

    async persistHistoricalRehearsalStarted(
      candidate: HistoricalRehearsalStartedReceiptV1,
    ): Promise<HistoricalTerminalReceiptPersistenceResultV1> {
      const receipt = validateRehearsalStarted(candidate);
      assertScope(receipt);
      return withPostgresSerializableTransactionRetryV2(input.sql, async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
        const [existingScientific, existingRehearsal] = await Promise.all([
          loadScientific(tx),
          loadRehearsal(tx),
        ]);
        if (existingScientific.length > 0) return refuse("TERMINAL_KIND_CONFLICT");
        if (existingRehearsal.length > 0) {
          if (!isExactReceipt(existingRehearsal[0], receipt)) return refuse("CONTENT_CONFLICT");
          return Object.freeze({
            inserted: false,
            kind: "HISTORICAL_REHEARSAL_STARTED" as const,
            contentDigestHex: receipt.contentDigestHex,
          });
        }
        const inserted = await tx<ExistingReceiptRow[]>`
          INSERT INTO trader_historical_rehearsal_started_v1 (
            organization_id, account_id, run_id, release_sha,
            runtime_release_binding_receipt_digest_hex, proposal_id,
            proposal_content_digest_hex, ratification_id, ratification_content_digest_hex,
            four_surface_authority_id, four_surface_authority_content_digest_hex,
            consumer_claim_digest_hex, lease_digest_hex, lifecycle_content_digest_hex,
            image_health_binding_digest_hex, admin_observation_binding_digest_hex,
            tenant_observation_binding_digest_hex, receipt_json, content_digest_hex,
            schema_version
          ) VALUES (
            ${receipt.organizationId}::uuid, ${receipt.accountId}, ${receipt.runId},
            ${receipt.releaseSha}, ${receipt.runtimeReleaseBindingReceiptDigestHex},
            ${receipt.proposalId}::uuid, ${receipt.proposalContentDigestHex},
            ${receipt.ratificationId}::uuid, ${receipt.ratificationContentDigestHex},
            ${receipt.fourSurfaceAuthorityId}::uuid,
            ${receipt.fourSurfaceAuthorityContentDigestHex},
            ${receipt.consumerClaim.contentDigestHex}, ${receipt.lease.contentDigestHex},
            ${receipt.lifecycle.contentDigestHex}, ${receipt.imageHealthBinding.contentDigestHex},
            ${receipt.adminObservationBinding.contentDigestHex},
            ${receipt.tenantObservationBinding.contentDigestHex},
            ${JSON.stringify(receipt)}::text::jsonb, ${receipt.contentDigestHex},
            ${receipt.schemaVersion}
          )
          ON CONFLICT (organization_id, run_id) DO NOTHING
          RETURNING content_digest_hex, receipt_json
        `;
        const durable = inserted[0] ? inserted : await loadRehearsal(tx);
        if (inserted.length === 0 && !durable[0]) retryWithFreshSerializableSnapshot();
        if (!isExactReceipt(durable[0], receipt)) return refuse("CONTENT_CONFLICT");
        return Object.freeze({
          inserted: inserted.length === 1,
          kind: "HISTORICAL_REHEARSAL_STARTED" as const,
          contentDigestHex: receipt.contentDigestHex,
        });
      });
    },
  });
}

export type PostgresHistoricalTerminalReceiptRepositoryV1 = ReturnType<
  typeof createPostgresHistoricalTerminalReceiptRepositoryV1
>;
