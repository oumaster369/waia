import { RU } from "@/components/trader/admin-console/i18n/ru";
import type { AdminDataState } from "@/lib/trader/admin-console/contracts";

export function DataState({ state, reason }: { state: AdminDataState; reason?: string | null }) {
  const label = RU.states[state];
  const reasonText =
    reason && reason in RU.reasons ? RU.reasons[reason as keyof typeof RU.reasons] : reason;
  return (
    <p>
      <span>{label}</span>
      {reasonText ? <span>{` — ${reasonText}`}</span> : null}
    </p>
  );
}
