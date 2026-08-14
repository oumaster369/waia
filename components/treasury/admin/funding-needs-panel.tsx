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
import { treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import type { TreasuryFundingNeedDto } from "@/lib/treasury-admin/types";

function FundingNeedsInner() {
  const { organizationId } = useFinanceOrg();
  const [rows, setRows] = React.useState<TreasuryFundingNeedDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [title, setTitle] = React.useState("");
  const [targetStage, setTargetStage] = React.useState("");
  const [required, setRequired] = React.useState("");
  const [publicExplanation, setPublicExplanation] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const result = await treasuryGet<{ fundingNeeds: TreasuryFundingNeedDto[] }>(
      "/api/admin/treasury/funding-needs",
      organizationId,
    );
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    setRows(result.data.fundingNeeds ?? []);
    setLoading(false);
  }, [organizationId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!organizationId) return;
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/funding-needs", "POST", {
      organization_id: organizationId,
      title,
      target_stage: targetStage,
      required_amount_micros: required,
      currency: "USD",
      public_explanation: publicExplanation,
      reason,
    });
    setBusy(false);
    setConfirmOpen(false);
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
    <div className="space-y-4" data-testid="finance-funding-needs">
      {rows.length === 0 ? <EmptyState label="No funding needs." /> : null}
      {rows.map((row) => (
        <WaiaSurface key={row.id} variant="raised" className="space-y-2 p-4">
          <h2 className="text-sm font-medium">
            {row.title} · {row.status} · {row.isPublic ? "Public" : "Private"}
          </h2>
          <p className="text-xs">Target stage: {row.targetStage ?? "None"}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Required</dt>
            <dd>
              <MoneyText micros={row.requiredAmountMicros} />
            </dd>
            <dt>Funded (server)</dt>
            <dd>
              <MoneyText micros={row.funded} />
            </dd>
            <dt>Remaining (server)</dt>
            <dd>
              <MoneyText micros={row.remaining} />
            </dd>
          </dl>
          {row.publicExplanation ? <p className="text-sm">{row.publicExplanation}</p> : null}
        </WaiaSurface>
      ))}
      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Create funding need</h2>
        <Input
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          placeholder="Target stage"
          value={targetStage}
          onChange={(event) => setTargetStage(event.target.value)}
        />
        <Input
          placeholder="Required amount micros"
          value={required}
          onChange={(event) => setRequired(event.target.value)}
        />
        <Input
          placeholder="Public explanation"
          value={publicExplanation}
          onChange={(event) => setPublicExplanation(event.target.value)}
        />
        <Button type="button" onClick={() => setConfirmOpen(true)}>
          Create funding need
        </Button>
      </WaiaSurface>
      <ConfirmDialog
        open={confirmOpen}
        title="Create funding need"
        impact="Derived funded/remaining stay server-owned."
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

export function FundingNeedsPanel() {
  return (
    <OrgGate>
      <FundingNeedsInner />
    </OrgGate>
  );
}
