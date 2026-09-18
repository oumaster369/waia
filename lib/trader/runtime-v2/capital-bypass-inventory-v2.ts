export const CAPITAL_BYPASS_DISPOSITIONS_V2 = [
  "CANONICAL",
  "MIGRATE",
  "READ_ONLY",
  "RESEARCH_ONLY",
  "QUARANTINE",
  "DELETE",
] as const;

export type CapitalBypassDispositionV2 = (typeof CAPITAL_BYPASS_DISPOSITIONS_V2)[number];

export type CapitalBypassSeamV2 = Readonly<{
  id: string;
  path: string;
  kind:
    | "venue_write"
    | "legacy_submit"
    | "strategy_signal_mapper"
    | "forecast_decision"
    | "legacy_risk"
    | "orchestrator"
    | "guardian_control"
    | "billing"
    | "research"
    | "ui";
  disposition: CapitalBypassDispositionV2;
  writeCapable: boolean;
  unresolved: boolean;
  note: string;
}>;

export const CAPITAL_BYPASS_INVENTORY_V2: readonly CapitalBypassSeamV2[] = Object.freeze([
  Object.freeze({
    id: "execution-v2-connector-dispatch",
    path: "lib/trader/execution/v2/connector-dispatch.ts",
    kind: "venue_write",
    disposition: "CANONICAL",
    writeCapable: true,
    unresolved: false,
    note: "Sole production write-enabled capital-effect ingress.",
  }),
  Object.freeze({
    id: "htx-exchange-connector-adapter",
    path: "lib/trader/connectors/htx/htx-exchange-connector.ts",
    kind: "venue_write",
    disposition: "CANONICAL",
    writeCapable: true,
    unresolved: false,
    note: "Venue adapter owned by Execution V2; not an independent capital spine.",
  }),
  Object.freeze({
    id: "htx-client-transport",
    path: "lib/trader/connectors/htx/client.ts",
    kind: "venue_write",
    disposition: "CANONICAL",
    writeCapable: true,
    unresolved: false,
    note: "HTX HTTP transport used only by the Execution-owned adapter.",
  }),
  Object.freeze({
    id: "mock-exchange-connector",
    path: "lib/trader/connectors/mock-exchange-connector.ts",
    kind: "venue_write",
    disposition: "READ_ONLY",
    writeCapable: false,
    unresolved: false,
    note: "Simulation connector. Physically unable to cause a real venue effect.",
  }),
  Object.freeze({
    id: "legacy-execution-service-submit",
    path: "lib/trader/execution/execution-service.ts",
    kind: "legacy_submit",
    disposition: "QUARANTINE",
    writeCapable: false,
    unresolved: false,
    note: "submitOrder is fail-closed: execution_v2_required / LEGACY_ORDER_SUBMISSION_DISABLED.",
  }),
  Object.freeze({
    id: "map-signal-to-live-submit",
    path: "lib/trader/live/signal-to-live-order.ts",
    kind: "strategy_signal_mapper",
    disposition: "QUARANTINE",
    writeCapable: false,
    unresolved: false,
    note: "StrategySignal is not capital authority; mapper rejects V2 live submit.",
  }),
  Object.freeze({
    id: "map-signal-to-paper-submit",
    path: "lib/trader/paper/signal-to-order.ts",
    kind: "strategy_signal_mapper",
    disposition: "QUARANTINE",
    writeCapable: false,
    unresolved: false,
    note: "Legacy sizing mapper; not Execution V2 ingress.",
  }),
  Object.freeze({
    id: "forecast-decision-bundle",
    path: "lib/trader/intelligence/forecast-decision",
    kind: "forecast_decision",
    disposition: "READ_ONLY",
    writeCapable: false,
    unresolved: false,
    note: "Compatibility records only. Capital spine is Decision V2 canonical authority.",
  }),
  Object.freeze({
    id: "live-cycle-once",
    path: "lib/trader/live/run-live-cycle.ts",
    kind: "orchestrator",
    disposition: "MIGRATE",
    writeCapable: false,
    unresolved: false,
    note: "One-cycle helper. Must consume canonical compose + ExecutionAdmissionProofV2; currently fail-closes without Decision V2.",
  }),
  Object.freeze({
    id: "paper-cycle-runner",
    path: "lib/trader/paper/paper-cycle-runner.ts",
    kind: "orchestrator",
    disposition: "MIGRATE",
    writeCapable: false,
    unresolved: false,
    note: "Paper loop still calls Decision V2; venue write remains Execution V2. Cutover to canonical recurring builder is this issue's remaining runtime switch.",
  }),
  Object.freeze({
    id: "guardian-partial-entry-cancel",
    path: "lib/trader/guardian/htr-breach-partial-entry-cancellation.ts",
    kind: "guardian_control",
    disposition: "CANONICAL",
    writeCapable: false,
    unresolved: false,
    note: "Protective cancel of pending exposure-increasing orders; does not create exposure.",
  }),
  Object.freeze({
    id: "billing-period-close",
    path: "lib/trader/billing/billing-period-close-orchestrator.ts",
    kind: "billing",
    disposition: "READ_ONLY",
    writeCapable: false,
    unresolved: false,
    note: "Billing has no venue-write path.",
  }),
  Object.freeze({
    id: "research-evolution",
    path: "lib/trader/discovery/evolution-orchestrator.ts",
    kind: "research",
    disposition: "RESEARCH_ONLY",
    writeCapable: false,
    unresolved: false,
    note: "No capital path before Human admission.",
  }),
  Object.freeze({
    id: "admin-ui-trade-endpoints",
    path: "app/api/trader/admin",
    kind: "ui",
    disposition: "READ_ONLY",
    writeCapable: false,
    unresolved: false,
    note: "Control plane cannot place trading orders.",
  }),
]);

export function unresolvedWriteCapableCapitalBypassesV2(): readonly CapitalBypassSeamV2[] {
  return CAPITAL_BYPASS_INVENTORY_V2.filter((seam) => seam.unresolved && seam.writeCapable);
}

export function isCapitalBypassVenueWriteForbiddenV2(relativePath: string): boolean {
  return CAPITAL_BYPASS_FORBIDDEN_VENUE_WRITE_PREFIXES_V2.some((prefix) =>
    relativePath.startsWith(prefix),
  );
}

export const CAPITAL_BYPASS_PRODUCTION_PLACE_ORDER_CALL_SITES_V2 = [
  "lib/trader/execution/v2/connector-dispatch.ts",
] as const;

export const CAPITAL_BYPASS_CANONICAL_PLACE_ORDER_SITES_V2 = [
  "lib/trader/execution/v2/connector-dispatch.ts",
  "lib/trader/connectors/htx/htx-exchange-connector.ts",
  "lib/trader/connectors/htx/client.ts",
] as const;

export const CAPITAL_BYPASS_FORBIDDEN_VENUE_WRITE_PREFIXES_V2 = [
  "lib/trader/intelligence/forecast-v2/",
  "lib/trader/intelligence/decision",
  "lib/trader/intelligence/forecast-decision/",
  "lib/trader/risk/",
  "lib/trader/guardian/",
  "lib/trader/billing/",
  "lib/trader/discovery/",
  "lib/trader/research/",
  "app/",
] as const;
