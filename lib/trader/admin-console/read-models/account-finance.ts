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

export type ObservationEvidence = { id: string; payload: unknown; recordedAt: string };
export type AccountFinance = OverviewAccount & {
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
  const inclusion = equityInclusion(valued.reasons, valued.equity);
  return {
    ...result,
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
  };
}
