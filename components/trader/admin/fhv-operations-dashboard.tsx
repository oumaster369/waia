"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

type FhvOperationsDashboardProps = Readonly<{
  status: Record<string, unknown>;
  showRawJson: boolean;
  onToggleRawJson: () => void;
}>;

function asStatus(value: Record<string, unknown>): FhvOperatorStatusV1 | null {
  if (value.schemaVersion !== "fhv-operator-status/v1") {
    return null;
  }
  return value as unknown as FhvOperatorStatusV1;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-4">
      <h3 className="text-sm font-semibold tracking-wide uppercase opacity-80">{title}</h3>
      {children}
    </WaiaSurface>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-0.5">
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="text-sm font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FhvOperationsDashboard({
  status,
  showRawJson,
  onToggleRawJson,
}: FhvOperationsDashboardProps) {
  const parsed = asStatus(status);

  if (!parsed) {
    return (
      <WaiaSurface variant="raised" className="p-4">
        <p className="text-destructive text-sm">Status payload is unavailable or invalid.</p>
      </WaiaSurface>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Campaign progress">
        <MetricGrid
          items={[
            { label: "Run ID", value: parsed.campaign.runId },
            { label: "Phase", value: parsed.campaign.phase },
            { label: "Terminal state", value: parsed.campaign.terminalState },
            {
              label: "Bars processed / total",
              value: `${parsed.campaign.barsProcessed} / ${parsed.campaign.barsTotal ?? "unknown"}`,
            },
            {
              label: "Completion",
              value:
                parsed.campaign.completionPct !== null
                  ? `${parsed.campaign.completionPct.toFixed(1)}%`
                  : "unknown",
            },
            { label: "Heartbeat age (ms)", value: parsed.campaign.heartbeatAgeMs },
            {
              label: "Checkpoint age (ms)",
              value: parsed.campaign.checkpointAgeMs ?? "unknown",
            },
          ]}
        />
      </Section>

      <Section title="Host health">
        <MetricGrid
          items={[
            { label: "Process", value: parsed.host.processStatus },
            { label: "Service", value: parsed.host.serviceStatus },
            { label: "RAM used %", value: parsed.host.ramUsedPct ?? "unknown" },
            { label: "Disk free (bytes)", value: parsed.host.diskFreeBytes ?? "unknown" },
            { label: "Artifact dir (bytes)", value: parsed.host.artifactDirBytes ?? "unknown" },
            { label: "Postgres", value: parsed.host.postgresConnectivity },
            {
              label: "Dataset readable",
              value:
                parsed.host.datasetReadable === null
                  ? "unknown"
                  : String(parsed.host.datasetReadable),
            },
          ]}
        />
      </Section>

      <Section title="Market intelligence">
        <MetricGrid
          items={[
            { label: "Regime", value: parsed.marketIntelligence.regime ?? "unknown" },
            {
              label: "Data quality",
              value: parsed.marketIntelligence.dataQualityScore ?? "unknown",
            },
            { label: "Conviction", value: parsed.marketIntelligence.conviction ?? "unknown" },
            {
              label: "Active hypotheses",
              value: parsed.marketIntelligence.activeHypothesesSummary.length,
            },
          ]}
        />
      </Section>

      <Section title="Strategies">
        <MetricGrid
          items={[
            { label: "Eligibility", value: parsed.strategies.eligibility },
            { label: "Signals created", value: parsed.strategies.signalsCreated },
            { label: "Signals rejected", value: parsed.strategies.signalsRejected },
            { label: "Active versions", value: parsed.strategies.activeVersions.join(", ") || "—" },
          ]}
        />
      </Section>

      <Section title="Simulated positions & trades">
        <MetricGrid
          items={[
            { label: "Orders", value: parsed.tradingSimulation.ordersCount },
            { label: "Fills", value: parsed.tradingSimulation.fillsCount },
            { label: "Open positions", value: parsed.tradingSimulation.openPositionsCount },
            { label: "Equity", value: parsed.tradingSimulation.equity ?? "unknown" },
            { label: "Gross PnL", value: parsed.tradingSimulation.grossPnl ?? "unknown" },
            { label: "Net PnL", value: parsed.tradingSimulation.netPnl ?? "unknown" },
            {
              label: "Drawdown (bps)",
              value: parsed.tradingSimulation.accountDrawdownBps ?? "unknown",
            },
          ]}
        />
      </Section>

      <Section title="Risk & Guardian">
        <MetricGrid
          items={[
            { label: "Guardian state", value: parsed.tradingSimulation.guardianState ?? "unknown" },
            {
              label: "Reconciliation",
              value: parsed.tradingSimulation.reconciliationState ?? "unknown",
            },
            { label: "Exposure", value: parsed.tradingSimulation.exposure ?? "unknown" },
          ]}
        />
      </Section>

      <Section title="Alerts">
        {parsed.recentAlerts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent alerts.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {parsed.recentAlerts.slice(0, 10).map((alert) => (
              <li key={alert.id}>
                <span className="font-medium">{alert.id}</span> — {alert.label}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Evidence & checkpoint health">
        <MetricGrid
          items={[
            {
              label: "Evidence health",
              value: parsed.evidence.evidenceHealth ?? parsed.evidence.artifactWriteHealth,
            },
            { label: "Checkpoint integrity", value: parsed.evidence.checkpointIntegrity },
            { label: "Digest state", value: parsed.evidence.digestState },
            { label: "Event sequence", value: parsed.evidence.eventSequence },
          ]}
        />
      </Section>

      <Section title="Holdout confidentiality">
        <MetricGrid
          items={[
            { label: "Holdout gate", value: parsed.holdout.holdoutGate },
            { label: "Holdout state", value: parsed.holdout.holdoutState },
            { label: "Access", value: parsed.holdout.holdoutAccess },
          ]}
        />
      </Section>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onToggleRawJson}>
          {showRawJson ? "Hide diagnostic JSON" : "Show diagnostic JSON"}
        </Button>
      </div>

      {showRawJson ? (
        <WaiaSurface variant="raised" className="p-4">
          <pre className="bg-muted/30 overflow-auto rounded-md p-3 text-xs">
            {JSON.stringify(status, null, 2)}
          </pre>
        </WaiaSurface>
      ) : null}
    </div>
  );
}
