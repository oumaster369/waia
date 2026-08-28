import { useId } from "react";

import { BreathCountdown } from "@/components/landing/BreathCountdown";
import type { BreathMoney, BreathPublicSnapshot } from "@/lib/landing/breath-public";
import { deriveBreathFundingMarkerRatio, formatBreathAmount } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { cn } from "@/lib/utils";

import styles from "@/components/landing/visuals/breath-runway-pulse.module.css";

type BreathFundingGaugeProps = {
  status: BreathPublicSnapshot["status"];
  idealAnnualBudget: BreathMoney;
  currentFreeFunds: BreathMoney;
  runway: BreathPublicSnapshot["runway"];
  hourlyBurnMicros?: string | null;
  runwayCurrency?: string | null;
};

/**
 * One soft rise + fall (viewBox units). Width = 80 so travel % = 100 / cellCount.
 * PRESERVE — Human-approved breathing waveform from HEAD 417baeb / b28499e.
 */
const PULSE_CELL = "c 20 0 28 -7 40 -7 s 20 7 40 7";
const WAVE_CELL_COUNT = 12;

function buildWavePath(cells: number): string {
  let d = "M -40 22";
  for (let i = 0; i < cells; i += 1) {
    d += ` ${PULSE_CELL}`;
  }
  return d;
}

const WAVE_PATH = buildWavePath(WAVE_CELL_COUNT);

function markerLabelTransform(ratio: number): string {
  if (ratio <= 0.12) return "translateX(0)";
  if (ratio >= 0.88) return "translateX(-100%)";
  return "translateX(-50%)";
}

/**
 * WAIA Funding Breath scale — capacity from 0 → ideal annual budget,
 * with CURRENT FREE FUNDS marker + countdown in the funded interval.
 * Waves unchanged from the Human-approved pulse.
 */
export function BreathFundingGauge({
  status,
  idealAnnualBudget,
  currentFreeFunds,
  runway,
  hourlyBurnMicros = null,
  runwayCurrency = null,
}: BreathFundingGaugeProps) {
  const copy = HOMEPAGE_COPY.breath;
  const clipId = useId().replace(/:/g, "");
  const ratio = deriveBreathFundingMarkerRatio(currentFreeFunds, idealAnnualBudget);
  const gaugePending = status === "pending" || ratio === null;
  const idealPublished = idealAnnualBudget.amount !== null && idealAnnualBudget.currency !== null;

  return (
    <div
      data-testid="landing-breath-runway"
      data-runway-state={gaugePending ? "pending" : "published"}
      data-funding-ratio={ratio === null ? "pending" : ratio.toFixed(4)}
      className={cn(
        "rounded-2xl border px-4 py-5 sm:px-5 sm:py-6",
        "border-[rgba(150,195,205,0.28)]",
        "bg-[linear-gradient(180deg,rgba(20,48,62,0.42),rgba(6,16,28,0.55))]",
      )}
    >
      <p
        data-testid="landing-breath-runway-label"
        className="text-xs font-semibold tracking-[0.16em] text-[rgba(170,210,220,0.9)] uppercase"
      >
        {copy.fundingScaleTitle}
      </p>

      <div data-testid="landing-breath-runway-pulse" className="mt-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <span
            data-testid="landing-breath-runway-now"
            className="font-mono text-sm text-[rgba(205,225,230,0.82)] tabular-nums"
          >
            0
          </span>
          <span className="max-w-[13rem] text-right text-[0.65rem] font-semibold tracking-[0.1em] text-[rgba(170,210,220,0.75)] uppercase">
            {copy.idealAnnualBudgetLabel}
            <span
              data-testid="landing-breath-ideal-budget-value"
              className="mt-1 block font-mono text-sm font-normal tracking-normal text-[#e8f2f4] normal-case tabular-nums"
            >
              {idealPublished
                ? formatBreathAmount(idealAnnualBudget.amount, idealAnnualBudget.currency)
                : copy.idealAnnualBudgetPending}
            </span>
          </span>
        </div>
        <div className="relative" aria-hidden={ratio === null ? true : undefined}>
          <svg
            data-testid="landing-breath-runway-svg"
            className={styles.svg}
            viewBox="0 0 320 44"
            preserveAspectRatio="none"
            role="presentation"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width="320" height="44" />
              </clipPath>
            </defs>

            <line className={styles.baseline} x1="4" y1="22" x2="316" y2="22" />

            <g clipPath={`url(#${clipId})`}>
              <g
                data-testid="landing-breath-runway-wave-track"
                className={cn(
                  styles.waveTrack,
                  gaugePending ? styles.waveTrackPending : styles.waveTrackLive,
                )}
              >
                <path
                  data-testid="landing-breath-runway-wave"
                  className={cn(styles.wave, gaugePending && styles.wavePending)}
                  d={WAVE_PATH}
                />
              </g>
            </g>
          </svg>

          {ratio !== null ? (
            <div
              data-testid="landing-breath-funding-marker"
              data-marker-ratio={ratio.toFixed(4)}
              className="pointer-events-none absolute inset-y-0 flex w-0 flex-col items-center"
              style={{ left: `${ratio * 100}%` }}
            >
              <div className="h-full w-px bg-[rgba(210,235,240,0.85)] shadow-[0_0_8px_rgba(160,210,220,0.35)]" />
            </div>
          ) : null}
        </div>

        {gaugePending ? (
          <p
            data-testid="landing-breath-pending"
            data-publication-status="pending"
            className="mt-5 max-w-2xl text-sm leading-relaxed text-[rgba(205,222,228,0.78)]"
          >
            {copy.pending}
          </p>
        ) : (
          <div data-testid="landing-breath-facts" data-publication-status="published">
            <div
              data-testid="landing-breath-free-funds"
              className="relative mt-2 min-h-12 w-full overflow-hidden"
              aria-label={`Current free funds ${formatBreathAmount(currentFreeFunds.amount, currentFreeFunds.currency)}`}
            >
              <div
                className="absolute top-0 w-max max-w-full text-center"
                style={{ left: `${ratio * 100}%`, transform: markerLabelTransform(ratio) }}
              >
                <p className="text-[0.6rem] font-semibold tracking-[0.12em] text-[rgba(170,210,220,0.72)] uppercase">
                  {copy.freeFundsLabel}
                </p>
                <p
                  data-testid="landing-breath-free-funds-value"
                  className="mt-0.5 font-mono text-sm text-[#e8f2f4] tabular-nums"
                >
                  {formatBreathAmount(currentFreeFunds.amount, currentFreeFunds.currency)}
                </p>
              </div>
            </div>
            <div
              data-testid="landing-breath-countdown-region"
              data-countdown-region="published"
              className="mt-3 border-t border-[rgba(150,195,205,0.18)] pt-4 sm:max-w-[70%]"
            >
              <BreathCountdown
                endsAt={runway.endsAt}
                hourlyBurnMicros={hourlyBurnMicros}
                currency={runwayCurrency}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
