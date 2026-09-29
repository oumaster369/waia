import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { compareDecimal, formatDecimal, minDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  LIVE_CAPITAL_ENVELOPE_V2,
  decideLiveCapitalEnvelopeWindowV2,
  liveCapitalEnvelopeCommandSchemaV2,
  sealLiveCapitalEnvelopeV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import type { RiskAccountAccountingV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";

type LimitTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

export const LIVE_CAPITAL_ORDER_LIMIT_REASONS = [
  "LIVE_CAPITAL_ENVELOPE_ABSENT",
  "LIVE_CAPITAL_ENVELOPE_STALE",
  "LIVE_CAPITAL_IDENTITY_CHANGED",
  "LIVE_CAPITAL_LIMIT_MISMATCH",
  "LIVE_CAPITAL_NOT_POSITIVE",
  "LIVE_CAPITAL_LOSS_LIMIT_EXCEEDED",
] as const;

export type LiveCapitalOrderLimitReasonV2 = (typeof LIVE_CAPITAL_ORDER_LIMIT_REASONS)[number];

export class LiveCapitalOrderLimitRefusedError extends Error {
  constructor(readonly reason: LiveCapitalOrderLimitReasonV2) {
    super(reason);
    this.name = "LiveCapitalOrderLimitRefusedError";
  }
}

export type LiveCapitalOrderLimitV2 =
  | Readonly<{ ok: true; effectiveLimitNotional: string }>
  | Readonly<{ ok: false; reason: LiveCapitalOrderLimitReasonV2 }>;

/**
 * Effective order limit after a sealed basis-bound envelope.
 * capitalNotional must equal the account exposure limit. lossLimitNotional caps it.
 * Zero or negative amounts refuse. This function does not invent an amount.
 */
export function liveCapitalOrderLimitV2(
  input: Readonly<{
    exposureLimitNotional: string;
    capitalNotional: string;
    lossLimitNotional: string;
    basisBound: boolean;
    windowOpen: boolean;
    identityMatches: boolean;
  }>,
): LiveCapitalOrderLimitV2 {
  if (!input.basisBound) return { ok: false, reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" };
  if (!input.identityMatches) return { ok: false, reason: "LIVE_CAPITAL_IDENTITY_CHANGED" };
  if (!input.windowOpen) return { ok: false, reason: "LIVE_CAPITAL_ENVELOPE_STALE" };
  let capital: bigint;
  let loss: bigint;
  try {
    capital = parseDecimal(input.capitalNotional);
    loss = parseDecimal(input.lossLimitNotional);
    parseDecimal(input.exposureLimitNotional);
  } catch {
    return { ok: false, reason: "LIVE_CAPITAL_LIMIT_MISMATCH" };
  }
  if (capital <= 0n || loss <= 0n) return { ok: false, reason: "LIVE_CAPITAL_NOT_POSITIVE" };
  if (compareDecimal(input.capitalNotional, input.exposureLimitNotional) !== 0) {
    return { ok: false, reason: "LIVE_CAPITAL_LIMIT_MISMATCH" };
  }
  return {
    ok: true,
    effectiveLimitNotional: minDecimal(
      input.exposureLimitNotional,
      minDecimal(input.capitalNotional, input.lossLimitNotional),
    ),
  };
}

async function clockNowUtc(tx: LimitTx): Promise<string> {
  const rows = await tx.execute<{ now: string }>(sql`
    select to_char(date_trunc('milliseconds', clock_timestamp()) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now
  `);
  const now = rows[0]?.now;
  if (!now) throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_ABSENT");
  return now;
}

/** Re-reads the sealed envelope under the caller's account lock. Refuses closed. */
export async function requireLiveCapitalOrderLimitV2(
  tx: LimitTx,
  organizationId: string,
  accountId: string,
  exposureLimitNotional: string,
): Promise<string> {
  const currentRows = await tx
    .select()
    .from(pgSchema.traderLiveCapitalEnvelopeCurrentV2)
    .where(
      and(
        eq(pgSchema.traderLiveCapitalEnvelopeCurrentV2.organizationId, organizationId),
        eq(pgSchema.traderLiveCapitalEnvelopeCurrentV2.accountId, accountId),
      ),
    )
    .for("update");
  const current = currentRows[0];
  if (!current?.basisDigest) {
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  const envelopeRows = await tx
    .select()
    .from(pgSchema.traderLiveCapitalEnvelopesV2)
    .where(
      and(
        eq(pgSchema.traderLiveCapitalEnvelopesV2.organizationId, organizationId),
        eq(pgSchema.traderLiveCapitalEnvelopesV2.accountId, accountId),
        eq(pgSchema.traderLiveCapitalEnvelopesV2.contentDigest, current.envelopeDigest),
      ),
    )
    .limit(1);
  const envelope = envelopeRows[0];
  if (!envelope) throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_ABSENT");
  let command;
  try {
    const parsed = JSON.parse(envelope.bodyText) as { schemaVersion?: string };
    const { schemaVersion, ...rest } = parsed;
    if (schemaVersion !== LIVE_CAPITAL_ENVELOPE_V2) {
      throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_IDENTITY_CHANGED");
    }
    command = liveCapitalEnvelopeCommandSchemaV2.parse(rest);
  } catch (error) {
    if (error instanceof LiveCapitalOrderLimitRefusedError) throw error;
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_IDENTITY_CHANGED");
  }
  const receipt = sealLiveCapitalEnvelopeV2(command);
  if (receipt.contentDigest !== current.envelopeDigest) {
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_IDENTITY_CHANGED");
  }
  const nowUtc = await clockNowUtc(tx);
  const publication = decideLiveCapitalEnvelopeWindowV2({
    liveCapitalEnvelope: receipt,
    bound: {
      organizationId,
      accountId,
      policyDigest: current.policyDigest,
      releaseSha: current.releaseSha,
      nowUtc,
    },
  });
  if (publication.decision === "REFUSED") {
    if (publication.reason === "LIVE_CAPITAL_ENVELOPE_STALE") {
      throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_STALE");
    }
    if (
      publication.reason === "LIVE_CAPITAL_IDENTITY_CHANGED" ||
      publication.reason === "EXTERNAL_ORGANIZATION"
    ) {
      throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_IDENTITY_CHANGED");
    }
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  if (publication.basisDigest !== current.basisDigest) {
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  const decision = liveCapitalOrderLimitV2({
    exposureLimitNotional,
    capitalNotional: receipt.capitalNotional,
    lossLimitNotional: receipt.lossLimitNotional,
    basisBound: true,
    windowOpen: true,
    identityMatches: true,
  });
  if (!decision.ok) throw new LiveCapitalOrderLimitRefusedError(decision.reason);
  return formatDecimal(parseDecimal(decision.effectiveLimitNotional));
}

export async function accountingCappedByLiveCapitalEnvelopeV2(
  tx: LimitTx,
  organizationId: string,
  accountId: string,
  accounting: RiskAccountAccountingV2,
): Promise<RiskAccountAccountingV2> {
  const effectiveLimitNotional = await requireLiveCapitalOrderLimitV2(
    tx,
    organizationId,
    accountId,
    accounting.exposureLimitNotional,
  );
  return { ...accounting, exposureLimitNotional: effectiveLimitNotional };
}

export function assertNotionalWithinLiveCapitalLimitV2(
  notional: string,
  effectiveLimitNotional: string,
): void {
  if (compareDecimal(notional, effectiveLimitNotional) > 0) {
    throw new LiveCapitalOrderLimitRefusedError("LIVE_CAPITAL_LOSS_LIMIT_EXCEEDED");
  }
}
