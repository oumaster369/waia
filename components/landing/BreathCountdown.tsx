"use client";

import { useEffect, useState } from "react";

import { formatBreathCountdown } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

type BreathCountdownProps = {
  /** ISO-8601 runway end instant from the governed ledger, or null while pending. */
  endsAt: string | null;
};

const SECOND_MS = 1_000;

/**
 * Lightweight ticking display for WAIA CAN BREATHE FOR.
 * Updates once per second to preserve the intended sense of life — never fabricates time.
 */
export function BreathCountdown({ endsAt }: BreathCountdownProps) {
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
  const label = formatBreathCountdown(remainingMs);

  return (
    <div data-testid="landing-breath-countdown" data-countdown-state="live">
      <p className="text-xs font-semibold tracking-[0.14em] text-[rgba(170,210,220,0.78)] uppercase">
        {copy.breatheForLabel}
      </p>
      <p
        data-testid="landing-breath-countdown-value"
        className="mt-1 font-mono text-lg text-[#e8f2f4] tabular-nums"
        aria-live="polite"
      >
        <span className="sr-only">Remaining operating time: </span>
        {label}
      </p>
    </div>
  );
}
