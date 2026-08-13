import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import {
  bindHistoricalSimulatedExchange,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { HtxVolumeCapitalAuthorityError } from "@/lib/trader/market-data/volume-qualification/htx-volume-authority-capital-v1";

export const HTR_HISTORICAL_EXECUTION_PROFILE_V1 = "htr-historical-execution-profile/v1" as const;

export type HistoricalExecutionProfileV1 = {
  profileId: typeof HTR_HISTORICAL_EXECUTION_PROFILE_V1;
  model: HistoricalExecutionModelV1;
  exchange: HistoricalSimulatedExchange;
  /**
   * DEE-526: required for participation capacity. Missing ⇒ fail closed at advance.
   * Do not fabricate QUALIFIED here — attach a real dataset/CLI qualification receipt.
   */
  htxVolumeAuthorityReceipt?: HtxVolumeQualificationReceiptV1;
};

export function bindHistoricalExecutionModelToSession(options?: {
  htxVolumeAuthorityReceipt?: HtxVolumeQualificationReceiptV1;
}): HistoricalExecutionProfileV1 {
  const model = createHistoricalExecutionModelV1();
  return {
    profileId: HTR_HISTORICAL_EXECUTION_PROFILE_V1,
    model,
    exchange: bindHistoricalSimulatedExchange(model),
    htxVolumeAuthorityReceipt: options?.htxVolumeAuthorityReceipt,
  };
}

/** Derive amount/vol for the capital gate from a non-authoritative bar after QUALIFIED receipt. */
export function htxVolumeRawFromClosedBar(closedBar: Bar): { amount: number; vol: number } {
  const vol = Number(closedBar.volume);
  const close = Number(closedBar.close);
  if (!Number.isFinite(vol) || vol < 0 || !Number.isFinite(close) || close <= 0) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_BAR_RAW_INVALID",
      "closed bar volume/close cannot supply HTX volume raw fields",
    );
  }
  return { vol, amount: vol * close };
}

export function requireProfileHtxVolumeAuthority(
  profile: HistoricalExecutionProfileV1,
): HtxVolumeQualificationReceiptV1 {
  if (!profile.htxVolumeAuthorityReceipt) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      "historical execution profile missing HTX volume qualification receipt",
    );
  }
  return profile.htxVolumeAuthorityReceipt;
}

const HISTORICAL_EXECUTION_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);

/** Maps canonical research instrument ids to WP17 execution symbols. */
export function normalizeSymbolForHistoricalExecution(symbol: string): "BTCUSDT" | "ETHUSDT" {
  const normalized = symbol.includes("/") ? symbol.replace("/", "") : symbol;
  if (HISTORICAL_EXECUTION_SYMBOLS.has(normalized)) {
    return normalized as "BTCUSDT" | "ETHUSDT";
  }
  throw new Error(`[htr/wp17] unsupported historical execution symbol: ${symbol}`);
}
