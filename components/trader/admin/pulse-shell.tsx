"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { PulseDeskProvider, usePulseDesk } from "@/components/trader/admin/pulse-desk-context";
import { TraderSignOut } from "@/components/trader/trader-sign-out";
import { formatCockpitAge } from "@/lib/trader/admin/cockpit-client";
import {
  campaignRunIdForCockpit,
  cockpitFactByKey,
  pulseAccountObservationHref,
  pulseHaltHref,
  pulseScopedHref,
  readRuntimeAuthorityStrip,
} from "@/lib/trader/admin/pulse-desk";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "Ops Night" },
  { href: "/admin/account-observation", label: "Accounts" },
  { href: "/admin/runtime-authority", label: "Runtime authority" },
  { href: "/admin/fhv-operations", label: "FHV operations" },
  { href: "/admin/kill-switches", label: "Kill switches" },
  { href: "/admin/live-enable", label: "Live enable" },
  { href: "/admin/strategy-promotions", label: "Strategy promotions" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/score-diagnostic", label: "Score diagnostic" },
] as const;

const LED_CLASS = {
  live: "bg-waia-success",
  reconnecting: "bg-waia-warning",
  poll: "bg-waia-accent-cool",
  stale: "bg-waia-danger",
} as const;

function activeNav(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PulseStrip() {
  const desk = usePulseDesk();
  const strip = readRuntimeAuthorityStrip(desk.snapshot?.runtimeAuthority);
  const freshness = desk.snapshot
    ? formatCockpitAge(desk.snapshot.observationFreshness.asOf, desk.nowMs)
    : "Age unknown";
  const posture =
    strip.posture === null ? strip.availability : `${strip.availability} · ${strip.posture}`;

  return (
    <div className="border-waia-divider bg-waia-elevated flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
      <div className="min-w-0">
        <p className="text-waia-fg-muted text-xs">AI-TRADER · Pulse</p>
        <p className="truncate text-sm font-medium" data-testid="pulse-org-scope">
          {desk.organizationName || "No organization"}
        </p>
      </div>
      <p className="text-sm" data-testid="pulse-runtime-posture">
        <span className="text-waia-fg-muted">Runtime </span>
        {desk.snapshot ? posture : "Waiting"}
      </p>
      <div className="flex max-w-full flex-wrap gap-1" data-testid="pulse-reason-chips">
        {strip.reasonCodes.length === 0 ? (
          <span className="text-waia-fg-muted text-xs">No reason codes</span>
        ) : (
          strip.reasonCodes.slice(0, 6).map((code) => (
            <Link
              key={code}
              href={pulseScopedHref("/admin/runtime-authority", desk.organizationId)}
              className="border-waia-divider rounded-full border px-2 py-0.5 text-xs"
            >
              {code}
            </Link>
          ))
        )}
      </div>
      <p className="text-waia-fg-muted text-xs" data-testid="pulse-freshness">
        Observation {freshness}
      </p>
      <p
        className="flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase"
        data-testid="pulse-connection"
        data-state={desk.led}
        data-transport={desk.connection}
      >
        <span aria-hidden className={cn("inline-block size-2 rounded-full", LED_CLASS[desk.led])} />
        {desk.led}
      </p>
      <Link
        href={pulseHaltHref(desk.organizationId)}
        title="Opens the audited kill-switch console. Does not trip a switch."
        className="bg-waia-danger text-waia-danger-fg ml-auto rounded-md px-3 py-1.5 text-sm font-semibold"
      >
        HALT
      </Link>
      <TraderSignOut />
    </div>
  );
}

function PulseModeTabs() {
  const pathname = usePathname() || "/admin";
  const desk = usePulseDesk();
  const opsHref = pulseScopedHref("/admin", desk.organizationId, desk.campaignRunId);
  const onOps = pathname === "/admin";

  return (
    <div
      role="tablist"
      aria-label="Pulse modes"
      className="border-waia-divider flex flex-wrap items-center gap-1 border-b px-3 py-1.5"
    >
      <Link
        role="tab"
        aria-selected={onOps}
        href={opsHref}
        className={cn(
          "rounded-md px-3 py-1 text-sm",
          onOps ? "bg-waia-field text-waia-fg" : "text-waia-fg-muted hover:text-waia-fg",
        )}
      >
        Ops Night
      </Link>
      <span
        role="tab"
        aria-disabled="true"
        aria-selected="false"
        className="text-waia-fg-subtle px-3 py-1 text-sm"
      >
        Knowledge
      </span>
      <span
        role="tab"
        aria-disabled="true"
        aria-selected="false"
        className="text-waia-fg-subtle px-3 py-1 text-sm"
      >
        Research
      </span>
      {onOps ? null : <span className="text-waia-fg-muted ml-auto text-xs">Legacy admin page</span>}
    </div>
  );
}

function PulseLeftRail() {
  const pathname = usePathname() || "/admin";
  const desk = usePulseDesk();
  const [draft, setDraft] = React.useState(desk.campaignRunId);
  const [synced, setSynced] = React.useState(desk.campaignRunId);
  if (synced !== desk.campaignRunId) {
    setSynced(desk.campaignRunId);
    setDraft(desk.campaignRunId);
  }
  const draftInvalid = draft.trim() !== "" && campaignRunIdForCockpit(draft) === "";
  const orgOptions =
    desk.organizationId &&
    !desk.organizations.some((organization) => organization.id === desk.organizationId)
      ? [
          {
            id: desk.organizationId,
            name: desk.organizationName || desk.organizationId,
            kind: "scope",
          },
          ...desk.organizations,
        ]
      : desk.organizations;

  function commitCampaign(next: string) {
    if (next.trim() && !campaignRunIdForCockpit(next)) return;
    desk.setCampaignRunId(next);
  }

  return (
    <aside
      aria-label="Pulse filters"
      className="border-waia-divider min-h-0 overflow-y-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="space-y-3">
        <label className="block space-y-1 text-xs">
          <span className="text-waia-fg-muted font-medium">Organization</span>
          <select
            data-testid="pulse-org-select"
            className="border-waia-divider bg-waia-field w-full rounded-md border px-2 py-1.5 text-sm"
            value={desk.organizationId}
            onChange={(event) => desk.setOrganizationId(event.target.value)}
          >
            {orgOptions.length === 0 ? <option value="">No organizations</option> : null}
            {orgOptions.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name ?? organization.id}
              </option>
            ))}
          </select>
          {desk.organizationsLoading ? (
            <span className="text-waia-fg-muted">Loading organizations…</span>
          ) : null}
          {desk.organizationsError ? (
            <span className="text-waia-danger">{desk.organizationsError}</span>
          ) : null}
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-waia-fg-muted font-medium">Account</span>
          <select
            data-testid="pulse-account-select"
            className="border-waia-divider bg-waia-field w-full rounded-md border px-2 py-1.5 text-sm"
            value={desk.accountId}
            onChange={(event) => desk.setAccountId(event.target.value)}
          >
            <option value="">All in scope</option>
            {desk.scopedAccounts.map((account) => (
              <option key={account.credentialId} value={account.credentialId}>
                {account.accountName}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-waia-fg-muted font-medium">Campaign</span>
          <input
            data-testid="pulse-campaign-run-id"
            className="border-waia-divider bg-waia-field w-full rounded-md border px-2 py-1.5 font-mono text-sm"
            value={draft}
            aria-invalid={draftInvalid}
            maxLength={128}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitCampaign(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitCampaign(draft);
            }}
          />
          {draftInvalid ? (
            <span className="text-waia-danger">Campaign run id format is invalid.</span>
          ) : null}
        </label>
      </div>

      <nav aria-label="Admin pages" className="mt-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = activeNav(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={pulseScopedHref(item.href, desk.organizationId, desk.campaignRunId)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2 py-1.5 text-sm",
                    active ? "bg-waia-field text-waia-fg" : "text-waia-fg-muted hover:text-waia-fg",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function contactLabel(lastContactMs: number | null, nowMs: number): string {
  if (lastContactMs === null) return "No contact yet";
  return formatCockpitAge({ state: "known", at: lastContactMs }, nowMs);
}

function PulseInspector() {
  const desk = usePulseDesk();
  const selectedCredentialId =
    desk.selection.kind === "account" ? desk.selection.credentialId : null;
  const selectedAccount = selectedCredentialId
    ? desk.accounts.find((account) => account.credentialId === selectedCredentialId)
    : undefined;
  const selectedFactKey = desk.selection.kind === "fact" ? desk.selection.factKey : null;
  const selectedFact =
    selectedFactKey && desk.snapshot ? cockpitFactByKey(desk.snapshot, selectedFactKey) : null;

  return (
    <aside
      aria-label="Inspector"
      className="border-waia-divider min-h-0 space-y-4 overflow-y-auto border-t p-3 lg:border-t-0 lg:border-l"
    >
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Inspector</h2>
        {desk.selection.kind === "none" ? (
          <p className="text-waia-fg-muted text-sm">Select a reason, fact, or account.</p>
        ) : null}
        {desk.selection.kind === "reason" ? (
          <p className="font-mono text-sm">{desk.selection.code}</p>
        ) : null}
        {desk.selection.kind === "fact" && selectedFact ? (
          <div className="space-y-1 text-sm">
            <p>{desk.selection.factKey}</p>
            <p className="text-waia-fg-muted text-xs">Source {selectedFact.source}</p>
          </div>
        ) : null}
        {selectedAccount ? (
          <div className="space-y-1 text-sm">
            <p>{selectedAccount.accountName}</p>
            <p className="font-mono text-xs">{selectedAccount.exchangeAccountId}</p>
            <Link
              className="text-waia-accent-cool underline-offset-2 hover:underline"
              href={pulseAccountObservationHref(selectedAccount)}
            >
              Open account observation
            </Link>
          </div>
        ) : null}
      </section>
      <section className="space-y-1 text-xs" data-testid="pulse-connection-diagnostics">
        <h2 className="text-sm font-medium">Connection</h2>
        <p>Lamp {desk.led}</p>
        <p>Transport {desk.connection}</p>
        <p>Last contact {contactLabel(desk.lastContactMs, desk.nowMs)}</p>
        <p className="break-all">Organization {desk.organizationId || "Unset"}</p>
        <p className="break-all">Campaign {desk.campaignRunId || "Unset"}</p>
      </section>
    </aside>
  );
}

function PulseChrome({ children }: { children: React.ReactNode }) {
  const desk = usePulseDesk();

  return (
    <div
      data-testid="pulse-shell"
      className="bg-waia-field text-waia-fg flex h-dvh min-h-0 w-full max-w-none flex-col"
    >
      <header className="bg-waia-elevated sticky top-0 z-20">
        <PulseStrip />
        <PulseModeTabs />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <PulseLeftRail />
        <main
          key={`${desk.organizationId}:${desk.campaignRunId}`}
          className="min-h-0 overflow-y-auto p-3"
        >
          {children}
        </main>
        <PulseInspector />
      </div>
    </div>
  );
}

export function PulseShell({ children }: { children: React.ReactNode }) {
  return (
    <PulseDeskProvider>
      <PulseChrome>{children}</PulseChrome>
    </PulseDeskProvider>
  );
}
