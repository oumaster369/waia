"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryJson } from "@/lib/treasury-admin/api";
import { financeHref } from "@/lib/treasury-admin/org";

function ManualInner() {
  const { organizationId } = useFinanceOrg();
  const router = useRouter();
  const [direction, setDirection] = React.useState("INFLOW");
  const [nativeAmountAtomic, setNativeAmountAtomic] = React.useState("");
  const [nativeAsset, setNativeAsset] = React.useState("USDT");
  const [occurredAt, setOccurredAt] = React.useState("");
  const [correctsTransactionId, setCorrectsTransactionId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!organizationId) return;
    setBusy(true);
    const result = await treasuryJson<{ transaction: { id: string } }>(
      "/api/admin/treasury/transactions",
      "POST",
      {
        organization_id: organizationId,
        direction,
        native_amount_atomic: nativeAmountAtomic,
        native_decimals: 6,
        native_asset: nativeAsset,
        occurred_at: occurredAt,
        reason,
        corrects_transaction_id: correctsTransactionId || null,
      },
    );
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      return;
    }
    router.push(financeHref(`/finance/transactions/${result.data.transaction.id}`, organizationId));
  }

  return (
    <WaiaSurface variant="raised" className="space-y-4 p-4" data-testid="manual-transaction-form">
      <p className="text-muted-foreground text-sm">
        Manual entry starts as provenance MANUAL, publication Private, and accounting MANUAL_DRAFT.
        It cannot skip review, evidence, verification, or publication separation.
      </p>
      {error ? <UnavailableState code={error.code} message={error.message} /> : null}
      <label className="block space-y-1 text-sm">
        Direction
        <select
          className="border-border bg-background w-full rounded-md border px-3 py-2"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        >
          <option value="INFLOW">INFLOW</option>
          <option value="OUTFLOW">OUTFLOW</option>
          <option value="INTERNAL">INTERNAL</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        Native amount atomic (integer string)
        <Input
          data-testid="manual-native-amount"
          value={nativeAmountAtomic}
          onChange={(event) => setNativeAmountAtomic(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        Native asset
        <Input value={nativeAsset} onChange={(event) => setNativeAsset(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        Occurred at (ISO-8601)
        <Input
          data-testid="manual-occurred-at"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        Corrects transaction id (optional)
        <Input
          value={correctsTransactionId}
          onChange={(event) => setCorrectsTransactionId(event.target.value)}
        />
      </label>
      <Button type="button" onClick={() => setConfirmOpen(true)}>
        Create MANUAL draft
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Create manual draft"
        impact="Creates a MANUAL_DRAFT with PRIVATE publication. Review, evidence, verify, and publication remain separate steps."
        confirmLabel="Create draft"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
        busy={busy}
      />
    </WaiaSurface>
  );
}

export function ManualTransactionForm() {
  return (
    <OrgGate>
      <ManualInner />
    </OrgGate>
  );
}
