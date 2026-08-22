"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { FormField, MoreDetails } from "@/components/treasury/admin/form-controls";
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
import { missingOrganizationResult, treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import {
  formatAtomicToHumanDecimal,
  parseHumanDecimalToAtomic,
} from "@/lib/treasury-admin/parse-human-amount";
import type {
  TreasuryApiResult,
  TreasuryCategoryBudgetCategoryDto,
  TreasuryCategoryBudgetMonthDto,
  TreasuryCategoryDto,
} from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { cn } from "@/lib/utils";

const CATEGORY_GROUPS = ["Development", "Advertising", "Payroll", "Equipment", "Office"];

function BudgetAmount({ micros, currency }: { micros: string; currency: string }) {
  return (
    <span
      className={cn("font-mono tabular-nums", micros.startsWith("-") && "text-destructive")}
      data-testid={micros.startsWith("-") ? "money-negative" : "money-value"}
    >
      {formatAtomicToHumanDecimal(micros, 6)} {currency}
    </span>
  );
}

function CategoryRow({
  organizationId,
  row,
  detail,
  onSaved,
}: {
  organizationId: string;
  row: TreasuryCategoryBudgetCategoryDto;
  detail?: TreasuryCategoryDto;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(row.name);
  const [groupName, setGroupName] = React.useState(row.groupName);
  const [monthly, setMonthly] = React.useState(() =>
    formatAtomicToHumanDecimal(row.budgetMicros, 6),
  );
  const [description, setDescription] = React.useState(detail?.description ?? "");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState<"save" | "archive" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function apply() {
    const parsed = parseHumanDecimalToAtomic(monthly, 6, { requirePositive: true });
    if (pending === "save" && (!parsed.ok || !name.trim() || !groupName.trim())) {
      setPending(null);
      setError(
        !parsed.ok ? parsed.message : "Name, group, and a positive monthly limit are required.",
      );
      return;
    }
    if (!reason.trim()) {
      setPending(null);
      setError("Add an audit reason.");
      return;
    }
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/categories", "PATCH", {
      organization_id: organizationId,
      id: row.categoryId,
      ...(pending === "archive"
        ? { is_active: false }
        : {
            name: name.trim(),
            group_name: groupName.trim(),
            description: description.trim() || null,
            monthly_budget_micros: parsed.ok ? parsed.atomic : row.budgetMicros,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-muted-foreground text-xs">
            {row.code} · {row.groupName} · {row.currency}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right text-xs">
          <dt className="text-muted-foreground">Budget</dt>
          <dt className="text-muted-foreground">Spent</dt>
          <dt className="text-muted-foreground">Remaining</dt>
          <dd><BudgetAmount micros={row.budgetMicros} currency={row.currency} /></dd>
          <dd><BudgetAmount micros={row.spentMicros} currency={row.currency} /></dd>
          <dd><BudgetAmount micros={row.remainingMicros} currency={row.currency} /></dd>
        </dl>
      </div>
      <MoreDetails summary="Edit category">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Name" htmlFor={`category-name-${row.categoryId}`}>
            <Input id={`category-name-${row.categoryId}`} value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Group" htmlFor={`category-group-${row.categoryId}`}>
            <Input id={`category-group-${row.categoryId}`} list="finance-category-groups" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
          </FormField>
          <FormField label="Monthly limit" htmlFor={`category-monthly-${row.categoryId}`} help="Enter a positive expense limit. The minus sign comes from outgoing transactions.">
            <Input id={`category-monthly-${row.categoryId}`} inputMode="decimal" value={monthly} onChange={(event) => setMonthly(event.target.value)} />
          </FormField>
          <FormField label="Currency" htmlFor={`category-currency-${row.categoryId}`}>
            <Input id={`category-currency-${row.categoryId}`} value={row.currency} disabled />
          </FormField>
        </div>
        <FormField label="Description" htmlFor={`category-description-${row.categoryId}`}>
          <Textarea id={`category-description-${row.categoryId}`} value={description} onChange={(event) => setDescription(event.target.value)} />
        </FormField>
        {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setPending("save")}>Save category</Button>
          <Button type="button" variant="ghost" onClick={() => setPending("archive")}>Archive</Button>
        </div>
      </MoreDetails>
      <ConfirmDialog
        open={pending !== null}
        title={pending === "archive" ? "Archive category" : "Update category"}
        impact={pending === "archive" ? "Historical transactions keep this category, but it leaves active selectors." : "The new limit and group become the effective monthly budget input. Historical months remain intact."}
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
  const categoriesQuery = useLedgerCatalog(organizationId, "categories");
  const categoryDetails = new Map(
    (categoriesQuery.items as TreasuryCategoryDto[]).map((category) => [category.id, category]),
  );
  const query = React.useCallback((): Promise<TreasuryApiResult<{ month: TreasuryCategoryBudgetMonthDto }>> => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ month: TreasuryCategoryBudgetMonthDto }>(
      "/api/admin/treasury/category-budgets",
      organizationId,
    );
  }, [organizationId]);
  const summary = useTreasuryQuery(Boolean(organizationId), `category-budgets:${organizationId ?? ""}`, query);
  const [name, setName] = React.useState("");
  const [groupName, setGroupName] = React.useState("Development");
  const [monthly, setMonthly] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [description, setDescription] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<string | null>(null);

  function reload() {
    summary.reload();
    categoriesQuery.reload();
  }

  async function create() {
    if (!organizationId) return;
    const parsed = parseHumanDecimalToAtomic(monthly, 6, { requirePositive: true });
    if (!parsed.ok || !name.trim() || !groupName.trim() || !currency.trim()) {
      setConfirmOpen(false);
      setCommandError(!parsed.ok ? parsed.message : "Name, group, currency, and a positive monthly limit are required.");
      return;
    }
    setBusy(true);
    const result = await treasuryJson("/api/admin/treasury/categories", "POST", {
      organization_id: organizationId,
      name: name.trim(),
      group_name: groupName.trim(),
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
    setGroupName("Development");
    setMonthly("");
    setDescription("");
    setReason("");
    reload();
  }

  if (summary.loading || categoriesQuery.loading) return <LoadingState label="Loading budget…" />;
  const displayError = summary.error ?? categoriesQuery.error;
  if (displayError) return <UnavailableState code={displayError.code} message={displayError.message} onRetry={reload} />;
  if (!organizationId) return null;
  const month = summary.data?.month;

  return (
    <div className="space-y-4" data-testid="finance-category-budgets">
      <datalist id="finance-category-groups">
        {CATEGORY_GROUPS.map((group) => <option key={group} value={group} />)}
      </datalist>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-muted-foreground text-xs tracking-wide uppercase">Current month</p><h3 className="text-lg font-medium">{month?.month ?? "—"}</h3></div>
        <p className="text-muted-foreground max-w-md text-xs">Spend and remaining are derived from verified transactions by the server.</p>
      </div>
      {month?.totals.map((total) => (
        <WaiaSurface key={total.currency} variant="elevated" className="p-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            {[["Budget", total.budgetMicros], ["Spent", total.spentMicros], ["Remaining", total.remainingMicros]].map(([label, value]) => (
              <div key={label}><dt className="text-muted-foreground text-xs">{label}</dt><dd className="mt-1 text-lg"><BudgetAmount micros={value} currency={total.currency} /></dd></div>
            ))}
          </dl>
        </WaiaSurface>
      ))}
      {month && month.groups.length > 0 ? (
        <WaiaSurface variant="raised" className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm" data-testid="budget-groups">
            <thead className="bg-muted/30"><tr className="border-b"><th className="p-3">Group</th><th className="p-3 text-right">Budget</th><th className="p-3 text-right">Spent</th><th className="p-3 text-right">Remaining</th></tr></thead>
            <tbody>{month.groups.map((group) => (
              <tr key={`${group.groupName}:${group.currency}`} className="border-b last:border-0">
                <td className="p-3 font-medium">{group.groupName}</td>
                <td className="p-3 text-right"><BudgetAmount micros={group.budgetMicros} currency={group.currency} /></td>
                <td className="p-3 text-right"><BudgetAmount micros={group.spentMicros} currency={group.currency} /></td>
                <td className="p-3 text-right"><BudgetAmount micros={group.remainingMicros} currency={group.currency} /></td>
              </tr>
            ))}</tbody>
          </table>
        </WaiaSurface>
      ) : null}
      {!month || month.categories.length === 0 ? <EmptyState label="No budget categories yet." /> : month.categories.map((row) => (
        <CategoryRow key={row.categoryId} organizationId={organizationId} row={row} detail={categoryDetails.get(row.categoryId)} onSaved={reload} />
      ))}
      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <div><h3 className="font-medium">Add category</h3><p className="text-muted-foreground text-xs">The unique category code is generated automatically.</p></div>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Name" htmlFor="new-category-name"><Input id="new-category-name" value={name} onChange={(event) => setName(event.target.value)} /></FormField>
          <FormField label="Group" htmlFor="new-category-group" help="Choose a suggestion or type a new group."><Input id="new-category-group" list="finance-category-groups" value={groupName} onChange={(event) => setGroupName(event.target.value)} /></FormField>
          <FormField label="Monthly limit" htmlFor="new-category-monthly" help="Enter a positive expense limit without a minus sign."><Input id="new-category-monthly" inputMode="decimal" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></FormField>
          <FormField label="Currency" htmlFor="new-category-currency"><Input id="new-category-currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></FormField>
        </div>
        <FormField label="Description (optional)" htmlFor="new-category-description"><Textarea id="new-category-description" value={description} onChange={(event) => setDescription(event.target.value)} /></FormField>
        {commandError ? <p role="alert" className="text-destructive text-sm">{commandError}</p> : null}
        <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)}>Add category</Button>
      </WaiaSurface>
      <ConfirmDialog
        open={confirmOpen}
        title="Add budget category"
        impact="Creates a category and its effective monthly limit. The server generates the code and derived totals."
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
