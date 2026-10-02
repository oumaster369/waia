import { z } from "zod";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES, type HtxDerivativesAccountFamily,
  type HtxDerivativesAccountRow, type HtxDerivativesAccountSnapshot,
  type HtxDerivativesPositionRow, type HtxDerivativesPositionsSnapshot } from "./types";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80);
const nonnegativeDecimal = z.string().regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80);
const optionalDecimal = z.union([decimal, z.null()]).optional().transform(value => value ?? null);
const token = z.string().min(1).max(64);
const root = z.object({ status: z.literal("ok"), data: z.array(z.record(z.string(), z.unknown())).max(100),
  ts: z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe())]).optional() }).passthrough();

function invalid(): never { throw new Error("HTX_DERIVATIVES_INVALID_RESPONSE"); }
/** Strict JSON reader that preserves numeric lexemes and rejects duplicate object keys. */
function parseJson(input: string | unknown): unknown {
  if (typeof input !== "string") return input;
  if (input.length > 1_048_576) return invalid();
  let i = 0;
  let nodeCount = 0;
  const maxDepth = 64;
  const maxNodes = 20_000;
  const ws = () => { while (/[ \t\r\n]/.test(input[i] ?? "")) i++; };
  const string = (): string => {
    if (input[i] !== '"') return invalid();
    const start = i++;
    while (i < input.length) {
      const c = input[i++]!;
      if (c === '"') {
        try { return JSON.parse(input.slice(start, i)) as string; } catch { return invalid(); }
      }
      if (c === "\\") i++;
      else if (c.charCodeAt(0) < 0x20) return invalid();
    }
    return invalid();
  };
  const value = (depth = 0): unknown => {
    if (depth > maxDepth || ++nodeCount > maxNodes) return invalid();
    ws(); const ch = input[i];
    if (ch === '"') return string();
    if (ch === "{") {
      i++; ws(); const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (input[i] === "}") { i++; return out; }
      while (true) {
        ws(); const key = string(); if (Object.hasOwn(out, key)) return invalid();
        ws(); if (input[i++] !== ":") return invalid();
        out[key] = value(depth + 1); ws(); const sep = input[i++];
        if (sep === "}") return out; if (sep !== ",") return invalid();
      }
    }
    if (ch === "[") {
      i++; ws(); const out: unknown[] = [];
      if (input[i] === "]") { i++; return out; }
      while (true) { out.push(value(depth + 1)); ws(); const sep = input[i++]; if (sep === "]") return out; if (sep !== ",") return invalid(); }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (input.startsWith(literal, i)) { i += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(i));
    if (!match) return invalid(); i += match[0].length; return match[0];
  };
  const parsed = value(); ws(); if (i !== input.length) return invalid(); return parsed;
}
function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return token.parse(value);
}
function decimalField(row: Record<string, unknown>, key: string): string | null {
  if (!(key in row)) return null;
  const value = row[key];
  return value === null ? null : optionalDecimal.parse(value);
}
function nonnegativeDecimalField(row: Record<string, unknown>, key: string): string | null {
  if (!(key in row)) return null;
  const value = row[key];
  return value === null ? null : nonnegativeDecimal.parse(value);
}
function marginMode(value: unknown): "isolated" | "cross" | null {
  if (value === undefined || value === null) return null;
  if (value === "isolated" || value === "cross") return value;
  return invalid();
}
function accountCode(family: HtxDerivativesAccountFamily, row: Record<string, unknown>): string {
  const value = family === "usdt_cross_shared" ? row.margin_account :
    family === "usdt_isolated_perpetual" || family === "coin_perpetual" ? row.contract_code : row.symbol;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return invalid();
  return value.toUpperCase();
}
function accountRow(family: HtxDerivativesAccountFamily, value: Record<string, unknown>): HtxDerivativesAccountRow {
  const mode = marginMode(value.margin_mode);
  if (mode && mode !== (family === "usdt_cross_shared" ? "cross" : "isolated")) {
    // Coin endpoints have their own account modes; only enforce the USDT endpoint's exact mode.
    if (family === "usdt_isolated_perpetual" || family === "usdt_cross_shared") return invalid();
  }
  const leverageValue = value.lever_rate;
  const leverage = leverageValue === undefined || leverageValue === null ? null : decimal.parse(leverageValue);
  const symbol = nullableText(value.symbol)?.toUpperCase() ?? null;
  const contractCode = nullableText(value.contract_code)?.toUpperCase() ?? null;
  const collateralAsset = family.startsWith("usdt_") ? "USDT" : symbol;
  const declaredAsset = nullableText(value.margin_asset);
  if (declaredAsset && declaredAsset.toUpperCase() !== collateralAsset) return invalid();
  if (family === "usdt_cross_shared" && value.margin_account !== "USDT") return invalid();
  if (family === "usdt_isolated_perpetual" && (!symbol || !contractCode?.endsWith("-USDT") ||
      !contractCode.startsWith(`${symbol}-`) || value.margin_account !== contractCode)) return invalid();
  if (family === "coin_perpetual" && (!contractCode?.endsWith("-USD") || (symbol && !contractCode.startsWith(`${symbol}-`)))) return invalid();
  if ((family === "coin_perpetual" || family === "coin_delivery_futures") && !symbol) return invalid();
  if (family === "coin_delivery_futures" && contractCode && !contractCode.startsWith(`${symbol}-`)) return invalid();
  if ((family === "coin_perpetual" || family === "coin_delivery_futures") &&
      collateralAsset && !/^[A-Z0-9]{2,16}$/.test(collateralAsset)) return invalid();
  return Object.freeze({
    accountCode: accountCode(family, value), collateralAsset: collateralAsset?.toUpperCase() ?? null,
    marginMode: mode, marginBalance: decimalField(value, "margin_balance"),
    marginAvailable: decimalField(value, "margin_available"),
    withdrawAvailable: decimalField(value, "withdraw_available"), marginPosition: decimalField(value, "margin_position"),
    marginFrozen: decimalField(value, "margin_frozen"), marginStatic: decimalField(value, "margin_static"),
    realizedPnl: decimalField(value, "profit_real"), unrealizedPnl: decimalField(value, "profit_unreal"),
    riskRate: decimalField(value, "risk_rate"), liquidationPrice: decimalField(value, "liquidation_price"), leverage,
  });
}

