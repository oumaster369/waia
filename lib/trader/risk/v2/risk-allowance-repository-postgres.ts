import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  calculateRiskAdmissionV2,
  type RiskAccountAccountingV2,
} from "./risk-admission-service-v2";
import {
  createRiskAllowanceV2FromVerdict,
  validateRiskAllowanceV2,
  type RiskAllowanceV2,
} from "./risk-allowance-v2";
import type { ProtectivePostureV2 } from "./protective-posture-v2";
import { validateRiskReasonsForLayersV2 } from "./risk-reason-codes-v2";
import {
  createRiskVerdictV2,
  validateRiskVerdictV2,
  type RiskVerdictV2,
  type RiskVerdictV2Draft,
} from "./risk-verdict-contract-v2";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type RiskTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type RiskExecutor = Pick<WaiaPostgresDb, "select" | "execute">;
type AccountStateRow = typeof pgSchema.traderRiskAccountStateV2.$inferSelect;
type VerdictRow = typeof pgSchema.traderRiskVerdictsV2.$inferSelect;
type AllowanceRow = typeof pgSchema.traderRiskAllowancesV2.$inferSelect;

export type RiskAccountStateV2 = Readonly<{
  organizationId: string;
  accountId: string;
  posture: ProtectivePostureV2;
  killState: "CLEAR" | "TRIPPED" | "UNKNOWN";
  reconciliationStatus: "RECONCILED" | "DIVERGENT" | "UNAVAILABLE" | "STALE";
  realitySnapshotId: string;
  realityContentDigestHex: string;
  reconciliationAuthorityDigestHex: string;
  accounting: RiskAccountAccountingV2;
  nextAdmissionSequence: string;
  nextEnforcementEventSequence: string;
  lastEnforcementEventDigestHex: string | null;
  stateVersion: string;
}>;

export type InitializeRiskAccountStateV2Input = Omit<
  RiskAccountStateV2,
  | "organizationId"
  | "nextAdmissionSequence"
  | "nextEnforcementEventSequence"
  | "lastEnforcementEventDigestHex"
  | "stateVersion"
>;

export type AdmitRiskAllowanceV2Input = Readonly<{
  accountId: string;
  riskVerdictId: string;
  riskAllowanceId: string;
  issuanceEventId: string;
  nonce: string;
  validForMs: number;
  strictExposureReduction: boolean;
  requestedReservationNotional: string;
  verdict: Omit<
    RiskVerdictV2Draft,
    "riskVerdictId" | "organizationId" | "accountId" | "admissionSequence" | "issuedAtUtc"
  >;
}>;

export type AdmitRiskAllowanceV2Result = Readonly<{
  verdict: RiskVerdictV2;
  allowance: RiskAllowanceV2;
  insertedNew: boolean;
}>;

export type RiskEnforcementEventTypeV2 =
  | "ALLOWANCE_ISSUED"
  | "ALLOWANCE_CONSUMED"
  | "ALLOWANCE_REVOKED"
  | "ALLOWANCE_EXPIRED"
  | "CONSUMPTION_REFUSED";

type EnforcementEventV2 = Readonly<{
  id: string;
  schemaVersion: "risk-enforcement-event/v2";
  organizationId: string;
  accountId: string;
  eventSequence: string;
  riskVerdictId: string | null;
  riskAllowanceId: string | null;
  eventType: RiskEnforcementEventTypeV2;
  fromState: "ISSUED" | "CONSUMED" | "REVOKED" | "EXPIRED" | null;
  toState: "ISSUED" | "CONSUMED" | "REVOKED" | "EXPIRED" | null;
  reasonCode: string | null;
  boundOrderId: string | null;
  boundOrderDigestHex: string | null;
  eventPayload: Readonly<Record<string, unknown>>;
  occurredAtUtc: string;
  previousEventDigestHex: string | null;
  contentDigestHex: string;
}>;

export class RiskV2PersistenceConflictError extends Error {
  constructor(message = "[trader] Risk V2 append-only persistence conflict") {
    super(message);
    this.name = "RiskV2PersistenceConflictError";
  }
}

