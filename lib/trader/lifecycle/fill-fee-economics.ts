import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

/** A persisted per-leg marker distinguishes repaired closes from immutable legacy legs. */
export const LIFECYCLE_FEE_ACCOUNTING_VERSION = "native-fee-inventory/v1" as const;

/** Keep opening fees separate from avgCost: the operational reader recognizes them once at OPEN. */
export function lifecycleFillEconomics(
  order: Pick<OrderRow, "symbol" | "side">,
  fill: Pick<FillRow, "quantity" | "price" | "fee" | "feeAsset">,
) {
  if (
    compareDecimal(fill.quantity, "0") <= 0 ||
    compareDecimal(fill.price, "0") <= 0 ||
    compareDecimal(fill.fee, "0") < 0
  )
    throw new Error("[trader/lifecycle] FILL_ECONOMICS_INVALID");
  if (compareDecimal(fill.fee, "0") === 0)
    return { inventoryQuantity: fill.quantity, nativeFee: "0", quoteFee: "0" };
  const symbol = order.symbol.toUpperCase();
  const pair =
    /^([A-Z0-9]+)[/_-]([A-Z0-9]+)$/.exec(symbol) ??
    /^([A-Z0-9]+?)(USDT|USDC|USD|BTC|ETH|EUR)$/.exec(symbol);
  const asset = fill.feeAsset.toUpperCase();
  if (!pair || (asset !== pair[1] && asset !== pair[2]))
    throw new Error("[trader/lifecycle] FEE_ASSET_UNCONVERTIBLE");
  const baseFee = asset === pair[1];
  const inventoryQuantity = baseFee
    ? order.side === "buy"
      ? subtractDecimal(fill.quantity, fill.fee)
      : addDecimal(fill.quantity, fill.fee)
    : fill.quantity;
  if (compareDecimal(inventoryQuantity, "0") <= 0)
    throw new Error("[trader/lifecycle] NET_QUANTITY_INVALID");
  return {
    inventoryQuantity,
    nativeFee: fill.fee,
    quoteFee: baseFee ? multiplyDecimal(fill.fee, fill.price) : fill.fee,
  };
}

/** Allocate against the remaining quantity, giving the final lot the exact residual. */
export function allocateLifecycleFee(
  feeRemaining: string,
  quantity: string,
  quantityRemaining: string,
): string {
  return formatDecimal(
    (parseDecimal(feeRemaining) * parseDecimal(quantity)) / parseDecimal(quantityRemaining),
  );
}
