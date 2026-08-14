"use client";

import * as React from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { AccountingStatusPill, PublicationPill } from "@/components/treasury/admin/status-pills";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import { financeHref } from "@/lib/treasury-admin/org";
import { backendUnavailableLabel } from "@/lib/treasury-admin/facts";
import {
  canEditAccountingMeaning,
  isVerifiedFinancialLocked,
  transactionActionAffordances,
  type TreasuryTxCommand,
} from "@/lib/treasury-admin/tx-actions";
import { canExposeDetailPublicAction } from "@/lib/treasury-admin/publication";
import type {
  TreasuryEvidenceObjectDto,
  TreasuryTransactionDetailDto,
} from "@/lib/treasury-admin/types";

function Zone({
  title,
  testId,
  children,
  publicZone = false,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
  publicZone?: boolean;
}) {
  return (
    <WaiaSurface
      variant={publicZone ? "elevated" : "raised"}
      className="space-y-3 p-4"
      data-testid={testId}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </WaiaSurface>
  );
}

function TransactionReviewInner({ transactionId }: { transactionId: string }) {
  const { organizationId } = useFinanceOrg();
  const [detail, setDetail] = React.useState<TreasuryTransactionDetailDto | null>(null);
  const [evidence, setEvidence] = React.useState<TreasuryEvidenceObjectDto[]>([]);
  const [evidenceError, setEvidenceError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState<TreasuryTxCommand | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = React.useState("");
  const [correctionId, setCorrectionId] = React.useState("");
  const [returnStatus, setReturnStatus] = React.useState("NEEDS_REVIEW");
  const [publicationTarget, setPublicationTarget] = React.useState("DETAIL_PUBLIC");
  const [supersededBy, setSupersededBy] = React.useState("");
  const [patch, setPatch] = React.useState({
    kind: "",
    direction: "",
    fundBucketCode: "",
    purpose: "",
    category: "",
    projectModule: "",
    milestoneStage: "",
    budgetId: "",
    fundingNeedId: "",
    accountingAmountMicros: "",
    description: "",
    internalNotes: "",
    publicDescription: "",
    counterpartyDisplay: "",
    publishCounterparty: false,
  });

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    const result = await treasuryGet<TreasuryTransactionDetailDto>(
      `/api/admin/treasury/transactions/${transactionId}`,
      organizationId,
      { id: transactionId },
    );
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      setDetail(null);
      setLoading(false);
      return;
    }
    const tx = result.data.transaction;
    setDetail(result.data);
    setPatch({
      kind: tx.kind ?? "",
      direction: tx.direction,
      fundBucketCode: tx.fundBucketCode,
      purpose: tx.purpose ?? "",
      category: tx.category ?? "",
      projectModule: tx.projectModule ?? "",
      milestoneStage: tx.milestoneStage ?? "",
      budgetId: tx.budgetId ?? "",
      fundingNeedId: tx.fundingNeedId ?? "",
      accountingAmountMicros: tx.accountingAmountMicros ?? "",
      description: tx.description ?? "",
      internalNotes: tx.internalNotes ?? "",
      publicDescription: tx.publicDescription ?? "",
      counterpartyDisplay: tx.counterpartyDisplay ?? "",
      publishCounterparty: tx.publishCounterparty,
    });
    const evidenceResult = await treasuryGet<{ evidence: TreasuryEvidenceObjectDto[] }>(
      "/api/admin/treasury/evidence",
      organizationId,
    );
    if (!evidenceResult.ok) {
      setEvidenceError(evidenceResult.code);
    } else {
      setEvidence(evidenceResult.data.evidence ?? []);
      setEvidenceError(null);
    }
    setLoading(false);
  }, [organizationId, transactionId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function runCommand(command: TreasuryTxCommand) {
    if (!organizationId || !detail) return;
    setBusy(true);
    setCommandError(null);
    const body: Record<string, unknown> = {
      organization_id: organizationId,
      command,
      transaction_id: detail.transaction.id,
      reason,
    };
    if (command === "classify") {
      body.patch = {
        kind: patch.kind || null,
        direction: patch.direction,
        fundBucketCode: patch.fundBucketCode,
        purpose: patch.purpose || null,
        category: patch.category || null,
        projectModule: patch.projectModule || null,
        milestoneStage: patch.milestoneStage || null,
        budgetId: patch.budgetId || null,
        fundingNeedId: patch.fundingNeedId || null,
        accountingAmountMicros: patch.accountingAmountMicros || null,
        description: patch.description || null,
        internalNotes: patch.internalNotes || null,
        publicDescription: patch.publicDescription || null,
        counterpartyDisplay: patch.counterpartyDisplay || null,
        publishCounterparty: patch.publishCounterparty,
      };
    }
    if (command === "confirm_duplicate") body.duplicate_of_transaction_id = duplicateOf;
    if (command === "return_from_reconciliation") body.to_status = returnStatus;
    if (command === "set_detail_publication") {
      body.detail_publication = publicationTarget;
      if (publicationTarget === "SUPERSEDED") body.superseded_by_id = supersededBy;
    }
    if (command === "link_correction") {
      body.original_transaction_id = detail.transaction.id;
      body.correction_transaction_id = correctionId;
    }
    const result = await treasuryJson("/api/admin/treasury/transactions/commands", "POST", body);
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setCommandError(result.message);
      return;
    }
    setReason("");
    await load();
  }

  if (loading) return <LoadingState label="Loading transaction…" />;
  if (error)
    return (
      <UnavailableState code={error.code} message={error.message} onRetry={() => void load()} />
    );
  if (!detail) return <UnavailableState message="Transaction was not found." />;

  const tx = detail.transaction;
  const actions = transactionActionAffordances(tx.status);
  const locked = isVerifiedFinancialLocked(tx.status);
  const meaningEditable = canEditAccountingMeaning(tx.status);
  const pendingAction = pending ? actions.find((item) => item.command === pending) : null;

  return (
    <div className="space-y-4" data-testid="finance-transaction-review">
      <div className="flex flex-wrap items-center gap-2">
        <AccountingStatusPill status={tx.status} />
        <PublicationPill state={tx.detailPublication} />
        {tx.status === "VERIFIED" && tx.detailPublication === "PRIVATE" ? (
          <span data-testid="verified-private-valid" className="text-muted-foreground text-xs">
            Verified + Private is a valid state
          </span>
        ) : null}
      </div>

      <Zone title="A. Provenance / observation" testId="zone-provenance">
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <dt>Provenance</dt>
          <dd>{tx.provenance}</dd>
          <dt>Canonical network</dt>
          <dd>{tx.canonicalNetwork ?? "None"}</dd>
          <dt>Canonical token</dt>
          <dd>{tx.canonicalTokenContract ?? "None"}</dd>
          <dt>Canonical tx hash</dt>
          <dd className="font-mono text-xs">{tx.canonicalTxHash ?? tx.txHash ?? "None"}</dd>
          <dt>Transfer index</dt>
          <dd>{tx.canonicalTransferIndex ?? "None"}</dd>
          <dt>Native amount</dt>
          <dd className="font-mono">
            {tx.nativeAmountAtomic ?? "None"} {tx.nativeAsset}
          </dd>
          <dt>Occurred at</dt>
          <dd>{tx.occurredAt ?? "None"}</dd>
        </dl>
        {detail.observations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No linked observations.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {detail.observations.map((obs) => (
              <li key={obs.id}>
                {obs.observationStatus} · confirmations {obs.confirmationsObserved}/
                {obs.confirmationsRequired}
              </li>
            ))}
          </ul>
        )}
      </Zone>

      <Zone title="B. Accounting meaning" testId="zone-accounting">
        {locked ? (
          <p className="text-muted-foreground text-sm">
            Finalized financial truth is locked. Use a correcting MANUAL draft and link_correction.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["kind", "Kind"],
              ["direction", "Direction"],
              ["fundBucketCode", "Fund bucket"],
              ["purpose", "Purpose"],
              ["category", "Category"],
              ["projectModule", "Project / module"],
              ["milestoneStage", "Milestone"],
              ["budgetId", "Budget"],
              ["fundingNeedId", "Funding need"],
              ["accountingAmountMicros", "Accounting amount (micros string)"],
              ["description", "Description"],
              ["internalNotes", "Internal notes"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span>{label}</span>
              <Input
                value={patch[key]}
                disabled={!meaningEditable}
                onChange={(event) =>
                  setPatch((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      </Zone>

      <Zone title="C. Evidence" testId="zone-evidence">
        {detail.evidenceLinks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No evidence linked.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.evidenceLinks.map((link) => {
              const object = evidence.find((row) => row.id === link.evidenceObjectId);
              return (
                <li key={link.id} className="border-border rounded-md border p-2">
                  <p>Object {link.evidenceObjectId}</p>
                  {object ? (
                    <p className="text-muted-foreground text-xs">
                      {object.kind} · {object.visibility} · {object.mediaType} · digest{" "}
                      {object.sha256} · source {object.source}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {evidenceError ? (
          <p data-testid="evidence-unavailable" className="text-sm">
            {backendUnavailableLabel(evidenceError)}
          </p>
        ) : null}
      </Zone>

      <Zone title="D. Public disclosure" testId="zone-public" publicZone>
        <p className="text-muted-foreground text-xs">
          Separate from internal accounting. Public recent activity requires VERIFIED + Public
          detail + not superseded.
        </p>
        <label className="block space-y-1 text-sm">
          Public description
          <Input
            value={patch.publicDescription}
            disabled={!meaningEditable}
            onChange={(event) =>
              setPatch((current) => ({ ...current, publicDescription: event.target.value }))
            }
          />
        </label>
        <label className="block space-y-1 text-sm">
          Counterparty display
          <Input
            value={patch.counterpartyDisplay}
            disabled={!meaningEditable}
            onChange={(event) =>
              setPatch((current) => ({ ...current, counterpartyDisplay: event.target.value }))
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={patch.publishCounterparty}
            disabled={!meaningEditable}
            onChange={(event) =>
              setPatch((current) => ({ ...current, publishCounterparty: event.target.checked }))
            }
          />
          Publish counterparty
        </label>
        {canExposeDetailPublicAction(tx.status) ? (
          <div className="space-y-2" data-testid="detail-public-controls">
            <label className="block space-y-1 text-sm">
              Publication target
              <select
                className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={publicationTarget}
                onChange={(event) => setPublicationTarget(event.target.value)}
              >
                <option value="PRIVATE">Private</option>
                <option value="DETAIL_PUBLIC">Public detail</option>
                <option value="SUPERSEDED">Superseded</option>
              </select>
            </label>
            {publicationTarget === "SUPERSEDED" ? (
              <Input
                placeholder="detail superseded by id"
                value={supersededBy}
                onChange={(event) => setSupersededBy(event.target.value)}
              />
            ) : null}
            <Button type="button" onClick={() => setPending("set_detail_publication")}>
              Set publication
            </Button>
          </div>
        ) : (
          <p data-testid="detail-public-hidden" className="text-muted-foreground text-sm">
            Public detail can be set only after accounting status is VERIFIED.
          </p>
        )}
      </Zone>

      <Zone title="E. History" testId="zone-history">
        {detail.revisions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No revisions yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {detail.revisions.map((rev) => (
              <li key={rev.id}>
                #{rev.seq} · {rev.actorType} · {rev.reason ?? "no reason"} · {rev.createdAt}
              </li>
            ))}
          </ol>
        )}
      </Zone>

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Human commands</h2>
        {commandError ? <p className="text-destructive text-sm">{commandError}</p> : null}
        <div className="flex flex-wrap gap-2">
          {actions
            .filter((action) => action.command !== "set_detail_publication")
            .map((action) => (
              <Button
                key={action.command}
                type="button"
                variant={action.impact === "high" ? "default" : "outline"}
                data-testid={`tx-action-${action.command}`}
                onClick={() => setPending(action.command)}
              >
                {action.label}
              </Button>
            ))}
        </div>
        {actions.some((action) => action.command === "confirm_duplicate") ? (
          <Input
            placeholder="Duplicate of transaction id"
            value={duplicateOf}
            onChange={(event) => setDuplicateOf(event.target.value)}
          />
        ) : null}
        {actions.some((action) => action.command === "return_from_reconciliation") ? (
          <select
            className="border-border bg-background rounded-md border px-3 py-2 text-sm"
            value={returnStatus}
            onChange={(event) => setReturnStatus(event.target.value)}
          >
            <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
            <option value="REJECTED">REJECTED</option>
            <option value="DUPLICATE">DUPLICATE</option>
            <option value="VERIFIED">VERIFIED</option>
          </select>
        ) : null}
        {tx.status === "VERIFIED" ? (
          <div className="space-y-2" data-testid="correction-workflow">
            <p className="text-sm">
              Correction is append-only: create a MANUAL draft with corrects_transaction_id, then
              link it here. If public detail must be replaced, set SUPERSEDED with
              detailSupersededById.
            </p>
            <Link
              className="text-sm underline"
              href={financeHref("/finance/transactions/new", organizationId)}
            >
              Create correcting manual draft
            </Link>
            <Input
              placeholder="Correction transaction id"
              value={correctionId}
              onChange={(event) => setCorrectionId(event.target.value)}
            />
          </div>
        ) : null}
      </WaiaSurface>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.label ?? "Confirm"}
        impact={
          pending === "verify"
            ? "Verify writes finalized financial truth. It does not publish public detail."
            : pending === "set_detail_publication"
              ? "Publication does not change accounting status. Public recent activity requires VERIFIED + public detail + not superseded."
              : pending === "link_correction"
                ? "Correction links a new MANUAL draft. Original verified truth is not rewritten."
                : "This command writes an audited Treasury mutation."
        }
        confirmLabel="Confirm"
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void runCommand(pending)}
        busy={busy}
      />
    </div>
  );
}

export function TransactionReviewPanel({ transactionId }: { transactionId: string }) {
  return (
    <OrgGate>
      <TransactionReviewInner transactionId={transactionId} />
    </OrgGate>
  );
}
