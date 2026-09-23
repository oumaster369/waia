import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type FeeChainInput = {
  previousCumulative: string;
  periodProfit: string;
  cumulative: string;
  previousHwm: string;
  newProfitAboveHwm: string;
  feeRate: string;
  performanceFee: string;
  billable: boolean;
  minFeeThreshold: string;
  ledgerPreviousHwm: string;
};

export function checkFeeChain(input: FeeChainInput): { ok: true } | { ok: false; link: string } {
  if (
    compareDecimal(input.cumulative, addDecimal(input.previousCumulative, input.periodProfit)) !== 0
  ) {
    return { ok: false, link: "кумулятивный результат" };
  }
  const profit =
    compareDecimal(input.cumulative, input.previousHwm) > 0
      ? subtractDecimal(input.cumulative, input.previousHwm)
      : "0";
  if (compareDecimal(input.newProfitAboveHwm, profit) !== 0) {
    return { ok: false, link: "прибыль над HWM" };
  }
  if (
    compareDecimal(
      input.performanceFee,
      multiplyDecimal(input.newProfitAboveHwm, input.feeRate),
    ) !== 0
  ) {
    return { ok: false, link: "комиссия" };
  }
  const billable = compareDecimal(input.performanceFee, input.minFeeThreshold) >= 0;
  if (input.billable !== billable) return { ok: false, link: "порог" };
  if (compareDecimal(input.previousHwm, input.ledgerPreviousHwm) !== 0) {
    return { ok: false, link: "HWM" };
  }
  return { ok: true };
}
