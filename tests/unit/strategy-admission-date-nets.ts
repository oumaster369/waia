import type { StrategyAdmissionObservation } from "@/lib/trader/research/strategy-admission-v1";

export const STRATEGY_ADMISSION_SPEC_SHA256 = "ab".repeat(32);

export function admissionDateNets(
  year: number,
  net: string,
  perQuarter = 8,
): StrategyAdmissionObservation[] {
  const months = [1, 4, 7, 10];
  const rows: StrategyAdmissionObservation[] = [];
  for (const month of months) {
    for (let offset = 0; offset < perQuarter; offset += 1) {
      const date = new Date(Date.UTC(year, month - 1, 10 + offset));
      rows.push({ utcDate: date.toISOString().slice(0, 10), net });
    }
  }
  return rows;
}

export function countsForDateNets(nets: readonly StrategyAdmissionObservation[]) {
  return {
    sampleSize: nets.length,
    distinctDayCount: new Set(nets.map((row) => row.utcDate)).size,
    positiveTradeCount: nets.filter((row) => Number(row.net) > 0).length,
    nonZeroTradeCount: nets.filter((row) => Number(row.net) !== 0).length,
    dateNets: nets,
  };
}
