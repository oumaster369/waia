import { describe, expect, it } from "vitest";

import { fifoAllocationPolicy } from "@/lib/trader/settlement/allocation-policy";
import {
  buildSettlementRecordPayload,
  verifySettlementRecordDigest,
} from "@/lib/trader/settlement/serialize-settlement";
import {
  evaluateSettlement,
  amountsMatchWithinTolerance,
} from "@/lib/trader/settlement/settlement-matching";
import { settlementExceptionReasons } from "@/lib/trader/settlement/settlement.types";
import { parityUsdtUsdValuation } from "@/lib/trader/settlement/valuation-policy";

const BASE_PAYMENT = {
  paymentId: "pay-1",
  organizationId: "org-1",
  subjectModule: "trader" as const,
  settlementNetwork: "TRC-20",
  settlementAsset: "USDT",
  settlementAmount: "150.000000",
  settlementTxHash: "tx-1",
  transferIndex: 0,
  blockHeight: "100",
  paymentAddressId: "addr-1",
  exchangeAccountId: "acct-1",
  updatedAt: new Date("2026-06-26T10:00:00.000Z"),
};

describe("settlement policies + matching", () => {
  it("values canonical USDT TRC-20 at 1:1 USD parity", () => {
    const result = parityUsdtUsdValuation({
      settlementNetwork: "TRC-20",
      settlementAsset: "USDT",
      onChainAmount: "150.000000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valuedAmount).toBe("150.000000");
      expect(result.valuationCurrency).toBe("USD");
    }
  });

  it("declines unsupported assets", () => {
    const result = parityUsdtUsdValuation({
      settlementNetwork: "TRC-20",
      settlementAsset: "USDC",
      onChainAmount: "150.000000",
    });
    expect(result.ok).toBe(false);
  });

  it("declines when multiple ISSUED invoices exist", () => {
    const result = fifoAllocationPolicy([
      {
        id: "inv-1",
        organizationId: "org-1",
        exchangeAccountId: "acct-1",
        performanceFee: "150.000000",
        status: "ISSUED",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
      },
      {
        id: "inv-2",
        organizationId: "org-1",
        exchangeAccountId: "acct-1",
        performanceFee: "150.000000",
        status: "ISSUED",
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(settlementExceptionReasons.multipleCandidateInvoices);
    }
  });

  it("classifies exact match as APPLIED", () => {
    const evaluation = evaluateSettlement({
      payment: BASE_PAYMENT,
      candidates: [
        {
          id: "inv-1",
          organizationId: "org-1",
          exchangeAccountId: "acct-1",
          performanceFee: "150.000000",
          status: "ISSUED",
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
    });
    expect(evaluation.outcome).toBe("APPLIED");
    expect(evaluation.invoiceId).toBe("inv-1");
  });

  it("classifies underpayment as EXCEPTION", () => {
    const evaluation = evaluateSettlement({
      payment: { ...BASE_PAYMENT, settlementAmount: "100.000000" },
      candidates: [
        {
          id: "inv-1",
          organizationId: "org-1",
          exchangeAccountId: "acct-1",
          performanceFee: "150.000000",
          status: "ISSUED",
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
    });
    expect(evaluation.outcome).toBe("EXCEPTION");
    expect(evaluation.exceptionReason).toBe(settlementExceptionReasons.amountMismatch);
  });

  it("compares amounts within tolerance", () => {
    expect(amountsMatchWithinTolerance("150.000000", "150.00000000", "0")).toBe(true);
    expect(amountsMatchWithinTolerance("150.000001", "150.00000000", "0")).toBe(false);
  });

  it("serializes and verifies settlement record digests", () => {
    const payload = buildSettlementRecordPayload({
      organizationId: "org-1",
      exchangeAccountId: "acct-1",
      paymentId: "pay-1",
      settlementNetwork: "TRC-20",
      settlementTxHash: "tx-1",
      transferIndex: 0,
      blockHeight: "100",
      asset: "USDT",
      onChainAmount: "150.000000",
      valuedAmount: "150.000000",
      valuationCurrency: "USD",
      valuationBasis: "usdt_usd_parity.v1",
      outcome: "APPLIED",
      exceptionReason: null,
      prevEventDigest: null,
    });
    expect(payload.recordContentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifySettlementRecordDigest(payload)).not.toThrow();
  });
});
