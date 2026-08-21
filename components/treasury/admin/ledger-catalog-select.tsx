"use client";

import * as React from "react";

import { CanonicalSelect, FormField, MoreDetails } from "@/components/treasury/admin/form-controls";
import {
  ledgerCatalogItemLabel,
  useLedgerCatalog,
} from "@/components/treasury/admin/use-ledger-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { treasuryJson } from "@/lib/treasury-admin/api";
import { parseHumanDecimalToAtomic } from "@/lib/treasury-admin/parse-human-amount";
import type {
  TreasuryAccountSummaryDto,
  TreasuryLedgerCatalogItem,
  TreasuryLedgerCatalogKind,
} from "@/lib/treasury-admin/types";

const COPY: Record<
  TreasuryLedgerCatalogKind,
  { singular: string; label: string; blank: string; nameField: string }
> = {
  counterparties: {
    singular: "counterparty",
    label: "Counterparty",
    blank: "No counterparty",
    nameField: "display_name",
  },
  accounts: {
    singular: "account",
    label: "Account",
    blank: "Choose account",
    nameField: "display_name",
  },
  categories: { singular: "category", label: "Category", blank: "No category", nameField: "name" },
  projects: { singular: "project", label: "Project", blank: "No project", nameField: "name" },
};

export function LedgerCatalogSelect({
  id,
  organizationId,
  kind,
  value,
  onChange,
  disabled,
  required,
  allowCreate = true,
}: {
  id: string;
  organizationId: string;
  kind: TreasuryLedgerCatalogKind;
  value: string;
  onChange: (id: string, item: TreasuryLedgerCatalogItem | null) => void;
  disabled?: boolean;
  required?: boolean;
  allowCreate?: boolean;
}) {
  const copy = COPY[kind];
  const [search, setSearch] = React.useState("");
  const { items, loading, error, reload, isSearchPending } = useLedgerCatalog(
    organizationId,
    kind,
    search,
  );
  const [name, setName] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [description, setDescription] = React.useState("");
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
  const [code, setCode] = React.useState("");
  const [monthlyBudget, setMonthlyBudget] = React.useState("0");
  const [startsOn, setStartsOn] = React.useState("");
  const [endsOn, setEndsOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const options = items.map((item) => ({ value: item.id, label: ledgerCatalogItemLabel(item) }));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: `Selected · ${value.slice(0, 8)}` });
  }

  async function createItem() {
    const trimmedName = name.trim();
    if (!trimmedName || !reason.trim()) {
      setCreateError("Name and audit reason are required.");
      return;
    }
    const body: Record<string, unknown> = {
      organization_id: organizationId,
      [copy.nameField]: trimmedName,
      reason: reason.trim(),
    };
    if (kind === "counterparties") {
      Object.assign(body, {
        website_url: website.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        payment_instructions: paymentInstructions.trim() || null,
        waia_username: waiaUsername.trim() || null,
      });
    } else if (kind === "accounts") {
      Object.assign(body, {
        kind: accountKind,
        currency: currency.trim(),
        network: network.trim() || null,
        address: address.trim() || null,
        masked_requisites: maskedRequisites.trim() || null,
      });
    } else if (kind === "categories") {
      const parsed = parseHumanDecimalToAtomic(monthlyBudget, 6, { requirePositive: false });
      if (!parsed.ok) {
        setCreateError(parsed.message);
        return;
      }
      Object.assign(body, {
        code: code.trim(),
        description: description.trim() || null,
        monthly_budget_micros: parsed.atomic,
        currency: currency.trim(),
      });
      if (!code.trim() || !currency.trim()) {
        setCreateError("Category code and currency are required.");
        return;
      }
    } else {
      Object.assign(body, {
        description: description.trim() || null,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
      });
    }
    if (kind === "accounts" && !currency.trim()) {
      setCreateError("Account currency is required.");
      return;
    }
    setBusy(true);
    const result = await treasuryJson<Record<string, unknown>>(
      `/api/admin/treasury/${kind}`,
      "POST",
      body,
    );
    setBusy(false);
    if (!result.ok) {
      setCreateError(result.message);
      return;
    }
    const created = result.data[copy.singular] as TreasuryLedgerCatalogItem | undefined;
    if (!created?.id) {
      setCreateError("The catalog item was created but its identifier was not returned.");
      return;
    }
    setCreateError(null);
    setSearch(ledgerCatalogItemLabel(created));
    onChange(created.id, created);
    reload();
  }

  return (
    <div className="space-y-2" data-testid={`${id}-catalog`}>
      <FormField
        label={copy.label}
        htmlFor={id}
        help="Searches this organization’s active catalog. The transaction stores the stable catalog ID."
      >
        <div className="space-y-2">
          <Input
            id={`${id}-search`}
            aria-label={`Search ${copy.label.toLowerCase()}`}
            placeholder={`Search ${copy.label.toLowerCase()}…`}
            value={search}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
          />
          <CanonicalSelect
            id={id}
            testId={id}
            value={value}
            onChange={(next) => onChange(next, items.find((item) => item.id === next) ?? null)}
            options={options}
            blankLabel={loading || isSearchPending ? "Loading…" : copy.blank}
            disabled={disabled || loading || isSearchPending}
            required={required}
          />
        </div>
      </FormField>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error.message}
        </p>
      ) : null}
      {allowCreate ? (
        <MoreDetails summary={`Add ${copy.label.toLowerCase()}`} testId={`${id}-create`}>
          <FormField label={`${copy.label} name`} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          {kind === "counterparties" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="WAIA username"
                placeholder="WAIA username"
                value={waiaUsername}
                onChange={(event) => setWaiaUsername(event.target.value)}
              />
              <Input
                aria-label="Website"
                placeholder="Website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
              <Input
                aria-label="Email"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                aria-label="Phone"
                placeholder="Phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <Textarea
                aria-label="Payment details"
                placeholder="Payment details (no secrets or full card data)"
                value={paymentInstructions}
                onChange={(event) => setPaymentInstructions(event.target.value)}
              />
            </div>
          ) : null}
          {kind === "accounts" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <CanonicalSelect
                id={`${id}-kind`}
                value={accountKind}
                onChange={(next) => setAccountKind(next as TreasuryAccountSummaryDto["kind"])}
                options={[
                  { value: "CRYPTO_WALLET", label: "Crypto wallet" },
                  { value: "BANK_CARD", label: "Bank card" },
                  { value: "BANK_ACCOUNT", label: "Bank account" },
                  { value: "CASH", label: "Cash" },
                  { value: "OTHER", label: "Other" },
                ]}
                blankLabel="Account type"
                required
              />
              <Input
                aria-label="Currency"
                placeholder="Currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
              <Input
                aria-label="Network"
                placeholder="Network, e.g. TRC-20"
                value={network}
                onChange={(event) => setNetwork(event.target.value)}
              />
              <Input
                aria-label="Wallet address"
                placeholder="Wallet address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <Input
                aria-label="Masked requisites"
                placeholder="Masked requisites, e.g. Visa •••• 1234"
                value={maskedRequisites}
                onChange={(event) => setMaskedRequisites(event.target.value)}
              />
            </div>
          ) : null}
          {kind === "categories" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="Category code"
                placeholder="Category code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Input
                aria-label="Monthly budget"
                placeholder="Monthly budget"
                inputMode="decimal"
                value={monthlyBudget}
                onChange={(event) => setMonthlyBudget(event.target.value)}
              />
              <Input
                aria-label="Currency"
                placeholder="Currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
              <Textarea
                aria-label="Category description"
                placeholder="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          ) : null}
          {kind === "projects" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                aria-label="Project start"
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
              <Input
                aria-label="Project end"
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
              <Textarea
                aria-label="Project description"
                placeholder="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          ) : null}
          <FormField
            label="Reason"
            htmlFor={`${id}-reason`}
            help="Required for the audited catalog change."
          >
            <Input
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          {createError ? (
            <p role="alert" className="text-destructive text-sm">
              {createError}
            </p>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => void createItem()}>
            {busy ? "Adding…" : `Add ${copy.label.toLowerCase()}`}
          </Button>
        </MoreDetails>
      ) : null}
    </div>
  );
}
