"use client";

import * as React from "react";

import { CockpitFactsBody } from "@/components/trader/admin/admin-cockpit-facts";
import { usePulseDesk, type PulseFactKey } from "@/components/trader/admin/pulse-desk-context";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import { WaiaSurface } from "@/components/waia/waia-surface";
import {
  nextTapeWindow,
  PULSE_TAPE_WINDOW,
  pulseTapeFromSnapshot,
} from "@/lib/trader/admin/pulse-desk";
import { cn } from "@/lib/utils";

export function PulseOpsNight() {
  const desk = usePulseDesk();
  const entries = pulseTapeFromSnapshot(desk.snapshot, desk.nowMs);
  const [shown, setShown] = React.useState(PULSE_TAPE_WINDOW);
  const scopeKey = `${desk.organizationId}:${desk.snapshot?.organizationId ?? ""}`;
  const [tapeScope, setTapeScope] = React.useState(scopeKey);
  if (tapeScope !== scopeKey) {
    setTapeScope(scopeKey);
    setShown(PULSE_TAPE_WINDOW);
  }
  const visible = entries.slice(0, shown);
  const filteredAccounts = desk.accountId
    ? desk.scopedAccounts.filter((account) => account.credentialId === desk.accountId)
    : desk.scopedAccounts;
  const observed =
    filteredAccounts.find((account) => account.credentialId === desk.accountId) ??
    filteredAccounts[0] ??
    null;

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Ops Night</h1>
        <p className="text-waia-fg-muted text-sm">
          Live cockpit for this organization. Legacy admin pages stay in the left rail.
        </p>
      </header>

      <section aria-label="Observatory">
        <CockpitFactsBody
          organizationName={desk.organizationName || "Observatory"}
          snapshot={desk.snapshot}
          connection={desk.connection}
          stale={desk.stale}
          nowMs={desk.nowMs}
          onSelectFact={(factKey: PulseFactKey) => desk.select({ kind: "fact", factKey })}
        />
      </section>

      <WaiaSurface variant="raised" className="space-y-2 p-4">
        <h2 className="text-sm font-medium">Reason tape</h2>
        {entries.length === 0 ? (
          <p className="text-waia-fg-muted text-sm">Waiting for runtime reason codes.</p>
        ) : (
          <div
            data-testid="pulse-reason-tape"
            className="max-h-72 overflow-y-auto"
            onScroll={(event) => {
              const element = event.currentTarget;
              if (element.scrollTop + element.clientHeight >= element.scrollHeight - 24) {
                setShown((current) => nextTapeWindow(current, entries.length));
              }
            }}
          >
            <div role="log" aria-relevant="additions" aria-label="Runtime reasons">
              {visible.map((entry) => {
                const selected =
                  (entry.kind === "reason" &&
                    desk.selection.kind === "reason" &&
                    desk.selection.code === entry.label) ||
                  (entry.kind === "fact" &&
                    desk.selection.kind === "fact" &&
                    `fact:${desk.selection.factKey}` === entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (entry.kind === "reason") {
                        desk.select({ kind: "reason", code: entry.label });
                        return;
                      }
                      const factKey = entry.id.slice("fact:".length) as PulseFactKey;
                      desk.select({ kind: "fact", factKey });
                    }}
                    className={cn(
                      "flex w-full items-baseline justify-between gap-3 border-b px-1 py-1.5 text-left text-sm last:border-0",
                      selected ? "bg-waia-field" : "hover:bg-waia-field/60",
                    )}
                  >
                    <span className="font-mono text-xs">{entry.label}</span>
                    <span className="text-waia-fg-muted truncate text-xs">{entry.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </WaiaSurface>

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Accounts / positions</h2>
        <p className="text-waia-fg-muted text-xs">
          Positions come from the selected account observation. This desk does not place orders.
        </p>
        {desk.accountsLoading ? (
          <p className="text-waia-fg-muted text-sm">Loading accounts…</p>
        ) : null}
        {desk.accountsError ? (
          <p className="text-waia-danger text-sm">{desk.accountsError}</p>
        ) : null}
        {!desk.accountsLoading && filteredAccounts.length === 0 ? (
          <p className="text-waia-fg-muted text-sm">No connected accounts in this organization.</p>
        ) : null}
        {filteredAccounts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filteredAccounts.map((account) => {
              const selected = observed?.credentialId === account.credentialId;
              return (
                <button
                  key={account.credentialId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    desk.setAccountId(account.credentialId);
                    desk.select({ kind: "account", credentialId: account.credentialId });
                  }}
                  className={cn(
                    "rounded-md border px-2 py-1 text-left text-sm",
                    selected ? "border-waia-accent-cool" : "border-waia-divider",
                  )}
                >
                  <span className="block">{account.accountName}</span>
                  <span className="text-waia-fg-muted font-mono text-xs">
                    {account.exchangeAccountId}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {observed ? (
          <ConnectedAccountObservationPanel
            mode="admin"
            target={{
              organizationId: observed.organizationId,
              credentialId: observed.credentialId,
              exchangeAccountId: observed.exchangeAccountId,
            }}
          />
        ) : null}
      </WaiaSurface>
    </div>
  );
}
