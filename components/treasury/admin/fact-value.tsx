import { cn } from "@/lib/utils";
import type { FactKind } from "@/lib/treasury-admin/facts";

export function FactValue({
  kind,
  children,
  reason,
}: {
  kind: FactKind;
  children?: React.ReactNode;
  reason?: string;
}) {
  const label =
    kind === "pending"
      ? "Pending"
      : kind === "unavailable"
        ? "Unavailable"
        : kind === "not_configured"
          ? "Not configured"
          : kind === "null"
            ? "None"
            : null;
  return (
    <div data-testid={`fact-${kind}`} className="space-y-1">
      {label ? (
        <p
          className={cn(
            "text-sm",
            kind === "unavailable" || kind === "not_configured"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {label}
          {reason ? ` — ${reason}` : ""}
        </p>
      ) : (
        children
      )}
    </div>
  );
}