export class RiskV2AdmissionRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`[trader] Risk V2 allowance admission refused: ${reason}`);
    this.name = "RiskV2AdmissionRefusedError";
  }
}

function canonicalNonnegative(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed < 0n) throw new RiskV2PersistenceConflictError("negative Risk accounting value");
  return formatDecimal(parsed);
}

function mapAccountState(row: AccountStateRow): RiskAccountStateV2 {
  return Object.freeze({
    organizationId: row.organizationId,
    accountId: row.accountId,
    posture: row.posture as ProtectivePostureV2,
    killState: row.killState as RiskAccountStateV2["killState"],
    reconciliationStatus: row.reconciliationStatus as RiskAccountStateV2["reconciliationStatus"],
    realitySnapshotId: row.realitySnapshotId,
    realityContentDigestHex: row.realityContentDigest,
    reconciliationAuthorityDigestHex: row.reconciliationAuthorityDigest,
    accounting: Object.freeze({
      reconciledExposureNotional: formatDecimal(parseDecimal(row.reconciledExposureNotional)),
      worstCasePendingExposureNotional: formatDecimal(
        parseDecimal(row.worstCasePendingExposureNotional),
      ),
      outstandingReservationNotional: formatDecimal(
        parseDecimal(row.outstandingReservationNotional),
      ),
      exposureLimitNotional: formatDecimal(parseDecimal(row.exposureLimitNotional)),
    }),
    nextAdmissionSequence: row.nextAdmissionSequence.toString(),
    nextEnforcementEventSequence: row.nextEnforcementEventSequence.toString(),
    lastEnforcementEventDigestHex: row.lastEnforcementEventDigest,
    stateVersion: row.stateVersion.toString(),
  });
}

function verdictFromRow(row: VerdictRow): RiskVerdictV2 {
  const rebuilt = createRiskVerdictV2({
    riskVerdictId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    venue: row.venue,
    market: row.market as "SPOT",
    symbol: row.symbol,
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset as "USDT",
    instrumentIdentityDigestHex: row.instrumentIdentityDigest,
    decision: {
      decisionId: row.decisionId,
      semanticDigestHex: row.decisionSemanticDigest,
      contentDigestHex: row.decisionContentDigest,
      action: row.decisionAction as RiskVerdictV2["decision"]["action"],
      economicSizeSetId: row.economicSizeSetId,
      economicSizeSetDigestHex: row.economicSizeSetDigest,
    },
    riskPolicyVersion: row.riskPolicyVersion,
    riskPolicyDigestHex: row.riskPolicyDigest,
    limitVersions: row.limitVersions as RiskVerdictV2["limitVersions"],
    reality: {
      snapshotId: row.realitySnapshotId,
      contentDigestHex: row.realityContentDigest,
      asOfUtc: row.realityAsOf.toISOString(),
      reconciliationAuthorityDigestHex: row.reconciliationAuthorityDigest,
      reconciliationStatus: "RECONCILED",
    },
    referencePrice: {
      authorityId: row.referencePriceAuthorityId,
      authorityVersion: row.referencePriceAuthorityVersion,
      contentDigestHex: row.referencePriceContentDigest,
      price: formatDecimal(parseDecimal(row.referencePrice)),
    },
    admissionSequence: row.admissionSequence.toString(),
    verdict: row.verdict as RiskVerdictV2["verdict"],
    approvedQualifiedQuantity:
      row.approvedQualifiedQuantity === null
        ? null
        : formatDecimal(parseDecimal(row.approvedQualifiedQuantity)),
    bindingLayers: row.bindingLayers as RiskVerdictV2["bindingLayers"],
    reasonCodes: row.reasonCodes as RiskVerdictV2["reasonCodes"],
    issuedAtUtc: row.issuedAt.toISOString(),
  });
  if (
    rebuilt.semanticDigestHex !== row.semanticDigest ||
    rebuilt.contentDigestHex !== row.contentDigest ||
    row.schemaVersion !== rebuilt.schemaVersion ||
    !validateRiskVerdictV2(rebuilt)
  ) {
    throw new RiskV2PersistenceConflictError("stored Risk verdict seal mismatch");
  }
  return rebuilt;
}

