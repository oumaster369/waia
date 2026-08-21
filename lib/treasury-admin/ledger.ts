import type { AccountingStatus } from "@/lib/treasury-admin/publication";
import { formatAtomicToHumanDecimal } from "@/lib/treasury-admin/parse-human-amount";

export const TREASURY_ACCOUNTING_DECIMALS = 6;

export type SignedAmountResult =
  | { ok: true; micros: string; magnitudeMicros: string; direction: "INFLOW" | "OUTFLOW" }
  | { ok: false; message: string };

const SIGNED_DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Exact Human signed amount -> accounting micros. String/BigInt only. */
export function parseHumanSignedAmount(raw: string): SignedAmountResult {
  const value = raw.trim();
  if (!value) return { ok: false, message: "Enter an amount." };
  if (/[eE,\s]/.test(value)) {
    return { ok: false, message: "Use a plain signed decimal without spaces or separators." };
  }
  const match = SIGNED_DECIMAL.exec(value);
  if (!match) {
    return { ok: false, message: "Use a plain amount such as 125.50 or -40.00." };
  }
  const fraction = match[3] ?? "";
  if (fraction.length > TREASURY_ACCOUNTING_DECIMALS) {
    return { ok: false, message: "Amount accepts at most 6 decimal places; it is never rounded." };
  }
  const magnitudeText = `${match[2]}${fraction.padEnd(TREASURY_ACCOUNTING_DECIMALS, "0")}`;
  const magnitude = BigInt(magnitudeText);
  if (magnitude === 0n) return { ok: false, message: "Amount must not be zero." };
  const outgoing = match[1] === "-";
  return {
    ok: true,
    micros: `${outgoing ? "-" : ""}${magnitude.toString(10)}`,
    magnitudeMicros: magnitude.toString(10),
    direction: outgoing ? "OUTFLOW" : "INFLOW",
  };
}

export function signedAmountLabel(micros: string | null): string {
  if (micros === null) return "Pending";
  return formatAtomicToHumanDecimal(micros, TREASURY_ACCOUNTING_DECIMALS);
}

export function accountingStatusLabel(status: AccountingStatus): string {
  if (status === "VERIFIED") return "Verified";
  if (status === "PLANNED") return "Planned";
  if (status === "REJECTED") return "Rejected";
  if (status === "DUPLICATE") return "Duplicate";
  return "Requires review";
}

export function formatOccurredAt(value: string | null): { date: string; time: string } {
  if (!value) return { date: "Pending", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: value, time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(parsed),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed),
  };
}
