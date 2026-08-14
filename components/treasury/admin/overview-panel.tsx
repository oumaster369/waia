"use client";

import * as React from "react";

import { MoneyText } from "@/components/treasury/admin/money-text";
import { FactValue } from "@/components/treasury/admin/fact-value";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { Button } from "@/components/ui/button";
import { missingOrganizationResult, treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import { WATCHER_DARK_COPY } from "@/lib/treasury-admin/facts";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type {
  BreathAdminPreviewDto,
  TreasuryApiResult,
  TreasuryOverviewCountsDto,
  TreasurySettingsDto,
} from "@/lib/treasury-admin/types";

type OverviewBundle = {
  preview: BreathAdminPreviewDto;
  counts: TreasuryOverviewCountsDto;
  settings: TreasurySettingsDto | null;
};

function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </WaiaSurface>
  );
}

function OverviewInner() {
  const { organizationId } = useFinanceOrg();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<{
    code?: string;
    message: string;
  } | null>(null);

  const query = React.useCallback(async (): Promise<TreasuryApiResult<OverviewBundle>> => {
    if (!organizationId) return missingOrganizationResult();
    const [previewResult, countsResult, settingsResult] = await Promise.all([
      treasuryGet<{ preview: BreathAdminPreviewDto }>(
        "/api/admin/treasury/breath-preview",
        organizationId,
      ),
      treasuryGet<TreasuryOverviewCountsDto>("/api/admin/treasury/overview-counts", organizationId),
      treasuryGet<{ settings: TreasurySettingsDto | null }>(
        "/api/admin/treasury/settings",
        organizationId,
      ),
    ]);
    if (!previewResult.ok) return previewResult;
    if (!countsResult.ok) return countsResult;
    return {
      ok: true,
      data: {
        preview: previewResult.data.preview,
        counts: countsResult.data,
        settings: settingsResult.ok ? (settingsResult.data.settings ?? null) : null,
      },
    };
  }, [organizationId]);

  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `overview:${organizationId ?? ""}`,
    query,
  );
  const preview = data?.preview ?? null;
  const counts = data?.counts ?? null;
  const settings = data?.settings ?? null;
  const displayError = commandError ?? error;

  async function confirmBreathToggle() {
    if (!organizationId || !settings) return;
    setBusy(true);
    const result = await treasuryJson<{ settings: TreasurySettingsDto }>(
      "/api/admin/treasury/settings",
      "PATCH",
      {
        organization_id: organizationId,
        breath_enabled: !settings.breathEnabled,
        reason,
      },
    );
    setBusy(false);
    setConfirmOpen(false);
    setReason("");
    if (!result.ok) {
      setCommandError({ code: result.code, message: result.message });
      return;
    }
    setCommandError(null);
    reload();
  }

  if (loading) return <LoadingState label="Loading overview…" />;
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
  if (!preview || !counts) return <UnavailableState message="Overview facts are not available." />;

  const resources = preview.resources;
  const budget = preview.budget;
  const ideal = preview.idealAnnualBudget;
  const runway = preview.runway;

  return (
    <div className="space-y-4" data-testid="finance-overview">
      <div className="grid gap-4 md:grid-cols-2">
        <PreviewCard title="Accounting cash">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Entered</dt>
            <dd>
              <FactValue
                kind={resources ? "value" : "pending"}
                reason="No published resource totals"
              >
                <MoneyText micros={resources?.entered ?? null} />
              </FactValue>
            </dd>
            <dt>Spent</dt>
            <dd>
              <MoneyText micros={resources?.spent ?? null} />
            </dd>
            <dt>Remaining</dt>
            <dd>
              <MoneyText micros={resources?.remaining ?? null} />
            </dd>
            <dt>Allocated / active commitments</dt>
            <dd>
              <MoneyText micros={resources?.allocated ?? null} />
            </dd>
            <dt>Needed next (server)</dt>
            <dd>
              <FactValue
                kind={resources?.neededNext ? "value" : "pending"}
                reason="No funding-gap total"
              >
                <MoneyText micros={resources?.neededNext ?? null} />
              </FactValue>
            </dd>
            <dt>Current free funds</dt>
            <dd>
              <FactValue kind={preview.currentFreeFunds ? "value" : "pending"}>
                <MoneyText micros={preview.currentFreeFunds} />
              </FactValue>
            </dd>
          </dl>
        </PreviewCard>

        <PreviewCard title="Current budget">
          {budget ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Title</dt>
              <dd>
                {budget.title} ({budget.code})
              </dd>
              <dt>Planned</dt>
              <dd>
                <MoneyText micros={budget.planned} />
              </dd>
              <dt>Funded</dt>
              <dd>
                <MoneyText micros={budget.funded} />
              </dd>
              <dt>Committed</dt>
              <dd>
                <MoneyText micros={budget.committed} />
              </dd>
              <dt>Spent</dt>
              <dd>
                <MoneyText micros={budget.spent} />
              </dd>
              <dt>Remaining (signed)</dt>
              <dd>
                <MoneyText micros={budget.remaining} />
              </dd>
              <dt>Fill (display only)</dt>
              <dd className="font-mono">{budget.fillRatio}</dd>
            </dl>
          ) : (
            <FactValue kind="pending" reason={preview.componentStatus.budget} />
          )}
        </PreviewCard>

        <PreviewCard title="Ideal annual budget">
          {ideal ? (
            <p className="text-sm">
              {ideal.periodYear} {ideal.currency} <MoneyText micros={ideal.amount} />
            </p>
          ) : (
            <FactValue kind="pending" reason="No Human-approved ACTIVE PUBLIC amount" />
          )}
        </PreviewCard>

        <PreviewCard title="Runway">
          {runway.status === "available" ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>As of</dt>
              <dd>{runway.runwayAsOf}</dd>
              <dt>Ends</dt>
              <dd>{runway.endsAt}</dd>
              <dt>Free funds at as-of</dt>
              <dd>
                <MoneyText micros={runway.freeFundsAtAsOf} />
              </dd>
              <dt>Approved daily burn</dt>
              <dd>
                <MoneyText micros={runway.approvedDailyBurn} />
              </dd>
            </dl>
          ) : (
            <FactValue
              kind="pending"
              reason={preview.runwayStatus.reason ?? "Runway snapshot pending"}
            />
          )}
        </PreviewCard>
      </div>

      <PreviewCard title="Review queues">
        <p className="text-sm" data-testid="review-required-count">
          Review required: {counts.reviewRequiredCount}
        </p>
        <p className="text-sm" data-testid="publication-pending-count">
          Publication pending (verified + private): {counts.publicationPendingCount}
        </p>
      </PreviewCard>

      <PreviewCard title="Reconciliation">
        <p className="text-sm">Gate status: {preview.reconciliationGate.status ?? "None"}</p>
        <p className="text-muted-foreground text-xs">
          Latest: {preview.reconciliationGate.latestId ?? "none"} ·{" "}
          {preview.reconciliationGate.createdAt ?? "no timestamp"}
        </p>
        <p className="text-sm">
          Balance component: {preview.componentStatus.balanceReconciliation}
        </p>
      </PreviewCard>

      <PreviewCard title="Watcher">
        <p className="text-sm" data-testid="watcher-dark">
          {WATCHER_DARK_COPY}
        </p>
        <p className="text-muted-foreground text-xs">
          No last-sync time is available. Watcher remains disabled.
        </p>
      </PreviewCard>

      {preview.pendingReasons.length > 0 ? (
        <PreviewCard title="Pending reasons">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {preview.pendingReasons.map((reasonCode) => (
              <li key={reasonCode} className="font-mono text-xs">
                {reasonCode}
              </li>
            ))}
          </ul>
        </PreviewCard>
      ) : null}

      <PreviewCard title="Breath publication">
        <p className="text-sm">
          Breath enabled: {settings?.breathEnabled ? "Yes" : "No"} (backend value is authoritative)
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="breath-enable-intent"
          onClick={() => setConfirmOpen(true)}
        >
          {settings?.breathEnabled ? "Disable Breath publication" : "Enable Breath publication"}
        </Button>
      </PreviewCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Change Breath publication"
        impact="This is a high-impact publication control. It does not wire the public homepage. The backend settings value remains the authority."
        confirmLabel="Confirm Breath change"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmBreathToggle()}
        busy={busy}
      />
    </div>
  );
}

export function OverviewPanel() {
  return (
    <OrgGate>
      <OverviewInner />
    </OrgGate>
  );
}
