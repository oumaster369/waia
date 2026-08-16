"use client";

import * as React from "react";

import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type {
  TreasuryApiResult,
  TreasuryBudgetDto,
  TreasuryFundingNeedDto,
} from "@/lib/treasury-admin/types";

export function useOrgBudgets(organizationId: string | null) {
  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ budgets: TreasuryBudgetDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ budgets: TreasuryBudgetDto[] }>(
      "/api/admin/treasury/budgets",
      organizationId,
    );
  }, [organizationId]);
  const result = useTreasuryQuery(
    Boolean(organizationId),
    `budgets-select:${organizationId ?? ""}`,
    query,
  );
  return {
    budgets: result.data?.budgets ?? [],
    loading: result.loading,
    error: result.error,
  };
}

export function useOrgFundingNeeds(organizationId: string | null) {
  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ fundingNeeds: TreasuryFundingNeedDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ fundingNeeds: TreasuryFundingNeedDto[] }>(
      "/api/admin/treasury/funding-needs",
      organizationId,
    );
  }, [organizationId]);
  const result = useTreasuryQuery(
    Boolean(organizationId),
    `funding-needs-select:${organizationId ?? ""}`,
    query,
  );
  return {
    fundingNeeds: result.data?.fundingNeeds ?? [],
    loading: result.loading,
    error: result.error,
  };
}

export function budgetOptionLabel(budget: Pick<TreasuryBudgetDto, "title" | "code">): string {
  return `${budget.title} — ${budget.code}`;
}

export function fundingNeedOptionLabel(
  need: Pick<TreasuryFundingNeedDto, "title" | "targetStage" | "id">,
): string {
  return need.targetStage ? `${need.title} — ${need.targetStage}` : need.title;
}
