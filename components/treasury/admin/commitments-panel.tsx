"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { PublicationPill } from "@/components/treasury/admin/status-pills";
import {
  LoadingState,
  UnavailableState,
  EmptyState,
} from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import {
  commitmentActionAffordances,
  isActiveCommittedStatus,
  type CommitmentCommand,
} from "@/lib/treasury-admin/commitment-actions";
import type { TreasuryCommitmentDto } from "@/lib/treasury-admin/types";

function CommitmentsInner() {
  const { organizationId } = useFinanceOrg();
  const [rows, setRows] = React.useState<TreasuryCommitmentDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [amount, setAmount] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [budgetId, setBudgetId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [fulfillTx, setFulfillTx] = React.useState("");
  const [pending, setPending] = React.useState<{ id: string; command: CommitmentCommand } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const result = await treasuryGet<{ commitments: TreasuryCommitmentDto[] }>(
      "/api/admin/treasury/commitments",
      organizationId,
    );
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    setRows(result.data.commitments ?? []);
    setLoading(false);
  }, [organizationId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!organizationId) return;
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/commitments", "POST", {
      organization_id: organizationId,
      amount_micros: amount,
      currency: "USD",
      purpose,
      budget_id: budgetId || null,
      reason,
    });
    setBusy(false);
    setCreateOpen(false);
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      return;
    }
    setReason("");
    await load();
  }

  async function runCommand() {
    if (!organizationId || !pending) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      organization_id: organizationId,
      command: pending.command,
      commitment_id: pending.id,
      reason,
    };
    if (pending.command === "fulfill") body.fulfills_transaction_id = fulfillTx;
    const result = await treasuryJson("/api/admin/treasury/commitments/commands", "POST", body);
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      return;
    }
    setReason("");
    await load();
  }

  if (loading) return <LoadingState />;
  if (error)
    return (
      <UnavailableState code={error.code} message={error.message} onRetry={() => void load()} />
    );

  return (
    <div className="space-y-4" data-testid="finance-commitments">
      <p className="text-sm">
        APPROVED and RELEASED commitments reduce current free funds. Free funds are displayed from
        server preview and are not recomputed here.
      </p>
      {rows.length === 0 ? <EmptyState label="No commitments." /> : null}
      {rows.map((row) => (
        <WaiaSurface key={row.id} variant="raised" className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{row.purpose}</h2>
            <span className="text-xs">{row.status}</span>
            <PublicationPill state={row.detailPublication} />
            {isActiveCommittedStatus(row.status) ? (
              <span className="text-muted-foreground text-xs">Reduces current free funds</span>
            ) : null}
          </div>
          <MoneyText micros={row.amountMicros} />
          <p className="text-xs">
            Budget {row.budgetId ?? "none"} · expected {row.expectedAt ?? "none"} · effective{" "}
            {row.effectiveFrom ?? "none"}
          </p>
          <p className="text-xs">
            Created by {row.createdByUserId ?? "—"} · approved {row.approvedByUserId ?? "—"}{" "}
            {row.approvedAt ?? ""} · released {row.releasedByUserId ?? "—"} {row.releasedAt ?? ""}
          </p>
          {row.counterpartyDisplay && row.publishCounterparty ? (
            <p className="text-sm">Counterparty: {row.counterpartyDisplay}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {commitmentActionAffordances(row.status).map((action) => (
              <Button
                key={action.command}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPending({ id: row.id, command: action.command })}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </WaiaSurface>
      ))}
      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Create DRAFT commitment</h2>
        <Input
          placeholder="Amount micros"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          placeholder="Purpose"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
        <Input
          placeholder="Budget id"
          value={budgetId}
          onChange={(event) => setBudgetId(event.target.value)}
        />
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Create draft
        </Button>
      </WaiaSurface>
      {pending?.command === "fulfill" ? (
        <Input
          placeholder="Fulfills transaction id"
          value={fulfillTx}
          onChange={(event) => setFulfillTx(event.target.value)}
        />
      ) : null}
      <ConfirmDialog
        open={createOpen}
        title="Create commitment draft"
        impact="Draft commitments do not reduce free funds until APPROVED."
        confirmLabel="Create"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setCreateOpen(false)}
        onConfirm={() => void create()}
        busy={busy}
      />
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? pending.command : "Confirm"}
        impact={
          pending?.command === "approve" || pending?.command === "release"
            ? "This status reduces current free funds. Totals remain server-derived."
            : pending?.command === "cancel"
              ? "Cancellation from RELEASED requires an explicit audit reason."
              : "Commitment lifecycle command."
        }
        confirmLabel="Confirm"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setPending(null)}
        onConfirm={() => void runCommand()}
        busy={busy}
      />
    </div>
  );
}

export function CommitmentsPanel() {
  return (
    <OrgGate>
      <CommitmentsInner />
    </OrgGate>
  );
}
