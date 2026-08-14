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
import type { TreasuryApiResult, TreasuryFundingNeedDto } from "@/lib/treasury-admin/types";

function FundingNeedsInner() {
  const { organizationId } = useFinanceOrg();
  const [title, setTitle] = React.useState("");
  const [targetStage, setTargetStage] = React.useState("");
  const [required, setRequired] = React.useState("");
  const [publicExplanation, setPublicExplanation] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<{
    code?: string;
    message: string;
  } | null>(null);

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ fundingNeeds: TreasuryFundingNeedDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ fundingNeeds: TreasuryFundingNeedDto[] }>(
      "/api/admin/treasury/funding-needs",
      organizationId,
    );
  }, [organizationId]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `funding-needs:${organizationId ?? ""}`,
    query,
  );
  const rows = data?.fundingNeeds ?? [];
  const displayError = commandError ?? error;

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
