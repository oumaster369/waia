import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { backendUnavailableLabel } from "@/lib/treasury-admin/facts";

export function UnavailableState({
  code,
  message,
  onRetry,
}: {
  code?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <WaiaSurface variant="raised" className="space-y-3 p-4" data-testid="finance-unavailable">
      <p className="text-sm">{message ?? backendUnavailableLabel(code)}</p>
      {code ? <p className="text-muted-foreground font-mono text-xs">{code}</p> : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </WaiaSurface>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="text-muted-foreground text-sm" data-testid="finance-loading">
      {label}
    </p>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground text-sm" data-testid="finance-empty">
      {label}
    </p>
  );
}
