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

/**
 * Irregular IS series. Mean stays under 3% per trade and the date-level
 * t-statistic stays well above 1e-6 so §11 does not force an audit.
 */
export function passingIsDateNets(year: number): StrategyAdmissionObservation[] {
  const pattern = ["0.021", "0.004", "-0.011", "0.016", "0.002", "-0.008", "0.013", "0.007"];
  const months = [1, 4, 7, 10];
  const rows: StrategyAdmissionObservation[] = [];
  for (const month of months) {
    for (let offset = 0; offset < pattern.length; offset += 1) {
      const date = new Date(Date.UTC(year, month - 1, 10 + offset));
      rows.push({
        utcDate: date.toISOString().slice(0, 10),
        net: pattern[offset]!,
      });
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
