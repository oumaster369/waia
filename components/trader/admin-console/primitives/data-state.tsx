import { RU } from "@/components/trader/admin-console/i18n/ru";
import type { AdminDataState } from "@/lib/trader/admin-console/contracts";

export function DataState({ state, reason }: { state: AdminDataState; reason?: string | null }) {
  const label = RU.states[state];
  const reasonText =
    reason && reason in RU.reasons ? RU.reasons[reason as keyof typeof RU.reasons] : reason;
  return (
    <p
      data-state={state}
      data-reason={reason ?? undefined}
      className="text-waia-fg-muted text-xs leading-5"
      title={reason ?? undefined}
    >
      <span className={state === "partial" || state === "stale" ? "text-waia-warning" : undefined}>
        {label}
      </span>
      {reasonText ? <span>{` · ${reasonText}`}</span> : null}
    </p>
  );
}
