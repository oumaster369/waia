import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseDecimal } from "@/lib/trader/risk/numeric";
import { applyHolmAdjustment } from "@/lib/trader/research-v2/multiple-testing-holm-v2";

/**
 * Strategy admission v1 (docs/ai-trader/specs/strategy-admission-v1.md).
 *
 * The verdict is computed only here. Callers cannot supply it. This module
 * never returns `admitted` — that remains an explicit human decision.
 *
 * Research-v2 backtests still charge the canonical 20 bps fee and 15 bps
 * slippage. The spec's 0.7% / 0.4% / 0.2% round-trip grid is not applied here.
 */

export const STRATEGY_ADMISSION_EVENT_IS_MIN_EVENTS = 30 as const;
export const STRATEGY_ADMISSION_EVENT_IS_MIN_DATES = 15 as const;
export const STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_EVENTS = 20 as const;
export const STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_DATES = 10 as const;
export const STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES = 30 as const;
export const STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES_INTRADAY = 100 as const;
export const STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES = 15 as const;
export const STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES_INTRADAY = 50 as const;
export const STRATEGY_ADMISSION_MIN_QUARTERS = 4 as const;
export const STRATEGY_ADMISSION_IS_MIN_YEAR_MS = 730 * 24 * 60 * 60 * 1000;
export const STRATEGY_ADMISSION_ALPHA = 0.05 as const;
export const STRATEGY_ADMISSION_VALIDATION_MIN_T = 1.645 as const;
export const STRATEGY_ADMISSION_DSR_MIN = 0.95 as const;
export const STRATEGY_ADMISSION_DSR_FAMILY_MIN = 50 as const;
/** §11: net above this per trade is too good to accept without an audit. */
export const STRATEGY_ADMISSION_AUDIT_NET_PER_TRADE = 0.03 as const;
export const STRATEGY_ADMISSION_AUDIT_P_RAW = 1e-6 as const;
export const STRATEGY_ADMISSION_AUDIT_IS_SHARPE = 3 as const;
export const STRATEGY_ADMISSION_QUARTER_POSITIVE_FRACTION = 0.75 as const;
export const STRATEGY_ADMISSION_YEAR_POSITIVE_FRACTION = 2 / 3;

export function defaultStrategyAdmissionJournalPath(): string {
  const configured = process.env.WAIA_STRATEGY_ADMISSION_JOURNAL_PATH?.trim();
  return configured && configured.length > 0
    ? configured
    : "var/waia/strategy-admission-journal.jsonl";
}

/** Stable hypothesis identity. Campaign id is not part of the key. */
export function strategyAdmissionHypothesisId(
  specSha256: string,
  params: Readonly<Record<string, string>>,
): string {
  const configParams: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    configParams[key] = params[key] ?? "";
  }
  return createHash("sha256").update(JSON.stringify({ specSha256, configParams })).digest("hex");
}

/** Spec §7: Holm must be strictly below alpha. p = 0.05 does not pass. */
export function strategyAdmissionHolmPasses(pHolm: number): boolean {
  return pHolm < STRATEGY_ADMISSION_ALPHA;
}

const SPEC_SHA256 = /^[0-9a-f]{64}$/;
const UTC_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EULER = 0.5772156649015329;

export type StrategyAdmissionSplit = "is" | "validation" | "holdout";
export type StrategyAdmissionKind = "event" | "continuous";
export type StrategyAdmissionSide = "long" | "short" | "two_sided";
export type StrategyAdmissionVerdict =
  | "candidate"
  | "rejected"
  | "passed_is"
  | "passed_validation"
  | "insufficient_data"
  | "audit_required";

export type StrategyAdmissionObservation = Readonly<{
  utcDate: string;
  net: string;
}>;

export type StrategyAdmissionTrial = Readonly<{
  hypothesisId: string;
  observations: readonly StrategyAdmissionObservation[];
}>;

