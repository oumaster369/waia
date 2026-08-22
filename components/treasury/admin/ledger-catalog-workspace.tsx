"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/treasury/admin/confirm-dialog";
import { CanonicalSelect, FormField } from "@/components/treasury/admin/form-controls";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import {
  ledgerCatalogItemLabel,
  useLedgerCatalog,
} from "@/components/treasury/admin/use-ledger-catalog";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { missingOrganizationResult, treasuryGet, treasuryJson } from "@/lib/treasury-admin/api";
import type {
  TreasuryAccountDto,
  TreasuryAccountSummaryDto,
  TreasuryApiResult,
  TreasuryCounterpartyDto,
  TreasuryLedgerCatalogItem,
  TreasuryLedgerCatalogKind,
  TreasuryProjectDto,
} from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { cn } from "@/lib/utils";

type WorkspaceKind = Exclude<TreasuryLedgerCatalogKind, "categories">;
type CatalogDetail = TreasuryCounterpartyDto | TreasuryAccountDto | TreasuryProjectDto;

const COPY: Record<WorkspaceKind, { title: string; singular: string; description: string }> = {
  counterparties: {
    title: "Counterparties",
    singular: "counterparty",
    description: "People and organizations that pay WAIA or receive money from WAIA.",
  },
  accounts: {
    title: "Accounts",
    singular: "account",
    description: "Wallets, cards, bank accounts, and other places where money is held.",
  },
  projects: {
    title: "Projects",
    singular: "project",
    description: "WAIA modules and other work that transactions can be assigned to.",
  },
};

function summaryMeta(item: TreasuryLedgerCatalogItem, kind: WorkspaceKind) {
  if (kind === "counterparties") {
    const row = item as TreasuryCounterpartyDto;
    return row.waiaUsername ? `@${row.waiaUsername}` : "No WAIA username";
  }
  if (kind === "accounts") {
    const row = item as TreasuryAccountSummaryDto;
    return [row.kind.replaceAll("_", " "), row.currency, row.network].filter(Boolean).join(" · ");
  }
  const row = item as TreasuryProjectDto;
  return [row.startsOn, row.endsOn].filter(Boolean).join(" → ") || "Dates not set";
}