function allowanceFromIssuedRow(row: AllowanceRow, verdict: RiskVerdictV2): RiskAllowanceV2 {
  if (row.lifecycleState !== "ISSUED") {
    throw new RiskV2PersistenceConflictError("idempotent admission found terminal allowance");
  }
  const rebuilt = createRiskAllowanceV2FromVerdict({
    riskAllowanceId: row.id,
    verdict,
    postureAtIssuance: row.postureAtIssuance as ProtectivePostureV2,
    strictExposureReduction: row.strictExposureReduction,
    reservedExposureNotional: formatDecimal(parseDecimal(row.reservedExposureNotional)),
    nonce: row.nonce,
    validUntilUtc: row.validUntil.toISOString(),
  });
  if (
    rebuilt.semanticDigestHex !== row.semanticDigest ||
    rebuilt.contentDigestHex !== row.contentDigest ||
    row.schemaVersion !== rebuilt.schemaVersion ||
    !validateRiskAllowanceV2(rebuilt)
  ) {
    throw new RiskV2PersistenceConflictError("stored Risk allowance seal mismatch");
  }
  return rebuilt;
}

function buildEnforcementEventV2(
  input: Omit<EnforcementEventV2, "schemaVersion" | "contentDigestHex">,
): EnforcementEventV2 {
  const payload = { ...input, schemaVersion: "risk-enforcement-event/v2" as const };
  return Object.freeze({ ...payload, contentDigestHex: computeStableJsonDigest(payload) });
}

async function durableTransactionTime(ex: Pick<RiskTx, "execute">): Promise<Date> {
  const rows = await ex.execute<{ durable_at: Date | string }>(
    sql`select date_trunc('milliseconds', transaction_timestamp()) as durable_at`,
  );
  const durable = new Date(rows[0]!.durable_at);
  if (!Number.isFinite(durable.getTime())) throw new RiskV2PersistenceConflictError();
  return durable;
}

async function lockAccountState(
  ex: Pick<RiskTx, "select">,
  organizationId: string,
  accountId: string,
): Promise<RiskAccountStateV2> {
  const rows = await ex.select().from(pgSchema.traderRiskAccountStateV2).where(and(
    eq(pgSchema.traderRiskAccountStateV2.organizationId, organizationId),
    eq(pgSchema.traderRiskAccountStateV2.accountId, accountId),
  )).for("update");
  if (!rows[0]) throw new RiskV2AdmissionRefusedError("RISK_ACCOUNT_STATE_MISSING");
  return mapAccountState(rows[0]);
}

async function appendEventAndAdvanceAccount(input: {
  tx: RiskTx;
  state: RiskAccountStateV2;
  event: EnforcementEventV2;
  nextAdmissionSequence: string;
  outstandingReservationNotional: string;
  worstCasePendingExposureNotional?: string;
}): Promise<void> {
  const { tx, state, event } = input;
  await tx.insert(pgSchema.traderRiskEnforcementEventsV2).values({
    id: event.id,
    organizationId: event.organizationId,
    accountId: event.accountId,
    eventSequence: BigInt(event.eventSequence),
    riskVerdictId: event.riskVerdictId,
    riskAllowanceId: event.riskAllowanceId,
    eventType: event.eventType,
    fromState: event.fromState,
    toState: event.toState,
    reasonCode: event.reasonCode,
    boundOrderId: event.boundOrderId,
    boundOrderDigest: event.boundOrderDigestHex,
    eventPayload: event.eventPayload,
    occurredAt: new Date(event.occurredAtUtc),
    previousEventDigest: event.previousEventDigestHex,
    contentDigest: event.contentDigestHex,
    schemaVersion: event.schemaVersion,
  });
  await tx.update(pgSchema.traderRiskAccountStateV2).set({
    nextAdmissionSequence: BigInt(input.nextAdmissionSequence),
    nextEnforcementEventSequence: BigInt(event.eventSequence) + 1n,
    lastEnforcementEventDigest: event.contentDigestHex,
    outstandingReservationNotional: canonicalNonnegative(input.outstandingReservationNotional),
    worstCasePendingExposureNotional: canonicalNonnegative(
      input.worstCasePendingExposureNotional ?? state.accounting.worstCasePendingExposureNotional,
    ),
    stateVersion: BigInt(state.stateVersion) + 1n,
    updatedAt: new Date(event.occurredAtUtc),
  }).where(and(
    eq(pgSchema.traderRiskAccountStateV2.organizationId, state.organizationId),
    eq(pgSchema.traderRiskAccountStateV2.accountId, state.accountId),
    eq(pgSchema.traderRiskAccountStateV2.stateVersion, BigInt(state.stateVersion)),
  ));
}