export type StrategyAdmissionInput = Readonly<{
  specSha256: string;
  declaredFamilySize: number;
  kind: StrategyAdmissionKind;
  intraday: boolean;
  sideDeclared: StrategyAdmissionSide;
  horizonBars: number;
  split: Exclude<StrategyAdmissionSplit, "holdout">;
  trials: readonly StrategyAdmissionTrial[];
  confirmatoryIndex: number;
  /** Append-only journal that already holds this spec's family registration. */
  journal: AppendOnlyStrategyAdmissionJournal;
  symbol?: string;
  fundingMean?: string | null;
  usedForDiscovery: boolean;
  signalBarCloseUtc: string;
  entryTimeUtc: string;
  /** Minutes per bar. Horizon is converted to a date lag. Default 1. */
  barIntervalMinutes?: number;
  /**
   * Recompute a sealed record. Does not require a prior family registration
   * and does not consume a split.
   */
  replay?: boolean;
}>;

export type StrategyAdmissionFamilyTrial = Readonly<{
  trialIndex: number;
  hypothesisId: string;
  rawPValue: string;
  adjustedPValue: string;
  holmRank: number;
}>;

export type StrategyAdmissionAssessment = Readonly<{
  verdict: StrategyAdmissionVerdict;
  reasons: readonly string[];
  flags: readonly string[];
  nEvents: number;
  nDates: number;
  netMeanEvent: string;
  netMeanDate: string;
  seMethod: "newey_west";
  nwLag: number;
  t: string;
  pRaw: string;
  pHolm: string;
  ci95Low: string;
  ci95High: string;
  withoutBestDate: string;
  bestDate: string;
  byQuarter: Readonly<Record<string, string>>;
  familySize: number;
  dsr: string | null;
  familyTrials: readonly StrategyAdmissionFamilyTrial[];
}>;

export class StrategyAdmissionError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "StrategyAdmissionError";
    this.code = code;
  }
}

export type StrategyAdmissionJournalRow = Readonly<{
  rowIndex: number;
  correctsRowIndex: number | null;
  hypothesisId: string;
  specSha256: string;
  split: StrategyAdmissionSplit;
  familySize: number;
  configParamsJson: string;
  nEvents: number;
  nDates: number;
  netMeanDate: string;
  seMethod: "newey_west";
  nwLag: number;
  t: string;
  pRaw: string;
  pHolm: string;
  verdict: StrategyAdmissionVerdict;
  verdictReason: string;
  flags: readonly string[];
  countsAsSplitUse: boolean;
  direction: string;
  directionTrialOrdinal: number;
}>;

type StrategyAdmissionJournalLine =
  | {
      recordType: "family_registration";
      specSha256: string;
      familySize: number;
    }
  | {
      recordType: "run";
      row: Omit<StrategyAdmissionJournalRow, "rowIndex" | "directionTrialOrdinal">;
    };

/**
 * Append-only per-configuration journal. Corrections are new rows.
 * A durable journal is a JSONL file. In-memory journals are not accepted
 * for a validation consume.
 */
export class AppendOnlyStrategyAdmissionJournal {
  protected readonly rows: StrategyAdmissionJournalRow[] = [];
  protected readonly families = new Map<string, number>();
  durable = false;
  private filePath: string | null = null;

