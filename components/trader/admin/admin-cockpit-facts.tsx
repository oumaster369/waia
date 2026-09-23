"use client";

import * as React from "react";

import {
  useAdminCockpitStream,
  type CockpitConnection,
} from "@/components/trader/admin/use-admin-cockpit-stream";
import { WaiaSurface } from "@/components/waia/waia-surface";
import {
  COCKPIT_FACT_KEYS,
  cockpitFactValueText,
  cockpitStreamIsStale,
  formatCockpitAge,
  type CockpitFact,
  type CockpitSnapshot,
} from "@/lib/trader/admin/cockpit-client";

const LABELS: Record<(typeof COCKPIT_FACT_KEYS)[number], string> = {
  releaseIdentity: "Release",
  runtimeAuthority: "Runtime",
  observationFreshness: "Freshness",
  c3: "C3",
};

function FactTile({
  fact,
  label,
  nowMs,
  stale,
  onSelect,
}: {
  fact: CockpitFact;
  label: string;
  nowMs: number;
  stale: boolean;
  onSelect?: () => void;
}) {
  return (
    <article
      className="border-border space-y-1 rounded-md border p-3"
      data-testid={`cockpit-fact-${label}`}
    >
      <h3 className="text-sm font-medium">
        {onSelect ? (
          <button type="button" className="hover:underline" onClick={onSelect}>
            {label}
          </button>
        ) : (
          label
        )}
      </h3>
      <p className="text-base">{cockpitFactValueText(fact)}</p>
      <p className="text-muted-foreground text-xs">Source {fact.source}</p>
      <p className="text-muted-foreground text-xs">{formatCockpitAge(fact.asOf, nowMs)}</p>
      {fact.operatorCampaignRunId ? (
        <p className="text-muted-foreground text-xs">Operator run {fact.operatorCampaignRunId}</p>
      ) : null}
      {stale ? <p className="text-xs font-medium">Stale</p> : null}
    </article>
  );
}

export function CockpitFactsBody({
  organizationName,
  snapshot,
  connection,
  stale,
  nowMs,
  onSelectFact,
}: {
  organizationName: string;
  snapshot: CockpitSnapshot | null;
  connection: CockpitConnection;
  stale: boolean;
  nowMs: number;
  onSelectFact?: (factKey: (typeof COCKPIT_FACT_KEYS)[number]) => void;
}) {
  const connectionLabel =
    connection === "live" ? "Live" : connection === "poll" ? "Polling" : "Reconnecting";

  return (
    <WaiaSurface variant="raised" className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{organizationName}</h2>
        <p
          data-stale={stale ? "true" : "false"}
          data-state={connection}
          data-testid="cockpit-connection"
        >
          {connectionLabel}
        </p>
      </div>
      {snapshot ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {COCKPIT_FACT_KEYS.map((key) => (
            <FactTile
              key={key}
              fact={snapshot[key]}
              label={LABELS[key]}
              nowMs={nowMs}
              stale={stale}
              onSelect={onSelectFact ? () => onSelectFact(key) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Waiting for the cockpit read.</p>
      )}
    </WaiaSurface>
  );
}

export function AdminCockpitFacts({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string | null;
}) {
  const { snapshot, connection, lastContactMs } = useAdminCockpitStream(organizationId);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const stale = cockpitStreamIsStale(lastContactMs, nowMs);

  return (
    <CockpitFactsBody
      organizationName={organizationName ?? organizationId}
      snapshot={snapshot}
      connection={connection}
      stale={stale}
      nowMs={nowMs}
    />
  );
}
