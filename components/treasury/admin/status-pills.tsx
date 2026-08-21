import { cn } from "@/lib/utils";
import type { AccountingStatus, DetailPublicationState } from "@/lib/treasury-admin/publication";
import { publicationLabel } from "@/lib/treasury-admin/publication";
import { accountingStatusLabel } from "@/lib/treasury-admin/ledger";

export function AccountingStatusPill({ status }: { status: AccountingStatus }) {
  return (
    <span
      data-testid={`accounting-status-${status}`}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
        status === "VERIFIED" && "border-border bg-muted/40",
        status === "NEEDS_REVIEW" && "border-border bg-muted/20",
        status === "RECONCILIATION_REQUIRED" && "border-destructive/40 text-destructive",
        (status === "REJECTED" || status === "DUPLICATE") && "border-border text-muted-foreground",
      )}
    >
      {accountingStatusLabel(status)}
    </span>
  );
}

export function PublicationPill({ state }: { state: DetailPublicationState }) {
  return (
    <span
      data-testid={`publication-state-${state}`}
      data-publication={state}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
        state === "PRIVATE" && "border-border bg-muted/30",
        state === "DETAIL_PUBLIC" && "border-foreground/40 bg-foreground/5",
        state === "SUPERSEDED" && "text-muted-foreground border-dashed",
      )}
    >
      {publicationLabel(state)}
    </span>
  );
}