  /**
   * Opens a JSONL journal, creating it when missing.
   * Fails closed when the path cannot be created or read.
   */
  static openDurable(filePath: string): AppendOnlyStrategyAdmissionJournal {
    if (!filePath.trim()) {
      throw new StrategyAdmissionError("admission_journal_unavailable", "journal path is empty");
    }
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      try {
        writeFileSync(filePath, "", { flag: "wx" });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
      }
      const raw = readFileSync(filePath, "utf8");
      const journal = new AppendOnlyStrategyAdmissionJournal();
      journal.load(raw);
      journal.filePath = filePath;
      journal.durable = true;
      return journal;
    } catch (error) {
      if (error instanceof StrategyAdmissionError) throw error;
      throw new StrategyAdmissionError(
        "admission_journal_unavailable",
        error instanceof Error ? error.message : "journal unavailable",
      );
    }
  }

  list(): readonly StrategyAdmissionJournalRow[] {
    return this.rows;
  }

  registeredFamilySize(specSha256: string): number | null {
    return this.families.get(specSha256) ?? null;
  }

  /** Idempotent for the same size. A different size is a conflict. */
  registerFamily(specSha256: string, familySize: number): void {
    if (!SPEC_SHA256.test(specSha256)) {
      throw new StrategyAdmissionError("spec_sha256_required");
    }
    if (!Number.isSafeInteger(familySize) || familySize < 1) {
      throw new StrategyAdmissionError("declared_family_size_required");
    }
    const existing = this.families.get(specSha256);
    if (existing !== undefined) {
      if (existing !== familySize) {
        throw new StrategyAdmissionError(
          "family_size_mismatch",
          `registered family is ${existing}, caller declared ${familySize}`,
        );
      }
      return;
    }
    this.persist({ recordType: "family_registration", specSha256, familySize });
    this.families.set(specSha256, familySize);
  }

  append(
    row: Omit<StrategyAdmissionJournalRow, "rowIndex" | "directionTrialOrdinal" | "direction"> & {
      direction?: string;
    },
  ): StrategyAdmissionJournalRow {
    const direction = row.direction ?? "strategy";
    const directionTrialOrdinal =
      this.rows.filter((existing) => existing.direction === direction).length + 1;
    const stored = Object.freeze({
      ...row,
      direction,
      rowIndex: this.rows.length,
      directionTrialOrdinal,
      flags: Object.freeze([...row.flags]),
    });
    const { rowIndex: _rowIndex, directionTrialOrdinal: _ordinal, ...persisted } = stored;
    void _rowIndex;
    void _ordinal;
    this.persist({
      recordType: "run",
      row: { ...persisted, flags: [...stored.flags] },
    });
    this.rows.push(stored);
    return stored;
  }

  splitUseCount(input: {
    specSha256: string;
    hypothesisId: string;
    split: "validation" | "holdout";
  }): number {
    return this.rows.filter(
      (row) =>
        row.specSha256 === input.specSha256 &&
        row.hypothesisId === input.hypothesisId &&
        row.split === input.split &&
        row.countsAsSplitUse,
    ).length;
  }

  assertSplitAvailable(input: {
    specSha256: string;
    hypothesisId: string;
    split: "validation" | "holdout";
  }): void {
    if (this.splitUseCount(input) >= 1) {
      throw new StrategyAdmissionError(
        "split_already_used",
        `${input.split} already used for ${input.hypothesisId}`,
      );
    }
  }

  protected persist(line: StrategyAdmissionJournalLine): void {
    if (!this.filePath) return;
    try {
      appendFileSync(this.filePath, `${JSON.stringify(line)}\n`, "utf8");
    } catch (error) {
      throw new StrategyAdmissionError(
        "admission_journal_unavailable",
        error instanceof Error ? error.message : "journal append failed",
      );
    }
  }

  protected load(raw: string): void {
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: StrategyAdmissionJournalLine;
      try {
        parsed = JSON.parse(trimmed) as StrategyAdmissionJournalLine;
      } catch {
        throw new StrategyAdmissionError(
          "admission_journal_unavailable",
          "journal line is not JSON",
        );
      }
      if (parsed.recordType === "family_registration") {
        const existing = this.families.get(parsed.specSha256);
        if (existing !== undefined && existing !== parsed.familySize) {
          throw new StrategyAdmissionError("family_size_mismatch");
        }
        this.families.set(parsed.specSha256, parsed.familySize);
        continue;
      }
      if (parsed.recordType !== "run" || !parsed.row) {
        throw new StrategyAdmissionError(
          "admission_journal_unavailable",
          "journal line has an unknown record type",
        );
      }
      const direction = parsed.row.direction ?? "strategy";
      const directionTrialOrdinal =
        this.rows.filter((existing) => existing.direction === direction).length + 1;
      this.rows.push(
        Object.freeze({
          ...parsed.row,
          direction,
          rowIndex: this.rows.length,
          directionTrialOrdinal,
          flags: Object.freeze([...(parsed.row.flags ?? [])]),
        }),
      );
    }
  }
}

export function assertNoLookaheadEntry(input: {
  signalBarCloseUtc: string;
  entryTimeUtc: string;
}): void {
  const signal = Date.parse(input.signalBarCloseUtc);
  const entry = Date.parse(input.entryTimeUtc);
  if (!Number.isFinite(signal) || !Number.isFinite(entry) || entry <= signal) {
    throw new StrategyAdmissionError(
      "look_ahead_entry",
      "entry must be after the signal bar close (default: next bar open)",
    );
  }
}

