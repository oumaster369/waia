"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import {
  LoadingState,
  UnavailableState,
  EmptyState,
} from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { missingOrganizationResult, treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type { TreasuryApiResult, TreasuryBudgetDto } from "@/lib/treasury-admin/types";

function BudgetsInner() {
  const { organizationId } = useFinanceOrg();
  const [code, setCode] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [periodStart, setPeriodStart] = React.useState("");
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [planned, setPlanned] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<{
    code?: string;
    message: string;
  } | null>(null);

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ budgets: TreasuryBudgetDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ budgets: TreasuryBudgetDto[] }>(
      "/api/admin/treasury/budgets",
      organizationId,
    );
  }, [organizationId]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `budgets:${organizationId ?? ""}`,
    query,
  );
  const rows = data?.budgets ?? [];
  const displayError = commandError ?? error;

  async function create() {
    if (!organizationId) return;
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/budgets", "POST", {
      organization_id: organizationId,
      code,
      title,
      period_start: periodStart,
      period_end: periodEnd,
      currency: "USD",
      planned_amount_micros: planned,
      status: "DRAFT",
      reason,
    });
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setCommandError({ code: result.code, message: result.message });
      return;
    }
    setCommandError(null);
    setReason("");
    reload();
  }

  if (loading) return <LoadingState />;
  if (displayError)
    return (
      <UnavailableState
        code={displayError.code}
        message={displayError.message}
        onRetry={() => {
          setCommandError(null);
          reload();
        }}
      />
    );

  return (
    <div className="space-y-4" data-testid="finance-budgets">
      {rows.length === 0 ? <EmptyState label="No budgets." /> : null}
      {rows.map((row) => (
        <WaiaSurface key={row.id} variant="raised" className="space-y-2 p-4">
          <h2 className="text-sm font-medium">
            {row.title} ({row.code}) · {row.status} · {row.isPublic ? "Public" : "Private"}
          </h2>
          <p className="text-xs">
            {row.periodStart} → {row.periodEnd}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Planned</dt>
            <dd>
              <MoneyText micros={row.plannedAmountMicros} />
            </dd>
            <dt>Funded (server)</dt>
            <dd>
              <MoneyText micros={row.funded} />
            </dd>
            <dt>Committed (server)</dt>
            <dd>
              <MoneyText micros={row.committed} />
            </dd>
            <dt>Spent (server)</dt>
            <dd>
              <MoneyText micros={row.spent} />
            </dd>
            <dt>Remaining (signed, server)</dt>
            <dd>
              <MoneyText micros={row.remaining} />
            </dd>
          </dl>
        </WaiaSurface>
      ))}
      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Create planned budget</h2>
        <p className="text-muted-foreground text-xs">
          Funded, committed, spent, and remaining are server-derived and cannot be posted.
        </p>
        <Input placeholder="Code" value={code} onChange={(event) => setCode(event.target.value)} />
        <Input
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          placeholder="Period start"
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
        />
        <Input
          placeholder="Period end"
          value={periodEnd}
          onChange={(event) => setPeriodEnd(event.target.value)}
        />
        <Input
          placeholder="Planned amount micros"
          value={planned}
          onChange={(event) => setPlanned(event.target.value)}
        />
        <Button type="button" onClick={() => setConfirmOpen(true)}>
          Create budget
        </Button>
      </WaiaSurface>
      <ConfirmDialog
        open={confirmOpen}
        title="Create budget"
        impact="Creates a planned budget. Derived totals stay server-owned."
        confirmLabel="Create"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void create()}
        busy={busy}
      />
    </div>
  );
}

export function BudgetsPanel() {
  return (
    <OrgGate>
      <BudgetsInner />
    </OrgGate>
  );
}
