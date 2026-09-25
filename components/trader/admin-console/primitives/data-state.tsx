import { RU } from "@/components/trader/admin-console/i18n/ru";
import type { AdminDataState } from "@/lib/trader/admin-console/contracts";

export function DataState({ state, reason }: { state: AdminDataState; reason?: string | null }) {
  const label = RU.states[state];
  const prefix = reason?.split(":")[0];
  const base =
    prefix && prefix in RU.reasons ? RU.reasons[prefix as keyof typeof RU.reasons] : null;
  const suffix = reason?.slice((prefix?.length ?? 0) + 1);
  const detail =
    suffix && /^\d{4}-\d{2}-\d{2}T/.test(suffix) && Number.isFinite(Date.parse(suffix))
      ? new Date(suffix).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
      : suffix;
  const reasonText = base ? `${base}${detail ? ` · ${detail}` : ""}` : reason;
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