export async function initializeRiskAccountStateV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InitializeRiskAccountStateV2Input,
): Promise<RiskAccountStateV2> {
  const scoped = requireOrgContext(context.organizationId);
  const values = {
    organizationId: scoped.organizationId,
    accountId: input.accountId,
    market: "SPOT",
    quoteAsset: "USDT",
    posture: input.posture,
    killState: input.killState,
    reconciliationStatus: input.reconciliationStatus,
    realitySnapshotId: input.realitySnapshotId,
    realityContentDigest: input.realityContentDigestHex,
    reconciliationAuthorityDigest: input.reconciliationAuthorityDigestHex,
    reconciledExposureNotional: canonicalNonnegative(input.accounting.reconciledExposureNotional),
    worstCasePendingExposureNotional: canonicalNonnegative(
      input.accounting.worstCasePendingExposureNotional,
    ),
    outstandingReservationNotional: canonicalNonnegative(
      input.accounting.outstandingReservationNotional,
    ),
    exposureLimitNotional: canonicalNonnegative(input.accounting.exposureLimitNotional),
    nextAdmissionSequence: 1n,
    nextEnforcementEventSequence: 1n,
    lastEnforcementEventDigest: null,
    stateVersion: 1n,
  };
  await db.insert(pgSchema.traderRiskAccountStateV2).values(values).onConflictDoNothing();
  const rows = await db.select().from(pgSchema.traderRiskAccountStateV2).where(and(
    eq(pgSchema.traderRiskAccountStateV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRiskAccountStateV2.accountId, input.accountId),
  )).limit(1);
  if (!rows[0]) throw new RiskV2PersistenceConflictError();
  const stored = mapAccountState(rows[0]);
  const expected = mapAccountState({
    ...rows[0],
    ...values,
    updatedAt: rows[0].updatedAt,
  });
  if (JSON.stringify(stored) !== JSON.stringify(expected)) {
    throw new RiskV2PersistenceConflictError("Risk account state initialization conflict");
  }
  return stored;
}

export async function readRiskAccountStateV2Postgres(
  ex: RiskExecutor,
  context: OrgContext,
  accountId: string,
): Promise<RiskAccountStateV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderRiskAccountStateV2).where(and(
    eq(pgSchema.traderRiskAccountStateV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderRiskAccountStateV2.accountId, accountId),
  )).limit(1);
  return rows[0] ? mapAccountState(rows[0]) : null;
}