/** Positive funding is paid by a long. Returns the amount to subtract from net. */
export function perpFundingDebit(input: { symbol?: string; fundingMean?: string | null }): number {
  const symbol = input.symbol ?? "";
  const perp = /perp|swap/i.test(symbol);
  if (!perp) return 0;
  if (input.fundingMean === undefined || input.fundingMean === null || input.fundingMean === "") {
    throw new StrategyAdmissionError(
      "perp_funding_required",
      "perp observations require recorded funding",
    );
  }
  try {
    parseDecimal(input.fundingMean);
  } catch {
    throw new StrategyAdmissionError(
      "perp_funding_required",
      "perp funding must be a finite number and is subtracted from net",
    );
  }
  const value = Number(input.fundingMean);
  if (!Number.isFinite(value)) {
    throw new StrategyAdmissionError(
      "perp_funding_required",
      "perp funding must be a finite number and is subtracted from net",
    );
  }
  return value;
}

export function assertPerpFundingRecorded(input: {
  symbol?: string;
  fundingMean?: string | null;
}): void {
  perpFundingDebit(input);
}

export function standardNormalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Acklam rational approximation, sufficient for the deflated-Sharpe threshold. */
export function standardNormalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new StrategyAdmissionError("p_value_invalid");
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** Lanczos approximation of ln Γ(z). */
function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const shifted = z - 1;
  let series = 0.99999999999980993;
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index]! / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function betacf(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const tiny = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betacf(a, b, x)) / a;
  }
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** One-sided upper tail of Student t with `df` degrees of freedom. */
export function studentTOneSidedUpperTail(t: number, df: number): number {
  if (t === Number.POSITIVE_INFINITY) return 0;
  if (t === Number.NEGATIVE_INFINITY) return 1;
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  const x = df / (df + t * t);
  const survival = regularizedIncompleteBeta(x, df / 2, 0.5);
  if (t >= 0) return Math.min(1, survival / 2);
  return Math.min(1, 1 - survival / 2);
}

function formatStat(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return "inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  if (!Number.isFinite(value)) return "nan";
  return value.toFixed(8);
}

function parseNet(net: string): number {
  parseDecimal(net);
  const value = Number(net);
  if (!Number.isFinite(value)) {
    throw new StrategyAdmissionError("observation_invalid");
  }
  return value;
}

