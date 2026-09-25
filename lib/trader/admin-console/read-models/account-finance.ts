import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import type { DedupedAccount } from "@/lib/trader/admin-console/accounts/dedupe";
import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import type { AssetQuote } from "@/lib/trader/admin-console/money/quotes";
import {
  equityInclusion,
  valueObservation,
  type ValuationLot,
} from "@/lib/trader/admin-console/money/valuation";
import type { OverviewAccount } from "@/lib/trader/admin-console/read-models/overview";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import { quoteSetDigest } from "@/lib/trader/admin-console/money/quotes";

export type ObservationEvidence = { id: string; payload: unknown; recordedAt: string };
export type AccountFinance = OverviewAccount & {
  assets?: {
    asset: string;
    free: string;
    locked: string;
    value: string | null;
    state: AdminDataState;
    reasons: string[];
  }[];
  observationStatus?: string | null;
  organizationId: string | null;
  venue: string;
  exchangeAccountId: string;
  credentialsCount: number;
  connectedSince: string | null;
  portfolio: "live";
  state: AdminDataState;
  currency: "USDT" | "USD";
  method: string;
  sourceAt: string | null;
  traderUnrealized: string | null;
  traderCostBasis: string | null;
  traderLotsValue: string | null;
  externalValue: string | null;
  nativeValuation: { equity: string; unrealized: string; valuationKey: string } | null;
  valuationEvidence: {
    observationId: string;
    recordedAt: string;
    lotsRevision: string;
    quoteSet: readonly AssetQuote[];
    quoteSetDigest: string;
  } | null;
};

