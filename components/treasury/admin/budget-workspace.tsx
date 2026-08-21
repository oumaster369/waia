"use client";

import * as React from "react";
import Link from "next/link";

import { BudgetsPanel } from "@/components/treasury/admin/budgets-panel";
import { CategoryBudgetPanel } from "@/components/treasury/admin/category-budget-panel";
import { CommitmentsPanel } from "@/components/treasury/admin/commitments-panel";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { MoreDetails } from "@/components/treasury/admin/form-controls";
import { FundingNeedsPanel } from "@/components/treasury/admin/funding-needs-panel";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { Button } from "@/components/ui/button";
import { financeHref } from "@/lib/treasury-admin/org";

type Section = "categories" | "annual" | "needs" | "commitments";

function BudgetWorkspaceInner() {
  const { organizationId } = useFinanceOrg();
  const [section, setSection] = React.useState<Section>("categories");
  const tabs: { value: Section; label: string }[] = [
    { value: "categories", label: "Categories" },
    { value: "annual", label: "Annual budget" },
    { value: "needs", label: "Funding needs" },
    { value: "commitments", label: "Commitments" },
  ];
  return (
    <div className="space-y-5" data-testid="finance-budget-workspace">
      <div>
        <h2 className="text-lg font-medium">Budget</h2>
        <p className="text-muted-foreground text-sm">
          Plan by category, approve annual funding, and track needs and commitments in one place.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Budget sections">
        {tabs.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={section === tab.value}
            variant={section === tab.value ? "default" : "outline"}
            onClick={() => setSection(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      <div role="tabpanel">
        {section === "categories" ? <CategoryBudgetPanel /> : null}
        {section === "annual" ? <BudgetsPanel /> : null}
        {section === "needs" ? <FundingNeedsPanel /> : null}
        {section === "commitments" ? <CommitmentsPanel /> : null}
      </div>
      <MoreDetails summary="Publication and evidence tools">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="underline" href={financeHref("/finance/evidence", organizationId)}>
            Evidence library
          </Link>
          <Link className="underline" href={financeHref("/finance/preview", organizationId)}>
            Publication preview
          </Link>
        </div>
      </MoreDetails>
    </div>
  );
}

export function BudgetWorkspace() {
  return (
    <OrgGate>
      <BudgetWorkspaceInner />
    </OrgGate>
  );
}
