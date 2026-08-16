"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { CanonicalSelect, FormField } from "@/components/treasury/admin/form-controls";
import {
  BudgetSelect,
  CatalogStatus,
  FundingNeedSelect,
} from "@/components/treasury/admin/org-entity-select";
import { TransactionRefSelect } from "@/components/treasury/admin/transaction-ref-select";
import { useOrgBudgets, useOrgFundingNeeds } from "@/components/treasury/admin/use-org-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryJson } from "@/lib/treasury-admin/api";
import {
  TREASURY_DIRECTION_OPTIONS,
  TREASURY_KIND_OPTIONS,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_ASSET_OPTIONS,
  TREASURY_USDT_V1_DECIMALS,
} from "@/lib/treasury-admin/canonical";
import { datetimeLocalToIso } from "@/lib/treasury-admin/datetime-local";
import { buildManualDraftPostBody } from "@/lib/treasury-admin/manual-draft";
import { financeHref } from "@/lib/treasury-admin/org";
import {
  formatAtomicToHumanDecimal,
  parseHumanDecimalToAtomic,
} from "@/lib/treasury-admin/parse-human-amount";

function ManualInner() {
  const { organizationId } = useFinanceOrg();
  const router = useRouter();
  const { budgets, loading: budgetsLoading, error: budgetsError } = useOrgBudgets(organizationId);
  const {
    fundingNeeds,
    loading: needsLoading,
    error: needsError,
  } = useOrgFundingNeeds(organizationId);

  const [direction, setDirection] = React.useState("INFLOW");
  const [kind, setKind] = React.useState("");
  const [humanAmount, setHumanAmount] = React.useState("");
  const [occurredLocal, setOccurredLocal] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [budgetId, setBudgetId] = React.useState("");
  const [fundingNeedId, setFundingNeedId] = React.useState("");
  const [correctsTransactionId, setCorrectsTransactionId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const occurredAtIso = datetimeLocalToIso(occurredLocal);
  const parsedAmount = parseHumanDecimalToAtomic(humanAmount, TREASURY_USDT_V1_DECIMALS, {
    requirePositive: true,
  });
  const amountPreview = parsedAmount.ok
    ? `Stores as native amount ${parsedAmount.atomic} (${formatAtomicToHumanDecimal(parsedAmount.atomic, TREASURY_USDT_V1_DECIMALS)} ${TREASURY_USDT_V1_ASSET}, ${String(TREASURY_USDT_V1_DECIMALS)} decimals).`
    : humanAmount.trim()
      ? parsedAmount.message
      : `Enter a normal exact decimal such as 125.50. Treasury V1 stores ${TREASURY_USDT_V1_ASSET} with ${String(TREASURY_USDT_V1_DECIMALS)} decimals.`;

  function openConfirm() {
    if (!organizationId) return;
    const built = buildManualDraftPostBody(
      {
        organizationId,
        direction,
        kind,
        humanAmount,
        occurredAtIso: occurredAtIso ?? "",
        purpose,
        budgetId,
        fundingNeedId,
        correctsTransactionId,
        reason: "",
      },
      { requireReason: false },
    );
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    setFormError(null);
    setConfirmOpen(true);
  }

  async function submit() {
    if (!organizationId) return;
    const built = buildManualDraftPostBody({
      organizationId,
      direction,
      kind,
      humanAmount,
      occurredAtIso: occurredAtIso ?? "",
      purpose,
      budgetId,
      fundingNeedId,
      correctsTransactionId,
      reason,
    });
    if (!built.ok) {
      setBusy(false);
      setConfirmOpen(false);
      setFormError(built.message);
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

  return (
    <WaiaSurface variant="raised" className="space-y-4 p-4" data-testid="manual-transaction-form">
      <div>
        <h2 className="text-lg font-medium">Add manual transaction</h2>
        <p className="text-muted-foreground text-sm">
          Manual entry records an observation with provenance MANUAL. It starts as MANUAL_DRAFT and
          PRIVATE. It cannot skip review, Human classification, evidence, verification, or a later
          publication decision.
        </p>
      </div>
      {error ? <UnavailableState code={error.code} message={error.message} /> : null}
      {formError ? (
        <p role="alert" className="text-destructive text-sm" data-testid="manual-form-error">
          {formError}
        </p>
      ) : null}

      <FormField
        label="Direction"
        htmlFor="manual-direction"
        help="Required canonical Treasury direction."
      >
        <CanonicalSelect
          id="manual-direction"
          testId="manual-direction"
          value={direction}
          onChange={setDirection}
          options={TREASURY_DIRECTION_OPTIONS}
          blankLabel="Select direction"
          required
        />
      </FormField>

      <FormField
        label="Kind"
        htmlFor="manual-kind"
        help="Optional. Leave unclassified to keep observation separate from accounting classification."
      >
        <CanonicalSelect
          id="manual-kind"
          testId="manual-kind"
          value={kind}
          onChange={setKind}
          options={TREASURY_KIND_OPTIONS}
          blankLabel="Not classified yet"
        />
      </FormField>

      <FormField
        label="Asset"
        htmlFor="manual-asset"
        help={`Treasury V1 is ${TREASURY_USDT_V1_ASSET} with ${String(TREASURY_USDT_V1_DECIMALS)} native decimals. Decimals are not operator-editable.`}
      >
        <CanonicalSelect
          id="manual-asset"
          testId="manual-asset"
          value={TREASURY_USDT_V1_ASSET}
          onChange={() => undefined}
          options={[...TREASURY_USDT_V1_ASSET_OPTIONS]}
          blankLabel="Select asset"
          disabled
          required
        />
      </FormField>

      <FormField
        label="Amount"
        htmlFor="manual-amount"
        help={amountPreview}
        error={!parsedAmount.ok && humanAmount.trim() ? parsedAmount.message : null}
      >
        <Input
          id="manual-amount"
          data-testid="manual-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="125.50"
          value={humanAmount}
          aria-invalid={humanAmount.trim() !== "" && !parsedAmount.ok}
          onChange={(event) => setHumanAmount(event.target.value)}
        />
      </FormField>

      <FormField
        label="Occurred at"
        htmlFor="manual-occurred-at"
        help="Local date and time. The exact UTC ISO-8601 value below is what will be stored. Nothing is auto-filled."
      >
        <Input
          id="manual-occurred-at"
          data-testid="manual-occurred-at"
          type="datetime-local"
          value={occurredLocal}
          onChange={(event) => setOccurredLocal(event.target.value)}
        />
      </FormField>
      <FormField label="Stored timestamp (ISO-8601 UTC)" htmlFor="manual-occurred-iso">
        <Input
          id="manual-occurred-iso"
          data-testid="manual-occurred-iso"
          readOnly
          value={occurredAtIso ?? ""}
          placeholder="Appears after you choose a local date and time"
        />
      </FormField>

      <FormField
        label="Purpose"
        htmlFor="manual-purpose"
        help="Human semantic text. This is not a closed Purpose taxonomy."
      >
        <Textarea
          id="manual-purpose"
          data-testid="manual-purpose"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </FormField>

      <BudgetSelect
        id="manual-budget"
        testId="manual-budget"
        value={budgetId}
        onChange={setBudgetId}
        budgets={budgets}
        blankLabel="None"
        help="Organization-scoped. Submits budget_id, not the title."
      />
      <FundingNeedSelect
        id="manual-funding-need"
        testId="manual-funding-need"
        value={fundingNeedId}
        onChange={setFundingNeedId}
        fundingNeeds={fundingNeeds}
        blankLabel="None"
        help="Organization-scoped. Submits funding_need_id, not the title."
      />
      <CatalogStatus loading={budgetsLoading || needsLoading} error={budgetsError ?? needsError} />

      {organizationId ? (
        <TransactionRefSelect
          organizationId={organizationId}
          value={correctsTransactionId}
          onChange={setCorrectsTransactionId}
          emphasizeCorrection={kind === "CORRECTION"}
        />
      ) : null}

      <Button type="button" data-testid="manual-create-draft" onClick={openConfirm}>
        Create MANUAL draft
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Create manual draft"
        impact="Creates a MANUAL_DRAFT with PRIVATE publication. Review, evidence, verify, and publication remain separate steps. Classification is not applied automatically."
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