/** A missing/failed observation never means a confirmed zero balance. */
export function buildAccountFinance(input: {
  group: DedupedAccount;
  latest: ObservationEvidence | null;
  lastComplete: ObservationEvidence | null;
  connectedSince: string | null;
  currency: "USDT" | "USD";
  mode: string;
  nowMs: number;
  quotes: readonly AssetQuote[];
  lots: readonly ValuationLot[];
  lotsRevision: string;
  valuationDeferred?: boolean;
}): AccountFinance {
  const { group } = input;
  const result: AccountFinance = {
    id: `${group.venue}:${group.exchangeAccountId}`,
    assets: [],
    observationStatus: null,
    organizationId: group.conflict ? null : group.organizationIds[0]!,
    venue: group.venue,
    exchangeAccountId: group.exchangeAccountId,
    credentialsCount: group.credentialsCount,
    connectedSince: input.connectedSince,
    portfolio: "live",
    state: "unavailable",
    currency: input.currency,
    method: input.currency === "USDT" ? "htx_spot_last:usdt" : "usdt_usd:unavailable",
    valuationKey: adminRevision({ latest: input.latest?.id ?? null, mode: input.mode }),
    included: false,
    stale: false,
    reason: null,
    reasons: [],
    observedAt: null,
    sourceAt: null,
    equity: null,
    freeQuote: null,
    lockedQuote: null,
    holdingsValue: null,
    traderPnl: null,
    traderUnrealized: null,
    traderCostBasis: null,
    traderLotsValue: null,
    externalValue: null,
    nativeValuation: null,
    valuationEvidence: null,
  };
  const unavailable = (reason: string, state: AdminDataState = "unavailable") => ({
    ...result,
    state,
    reason,
    reasons: [reason],
  });
  if (group.conflict) return unavailable("OWNERSHIP_CONFLICT");
  if (input.mode === "paper" || input.mode === "history")
    return unavailable("EXCHANGE_BALANCE_LIVE_ONLY", "not_applicable");
  if (input.valuationDeferred) return unavailable("ACCOUNT_CAP", "partial");
  if (!input.latest) return unavailable("OBSERVATION_MISSING");

  const parse = (evidence: ObservationEvidence | null) => {
    if (!evidence) return null;
    try {
      const parsed = parseAccountObservation(evidence.payload);
      if (
        parsed.observationId !== evidence.id ||
        parsed.binding.organizationId !== result.organizationId ||
        parsed.binding.exchangeAccountId !== group.exchangeAccountId ||
        !group.credentials.some(
          (credential) => credential.credentialId === parsed.binding.credentialId,
        )
      )
        return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const latest = parse(input.latest);
  result.observationStatus = latest?.status ?? null;
  const complete = (observation: ReturnType<typeof parse>) =>
    observation?.status === "COMPLETE" &&
    observation.balances.status === "COMPLETE" &&
    observation.balances.values !== null;
  const isLatestComplete = complete(latest);
  const selected = isLatestComplete ? input.latest : input.lastComplete;
  const observation = isLatestComplete ? latest : parse(selected);
  const failureReason = latest ? `OBSERVATION_${latest.status}` : "OBSERVATION_INVALID";
  if (!complete(observation) || !observation || !selected) return unavailable(failureReason);

  const sourceMs = observation.balances.sourceAsOfMs ?? observation.balances.readCompletedAtMs;
  const sourceAt = new Date(sourceMs).toISOString();
  const ageMs = input.nowMs - sourceMs;
  const observationStale =
    !isLatestComplete || ageMs > ACCOUNT_OBSERVATION_STALE_AFTER_MS || ageMs < 0;
  const valued = valueObservation({
    observationId: selected.id,
    recordedAt: selected.recordedAt,
    balances: observation.balances.values!,
    quotes: input.quotes,
    lots: input.lots,
    lotsRevision: input.lotsRevision,
    currency: input.currency,
    nowMs: input.nowMs,
  });
  const reasons = [
    ...new Set([
      ...(!isLatestComplete ? [failureReason] : []),
      ...(observationStale ? ["OBSERVATION_STALE"] : []),
      ...valued.reasons,
    ]),
  ];
  const native =
    input.currency === "USDT"
      ? valued
      : valueObservation({
          observationId: selected.id,
          recordedAt: selected.recordedAt,
          balances: observation.balances.values!,
          quotes: input.quotes,
          lots: input.lots,
          lotsRevision: input.lotsRevision,
          currency: "USDT",
          nowMs: input.nowMs,
        });
  const inclusion = equityInclusion(valued.reasons, valued.equity);
  return {
    ...result,
    observationStatus: latest?.status ?? null,
    assets: observation.balances.values!.map((balance) => {
      const assetValue = valueObservation({
        observationId: selected.id,
        recordedAt: selected.recordedAt,
        balances: [balance],
        quotes: input.quotes,
        lots: [],
        lotsRevision: input.lotsRevision,
        currency: input.currency,
        nowMs: input.nowMs,
      });
      return {
        asset: balance.asset,
        free: balance.free,
        locked: balance.locked,
        value: assetValue.excludedAssets.includes(balance.asset.toUpperCase())
          ? null
          : assetValue.equity,
        state: observationStale ? ("stale" as const) : assetValue.state,
        reasons: assetValue.reasons,
      };
    }),
    valuationKey: adminRevision({
      valuation: valued.valuationKey,
      latest: input.latest.id,
      reasons,
    }),
    state: observationStale ? "stale" : valued.state,
    included: inclusion.included && !observationStale && !inclusion.stale,
    stale: observationStale || inclusion.stale,
    reason: reasons[0] ?? null,
    reasons,
    observedAt: selected.recordedAt,
    sourceAt,
    method: valued.method,
    equity: valued.equity,
    freeQuote: valued.freeQuote,
    lockedQuote: valued.lockedQuote,
    holdingsValue: valued.holdingsValue,
    traderUnrealized: valued.traderUnrealized,
    traderCostBasis: valued.traderCostBasis,
    traderLotsValue: valued.traderLotsValue,
    externalValue: valued.externalValue,
    nativeValuation:
      native.state === "ok" && native.equity !== null && native.traderUnrealized !== null
        ? {
            equity: native.equity,
            unrealized: native.traderUnrealized,
            valuationKey: native.valuationKey,
          }
        : null,
    valuationEvidence: {
      observationId: selected.id,
      recordedAt: selected.recordedAt,
      lotsRevision: input.lotsRevision,
      quoteSet: valued.quoteSet ?? [],
      quoteSetDigest: quoteSetDigest(valued.quoteSet ?? []),
    },
  };
}
