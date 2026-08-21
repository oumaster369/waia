"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { FormField } from "@/components/treasury/admin/form-controls";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { useLedgerCatalog } from "@/components/treasury/admin/use-ledger-catalog";
import {
  EmptyState,
  LoadingState,
  UnavailableState,
} from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryJson } from "@/lib/treasury-admin/api";
import {
  formatAtomicToHumanDecimal,
  parseHumanDecimalToAtomic,
} from "@/lib/treasury-admin/parse-human-amount";
import type { TreasuryCategoryDto } from "@/lib/treasury-admin/types";

function CategoryRow({
  organizationId,
  row,
  onSaved,
}: {
  organizationId: string;
  row: TreasuryCategoryDto;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(row.name);
  const [monthly, setMonthly] = React.useState(() =>
    formatAtomicToHumanDecimal(row.monthlyBudgetMicros, 6),
  );
  const [description, setDescription] = React.useState(row.description ?? "");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState<"save" | "archive" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function apply() {
    const parsed = parseHumanDecimalToAtomic(monthly, 6, { requirePositive: false });
    if (!parsed.ok || !reason.trim()) {
      setPending(null);
      setError(!parsed.ok ? parsed.message : "Add an audit reason.");
      return;
    }
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/categories", "PATCH", {
      organization_id: organizationId,
      id: row.id,
      ...(pending === "archive"
        ? { is_active: false }
        : {
            name: name.trim(),
            description: description.trim() || null,
            monthly_budget_micros: parsed.atomic,
          }),
      reason: reason.trim(),
    });
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setReason("");
    onSaved();
  }

  return (
    <WaiaSurface variant="raised" className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.code} · {row.currency}
          </p>
        </div>
        <p className="font-mono text-sm">
          {formatAtomicToHumanDecimal(row.monthlyBudgetMicros, 6)} / month
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Name" htmlFor={`category-name-${row.id}`}>
          <Input
            id={`category-name-${row.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="Monthly budget" htmlFor={`category-monthly-${row.id}`}>
          <Input
            id={`category-monthly-${row.id}`}
            inputMode="decimal"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </FormField>
      </div>
      <FormField label="Description" htmlFor={`category-description-${row.id}`}>
        <Textarea
          id={`category-description-${row.id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setPending("save")}>
          Save category
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPending("archive")}>
          Archive
        </Button>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending === "archive" ? "Archive category" : "Update category budget"}
        impact={
          pending === "archive"
            ? "Archived categories stay in historical transactions but disappear from active selectors."
            : "Changes the granular monthly planning input. Existing approved annual budgets are not silently rewritten."
        }
        confirmLabel={pending === "archive" ? "Archive" : "Save"}
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setPending(null)}
        onConfirm={() => void apply()}
        busy={busy}
      />
    </WaiaSurface>
  );
}

export function CategoryBudgetPanel() {
  const { organizationId } = useFinanceOrg();
  const { items, loading, error, reload } = useLedgerCatalog(organizationId, "categories");
  const categories = items as TreasuryCategoryDto[];
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [monthly, setMonthly] = React.useState("0");
  const [currency, setCurrency] = React.useState("USD");
  const [description, setDescription] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<string | null>(null);

  const annualMicros = categories.reduce(
    (sum, row) => sum + BigInt(row.monthlyBudgetMicros) * 12n,
    0n,
  );

  async function create() {
    if (!organizationId) return;
    const parsed = parseHumanDecimalToAtomic(monthly, 6, { requirePositive: false });
    if (!parsed.ok) {
      setConfirmOpen(false);
      setCommandError(parsed.message);
      return;
    }
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/categories", "POST", {
      organization_id: organizationId,
      name: name.trim(),
      code: code.trim(),
      description: description.trim() || null,
      monthly_budget_micros: parsed.atomic,
      currency: currency.trim(),
      reason: reason.trim(),
    });
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setCommandError(result.message);
      return;
    }
    setCommandError(null);
    setName("");
    setCode("");
    setMonthly("0");
    setDescription("");
    setReason("");
    reload();
  }

  if (loading) return <LoadingState label="Loading categories…" />;
  if (error) return <UnavailableState code={error.code} message={error.message} onRetry={reload} />;
  if (!organizationId) return null;

  return (
    <div className="space-y-4" data-testid="finance-category-budgets">
      <WaiaSurface
        variant="elevated"
        className="flex flex-wrap items-end justify-between gap-3 p-4"
      >
        <div>
          <p className="text-muted-foreground text-sm">Active category plan · annualized</p>
          <p className="text-2xl font-medium tabular-nums">
            {formatAtomicToHumanDecimal(annualMicros.toString(), 6)}{" "}
            {categories[0]?.currency ?? currency}
          </p>
        </div>
        <p className="text-muted-foreground max-w-md text-xs">
          Monthly category inputs × 12. This planning total does not replace the separately approved
          annual public budget.
        </p>
      </WaiaSurface>
      {categories.length === 0 ? (
        <EmptyState label="No budget categories yet." />
      ) : (
        categories.map((row) => (
          <CategoryRow key={row.id} organizationId={organizationId} row={row} onSaved={reload} />
        ))
      )}
      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h3 className="font-medium">Add category</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            aria-label="Category name"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label="Category code"
            placeholder="Code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Input
            aria-label="Monthly budget"
            placeholder="Monthly budget"
            inputMode="decimal"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
          />
          <Input
            aria-label="Currency"
            placeholder="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <Textarea
          aria-label="Category description"
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {commandError ? (
          <p role="alert" className="text-destructive text-sm">
            {commandError}
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)}>
          Add category
        </Button>
      </WaiaSurface>
      <ConfirmDialog
        open={confirmOpen}
        title="Add budget category"
        impact="Creates an organization-scoped planning category. It does not verify transactions or publish an annual budget."
        confirmLabel="Add category"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void create()}
        busy={busy}
      />
    </div>
  );
}