function quarterKey(utcDate: string): string {
  const match = UTC_DATE.exec(utcDate);
  if (!match) throw new StrategyAdmissionError("observation_invalid");
  const month = Number(match[2]);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${match[1]}-Q${quarter}`;
}

function dateMs(utcDate: string): number {
  const parsed = Date.parse(`${utcDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new StrategyAdmissionError("observation_invalid");
  return parsed;
}

type DatePoint = { utcDate: string; mean: number; count: number };

function aggregateByDate(observations: readonly StrategyAdmissionObservation[]): {
  events: number[];
  dates: DatePoint[];
} {
  const buckets = new Map<string, number[]>();
  const events: number[] = [];
  for (const observation of observations) {
    if (!UTC_DATE.test(observation.utcDate)) {
      throw new StrategyAdmissionError("observation_invalid");
    }
    const net = parseNet(observation.net);
    events.push(net);
    const bucket = buckets.get(observation.utcDate) ?? [];
    bucket.push(net);
    buckets.set(observation.utcDate, bucket);
  }
  const dates = [...buckets.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([utcDate, nets]) => ({
      utcDate,
      mean: nets.reduce((sum, value) => sum + value, 0) / nets.length,
      count: nets.length,
    }));
  return { events, dates };
}

/**
 * Newey–West lag on a date-aggregated series, in dates.
 * Horizon bars are converted to calendar days, then ceiled and capped at n−1.
 */
export function neweyWestDateLag(input: {
  horizonBars: number;
  barIntervalMinutes: number;
  nDates: number;
}): number {
  if (!Number.isFinite(input.barIntervalMinutes) || input.barIntervalMinutes <= 0) {
    throw new StrategyAdmissionError("bar_interval_invalid");
  }
  const days = Math.ceil((input.horizonBars * input.barIntervalMinutes) / 1440);
  const lag = Math.max(1, days);
  const cap = Math.max(0, input.nDates - 1);
  return Math.min(lag, cap);
}

function neweyWestMean(
  values: readonly number[],
  lag: number,
): { mean: number; se: number; t: number; lagUsed: number } {
  const count = values.length;
  if (count < 1) return { mean: 0, se: 0, t: 0, lagUsed: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  if (count === 1) {
    return {
      mean,
      se: 0,
      t: mean > 0 ? Number.POSITIVE_INFINITY : mean < 0 ? Number.NEGATIVE_INFINITY : 0,
      lagUsed: 0,
    };
  }
  const demeaned = values.map((value) => value - mean);
  const gamma = (step: number) => {
    let sum = 0;
    for (let index = step; index < count; index += 1) {
      sum += demeaned[index]! * demeaned[index - step]!;
    }
    return sum / count;
  };
  const maxLag = Math.max(0, Math.min(Math.floor(lag), count - 1));
  let hac = gamma(0);
  for (let step = 1; step <= maxLag; step += 1) {
    const weight = 1 - step / (maxLag + 1);
    hac += 2 * weight * gamma(step);
  }
  const se = Math.sqrt(Math.max(hac, 0) / count);
  const t =
    se === 0
      ? mean > 0
        ? Number.POSITIVE_INFINITY
        : mean < 0
          ? Number.NEGATIVE_INFINITY
          : 0
      : mean / se;
  return { mean, se, t, lagUsed: maxLag };
}

function normalUpperTail(t: number): number {
  if (t === Number.POSITIVE_INFINITY) return 0;
  if (t === Number.NEGATIVE_INFINITY) return 1;
  return 1 - standardNormalCdf(t);
}

function oneSidedP(t: number, side: StrategyAdmissionSide, df: number | null): number {
  const upper = df === null ? normalUpperTail(t) : studentTOneSidedUpperTail(t, df);
  if (side === "two_sided") {
    return Math.min(1, 2 * Math.min(upper, 1 - upper));
  }
  return upper;
}

function sampleThresholds(input: StrategyAdmissionInput): { minEvents: number; minDates: number } {
  if (input.kind === "event") {
    return input.split === "is"
      ? {
          minEvents: STRATEGY_ADMISSION_EVENT_IS_MIN_EVENTS,
          minDates: STRATEGY_ADMISSION_EVENT_IS_MIN_DATES,
        }
      : {
          minEvents: STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_EVENTS,
          minDates: STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_DATES,
        };
  }
  const intradayIs = input.intraday
    ? STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES_INTRADAY
    : STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES;
  const intradayValidation = input.intraday
    ? STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES_INTRADAY
    : STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES;
  return {
    minEvents: input.split === "is" ? intradayIs : intradayValidation,
    minDates: input.kind === "continuous" ? 1 : 0,
  };
}

function sharpeMoments(values: readonly number[]): { sr: number; skew: number; kurt: number } {
  const count = values.length;
  if (count < 2) return { sr: 0, skew: 0, kurt: 3 };
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const demeaned = values.map((value) => value - mean);
  const variance = demeaned.reduce((sum, value) => sum + value * value, 0) / (count - 1);
  const std = Math.sqrt(variance);
  if (!(std > 1e-12)) {
    return {
      sr: mean > 0 ? Number.POSITIVE_INFINITY : mean < 0 ? Number.NEGATIVE_INFINITY : 0,
      skew: 0,
      kurt: 3,
    };
  }
  const skew = demeaned.reduce((sum, value) => sum + value ** 3, 0) / count / std ** 3;
  const kurt = demeaned.reduce((sum, value) => sum + value ** 4, 0) / count / std ** 4;
  return { sr: mean / std, skew, kurt };
}

function srEstimationVariance(
  moments: { sr: number; skew: number; kurt: number },
  count: number,
): number {
  const numerator =
    1 - moments.skew * moments.sr + ((moments.kurt - 1) / 4) * moments.sr * moments.sr;
  return Math.max(numerator, 0) / (count - 1);
}

function deflatedSharpe(input: {
  confirmatory: readonly number[];
  trialSeries: readonly (readonly number[])[];
  familySize: number;
}): number {
  const moments = sharpeMoments(input.confirmatory);
  // A zero-std series has a non-finite Sharpe. That is not a pass.
  if (!Number.isFinite(moments.sr)) return 0;
  const count = input.confirmatory.length;
  if (count < 2 || input.familySize < 2) return 0;
  const trialSharpes = input.trialSeries
    .map((series) => sharpeMoments(series).sr)
    .filter((value) => Number.isFinite(value));
  const crossSectional = (() => {
    if (trialSharpes.length < 2) return Number.NaN;
    const mean = trialSharpes.reduce((sum, value) => sum + value, 0) / trialSharpes.length;
    return (
      trialSharpes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (trialSharpes.length - 1)
    );
  })();
  // Identical trials (or an undefined cross-section) use Bailey–López de Prado SR variance.
  const variance =
    Number.isFinite(crossSectional) && crossSectional > 0
      ? crossSectional
      : srEstimationVariance(moments, count);
  const n = input.familySize;
  const sr0 =
    Math.sqrt(Math.max(variance, 0)) *
    ((1 - EULER) * standardNormalQuantile(1 - 1 / n) +
      EULER * standardNormalQuantile(1 - 1 / (n * Math.E)));
  const denom = Math.sqrt(
    Math.max(
      1e-12,
      1 - moments.skew * moments.sr + ((moments.kurt - 1) / 4) * moments.sr * moments.sr,
    ),
  );
  const z = ((moments.sr - sr0) * Math.sqrt(count - 1)) / denom;
  return standardNormalCdf(z);
}

function signedObservations(
  observations: readonly StrategyAdmissionObservation[],
  side: StrategyAdmissionSide,
): StrategyAdmissionObservation[] {
  if (side !== "short") return [...observations];
  return observations.map((observation) => ({
    utcDate: observation.utcDate,
    net: formatStat(-parseNet(observation.net)),
  }));
}

export function assessStrategyAdmission(
  input: StrategyAdmissionInput,
): StrategyAdmissionAssessment {
  if (!SPEC_SHA256.test(input.specSha256)) {
    throw new StrategyAdmissionError(
      "spec_sha256_required",
      "a pre-registered spec_sha256 is required before a run",
    );
  }
  if (!Number.isSafeInteger(input.declaredFamilySize) || input.declaredFamilySize < 1) {
    throw new StrategyAdmissionError("declared_family_size_required");
  }
  if (!input.replay) {
    const registered = input.journal.registeredFamilySize(input.specSha256);
    if (registered === null) {
      throw new StrategyAdmissionError(
        "family_size_not_preregistered",
        "family size must be registered before the run",
      );
    }
    if (registered !== input.declaredFamilySize) {
      throw new StrategyAdmissionError(
        "family_size_mismatch",
        `registered family is ${registered}, caller declared ${input.declaredFamilySize}`,
      );
    }
  }
  if (input.trials.length < 1 || input.trials.length > input.declaredFamilySize) {
    throw new StrategyAdmissionError(
      "family_size_exceeded",
      "evaluated configurations exceed the pre-declared family",
    );
  }
  if (
    !Number.isSafeInteger(input.confirmatoryIndex) ||
    input.confirmatoryIndex < 0 ||
    input.confirmatoryIndex >= input.trials.length
  ) {
    throw new StrategyAdmissionError("confirmatory_trial_invalid");
  }
  if (!Number.isSafeInteger(input.horizonBars) || input.horizonBars < 1) {
    throw new StrategyAdmissionError("horizon_invalid");
  }
  const fundingDebit = perpFundingDebit(input);
  if (typeof input.usedForDiscovery !== "boolean") {
    throw new StrategyAdmissionError(
      "used_for_discovery_required",
      "usedForDiscovery must be declared before the run",
    );
  }
  if (!input.signalBarCloseUtc || !input.entryTimeUtc) {
    throw new StrategyAdmissionError(
      "look_ahead_entry",
      "signal close and entry timestamps are required",
    );
  }
  assertNoLookaheadEntry({
    signalBarCloseUtc: input.signalBarCloseUtc,
    entryTimeUtc: input.entryTimeUtc,
  });
  const barIntervalMinutes = input.barIntervalMinutes ?? 1;

  const flags: string[] = [];
  if (input.usedForDiscovery === true && input.split === "is") {
    flags.push("used_for_discovery");
  }

  const fundedTrials = input.trials.map((trial) =>
    fundingDebit === 0
      ? trial.observations
      : trial.observations.map((observation) => ({
          utcDate: observation.utcDate,
          net: formatStat(parseNet(observation.net) - fundingDebit),
        })),
  );
  const signedTrials = fundedTrials.map((observations) =>
    signedObservations(observations, input.sideDeclared),
  );
  const aggregated = signedTrials.map((observations) => aggregateByDate(observations));
  const dateLagFor = (nDates: number) =>
    neweyWestDateLag({
      horizonBars: input.horizonBars,
      barIntervalMinutes,
      nDates,
    });
  const isPValue = input.split === "is";
  const rawP = aggregated.map((trial) => {
    if (trial.dates.length < 2) return 1;
    const stats = neweyWestMean(
      trial.dates.map((point) => point.mean),
      dateLagFor(trial.dates.length),
    );
    const df = isPValue ? trial.dates.length - 1 : null;
    return oneSidedP(stats.t, input.sideDeclared === "short" ? "long" : input.sideDeclared, df);
  });
  const adjusted = applyHolmAdjustment(
    rawP
      .map((p, index) => (index < rawP.length ? p : 1))
      .concat(Array.from({ length: input.declaredFamilySize - rawP.length }, () => 1)),
  ).slice(0, rawP.length);
  const rankByIndex = new Map<number, number>();
  rawP
    .map((p, index) => ({ p, index }))
    .sort((left, right) => left.p - right.p || left.index - right.index)
    .forEach((entry, rank) => rankByIndex.set(entry.index, rank));

  const confirmatory = aggregated[input.confirmatoryIndex]!;
  const dateMeans = confirmatory.dates.map((point) => point.mean);
  const stats = neweyWestMean(dateMeans, dateLagFor(confirmatory.dates.length));
  const pRaw = rawP[input.confirmatoryIndex] ?? 1;
  const pHolm = adjusted[input.confirmatoryIndex] ?? 1;
  const eventMean =
    confirmatory.events.length === 0
      ? 0
      : confirmatory.events.reduce((sum, value) => sum + value, 0) / confirmatory.events.length;
  const z95 = 1.959963984540054;
  const ciLow = stats.se === 0 ? stats.mean : stats.mean - z95 * stats.se;
  const ciHigh = stats.se === 0 ? stats.mean : stats.mean + z95 * stats.se;

  let bestDate = "";
  let bestMean = Number.NEGATIVE_INFINITY;
  for (const point of confirmatory.dates) {
    if (point.mean > bestMean) {
      bestMean = point.mean;
      bestDate = point.utcDate;
    }
  }
  const withoutBest = confirmatory.dates.filter((point) => point.utcDate !== bestDate);
  const withoutBestMean =
    withoutBest.length === 0
      ? Number.NEGATIVE_INFINITY
      : withoutBest.reduce((sum, point) => sum + point.mean, 0) / withoutBest.length;

  const quarterSums = new Map<string, { sum: number; count: number }>();
  for (const point of confirmatory.dates) {
    const key = quarterKey(point.utcDate);
    const current = quarterSums.get(key) ?? { sum: 0, count: 0 };
    current.sum += point.mean;
    current.count += 1;
    quarterSums.set(key, current);
  }
  const byQuarter: Record<string, string> = {};
  let positiveQuarters = 0;
  for (const [key, value] of [...quarterSums.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const mean = value.sum / value.count;
    byQuarter[key] = formatStat(mean);
    if (mean > 0) positiveQuarters += 1;
  }
  const quarterCount = quarterSums.size;
  const yearMeans = new Map<string, { sum: number; count: number }>();
  for (const point of confirmatory.dates) {
    const year = point.utcDate.slice(0, 4);
    const current = yearMeans.get(year) ?? { sum: 0, count: 0 };
    current.sum += point.mean;
    current.count += 1;
    yearMeans.set(year, current);
  }
  let positiveYears = 0;
  for (const value of yearMeans.values()) {
    if (value.sum / value.count > 0) positiveYears += 1;
  }
  const yearCount = yearMeans.size;
  const negativeYears = yearCount - positiveYears;
  const spanMs =
    confirmatory.dates.length < 2
      ? 0
      : dateMs(confirmatory.dates.at(-1)!.utcDate) - dateMs(confirmatory.dates[0]!.utcDate);
  const spanOk =
    input.split === "validation"
      ? quarterCount >= STRATEGY_ADMISSION_MIN_QUARTERS
      : spanMs >= STRATEGY_ADMISSION_IS_MIN_YEAR_MS ||
        quarterCount >= STRATEGY_ADMISSION_MIN_QUARTERS;

  const thresholds = sampleThresholds(input);
  const sampleOk =
    confirmatory.events.length >= thresholds.minEvents &&
    confirmatory.dates.length >= thresholds.minDates &&
    spanOk;

  const dsr =
    input.declaredFamilySize > STRATEGY_ADMISSION_DSR_FAMILY_MIN
      ? deflatedSharpe({
          confirmatory: dateMeans,
          trialSeries: aggregated.map((trial) => trial.dates.map((point) => point.mean)),
          familySize: input.declaredFamilySize,
        })
      : null;

  const reasons: string[] = [];
  if (!sampleOk) reasons.push("INSUFFICIENT_DATA");
  if (flags.includes("used_for_discovery")) reasons.push("USED_FOR_DISCOVERY_NOT_IN_IS");
  if (sampleOk && stats.mean <= 0) reasons.push("NET_MEAN_DATE_NOT_POSITIVE");
  if (sampleOk && input.split === "is" && !strategyAdmissionHolmPasses(pHolm)) {
    reasons.push("HOLM_ADJUSTED_P_ABOVE_ALPHA");
  }
  if (sampleOk && input.split === "is" && !(withoutBestMean > 0)) {
    reasons.push("WITHOUT_BEST_DATE_NOT_POSITIVE");
  }
  const quarterRule =
    quarterCount >= STRATEGY_ADMISSION_MIN_QUARTERS &&
    positiveQuarters / quarterCount >= STRATEGY_ADMISSION_QUARTER_POSITIVE_FRACTION;
  const yearRule =
    yearCount >= 1 &&
    positiveYears / yearCount >= STRATEGY_ADMISSION_YEAR_POSITIVE_FRACTION &&
    negativeYears <= 1;
  if (sampleOk && !(quarterRule || yearRule)) reasons.push("STABILITY_NOT_MET");
  if (
    sampleOk &&
    input.split === "validation" &&
    !(stats.t >= STRATEGY_ADMISSION_VALIDATION_MIN_T)
  ) {
    reasons.push("VALIDATION_T_BELOW_1_645");
  }
  if (sampleOk && dsr !== null && !(dsr >= STRATEGY_ADMISSION_DSR_MIN)) {
    reasons.push("DEFLATED_SHARPE_NOT_PASSED");
  }
  const isSharpe = sharpeMoments(dateMeans).sr;
  const tooGood =
    input.split === "is" &&
    sampleOk &&
    (eventMean > STRATEGY_ADMISSION_AUDIT_NET_PER_TRADE ||
      pRaw < STRATEGY_ADMISSION_AUDIT_P_RAW ||
      (Number.isFinite(isSharpe) && isSharpe > STRATEGY_ADMISSION_AUDIT_IS_SHARPE) ||
      isSharpe === Number.POSITIVE_INFINITY);
  if (tooGood) reasons.push("AUDIT_REQUIRED");

  let verdict: StrategyAdmissionVerdict;
  if (reasons.includes("INSUFFICIENT_DATA")) verdict = "insufficient_data";
  else if (reasons.includes("AUDIT_REQUIRED")) verdict = "audit_required";
  else if (reasons.length > 0) verdict = "rejected";
  else verdict = input.split === "is" ? "passed_is" : "passed_validation";

  return Object.freeze({
    verdict,
    reasons: Object.freeze(reasons),
    flags: Object.freeze(flags),
    nEvents: confirmatory.events.length,
    nDates: confirmatory.dates.length,
    netMeanEvent: formatStat(eventMean),
    netMeanDate: formatStat(stats.mean),
    seMethod: "newey_west" as const,
    nwLag: stats.lagUsed,
    t: formatStat(stats.t),
    pRaw: formatStat(Math.min(1, Math.max(0, pRaw))),
    pHolm: formatStat(Math.min(1, Math.max(0, pHolm))),
    ci95Low: formatStat(ciLow),
    ci95High: formatStat(ciHigh),
    withoutBestDate: formatStat(withoutBestMean),
    bestDate,
    byQuarter: Object.freeze(byQuarter),
    familySize: input.declaredFamilySize,
    dsr: dsr === null ? null : formatStat(dsr),
    familyTrials: Object.freeze(
      input.trials.map((trial, index) =>
        Object.freeze({
          trialIndex: index,
          hypothesisId: trial.hypothesisId,
          rawPValue: formatStat(Math.min(1, Math.max(0, rawP[index] ?? 1))),
          adjustedPValue: formatStat(Math.min(1, Math.max(0, adjusted[index] ?? 1))),
          holmRank: rankByIndex.get(index) ?? index,
        }),
      ),
    ),
  });
}