function positionRow(family: HtxDerivativesAccountFamily, value: Record<string, unknown>): HtxDerivativesPositionRow {
  const symbol = nullableText(value.symbol)?.toUpperCase();
  const contractCode = nullableText(value.contract_code)?.toUpperCase();
  if (!symbol || !contractCode || !/^[A-Z0-9_-]{1,64}$/.test(symbol) ||
      !/^[A-Z0-9_-]{1,64}$/.test(contractCode) ||
      (value.direction !== "buy" && value.direction !== "sell")) return invalid();

  let marginAsset: string;
  if (family.startsWith("usdt_")) {
    const isolated = family === "usdt_isolated_perpetual";
    const expectedMode = isolated ? "isolated" : "cross";
    const validContractCode = isolated ? contractCode === `${symbol}-USDT`
      : contractCode.startsWith(`${symbol}-USDT`) && /^[A-Z0-9]+-USDT(?:-\d{6})?$/.test(contractCode);
    const validMarginAccount = value.margin_account == null ||
      (isolated ? value.margin_account === contractCode : value.margin_account === "USDT");
    const validMarginMode = value.margin_mode == null || value.margin_mode === expectedMode;
    if (!validContractCode || !validMarginAccount || !validMarginMode ||
        (value.margin_asset != null && String(value.margin_asset).toUpperCase() !== "USDT")) return invalid();
    marginAsset = "USDT";
  } else {
    marginAsset = symbol;
    if (value.margin_asset != null && String(value.margin_asset).toUpperCase() !== marginAsset) return invalid();
    if (family === "coin_perpetual" && contractCode !== `${symbol}-USD`) return invalid();
    if (family === "coin_delivery_futures" && !new RegExp(`^${symbol}\\d{6}$`).test(contractCode)) return invalid();
  }
  const contractType = nullableText(value.contract_type)?.toLowerCase() ?? null;
  return Object.freeze({
    symbol, contractCode, contractType, direction: value.direction,
    volume: nonnegativeDecimalField(value, "volume"), available: nonnegativeDecimalField(value, "available"),
    frozen: nonnegativeDecimalField(value, "frozen"), costOpen: nonnegativeDecimalField(value, "cost_open"),
    costHold: nonnegativeDecimalField(value, "cost_hold"), unrealizedPnl: decimalField(value, "profit_unreal"),
    profitRate: decimalField(value, "profit_rate"), positionMargin: nonnegativeDecimalField(value, "position_margin"),
    marginAsset, leverage: value.lever_rate === undefined || value.lever_rate === null ? null : nonnegativeDecimal.parse(value.lever_rate),
    lastPrice: nonnegativeDecimalField(value, "last_price"), liquidationPrice: nonnegativeDecimalField(value, "liquidation_price"),
  });
}

/** Projects only a small allowlist from the four official HTX account-info payload families. */
export function parseHtxDerivativesAccountSnapshot(
  family: HtxDerivativesAccountFamily,
  payload: string | unknown,
): HtxDerivativesAccountSnapshot {
  try {
    if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)) return invalid();
    const parsed = root.safeParse(parseJson(payload));
    if (!parsed.success) return invalid();
    const expectedMode = family === "usdt_cross_shared" ? "cross" : family === "usdt_isolated_perpetual" ? "isolated" : null;
    const accounts = parsed.data.data.map(row => accountRow(family, row));
    if (expectedMode && accounts.some(row => row.marginMode !== null && row.marginMode !== expectedMode)) return invalid();
    const keys = accounts.map(row => row.accountCode);
    if (new Set(keys).size !== keys.length) return invalid();
    return Object.freeze({ schemaVersion: "htx-derivatives-account/v1", family,
      accounts: Object.freeze(accounts), responseGeneratedAtMs: parsed.data.ts === undefined ? null : Number(parsed.data.ts) });
  } catch {
    return invalid();
  }
}

/** Projects open position rows only. Oversized or ambiguous data is rejected, never truncated. */
export function parseHtxDerivativesPositionsSnapshot(
  family: HtxDerivativesAccountFamily,
  payload: string | unknown,
): HtxDerivativesPositionsSnapshot {
  try {
    if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)) return invalid();
    const parsed = root.safeParse(parseJson(payload));
    if (!parsed.success) return invalid();
    const positions = parsed.data.data.map(row => positionRow(family, row));
    if (new Set(positions.map(row => `${row.contractCode}\u0000${row.direction}`)).size !== positions.length) return invalid();
    return Object.freeze({ schemaVersion: "htx-derivatives-positions/v1", family,
      positions: Object.freeze(positions), responseGeneratedAtMs: parsed.data.ts === undefined ? null : Number(parsed.data.ts) });
  } catch {
    return invalid();
  }
}
