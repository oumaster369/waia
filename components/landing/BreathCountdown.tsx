"use client";

import { useEffect, useState } from "react";

import { formatBreathCountdown } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { formatPublicMoney } from "@/lib/landing/public-format";

type BreathCountdownProps = {
  /** ISO-8601 runway end instant from the governed ledger, or null while pending. */
  endsAt: string | null;
  /** Exact server-owned approved burn rate, expressed in accounting micros per hour. */
  hourlyBurnMicros?: string | null;
  currency?: string | null;
};

const SECOND_MS = 1_000;

/**
 * Lightweight ticking display for WAIA CAN BREATHE FOR.
 * Updates once per second to preserve the intended sense of life — never fabricates time.
 */
export function BreathCountdown({
  endsAt,
  hourlyBurnMicros = null,
  currency = null,
}: BreathCountdownProps) {
  const copy = HOMEPAGE_COPY.breath;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), SECOND_MS);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!endsAt) {
    return (
      <div data-testid="landing-breath-countdown" data-countdown-state="pending">
        <p className="text-xs font-semibold tracking-[0.14em] text-[rgba(170,210,220,0.78)] uppercase">
          {copy.breatheForLabel}
        </p>
        <p
          data-testid="landing-breath-countdown-value"
          className="mt-1 text-sm text-[rgba(210,225,230,0.72)]"
        >
          {copy.breatheForPending}
        </p>
      </div>
    );
  }

  const endMs = Date.parse(endsAt);
  const remainingMs = Number.isFinite(endMs) ? endMs - nowMs : 0;
  const elapsed = !Number.isFinite(endMs) || remainingMs <= 0;
  const label = formatBreathCountdown(elapsed ? 0 : remainingMs);

  return (
    <div data-testid="landing-breath-countdown" data-countdown-state={elapsed ? "elapsed" : "live"}>
      <p className="text-xs font-semibold tracking-[0.14em] text-[rgba(170,210,220,0.78)] uppercase">
        {copy.breatheForLabel}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
        <p
          data-testid="landing-breath-countdown-value"
          className="font-mono text-lg text-[#e8f2f4] tabular-nums"
        >
          <span className="sr-only">Remaining operating time: </span>
          {label}
        </p>
        {elapsed ? (
          <p
            data-testid="landing-breath-countdown-paused"
            className="text-waia-accent-warm text-xs font-semibold tracking-[0.08em] uppercase"
          >
            {copy.breatheForElapsed}
          </p>
        ) : null}
      </div>
      {hourlyBurnMicros && currency ? (
        <p
          data-testid="landing-breath-hourly-burn"
          className="mt-2 text-xs text-[rgba(170,210,220,0.72)]"
        >
          Current operating rate · {formatPublicMoney(hourlyBurnMicros, currency)}/hour
        </p>
      ) : null}
    </div>
  );
}
