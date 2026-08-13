import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import {
  bindHistoricalSimulatedExchange,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { Bar } from "@/lib/trader/intelligence/types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/execution/historical-execution-symbol";
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
  /**
   * Per-instrument QUALIFIED receipts. Required when the replay is multi-symbol:
   * a BTC receipt must not authorize ETH capacity (DEE-526).
   */
  htxVolumeAuthorityByInstrument?: Readonly<
    Partial<Record<"BTCUSDT" | "ETHUSDT", HtxVolumeQualificationReceiptV1>>
  >;
};

export function bindHistoricalExecutionModelToSession(options?: {
  htxVolumeAuthorityReceipt?: HtxVolumeQualificationReceiptV1;
  htxVolumeAuthorityByInstrument?: Readonly<
    Partial<Record<"BTCUSDT" | "ETHUSDT", HtxVolumeQualificationReceiptV1>>
  >;
}): HistoricalExecutionProfileV1 {
  const model = createHistoricalExecutionModelV1();
  return {
    profileId: HTR_HISTORICAL_EXECUTION_PROFILE_V1,
    model,
    exchange: bindHistoricalSimulatedExchange(model),
    htxVolumeAuthorityReceipt: options?.htxVolumeAuthorityReceipt,
    htxVolumeAuthorityByInstrument: options?.htxVolumeAuthorityByInstrument,
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
  closedBarSymbol?: string,
): HtxVolumeQualificationReceiptV1 {
  if (closedBarSymbol !== undefined) {
    const instrument = normalizeSymbolForHistoricalExecution(closedBarSymbol);
    const fromInstrumentMap = profile.htxVolumeAuthorityByInstrument?.[instrument];
    if (fromInstrumentMap) {
      const receiptInstrument = normalizeSymbolForHistoricalExecution(fromInstrumentMap.symbol);
      if (receiptInstrument !== instrument) {
        throw new HtxVolumeCapitalAuthorityError(
          "HTX_VOLUME_AUTHORITY_SYMBOL_MISMATCH",
          `HTX volume qualification receipt symbol=${receiptInstrument} cannot authorize closed bar ${instrument}`,
        );
      }
      return fromInstrumentMap;
    }
  }
  if (!profile.htxVolumeAuthorityReceipt) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      "historical execution profile missing HTX volume qualification receipt",
    );
  }
  if (closedBarSymbol !== undefined) {
    const want = normalizeSymbolForHistoricalExecution(closedBarSymbol);
    const got = normalizeSymbolForHistoricalExecution(profile.htxVolumeAuthorityReceipt.symbol);
    if (want !== got) {
      throw new HtxVolumeCapitalAuthorityError(
        "HTX_VOLUME_AUTHORITY_SYMBOL_MISMATCH",
        `HTX volume qualification receipt symbol=${got} cannot authorize closed bar ${want}`,
      );
    }
  }
  return profile.htxVolumeAuthorityReceipt;
}

export { normalizeSymbolForHistoricalExecution };