export async function admitRiskAllowanceV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: AdmitRiskAllowanceV2Input,
): Promise<AdmitRiskAllowanceV2Result> {
  const scoped = requireOrgContext(context.organizationId);
  if (!Number.isInteger(input.validForMs) || input.validForMs < 1 || input.validForMs > 300_000) {
    throw new RiskV2AdmissionRefusedError("ALLOWANCE_VALIDITY_INVALID");
  }
  return runWaiaPostgresTransaction(db, async (tx) => {
    const state = await lockAccountState(tx, scoped.organizationId, input.accountId);
    const existingVerdicts = await tx.select().from(pgSchema.traderRiskVerdictsV2).where(and(
      eq(pgSchema.traderRiskVerdictsV2.organizationId, scoped.organizationId),
      eq(pgSchema.traderRiskVerdictsV2.accountId, input.accountId),
      eq(pgSchema.traderRiskVerdictsV2.decisionContentDigest, input.verdict.decision.contentDigestHex),
    )).limit(1);
    if (existingVerdicts[0]) {
      const verdict = verdictFromRow(existingVerdicts[0]);
      const rows = await tx.select().from(pgSchema.traderRiskAllowancesV2).where(and(
        eq(pgSchema.traderRiskAllowancesV2.organizationId, scoped.organizationId),
        eq(pgSchema.traderRiskAllowancesV2.riskVerdictId, verdict.riskVerdictId),
      )).limit(1);
      if (!rows[0]) throw new RiskV2PersistenceConflictError();
      const allowance = allowanceFromIssuedRow(rows[0], verdict);
      if (
        verdict.riskVerdictId !== input.riskVerdictId ||
        allowance.riskAllowanceId !== input.riskAllowanceId ||
        allowance.nonce !== input.nonce ||
        allowance.reservedExposureNotional !== canonicalNonnegative(input.requestedReservationNotional)
      ) {
        throw new RiskV2PersistenceConflictError("Risk admission idempotency key conflict");
      }
      return { verdict, allowance, insertedNew: false };
    }

    if (
      state.killState !== "CLEAR" ||
      state.realitySnapshotId !== input.verdict.reality.snapshotId ||
      state.realityContentDigestHex !== input.verdict.reality.contentDigestHex ||
      state.reconciliationAuthorityDigestHex !==
        input.verdict.reality.reconciliationAuthorityDigestHex
    ) {
      throw new RiskV2AdmissionRefusedError("CURRENT_AUTHORITY_BINDING_MISMATCH");
    }
    const calculation = calculateRiskAdmissionV2({
      accounting: state.accounting,
      requestedReservationNotional: input.requestedReservationNotional,
      posture: state.posture,
      strictExposureReduction: input.strictExposureReduction,
      reconciliationStatus: state.reconciliationStatus,
    });
    if (calculation.status === "REFUSED") throw new RiskV2AdmissionRefusedError(calculation.reason);
    if (input.verdict.approvedQualifiedQuantity === null) {
      throw new RiskV2AdmissionRefusedError("VERDICT_DOES_NOT_PERMIT_ALLOWANCE");
    }
    if (!validateRiskReasonsForLayersV2(input.verdict)) {
      throw new RiskV2AdmissionRefusedError("RISK_REASON_LAYER_BINDING_INVALID");
    }
    const durableAt = await durableTransactionTime(tx);
    const verdict = createRiskVerdictV2({
      ...input.verdict,
      riskVerdictId: input.riskVerdictId,
      organizationId: scoped.organizationId,
      accountId: input.accountId,
      admissionSequence: state.nextAdmissionSequence,
      issuedAtUtc: durableAt.toISOString(),
    });
    const allowance = createRiskAllowanceV2FromVerdict({
      riskAllowanceId: input.riskAllowanceId,
      verdict,
      postureAtIssuance: state.posture,
      strictExposureReduction: input.strictExposureReduction,
      reservedExposureNotional: calculation.reservationNotional,
      nonce: input.nonce,
      validUntilUtc: new Date(durableAt.getTime() + input.validForMs).toISOString(),
    });
    const event = buildEnforcementEventV2({
      id: input.issuanceEventId,
      organizationId: scoped.organizationId,
      accountId: input.accountId,
      eventSequence: state.nextEnforcementEventSequence,
      riskVerdictId: verdict.riskVerdictId,
      riskAllowanceId: allowance.riskAllowanceId,
      eventType: "ALLOWANCE_ISSUED",
      fromState: null,
      toState: "ISSUED",
      reasonCode: null,
      boundOrderId: null,
      boundOrderDigestHex: null,
      eventPayload: {
        admissionSequence: verdict.admissionSequence,
        allowanceContentDigestHex: allowance.contentDigestHex,
        exactQualifiedQuantity: allowance.exactQualifiedQuantity,
        reservedExposureNotional: allowance.reservedExposureNotional,
      },
      occurredAtUtc: durableAt.toISOString(),
      previousEventDigestHex: state.lastEnforcementEventDigestHex,
    });

    await tx.insert(pgSchema.traderRiskVerdictsV2).values({
      id: verdict.riskVerdictId,
      organizationId: verdict.organizationId,
      accountId: verdict.accountId,
      admissionSequence: BigInt(verdict.admissionSequence),
      venue: verdict.venue,
      market: verdict.market,
      symbol: verdict.symbol,
      baseAsset: verdict.baseAsset,
      quoteAsset: verdict.quoteAsset,
      instrumentIdentityDigest: verdict.instrumentIdentityDigestHex,
      decisionId: verdict.decision.decisionId,
      decisionSemanticDigest: verdict.decision.semanticDigestHex,
      decisionContentDigest: verdict.decision.contentDigestHex,
      decisionAction: verdict.decision.action,
      economicSizeSetId: verdict.decision.economicSizeSetId,
      economicSizeSetDigest: verdict.decision.economicSizeSetDigestHex,
      riskPolicyVersion: verdict.riskPolicyVersion,
      riskPolicyDigest: verdict.riskPolicyDigestHex,
      limitVersions: [...verdict.limitVersions],
      realitySnapshotId: verdict.reality.snapshotId,
      realityContentDigest: verdict.reality.contentDigestHex,
      realityAsOf: new Date(verdict.reality.asOfUtc),
      reconciliationAuthorityDigest: verdict.reality.reconciliationAuthorityDigestHex,
      referencePriceAuthorityId: verdict.referencePrice.authorityId,
      referencePriceAuthorityVersion: verdict.referencePrice.authorityVersion,
      referencePriceContentDigest: verdict.referencePrice.contentDigestHex,
      referencePrice: verdict.referencePrice.price,
      verdict: verdict.verdict,
      approvedQualifiedQuantity: verdict.approvedQualifiedQuantity,
      bindingLayers: [...verdict.bindingLayers],
      reasonCodes: [...verdict.reasonCodes],
      issuedAt: durableAt,
      semanticDigest: verdict.semanticDigestHex,
      contentDigest: verdict.contentDigestHex,
      schemaVersion: verdict.schemaVersion,
      createdAt: durableAt,
    });
    await tx.insert(pgSchema.traderRiskAllowancesV2).values({
      id: allowance.riskAllowanceId,
      organizationId: allowance.organizationId,
      accountId: allowance.accountId,
    riskVerdictId: allowance.riskVerdictId,
      riskVerdictContentDigest: allowance.riskVerdictContentDigestHex,
      admissionSequence: BigInt(allowance.admissionSequence),
      nonce: allowance.nonce,
      venue: allowance.venue,
      market: allowance.market,
      symbol: allowance.symbol,
      baseAsset: allowance.baseAsset,
      quoteAsset: allowance.quoteAsset,
      instrumentIdentityDigest: allowance.instrumentIdentityDigestHex,
      decisionId: allowance.decision.decisionId,
      decisionSemanticDigest: allowance.decision.semanticDigestHex,
      decisionContentDigest: allowance.decision.contentDigestHex,
      decisionAction: allowance.decision.action,
      economicSizeSetId: allowance.decision.economicSizeSetId,
      economicSizeSetDigest: allowance.decision.economicSizeSetDigestHex,
      riskPolicyVersion: allowance.riskPolicyVersion,
      riskPolicyDigest: allowance.riskPolicyDigestHex,
      realitySnapshotId: allowance.realitySnapshotId,
      realityContentDigest: allowance.realityContentDigestHex,
      reconciliationAuthorityDigest: allowance.reconciliationAuthorityDigestHex,
      postureAtIssuance: allowance.postureAtIssuance,
      strictExposureReduction: allowance.strictExposureReduction,
      exactQualifiedQuantity: allowance.exactQualifiedQuantity,
      reservedExposureNotional: allowance.reservedExposureNotional,
      lifecycleState: allowance.lifecycleState,
      boundOrderId: null,
      boundOrderDigest: null,
      issuedAt: new Date(allowance.issuedAtUtc),
      validUntil: new Date(allowance.validUntilUtc),
      lastEnforcementEventSequence: BigInt(event.eventSequence),
      lastEnforcementEventDigest: event.contentDigestHex,
      semanticDigest: allowance.semanticDigestHex,
      contentDigest: allowance.contentDigestHex,
      schemaVersion: allowance.schemaVersion,
      createdAt: durableAt,
      updatedAt: durableAt,
    });
    await appendEventAndAdvanceAccount({
      tx,
      state,
      event,
      nextAdmissionSequence: (BigInt(state.nextAdmissionSequence) + 1n).toString(),
      outstandingReservationNotional: formatDecimal(
        parseDecimal(state.accounting.outstandingReservationNotional) +
          parseDecimal(allowance.reservedExposureNotional),
      ),
    });
    return { verdict, allowance, insertedNew: true };
  });
}

