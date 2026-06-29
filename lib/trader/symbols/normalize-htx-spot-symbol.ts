import {
  HTX_SPOT_ALLOWED_SYMBOLS,
  type HtxSpotAllowedSymbol,
} from "@/lib/trader/connectors/htx/config";
import { htxSymbolToInternal, isHtxSpotSymbolAllowed } from "@/lib/trader/connectors/htx/mappers";

export type NormalizeHtxSpotSymbolResult =
  | { ok: true; symbol: HtxSpotAllowedSymbol }
  | { ok: false; message: string };

export const TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE =
  "Enter a supported HTX spot pair: BTC/USDT or ETH/USDT.";

export const UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE =
  "Unsupported HTX spot pair. Use BTC/USDT or ETH/USDT.";

export function normalizeHtxSpotSymbol(input: string): NormalizeHtxSpotSymbolResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, message: TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE };
  }

  let internal: string;
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      return { ok: false, message: UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE };
    }
    internal = `${parts[0].trim().toUpperCase()}/${parts[1].trim().toUpperCase()}`;
  } else {
    internal = htxSymbolToInternal(trimmed.toLowerCase());
  }

  if (!isHtxSpotSymbolAllowed(internal)) {
    return { ok: false, message: UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE };
  }

  return { ok: true, symbol: internal as HtxSpotAllowedSymbol };
}

export function formatHtxSpotAllowedSymbolsList(): string {
  return HTX_SPOT_ALLOWED_SYMBOLS.join(" or ");
}
