"use client";

import * as React from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { FactValue } from "@/components/treasury/admin/fact-value";
import { MoreDetails } from "@/components/treasury/admin/form-controls";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { missingOrganizationResult, treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import { WATCHER_DARK_COPY } from "@/lib/treasury-admin/facts";
import { parseHumanDecimalToAtomic } from "@/lib/treasury-admin/parse-human-amount";
import { financeHref } from "@/lib/treasury-admin/org";
import type {
  BreathAdminPreviewDto,
  TreasuryApiResult,
  TreasuryFundAllocationDto,
  TreasuryOverviewCountsDto,
  TreasurySettingsDto,
} from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { cn } from "@/lib/utils";

type OverviewBundle = {
  preview: BreathAdminPreviewDto;
  counts: TreasuryOverviewCountsDto;
  settings: TreasurySettingsDto | null;
  allocation: TreasuryFundAllocationDto | null;
};

function FactCard({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <div className="text-2xl font-medium tabular-nums">{value}</div>
      <p className="text-muted-foreground text-xs">{note}</p>
    </WaiaSurface>
  );
}

function OverviewInner() {
  const { organizationId } = useFinanceOrg();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [checkpointOpen, setCheckpointOpen] = React.useState(false);
  const [checkpointAmount, setCheckpointAmount] = React.useState("");
  const [checkpointAsOf, setCheckpointAsOf] = React.useState("");
  const [checkpointNote, setCheckpointNote] = React.useState("");
  const [checkpointReason, setCheckpointReason] = React.useState("");
  const [commandError, setCommandError] = React.useState<{ code?: string; message: string } | null>(
    null,
  );

  const query = React.useCallback(async (): Promise<TreasuryApiResult<OverviewBundle>> => {
    if (!organizationId) return missingOrganizationResult();
    const [previewResult, countsResult, settingsResult, allocationResult] = await Promise.all([
      treasuryGet<{ preview: BreathAdminPreviewDto }>(
        "/api/admin/treasury/breath-preview",
        organizationId,
      ),
      treasuryGet<TreasuryOverviewCountsDto>("/api/admin/treasury/overview-counts", organizationId),
      treasuryGet<{ settings: TreasurySettingsDto | null }>(
        "/api/admin/treasury/settings",
        organizationId,
      ),
      treasuryGet<{ allocation: TreasuryFundAllocationDto }>(
        "/api/admin/treasury/fund-allocation",
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
        allocation: allocationResult.ok ? allocationResult.data.allocation : null,
      },
    };
  }, [organizationId]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `overview:${organizationId ?? ""}`,
    query,
  );

  async function confirmBreathToggle() {
    if (!organizationId || !data?.settings) return;
    setBusy(true);
    const result = await treasuryJson<{ settings: TreasurySettingsDto }>(
      "/api/admin/treasury/settings",
      "PATCH",
      {
        organization_id: organizationId,
        breath_enabled: !data.settings.breathEnabled,
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

  async function confirmBalanceCheckpoint() {
    if (!organizationId) return;
    const parsed = parseHumanDecimalToAtomic(checkpointAmount, 6, { requirePositive: false });
    if (!parsed.ok) {
      setCommandError({ code: parsed.code, message: parsed.message });
      setCheckpointOpen(false);
      return;
    }
    const asOf = new Date(checkpointAsOf);
    if (!checkpointAsOf || !Number.isFinite(asOf.getTime()) || !checkpointNote.trim()) {
      setCommandError({
        code: "INVALID_CHECKPOINT",
        message: "Enter a valid as-of time and an evidence note.",
      });
      setCheckpointOpen(false);
      return;
    }
    setBusy(true);
    const result = await treasuryJson<{ checkpoint: { id: string } }>(
      "/api/admin/treasury/balance-checkpoints",
      "POST",
      {
        organization_id: organizationId,
        currency: "USD",
        confirmed_balance_micros: parsed.atomic,
        as_of: asOf.toISOString(),
        note: checkpointNote,
        reason: checkpointReason,
      },
    );
    setBusy(false);
    setCheckpointOpen(false);
    setCheckpointReason("");
    if (!result.ok) {
      setCommandError({ code: result.code, message: result.message });
      return;
    }
    setCommandError(null);
    setCheckpointAmount("");
    setCheckpointAsOf("");
    setCheckpointNote("");
    reload();
  }

  if (loading) return <LoadingState label="Loading overview…" />;
  const displayError = commandError ?? error;
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
  if (!data) return <UnavailableState message="Overview facts are not available." />;

  const { preview, counts, settings } = data;
  const runway = preview.runway;
  const ideal = preview.idealAnnualBudget;
  const allocation = data.allocation;

  return (
    <div className="space-y-5" data-testid="finance-overview">
      <div>
        <h2 className="text-lg font-medium">Overview</h2>
        <p className="text-muted-foreground text-sm">
          The minimum information needed to understand WAIA’s financial position.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FactCard
          label="Available now"
          value={
            <FactValue
              kind={preview.currentFreeFunds ? "value" : "pending"}
              reason="No verified free-funds total"
            >
              <MoneyText micros={preview.currentFreeFunds} />
            </FactValue>
          }
          note="Verified funds after active commitments."
        />
        <FactCard
          label="Runway"
          value={
            runway.status === "available" ? (
              new Date(runway.endsAt).toLocaleDateString()
            ) : (
              <FactValue
                kind="pending"
                reason={preview.runwayStatus.reason ?? "Runway snapshot pending"}
              />
            )
          }
          note={
            runway.status === "available"
              ? `Calculated as of ${new Date(runway.runwayAsOf).toLocaleDateString()}.`
              : "Waiting for an approved burn plan and reconciled balance."
          }
        />
        <FactCard
          label="Annual budget"
          value={
            ideal ? (
              <>
                <MoneyText micros={ideal.amount} />{" "}
                <span className="text-sm">{ideal.currency}</span>
              </>
            ) : (
              <FactValue kind="pending" reason="No Human-approved active public annual budget" />
            )
          }
          note={
            ideal
              ? `Approved funding target for ${ideal.periodYear}.`
              : "Publish an approved annual budget to expose this fact."
          }
        />
      </div>

      <WaiaSurface variant="raised" className="space-y-4 p-5" data-testid="fund-allocation">
        <div>
          <h3 className="text-sm font-medium">Fund allocation</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            One approved annual budget is protected for operations. Free funds above it are
            accounted to development. Money remains in the same accounts and wallets.
          </p>
        </div>
        {allocation?.status === "available" ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">WAIA operating fund</dt>
              <dd className="mt-1 text-xl font-medium tabular-nums">
                <MoneyText micros={allocation.operatingAllocationMicros} />{" "}
                <span className="text-sm">{allocation.accountingCurrency}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Development Fund</dt>
              <dd className="mt-1 text-xl font-medium tabular-nums">
                <MoneyText micros={allocation.developmentAllocationMicros} />{" "}
                <span className="text-sm">{allocation.accountingCurrency}</span>
              </dd>
            </div>
          </dl>
        ) : (
          <FactValue
            kind="pending"
            reason={allocation?.reason ?? "Authoritative allocation is unavailable"}
          />
        )}
      </WaiaSurface>

      <WaiaSurface
        variant="elevated"
        className="flex flex-wrap items-center justify-between gap-4 p-5"
      >
        <div>
          <p className="text-sm font-medium" data-testid="review-required-count">
            {counts.reviewRequiredCount} transaction{counts.reviewRequiredCount === 1 ? "" : "s"}{" "}
            {counts.reviewRequiredCount === 1 ? "requires" : "require"} review
          </p>
          <p className="text-muted-foreground text-xs">
            Automated entries and unverified manual entries remain outside confirmed financial
            truth.
          </p>
        </div>
        <Link
          className={cn(
            buttonVariants({ variant: counts.reviewRequiredCount > 0 ? "default" : "outline" }),
            "inline-flex",
          )}
          href={financeHref("/finance/transactions", organizationId)}
        >
          Open Transactions
        </Link>
      </WaiaSurface>

      <MoreDetails
        summary="Publication and operational details"
        testId="overview-operational-details"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Breath publication</h3>
            <p className="text-sm">
              {settings?.breathEnabled ? "Enabled" : "Disabled"} · preview {preview.status}
            </p>
            <p className="text-muted-foreground text-xs">
              {counts.publicationPendingCount} verified transaction
              {counts.publicationPendingCount === 1 ? "" : "s"} await a separate publication
              decision.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="breath-enable-intent"
                disabled={!settings}
                onClick={() => setConfirmOpen(true)}
              >
                {settings?.breathEnabled ? "Disable publication" : "Enable publication"}
              </Button>
              <Link
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex")}
                href={financeHref("/finance/preview", organizationId)}
              >
                Preview public facts
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Reconciliation</dt>
            <dd>{preview.reconciliationGate.status ?? "Pending"}</dd>
            <dt>Budget</dt>
            <dd>{preview.componentStatus.budget}</dd>
            <dt>Funding need</dt>
            <dd>{preview.componentStatus.fundingNeed}</dd>
            <dt>Watcher</dt>
            <dd data-testid="watcher-dark">{WATCHER_DARK_COPY}</dd>
          </dl>
        </div>
        {preview.pendingReasons.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Pending: {preview.pendingReasons.join(", ")}
          </p>
        ) : null}
        <div className="border-border space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Human-confirmed balance checkpoint</h3>
            <p className="text-muted-foreground text-xs">
              Records an append-only observed cash balance. Verified transactions after the selected
              time update the live balance automatically.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>Balance (USD)</span>
              <Input
                value={checkpointAmount}
                inputMode="decimal"
                placeholder="26.55"
                onChange={(event) => setCheckpointAmount(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Observed at</span>
              <Input
                type="datetime-local"
                value={checkpointAsOf}
                onChange={(event) => setCheckpointAsOf(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Evidence note</span>
              <Input
                value={checkpointNote}
                placeholder="Confirmed account balance"
                onChange={(event) => setCheckpointNote(event.target.value)}
              />
            </label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!checkpointAmount || !checkpointAsOf || !checkpointNote.trim()}
            onClick={() => setCheckpointOpen(true)}
          >
            Confirm balance checkpoint
          </Button>
        </div>
      </MoreDetails>

      <ConfirmDialog
        open={confirmOpen}
        title="Change Breath publication"
        impact="Changes only the server-owned publication setting. It does not verify transactions or wire the public homepage."
        confirmLabel="Confirm change"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmBreathToggle()}
        busy={busy}
      />
      <ConfirmDialog
        open={checkpointOpen}
        title="Confirm observed cash balance"
        impact="Creates an immutable financial baseline. Verified transactions occurring after its as-of time will change the displayed balance and runway."
        confirmLabel="Record checkpoint"
        reason={checkpointReason}
        onReasonChange={setCheckpointReason}
        onCancel={() => setCheckpointOpen(false)}
        onConfirm={() => void confirmBalanceCheckpoint()}
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
