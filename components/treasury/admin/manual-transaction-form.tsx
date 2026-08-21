"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { CanonicalSelect, FormField, MoreDetails } from "@/components/treasury/admin/form-controls";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { LedgerCatalogSelect } from "@/components/treasury/admin/ledger-catalog-select";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { TransactionRefSelect } from "@/components/treasury/admin/transaction-ref-select";
import { UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryJson } from "@/lib/treasury-admin/api";
import { dateToDatetimeLocal, datetimeLocalToIso } from "@/lib/treasury-admin/datetime-local";
import { parseHumanSignedAmount } from "@/lib/treasury-admin/ledger";
import { buildCentralLedgerPostBody } from "@/lib/treasury-admin/manual-draft";
import { financeHref } from "@/lib/treasury-admin/org";

function ManualInner() {
  const { organizationId } = useFinanceOrg();
  const router = useRouter();
  const [status, setStatus] = React.useState<"NEEDS_REVIEW" | "PLANNED">("NEEDS_REVIEW");
  const [humanAmount, setHumanAmount] = React.useState("");
  const [occurredLocal, setOccurredLocal] = React.useState(() => dateToDatetimeLocal(new Date()));
  const [counterpartyId, setCounterpartyId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [accountCurrency, setAccountCurrency] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [correctsTransactionId, setCorrectsTransactionId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const occurredAtIso = datetimeLocalToIso(occurredLocal);
  const parsedAmount = parseHumanSignedAmount(humanAmount);

  function build(requireReason: boolean) {
    if (!organizationId) return { ok: false as const, message: "Select an organization first." };
    return buildCentralLedgerPostBody(
      {
        organizationId,
        status,
        humanAmount,
        occurredAtIso: occurredAtIso ?? "",
        currency: accountCurrency,
        counterpartyId,
        accountId,
        categoryId,
        projectId,
        notes,
        correctsTransactionId,
        reason,
      },
      { requireReason },
    );
  }

  function openConfirm() {
    const result = build(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setFormError(null);
    setConfirmOpen(true);
  }

  async function submit() {
    const built = build(true);
    if (!built.ok || !organizationId) {
      setConfirmOpen(false);
      setFormError(built.ok ? "Select an organization first." : built.message);
      return;
    }
    setBusy(true);
    const result = await treasuryJson<{ transaction: { id: string } }>(
      "/api/admin/treasury/transactions",
      "POST",
      built.body,
    );
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      return;
    }
    router.push(financeHref(`/finance/transactions/${result.data.transaction.id}`, organizationId));
  }

  if (!organizationId) return null;

  return (
    <WaiaSurface variant="raised" className="space-y-5 p-5" data-testid="manual-transaction-form">
      <div>
        <h2 className="text-lg font-medium">Add transaction</h2>
        <p className="text-muted-foreground text-sm">
          Use a minus sign for money sent and a positive amount for money received. Every new entry
          stays behind Human review; verification is a separate audited action.
        </p>
      </div>
      {error ? <UnavailableState code={error.code} message={error.message} /> : null}
      {formError ? (
        <p role="alert" className="text-destructive text-sm" data-testid="manual-form-error">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Date and time"
          htmlFor="manual-occurred-at"
          help="Captured when this form opened. You can correct it before saving."
        >
          <Input
            id="manual-occurred-at"
            data-testid="manual-occurred-at"
            type="datetime-local"
            value={occurredLocal}
            onChange={(event) => setOccurredLocal(event.target.value)}
          />
        </FormField>
        <FormField
          label="Status"
          htmlFor="manual-status"
          help="Planned is accepted only for a future date and time."
        >
          <CanonicalSelect
            id="manual-status"
            testId="manual-status"
            value={status}
            onChange={(value) => setStatus(value as "NEEDS_REVIEW" | "PLANNED")}
            options={[
              { value: "NEEDS_REVIEW", label: "Requires review" },
              { value: "PLANNED", label: "Planned" },
            ]}
            blankLabel="Choose status"
            required
          />
        </FormField>
      </div>

      <FormField
        label="Amount"
        htmlFor="manual-amount"
        help="Positive = money received. Negative = money sent. Up to 6 decimal places; never rounded."
        error={!parsedAmount.ok && humanAmount.trim() ? parsedAmount.message : null}
      >
        <Input
          id="manual-amount"
          data-testid="manual-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="125.50 or -40.00"
          value={humanAmount}
          aria-invalid={humanAmount.trim() !== "" && !parsedAmount.ok}
          onChange={(event) => setHumanAmount(event.target.value)}
        />
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <LedgerCatalogSelect
          id="manual-counterparty"
          organizationId={organizationId}
          kind="counterparties"
          value={counterpartyId}
          onChange={(id) => setCounterpartyId(id)}
        />
        <LedgerCatalogSelect
          id="manual-account"
          organizationId={organizationId}
          kind="accounts"
          value={accountId}
          required
          onChange={(id, item) => {
            setAccountId(id);
            setAccountCurrency(item && "currency" in item ? item.currency : "");
          }}
        />
        <LedgerCatalogSelect
          id="manual-category"
          organizationId={organizationId}
          kind="categories"
          value={categoryId}
          onChange={(id) => setCategoryId(id)}
        />
        <LedgerCatalogSelect
          id="manual-project"
          organizationId={organizationId}
          kind="projects"
          value={projectId}
          onChange={(id) => setProjectId(id)}
        />
      </div>

      <FormField
        label="Notes"
        htmlFor="manual-notes"
        help="Private operational context for this transaction."
      >
        <Textarea
          id="manual-notes"
          data-testid="manual-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </FormField>

      <MoreDetails summary="Correction" testId="manual-correction-details">
        <p className="text-muted-foreground text-sm">
          Use this only to append a correction to an existing transaction. Verified history is never
          edited in place.
        </p>
        <TransactionRefSelect
          organizationId={organizationId}
          value={correctsTransactionId}
          onChange={setCorrectsTransactionId}
          emphasizeCorrection
        />
      </MoreDetails>

      <Button type="button" data-testid="manual-create-draft" onClick={openConfirm}>
        Add transaction for review
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Add transaction"
        impact={`Creates a ${status === "PLANNED" ? "planned" : "requires-review"} ledger row. It does not verify or publish financial truth.`}
        confirmLabel="Add transaction"
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
