import { useId } from "react";

import type { BreathPublicSnapshot } from "@/lib/landing/breath-public";
import { deriveBreathRunwayTicks, formatBreathRunway } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { cn } from "@/lib/utils";

import styles from "@/components/landing/visuals/breath-runway-pulse.module.css";

type BreathRunwayPulseProps = {
  runway: BreathPublicSnapshot["runway"];
  status: BreathPublicSnapshot["status"];
};

/**
 * One soft rise + fall (viewBox units). Width = 80 so travel % = 100 / cellCount.
 * Organic low-amplitude — not ECG, chart, or visualizer.
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

/**
 * WAIA Runway / Pulse — temporal line with an integrated breathing waveform.
 * Pending never invents ticks, percentages, or runway values.
 */
export function BreathRunwayPulse({ runway, status }: BreathRunwayPulseProps) {
  const copy = HOMEPAGE_COPY.breath;
  const clipId = useId().replace(/:/g, "");
  const pending = status === "pending" || runway.value === null || runway.unit === null;
  const valueLabel = pending ? copy.runwayPendingValue : formatBreathRunway(runway);
  const ticks = pending ? [] : deriveBreathRunwayTicks(runway);
  const endLabel = pending ? copy.runwayEndPending : copy.runwayEnd;

  return (
    <div
      data-testid="landing-breath-runway"
      data-runway-state={pending ? "pending" : "published"}
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
        {copy.runwayTitle}
      </p>
      <p
        data-testid="landing-breath-runway-value"
        className={cn(
          "font-waia-serif mt-3 text-[1.35rem] leading-snug text-[#e8f2f4] sm:text-[1.5rem]",
          pending && "text-[rgba(210,225,230,0.78)]",
        )}
      >
        {valueLabel}
      </p>

      <div data-testid="landing-breath-runway-pulse" className="mt-5" aria-hidden>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span
            data-testid="landing-breath-runway-now"
            className="text-[0.65rem] font-semibold tracking-[0.14em] text-[rgba(170,210,220,0.75)] uppercase"
          >
            {copy.runwayNow}
          </span>
          <span
            data-testid="landing-breath-runway-end"
            className="text-[0.65rem] font-semibold tracking-[0.14em] text-[rgba(170,210,220,0.75)] uppercase"
          >
            {endLabel}
          </span>
        </div>

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
                pending ? styles.waveTrackPending : styles.waveTrackLive,
              )}
            >
              <path
                data-testid="landing-breath-runway-wave"
                className={cn(styles.wave, pending && styles.wavePending)}
                d={WAVE_PATH}
              />
            </g>
          </g>
        </svg>

        {ticks.length > 0 ? (
          <ol data-testid="landing-breath-runway-ticks" className="mt-2 grid grid-cols-5 gap-1">
            {ticks.map((tick, index) => (
              <li
                key={tick.label}
                data-testid={`landing-breath-runway-tick-${tick.value}`}
                className={cn(
                  "font-mono text-[0.65rem] text-[rgba(175,210,220,0.72)] tabular-nums",
                  index === 0 && "text-left",
                  index > 0 && index < ticks.length - 1 && "text-center",
                  index === ticks.length - 1 && "text-right",
                )}
              >
                {tick.label}
              </li>
            ))}
          </ol>
        ) : (
          <div data-testid="landing-breath-runway-ticks-pending" className="mt-2 h-4" aria-hidden />
        )}
      </div>

      <p
        data-testid="landing-breath-runway-note"
        className="mt-4 text-sm leading-relaxed text-[rgba(185,210,218,0.78)]"
      >
        {pending ? copy.runwayPendingNote : copy.runwayPublishedNote}
      </p>
    </div>
  );
}
