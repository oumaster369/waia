"use client";

import { CanonicalSelect, FieldHelp, FormField } from "@/components/treasury/admin/form-controls";
import {
  budgetOptionLabel,
  fundingNeedOptionLabel,
} from "@/components/treasury/admin/use-org-catalog";
import type { TreasuryBudgetDto, TreasuryFundingNeedDto } from "@/lib/treasury-admin/types";

export function BudgetSelect({
  id,
  value,
  onChange,
  budgets,
  disabled,
  blankLabel,
  testId,
  help,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  budgets: TreasuryBudgetDto[];
  disabled?: boolean;
  blankLabel: string;
  testId?: string;
  help?: string;
}) {
  const options = budgets.map((budget) => ({
    value: budget.id,
    label: budgetOptionLabel(budget),
  }));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: `Current record (${value.slice(0, 8)})` });
  }
  return (
    <FormField label="Budget" htmlFor={id} help={help}>
      <CanonicalSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        blankLabel={blankLabel}
        disabled={disabled}
        testId={testId}
      />
    </FormField>
  );
}

export function FundingNeedSelect({
  id,
  value,
  onChange,
  fundingNeeds,
  disabled,
  blankLabel,
  testId,
  help,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  fundingNeeds: TreasuryFundingNeedDto[];
  disabled?: boolean;
  blankLabel: string;
  testId?: string;
  help?: string;
}) {
  const options = fundingNeeds.map((need) => ({
    value: need.id,
    label: fundingNeedOptionLabel(need),
  }));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: `Current record (${value.slice(0, 8)})` });
  }
  return (
    <FormField label="Funding need" htmlFor={id} help={help}>
      <CanonicalSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        blankLabel={blankLabel}
        disabled={disabled}
        testId={testId}
      />
    </FormField>
  );
}

export function CatalogStatus({
  loading,
  error,
}: {
  loading: boolean;
  error: { message: string } | null;
}) {
  if (loading) return <FieldHelp>Loading organization records…</FieldHelp>;
  if (error) return <FieldHelp>{error.message}</FieldHelp>;
  return null;
}
