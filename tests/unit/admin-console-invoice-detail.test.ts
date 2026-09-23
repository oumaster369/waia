import { describe, expect, it } from "vitest";

import {
  checkFeeChain,
  type FeeChainInput,
} from "@/lib/trader/admin-console/billing/fee-chain-check";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

function valid(): FeeChainInput {
  const previousCumulative = "1000";
  const periodProfit = "100";
  const cumulative = addDecimal(previousCumulative, periodProfit);
  const previousHwm = "1000";
  const newProfitAboveHwm = subtractDecimal(cumulative, previousHwm);
  const feeRate = "0.30";
  const performanceFee = multiplyDecimal(newProfitAboveHwm, feeRate);
  return {
    previousCumulative,
    periodProfit,
    cumulative,
    previousHwm,
    newProfitAboveHwm,
    feeRate,
    performanceFee,
    billable: true,
    minFeeThreshold: "10.00",
    ledgerPreviousHwm: previousHwm,
  };
}

describe("admin console invoice detail", () => {
  it("accepts a consistent stored chain and names the broken link without using trades", () => {
    expect(checkFeeChain(valid()).ok).toBe(true);
    expect(checkFeeChain({ ...valid(), cumulative: "9999" })).toMatchObject({
      ok: false,
      link: "кумулятивный результат",
    });
    expect(checkFeeChain({ ...valid(), newProfitAboveHwm: "1" })).toMatchObject({
      ok: false,
      link: "прибыль над HWM",
    });
    expect(checkFeeChain({ ...valid(), performanceFee: "1" })).toMatchObject({
      ok: false,
      link: "комиссия",
    });
    expect(checkFeeChain({ ...valid(), billable: false })).toMatchObject({
      ok: false,
      link: "порог",
    });
    expect(checkFeeChain({ ...valid(), ledgerPreviousHwm: "1" })).toMatchObject({
      ok: false,
      link: "HWM",
    });
  });
});
