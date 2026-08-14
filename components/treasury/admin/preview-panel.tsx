"use client";

import * as React from "react";

import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { FactValue } from "@/components/treasury/admin/fact-value";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryGet } from "@/lib/treasury-admin/api";
import { operatorPreviewDiagnostics, publicPreviewFields } from "@/lib/treasury-admin/preview";
import type { BreathAdminPreviewDto } from "@/lib/treasury-admin/types";

function PreviewInner() {
  const { organizationId } = useFinanceOrg();
  const [preview, setPreview] = React.useState<BreathAdminPreviewDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const result = await treasuryGet<{ preview: BreathAdminPreviewDto }>(
      "/api/admin/treasury/breath-preview",
      organizationId,
    );
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      setPreview(null);
      setLoading(false);
      return;
    }
    setError(null);
    setPreview(result.data.preview);
    setLoading(false);
  }, [organizationId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error)
    return (
      <UnavailableState code={error.code} message={error.message} onRetry={() => void load()} />
    );
  if (!preview) return <UnavailableState message="Preview is not available." />;

  const publicView = publicPreviewFields(preview);
  const diagnostics = operatorPreviewDiagnostics(preview);

  return (
    <div className="space-y-4" data-testid="finance-preview">
      <WaiaSurface variant="elevated" className="space-y-3 p-4" data-testid="public-view">
        <p className="text-xs uppercase tracking-wide">Public view</p>
        <h2 className="text-lg font-medium">Breath of WAIA preview</h2>
        <p className="text-sm">Publication status: {publicView.status}</p>
        <p className="text-sm">Stage: {publicView.stageLabel ?? "Pending"}</p>
        <p className="text-sm">Last updated: {publicView.lastUpdatedAt ?? "Pending"}</p>
        <p className="text-sm">Work: {publicView.work ?? "Pending"}</p>
        <p className="text-sm">Methodology: {publicView.methodologyNote ?? "Pending"}</p>
        <div>
          <h3 className="text-sm font-medium">Ideal annual budget</h3>
          {publicView.idealAnnualBudget ? (
            <p className="text-sm">
              {publicView.idealAnnualBudget.periodYear} {publicView.idealAnnualBudget.currency}{" "}
              <MoneyText micros={publicView.idealAnnualBudget.amount} />
            </p>
          ) : (
            <FactValue kind="pending" reason="No Human-approved ACTIVE PUBLIC amount" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Resources</h3>
          {publicView.resources ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Entered</dt>
              <dd>
                <MoneyText micros={publicView.resources.entered} />
              </dd>
              <dt>Spent</dt>
              <dd>
                <MoneyText micros={publicView.resources.spent} />
              </dd>
              <dt>Remaining</dt>
              <dd>
                <MoneyText micros={publicView.resources.remaining} />
              </dd>
              <dt>Allocated</dt>
              <dd>
                <MoneyText micros={publicView.resources.allocated} />
              </dd>
            </dl>
          ) : (
            <FactValue kind="pending" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Current free funds</h3>
          <FactValue kind={publicView.currentFreeFunds ? "value" : "pending"}>
            <MoneyText micros={publicView.currentFreeFunds} />
          </FactValue>
        </div>
        <div>
          <h3 className="text-sm font-medium">Budget</h3>
          {publicView.budget ? (
            <p className="text-sm">
              {publicView.budget.title} planned <MoneyText micros={publicView.budget.planned} />{" "}
              remaining <MoneyText micros={publicView.budget.remaining} />
            </p>
          ) : (
            <FactValue kind="pending" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Runway</h3>
          {publicView.runway.status === "available" ? (
            <p className="text-sm">
              {publicView.runway.runwayAsOf} → {publicView.runway.endsAt}
            </p>
          ) : (
            <FactValue kind="pending" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Recent public activity</h3>
          {publicView.recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-sm">None</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {publicView.recentActivity.map((item) => (
                <li key={`${item.occurredAt}-${item.publicDescription}`}>
                  {item.occurredAt} · {item.direction} ·{" "}
                  {item.publicDescription ?? "No description"} ·{" "}
                  <MoneyText micros={item.cashEffectMicros} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </WaiaSurface>

      <WaiaSurface variant="raised" className="space-y-3 p-4" data-testid="operator-diagnostics">
        <p className="text-xs uppercase tracking-wide">Operator diagnostics</p>
        <p className="text-sm">These fields are not the public Breath view.</p>
        <ul className="list-disc pl-5 text-xs">
          {diagnostics.pendingReasons.map((reason) => (
            <li key={reason} className="font-mono">
              {reason}
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>Breath enabled</dt>
          <dd>{String(diagnostics.componentStatus.breathEnabled)}</dd>
          <dt>Ideal budget</dt>
          <dd>{diagnostics.componentStatus.idealBudget}</dd>
          <dt>Material reconciliation</dt>
          <dd>{String(diagnostics.componentStatus.materialReconciliation)}</dd>
          <dt>Balance reconciliation</dt>
          <dd>{diagnostics.componentStatus.balanceReconciliation}</dd>
          <dt>Budget</dt>
          <dd>{diagnostics.componentStatus.budget}</dd>
          <dt>Funding need</dt>
          <dd>{diagnostics.componentStatus.fundingNeed}</dd>
          <dt>Verified financial complete</dt>
          <dd>{String(diagnostics.componentStatus.verifiedFinancialComplete)}</dd>
          <dt>Reconciliation gate</dt>
          <dd>
            {diagnostics.reconciliationGate.status ?? "none"} ·{" "}
            {diagnostics.reconciliationGate.latestId ?? "none"}
          </dd>
          <dt>Runway status</dt>
          <dd>
            {diagnostics.runwayStatus.status} · {diagnostics.runwayStatus.reason ?? "none"}
          </dd>
        </dl>
      </WaiaSurface>
    </div>
  );
}

export function PreviewPanel() {
  return (
    <OrgGate>
      <PreviewInner />
    </OrgGate>
  );
}
