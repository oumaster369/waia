import { compareDecimal } from "@/lib/trader/risk/numeric";
import { LIFECYCLE_FEE_ACCOUNTING_VERSION } from "@/lib/trader/lifecycle/fill-fee-economics";
type Row = Record<string, unknown>;
export function verifiedCloseFee(row: Row): string | null {
  if (row.kind !== "CLOSE_FILL" || !Array.isArray(row.fee_evidence)) return null;
  for (const payload of row.fee_evidence) {
    try {
      const evidence = JSON.parse(String(payload));
      if (
        evidence.feeAccountingVersion === LIFECYCLE_FEE_ACCOUNTING_VERSION &&
        evidence.legId === row.leg_id &&
        compareDecimal(
          String(evidence.nativeFee),
          String(row.fee)
            .replace(/(\.\d*?)0+$/, "$1")
            .replace(/\.$/, ""),
        ) === 0 &&
        compareDecimal(
          String(evidence.inventoryQuantity),
          String(row.quantity)
            .replace(/(\.\d*?)0+$/, "$1")
            .replace(/\.$/, ""),
        ) === 0 &&
        compareDecimal(String(evidence.quoteFee), "0") >= 0
      )
        return String(evidence.quoteFee);
    } catch {
      /* malformed or foreign evidence does not authorize reinterpretation */
    }
  }
  return null;
}
