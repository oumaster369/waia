import type { BreathPublicSnapshot } from "@/lib/landing/breath-public";
import { formatBreathRunway } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { cn } from "@/lib/utils";

import styles from "@/components/landing/visuals/breath-runway-pulse.module.css";

type BreathRunwayPulseProps = {
  runway: BreathPublicSnapshot["runway"];
  status: BreathPublicSnapshot["status"];
};

/**
 * WAIA Runway / Pulse — calm living-system line, not a progress bar or chart.
 * Pending runway never invents a percentage position.
 */
export function BreathRunwayPulse({ runway, status }: BreathRunwayPulseProps) {
  const copy = HOMEPAGE_COPY.breath;
  const pending = status === "pending" || runway.value === null || runway.unit === null;
  const valueLabel = pending ? copy.runwayPendingValue : formatBreathRunway(runway);

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
        <div className={cn(styles.pulseLine, pending && styles.pulseLinePending)}>
          <span
            className={cn(
              styles.pulseMark,
              pending ? styles.pulseMarkPending : styles.pulseMarkLive,
            )}
          />
        </div>
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