function CatalogEditor({
  kind,
  organizationId,
  selectedId,
  onSaved,
}: {
  kind: WorkspaceKind;
  organizationId: string;
  selectedId: string | null;
  onSaved: (id: string | null) => void;
}) {
  const copy = COPY[kind];
  const detailQuery = React.useCallback((): Promise<TreasuryApiResult<Record<string, unknown>>> => {
    if (!selectedId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<Record<string, unknown>>(
      `/api/admin/treasury/${kind}`,
      organizationId,
      { id: selectedId },
    );
  }, [kind, organizationId, selectedId]);
  const detail = useTreasuryQuery(
    Boolean(selectedId),
    `catalog-detail:${kind}:${organizationId}:${selectedId ?? "new"}`,
    detailQuery,
  );
  const record = selectedId
    ? (detail.data?.[copy.singular] as CatalogDetail | undefined)
    : undefined;
  const [initializedId, setInitializedId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [paymentInstructions, setPaymentInstructions] = React.useState("");
  const [waiaUsername, setWaiaUsername] = React.useState("");
  const [accountKind, setAccountKind] = React.useState<TreasuryAccountSummaryDto["kind"]>("OTHER");
  const [currency, setCurrency] = React.useState("USD");
  const [network, setNetwork] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [maskedRequisites, setMaskedRequisites] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startsOn, setStartsOn] = React.useState("");
  const [endsOn, setEndsOn] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState<"save" | "archive" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!record || record.id === initializedId) return;
    // The audited form is intentionally hydrated only after its selected server detail arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitializedId(record.id);
    if (kind === "counterparties") {
      const row = record as TreasuryCounterpartyDto;
      setName(row.displayName);
      setWebsite(row.websiteUrl ?? "");
      setEmail(row.email ?? "");
      setPhone(row.phone ?? "");
      setPaymentInstructions(row.paymentInstructions ?? "");
      setWaiaUsername(row.waiaUsername ?? "");
    } else if (kind === "accounts") {
      const row = record as TreasuryAccountDto;
      setName(row.displayName);
      setAccountKind(row.kind);
      setCurrency(row.currency);
      setNetwork(row.network ?? "");
      setAddress(row.address ?? "");
      setMaskedRequisites(row.maskedRequisites ?? "");
    } else {
      const row = record as TreasuryProjectDto;
      setName(row.name);
      setDescription(row.description ?? "");
      setStartsOn(row.startsOn ?? "");
      setEndsOn(row.endsOn ?? "");
    }
  }, [initializedId, kind, record]);

  async function apply() {
    if (!reason.trim()) {
      setPending(null);
      setError("Add an audit reason.");
      return;
    }
    if (pending === "save" && (!name.trim() || (kind === "accounts" && !currency.trim()))) {
      setPending(null);
      setError(kind === "accounts" ? "Name and currency are required." : "Name is required.");
      return;
    }
    const body: Record<string, unknown> = {
      organization_id: organizationId,
      ...(selectedId ? { id: selectedId } : {}),
      reason: reason.trim(),
    };
    if (pending === "archive") {
      body.is_active = false;
    } else if (kind === "counterparties") {
      Object.assign(body, {
        display_name: name.trim(),
        website_url: website.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        payment_instructions: paymentInstructions.trim() || null,
        waia_username: waiaUsername.trim() || null,
      });
    } else if (kind === "accounts") {
      Object.assign(body, {
        display_name: name.trim(),
        kind: accountKind,
        currency: currency.trim(),
        network: network.trim() || null,
        address: address.trim() || null,
        masked_requisites: maskedRequisites.trim() || null,
      });
    } else {
      Object.assign(body, {
        name: name.trim(),
        description: description.trim() || null,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
      });
    }
    setBusy(true);
    const result = await treasuryJson<Record<string, unknown>>(
      `/api/admin/treasury/${kind}`,
      selectedId ? "PATCH" : "POST",
      body,
    );
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const saved = result.data[copy.singular] as CatalogDetail | undefined;
    setError(null);
    setReason("");
    onSaved(pending === "archive" ? null : saved?.id ?? selectedId);
  }

  if (selectedId && detail.loading) return <LoadingState label={`Loading ${copy.singular}…`} />;
  if (detail.error) return <UnavailableState code={detail.error.code} message={detail.error.message} onRetry={detail.reload} />;

  return (
    <WaiaSurface variant="raised" className="space-y-4 p-4" data-testid={`catalog-editor-${kind}`}>
      <div>
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {selectedId ? "Edit" : "Add"}
        </p>
        <h3 className="font-medium">{selectedId ? name || `Selected ${copy.singular}` : `New ${copy.singular}`}</h3>
      </div>
      <FormField label="Name" htmlFor={`${kind}-name`}>
        <Input id={`${kind}-name`} value={name} onChange={(event) => setName(event.target.value)} />
      </FormField>
      {kind === "counterparties" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="WAIA username" htmlFor="counterparty-waia-username"><Input id="counterparty-waia-username" value={waiaUsername} onChange={(event) => setWaiaUsername(event.target.value)} /></FormField>
          <FormField label="Website" htmlFor="counterparty-website"><Input id="counterparty-website" type="url" value={website} onChange={(event) => setWebsite(event.target.value)} /></FormField>
          <FormField label="Email" htmlFor="counterparty-email"><Input id="counterparty-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></FormField>
          <FormField label="Phone" htmlFor="counterparty-phone"><Input id="counterparty-phone" value={phone} onChange={(event) => setPhone(event.target.value)} /></FormField>
          <div className="md:col-span-2"><FormField label="Payment details" htmlFor="counterparty-payment" help="Do not store passwords, private keys, or full card data."><Textarea id="counterparty-payment" value={paymentInstructions} onChange={(event) => setPaymentInstructions(event.target.value)} /></FormField></div>
        </div>
      ) : null}
      {kind === "accounts" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Type" htmlFor="account-kind"><CanonicalSelect id="account-kind" value={accountKind} onChange={(value) => setAccountKind(value as TreasuryAccountSummaryDto["kind"])} options={[
            { value: "CRYPTO_WALLET", label: "Crypto wallet" }, { value: "BANK_CARD", label: "Bank card" },
            { value: "BANK_ACCOUNT", label: "Bank account" }, { value: "CASH", label: "Cash" }, { value: "OTHER", label: "Other" },
          ]} blankLabel="Type" required /></FormField>
          <FormField label="Currency" htmlFor="account-currency"><Input id="account-currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></FormField>
          <FormField label="Network" htmlFor="account-network"><Input id="account-network" placeholder="e.g. TRC-20" value={network} onChange={(event) => setNetwork(event.target.value)} /></FormField>
          <FormField label="Address" htmlFor="account-address"><Input id="account-address" value={address} onChange={(event) => setAddress(event.target.value)} /></FormField>
          <div className="md:col-span-2"><FormField label="Masked requisites" htmlFor="account-masked" help="Use a safe display value such as Visa •••• 1234. Never enter private keys, seed phrases, CVV, PIN, or a full card number."><Input id="account-masked" value={maskedRequisites} onChange={(event) => setMaskedRequisites(event.target.value)} /></FormField></div>
        </div>
      ) : null}
      {kind === "projects" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Start date" htmlFor="project-start"><Input id="project-start" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></FormField>
          <FormField label="End date" htmlFor="project-end"><Input id="project-end" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></FormField>
          <div className="md:col-span-2"><FormField label="Description" htmlFor="project-description"><Textarea id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} /></FormField></div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setPending("save")}>{selectedId ? "Save changes" : `Add ${copy.singular}`}</Button>
        {selectedId ? <Button type="button" variant="ghost" onClick={() => setPending("archive")}>Archive</Button> : null}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending === "archive" ? `Archive ${copy.singular}` : selectedId ? `Update ${copy.singular}` : `Add ${copy.singular}`}
        impact={pending === "archive" ? "Historical transactions keep this reference, but it leaves active selectors." : "Saves this organization-scoped reference for Finance transactions."}
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

