import { COST_MODEL_VERSION_V1, type CostModelV1 } from "@/lib/trader/execution/cost-model";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal } from "@/lib/trader/risk/numeric";

export const HTR_HISTORICAL_COST_MODEL_ID = "htr-historical-execution-v1" as const;

export const HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION =
  "waia.trader.historical-execution-model.v1" as const;

export const HTR_HISTORICAL_COST_MODEL_FEE_BPS = "20" as const;
export const HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS = "5" as const;
export const HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS = "10" as const;
export const HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL = "MERGED_INTO_IMPACT" as const;

export class HtrHistoricalCostModelMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HtrHistoricalCostModelMismatchError";
  }
}

export type HtrHistoricalCostModelAuthorityV1 = Readonly<{
  modelId: typeof HTR_HISTORICAL_COST_MODEL_ID;
  schemaVersion: typeof HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION;
  feeBps: typeof HTR_HISTORICAL_COST_MODEL_FEE_BPS;
  halfSpreadBps: typeof HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS;
  marketImpactBps: typeof HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS;
  slippageModel: typeof HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL;
  takerFeeBps: "20";
  makerFeeBps: "20";
  submitLatencyMs: 50;
  cancelLatencyMs: 100;
  partialFillModel: "DETERMINISTIC_VOLUME_PARTICIPATION";
  costModelDigest: string;
}>;

type HtrHistoricalCostModelAuthorityDigestInput = Omit<
  HtrHistoricalCostModelAuthorityV1,
  "costModelDigest"
>;

const HTR_HISTORICAL_COST_MODEL_AUTHORITY_BASE: HtrHistoricalCostModelAuthorityDigestInput = {
  modelId: HTR_HISTORICAL_COST_MODEL_ID,
  schemaVersion: HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION,
  feeBps: HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  halfSpreadBps: HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  marketImpactBps: HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
  slippageModel: HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL,
  takerFeeBps: "20",
  makerFeeBps: "20",
  submitLatencyMs: 50,
  cancelLatencyMs: 100,
  partialFillModel: "DETERMINISTIC_VOLUME_PARTICIPATION",
};

export function computeHtrHistoricalCostModelDigest(
  authority: Partial<HtrHistoricalCostModelAuthorityV1> = HTR_HISTORICAL_COST_MODEL_AUTHORITY_BASE,
): string {
  const { costModelDigest: _costModelDigest, ...digestInput } =
    authority as HtrHistoricalCostModelAuthorityV1;
  return computeSemanticSha256Hex({
    ...HTR_HISTORICAL_COST_MODEL_AUTHORITY_BASE,
    ...digestInput,
  } as unknown as Record<string, unknown>);
}

export const HTR_HISTORICAL_COST_MODEL_DIGEST = computeHtrHistoricalCostModelDigest();

export function createHtrHistoricalCostModelAuthorityV1(): HtrHistoricalCostModelAuthorityV1 {
  return {
    ...HTR_HISTORICAL_COST_MODEL_AUTHORITY_BASE,
    costModelDigest: HTR_HISTORICAL_COST_MODEL_DIGEST,
  };
}

export function assertHtrHistoricalCostModelMatch(
  candidate: Partial<{
    modelId: string;
    schemaVersion: string;
    feeBps: string;
    halfSpreadBps: string;
    marketImpactBps: string;
    slippageModel: string;
    costModelDigest: string;
  }>,
): void {
  const authority = createHtrHistoricalCostModelAuthorityV1();

  if (candidate.modelId !== undefined && candidate.modelId !== authority.modelId) {
    throw new HtrHistoricalCostModelMismatchError("HTR_COST_MODEL_AUTHORITY:MODEL_ID_MISMATCH");
  }
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== authority.schemaVersion
  ) {
    throw new HtrHistoricalCostModelMismatchError(
      "HTR_COST_MODEL_AUTHORITY:SCHEMA_VERSION_MISMATCH",
    );
  }
  if (candidate.feeBps !== undefined && candidate.feeBps !== authority.feeBps) {
    throw new HtrHistoricalCostModelMismatchError("HTR_COST_MODEL_AUTHORITY:FEE_BPS_MISMATCH");
  }
  if (
    candidate.halfSpreadBps !== undefined &&
    candidate.halfSpreadBps !== authority.halfSpreadBps
  ) {
    throw new HtrHistoricalCostModelMismatchError(
      "HTR_COST_MODEL_AUTHORITY:HALF_SPREAD_BPS_MISMATCH",
    );
  }
  if (
    candidate.marketImpactBps !== undefined &&
    candidate.marketImpactBps !== authority.marketImpactBps
  ) {
    throw new HtrHistoricalCostModelMismatchError(
      "HTR_COST_MODEL_AUTHORITY:MARKET_IMPACT_BPS_MISMATCH",
    );
  }
  if (
    candidate.slippageModel !== undefined &&
    candidate.slippageModel !== authority.slippageModel
  ) {
    throw new HtrHistoricalCostModelMismatchError(
      "HTR_COST_MODEL_AUTHORITY:SLIPPAGE_MODEL_MISMATCH",
    );
  }
  if (
    candidate.costModelDigest !== undefined &&
    candidate.costModelDigest !== authority.costModelDigest
  ) {
    throw new HtrHistoricalCostModelMismatchError("HTR_COST_MODEL_AUTHORITY:DIGEST_MISMATCH");
  }
}

/**
 * Production-only CostModelV1 constructor. Accepts the canonical D-5 authority object only.
 */
export function costModelV1FromAuthority(
  authority: HtrHistoricalCostModelAuthorityV1,
): CostModelV1 {
  assertHtrHistoricalCostModelMatch(authority);
  return {
    version: COST_MODEL_VERSION_V1,
    feesBps: authority.feeBps,
    slippageBps: addDecimal(authority.halfSpreadBps, authority.marketImpactBps),
  };
}
