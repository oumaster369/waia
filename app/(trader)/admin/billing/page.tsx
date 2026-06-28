"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  adminFetch,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { ReadReviewActionShell } from "@/components/trader/admin/read-review-action-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminBillingPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState(
    searchParams.get("organization_id") ?? "",
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [exchangeAccountId, setExchangeAccountId] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");
  const [invoices, setInvoices] = React.useState<Record<string, unknown> | null>(null);
  const [invoiceDetail, setInvoiceDetail] = React.useState<Record<string, unknown> | null>(null);
  const [dispute, setDispute] = React.useState<Record<string, unknown> | null>(null);
  const [readLoading, setReadLoading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [commandMessage, setCommandMessage] = React.useState<string | null>(null);

  const loadReadState = React.useCallback(async () => {
    if (!organizationId || !exchangeAccountId) {
      return;
    }
    setReadLoading(true);
    setReadError(null);

    const listResult = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/invoices?organization_id=${encodeURIComponent(organizationId)}&exchange_account_id=${encodeURIComponent(exchangeAccountId)}`,
    );
    if (!listResult.ok) {
      setReadError(listResult.message);
      setInvoices(null);
      setInvoiceDetail(null);
      setDispute(null);
      setReadLoading(false);
      return;
    }
    setInvoices(listResult.data);

    const firstInvoice = (listResult.data.invoices as Array<{ id?: string }> | undefined)?.[0];
    const selectedInvoiceId = invoiceId || firstInvoice?.id || "";
    if (selectedInvoiceId) {
      setInvoiceId(selectedInvoiceId);
      const detailResult = await adminFetch<Record<string, unknown>>(
        `/api/trader/admin/invoices/${encodeURIComponent(selectedInvoiceId)}?organization_id=${encodeURIComponent(organizationId)}`,
      );
      setInvoiceDetail(detailResult.ok ? detailResult.data : null);

      const disputeResult = await adminFetch<Record<string, unknown>>(
        `/api/trader/admin/billing-disputes?organization_id=${encodeURIComponent(organizationId)}&invoice_id=${encodeURIComponent(selectedInvoiceId)}`,
      );
      setDispute(disputeResult.ok ? disputeResult.data : null);
    }

    setReadLoading(false);
  }, [organizationId, exchangeAccountId, invoiceId]);

  async function runInvoiceCommand(command: string) {
    if (!organizationId || !invoiceId) {
      return;
    }
    setCommandMessage(null);
    const body: Record<string, unknown> = {
      command,
      organization_id: organizationId,
    };
    if (command === "approve") {
      body.attestations = {
        depositsVerified: true,
        withdrawalsVerified: true,
        balanceSnapshotsVerified: true,
        reconciliationVerified: true,
        exchangeSyncVerified: true,
        realizedFillFinalityVerified: true,
      };
    }
    if (command === "cancel-pending") {
      body.reason = "Admin console cancel";
    }
    const response = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/invoices/${encodeURIComponent(invoiceId)}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setCommandMessage(response.ok ? `${command} succeeded.` : response.message);
    if (response.ok) {
      await loadReadState();
    }
  }

  return (
    <div className="space-y-6">
      {loading ? <AdminLoadingState /> : null}
      {error ? <AdminErrorState message={error} /> : null}
      {!loading && !error ? (
        <AdminOrgSelector
          organizations={organizations}
          value={organizationId}
          onChange={setSelectedOrganizationId}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Exchange account id</span>
          <Input
            value={exchangeAccountId}
            onChange={(event) => setExchangeAccountId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Invoice id</span>
          <Input value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} />
        </label>
        <Button type="button" size="sm" variant="outline" onClick={() => void loadReadState()}>
          Load billing
        </Button>
      </div>

      <ReadReviewActionShell
        title="Billing"
        loading={readLoading}
        error={readError}
        onReload={() => void loadReadState()}
        readContent={
          <div className="space-y-3">
            <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
              {invoices ? JSON.stringify(invoices, null, 2) : "No invoices loaded"}
            </pre>
            {invoiceDetail ? (
              <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
                {JSON.stringify(invoiceDetail, null, 2)}
              </pre>
            ) : null}
          </div>
        }
        reviewContent={
          dispute ? (
            <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
              {JSON.stringify(dispute, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">No open dispute for selected invoice.</p>
          )
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void runInvoiceCommand("approve")}>
              Approve issuance
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runInvoiceCommand("issue")}
            >
              Issue
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runInvoiceCommand("cancel-pending")}
            >
              Cancel pending
            </Button>
          </div>
        }
      />

      {commandMessage ? <p className="text-muted-foreground text-sm">{commandMessage}</p> : null}
    </div>
  );
}