function LedgerCatalogWorkspaceInner({ kind }: { kind: WorkspaceKind }) {
  const { organizationId } = useFinanceOrg();
  const copy = COPY[kind];
  const [search, setSearch] = React.useState("");
  const catalog = useLedgerCatalog(organizationId, kind, search);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editorGeneration, setEditorGeneration] = React.useState(0);

  function newItem() {
    setSelectedId(null);
    setEditorGeneration((current) => current + 1);
  }

  function saved(id: string | null) {
    setSelectedId(id);
    setEditorGeneration((current) => current + 1);
    catalog.reload();
  }

  if (!organizationId) return null;

  return (
    <div className="space-y-5" data-testid={`finance-${kind}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-medium">{copy.title}</h2><p className="text-muted-foreground text-sm">{copy.description}</p></div>
        <Button type="button" variant="outline" onClick={newItem}>Add {copy.singular}</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
        <div className="space-y-3">
          <FormField label={`Search ${copy.title.toLowerCase()}`} htmlFor={`${kind}-search`}>
            <Input id={`${kind}-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name…" />
          </FormField>
          {catalog.loading || catalog.isSearchPending ? <LoadingState /> : null}
          {catalog.error ? <UnavailableState code={catalog.error.code} message={catalog.error.message} onRetry={catalog.reload} /> : null}
          {!catalog.loading && !catalog.error ? (
            <WaiaSurface variant="raised" className="divide-y overflow-hidden">
              {catalog.items.length === 0 ? <p className="text-muted-foreground p-4 text-sm">No matching {copy.title.toLowerCase()}.</p> : catalog.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn("hover:bg-muted/20 flex w-full items-start justify-between gap-3 p-4 text-left", selectedId === item.id && "bg-muted/30")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span><span className="block font-medium">{ledgerCatalogItemLabel(item)}</span><span className="text-muted-foreground block text-xs">{summaryMeta(item, kind)}</span></span>
                  <span className="text-muted-foreground text-xs">Edit</span>
                </button>
              ))}
            </WaiaSurface>
          ) : null}
        </div>
        <CatalogEditor
          key={`${kind}:${selectedId ?? "new"}:${editorGeneration}`}
          kind={kind}
          organizationId={organizationId}
          selectedId={selectedId}
          onSaved={saved}
        />
      </div>
    </div>
  );
}

export function LedgerCatalogWorkspace({ kind }: { kind: WorkspaceKind }) {
  return <OrgGate><LedgerCatalogWorkspaceInner kind={kind} /></OrgGate>;
}