async function releaseIssuedAllowance(input: {
  db: WaiaPostgresDb;
  context: OrgContext;
  accountId: string;
  riskAllowanceId: string;
  eventId: string;
  transition: "REVOKED" | "EXPIRED";
  reasonCode: string;
}): Promise<boolean> {
  const scoped = requireOrgContext(input.context.organizationId);
  return runWaiaPostgresTransaction(input.db, async (tx) => {
    const state = await lockAccountState(tx, scoped.organizationId, input.accountId);
    const rows = await tx.select().from(pgSchema.traderRiskAllowancesV2).where(and(
      eq(pgSchema.traderRiskAllowancesV2.organizationId, scoped.organizationId),
      eq(pgSchema.traderRiskAllowancesV2.accountId, input.accountId),
      eq(pgSchema.traderRiskAllowancesV2.id, input.riskAllowanceId),
    )).for("update");
    const allowance = rows[0];
    if (!allowance) throw new RiskV2PersistenceConflictError("Risk allowance not found");
    if (allowance.lifecycleState !== "ISSUED") return false;
    const durableAt = await durableTransactionTime(tx);
    if (input.transition === "EXPIRED" && durableAt.getTime() < allowance.validUntil.getTime()) {
      throw new RiskV2AdmissionRefusedError("ALLOWANCE_NOT_EXPIRED");
    }
    const event = buildEnforcementEventV2({
      id: input.eventId,
      organizationId: scoped.organizationId,
      accountId: input.accountId,
      eventSequence: state.nextEnforcementEventSequence,
      riskVerdictId: allowance.riskVerdictId,
      riskAllowanceId: allowance.id,
      eventType: input.transition === "REVOKED" ? "ALLOWANCE_REVOKED" : "ALLOWANCE_EXPIRED",
      fromState: "ISSUED",
      toState: input.transition,
      reasonCode: input.reasonCode,
      boundOrderId: null,
      boundOrderDigestHex: null,
      eventPayload: { releasedReservationNotional: allowance.reservedExposureNotional },
      occurredAtUtc: durableAt.toISOString(),
      previousEventDigestHex: state.lastEnforcementEventDigestHex,
    });
    await tx.update(pgSchema.traderRiskAllowancesV2).set({
      lifecycleState: input.transition,
      revokedAt: input.transition === "REVOKED" ? durableAt : null,
      expiredAt: input.transition === "EXPIRED" ? durableAt : null,
      terminalReasonCode: input.reasonCode,
      lastEnforcementEventSequence: BigInt(event.eventSequence),
      lastEnforcementEventDigest: event.contentDigestHex,
      updatedAt: durableAt,
    }).where(and(
      eq(pgSchema.traderRiskAllowancesV2.id, allowance.id),
      eq(pgSchema.traderRiskAllowancesV2.organizationId, scoped.organizationId),
      eq(pgSchema.traderRiskAllowancesV2.lifecycleState, "ISSUED"),
    ));
    await appendEventAndAdvanceAccount({
      tx,
      state,
      event,
      nextAdmissionSequence: state.nextAdmissionSequence,
      outstandingReservationNotional: formatDecimal(
        parseDecimal(state.accounting.outstandingReservationNotional) -
          parseDecimal(allowance.reservedExposureNotional),
      ),
    });
    return true;
  });
}

export function revokeRiskAllowanceV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: { accountId: string; riskAllowanceId: string; eventId: string; reasonCode: string },
): Promise<boolean> {
  return releaseIssuedAllowance({ db, context, ...input, transition: "REVOKED" });
}

export function expireRiskAllowanceV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: {
    accountId: string;
    riskAllowanceId: string;
    eventId: string;
    reasonCode: string;
  },
): Promise<boolean> {
  return releaseIssuedAllowance({ db, context, ...input, transition: "EXPIRED" });
}
