"use client";

import { useEffect, useState } from "react";

import { formatPublicRunway } from "@/lib/landing/public-format";

export function PublicRunwayValue({ endsAt }: { endsAt: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return (
    <span data-testid="landing-breath-runway-value" aria-live="polite">
      {formatPublicRunway(endsAt, nowMs)}
    </span>
  );
}
