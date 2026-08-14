"use client";

import * as React from "react";

import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import {
  LoadingState,
  UnavailableState,
  EmptyState,
} from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryGet, withOrganizationQuery } from "@/lib/treasury-admin/api";
import { backendUnavailableLabel } from "@/lib/treasury-admin/facts";
import type { TreasuryEvidenceObjectDto } from "@/lib/treasury-admin/types";

function EvidenceInner() {
  const { organizationId } = useFinanceOrg();
  const [rows, setRows] = React.useState<TreasuryEvidenceObjectDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [contentError, setContentError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const result = await treasuryGet<{ evidence: TreasuryEvidenceObjectDto[] }>(
      "/api/admin/treasury/evidence",
      organizationId,
    );
    if (!result.ok) {
      setError({ code: result.code, message: result.message });
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    setRows(result.data.evidence ?? []);
    setLoading(false);
  }, [organizationId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function openContent(id: string) {
    if (!organizationId) return;
    setContentError(null);
    const path = withOrganizationQuery(
      `/api/admin/treasury/evidence/${id}/content`,
      organizationId,
    );
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      setContentError(body.error?.code ?? "EVIDENCE_CONTENT_UNAVAILABLE");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (loading) return <LoadingState />;
  if (error)
    return (
      <UnavailableState code={error.code} message={error.message} onRetry={() => void load()} />
    );

  return (
    <div className="space-y-4" data-testid="finance-evidence">
      <p className="text-sm">
        Evidence is admin-only by default. Metadata is useful even when object storage is not
        configured. Content never uses a public URL.
      </p>
      {contentError ? (
        <p data-testid="evidence-storage-unavailable" className="text-sm">
          {backendUnavailableLabel(contentError)}
        </p>
      ) : null}
      {rows.length === 0 ? <EmptyState label="No evidence objects." /> : null}
      {rows.map((row) => (
        <WaiaSurface key={row.id} variant="raised" className="space-y-2 p-4">
          <p className="text-sm font-medium">
            {row.kind} · {row.visibility}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt>Media type</dt>
            <dd>{row.mediaType ?? "None"}</dd>
            <dt>Byte size</dt>
            <dd className="font-mono">{row.byteSize ?? "None"}</dd>
            <dt>Digest</dt>
            <dd className="break-all font-mono">{row.sha256 ?? "None"}</dd>
            <dt>Source</dt>
            <dd>{row.source ?? "None"}</dd>
            <dt>Storage backend</dt>
            <dd>{row.storageBackend ?? "None"}</dd>
            <dt>Uploaded by</dt>
            <dd>{row.uploadedByUserId ?? "None"}</dd>
            <dt>Created</dt>
            <dd>{row.createdAt ?? "None"}</dd>
          </dl>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void openContent(row.id)}
          >
            Open private content
          </Button>
        </WaiaSurface>
      ))}
    </div>
  );
}

export function EvidencePanel() {
  return (
    <OrgGate>
      <EvidenceInner />
    </OrgGate>
  );
}
