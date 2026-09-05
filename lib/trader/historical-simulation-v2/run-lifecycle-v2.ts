import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HISTORICAL_SIMULATION_RUN_LIFECYCLE_V2 =
  "waia.trader.historical_simulation_run_lifecycle.v2" as const;

export const HISTORICAL_SIMULATION_RUN_PHASES_V2 = [
  "QUEUED", "RUNNING", "COMPLETED", "FAILED", "STOPPED",
] as const;

export type HistoricalSimulationRunPhaseV2 =
  (typeof HISTORICAL_SIMULATION_RUN_PHASES_V2)[number];

export type HistoricalSimulationRunLifecycleEventV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_RUN_LIFECYCLE_V2;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  eventSequence: number;
  phase: HistoricalSimulationRunPhaseV2;
  initialRecordIndex: number;
  terminalRecordIndexExclusive: number;
  qualifiedTotalCycles: number;
  committedCycles: number;
  nextCycleSequence: number;
  latestCommittedCycleId: string | null;
  requestedByOperatorId: string;
  observedAt: string;
  errorCode: string | null;
  previousContentDigestHex: string | null;
  contentDigestHex: string;
}>;

export type HistoricalSimulationRunLifecycleProjectionV2 = Readonly<{
  phase: HistoricalSimulationRunPhaseV2;
  qualifiedTotalCycles: number;
  committedCycles: number;
  remainingCycles: number;
  progressBps: number;
  nextCycleSequence: number;
  latestCommittedCycleId: string | null;
  observedAt: string;
  errorCode: string | null;
  contentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function canonicalUtc(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && new Date(epoch).toISOString() === value;
}

function validIdentity(value: string): boolean {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

export function buildHistoricalSimulationRunLifecycleEventV2(
  input: Omit<HistoricalSimulationRunLifecycleEventV2,
    "schemaVersion" | "contentDigestHex">,
): HistoricalSimulationRunLifecycleEventV2 {
  const body = Object.freeze({
    schemaVersion: HISTORICAL_SIMULATION_RUN_LIFECYCLE_V2,
    ...input,
  });
  return assertHistoricalSimulationRunLifecycleEventV2(Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  }));
}

export function assertHistoricalSimulationRunLifecycleEventV2(
  event: HistoricalSimulationRunLifecycleEventV2,
): HistoricalSimulationRunLifecycleEventV2 {
  const { contentDigestHex, ...body } = event ??
    ({} as HistoricalSimulationRunLifecycleEventV2);
  const terminal = event?.terminalRecordIndexExclusive;
  const initial = event?.initialRecordIndex;
  const phase = event?.phase;
  const completed = event?.committedCycles;
  const exactKeys = [
    "schemaVersion", "organizationId", "accountId", "runId", "partition", "symbol",
    "eventSequence", "phase", "initialRecordIndex", "terminalRecordIndexExclusive",
    "qualifiedTotalCycles", "committedCycles", "nextCycleSequence",
    "latestCommittedCycleId", "requestedByOperatorId", "observedAt", "errorCode",
    "previousContentDigestHex", "contentDigestHex",
  ].sort();
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      JSON.stringify(Object.keys(event).sort()) !== JSON.stringify(exactKeys) ||
      event.schemaVersion !== HISTORICAL_SIMULATION_RUN_LIFECYCLE_V2 ||
      !validIdentity(event.organizationId) || !validIdentity(event.accountId) ||
      !validIdentity(event.runId) || !validIdentity(event.requestedByOperatorId) ||
      !["DEVELOPMENT", "WALK_FORWARD"].includes(event.partition) ||
      !["BTCUSDT", "ETHUSDT"].includes(event.symbol) ||
      !HISTORICAL_SIMULATION_RUN_PHASES_V2.includes(phase) ||
      !Number.isSafeInteger(event.eventSequence) || event.eventSequence < 0 ||
      !Number.isSafeInteger(initial) || initial < 0 ||
      !Number.isSafeInteger(terminal) || terminal <= initial ||
      !Number.isSafeInteger(event.qualifiedTotalCycles) ||
      event.qualifiedTotalCycles !== terminal - initial ||
      !Number.isSafeInteger(completed) || completed < 0 ||
      completed > event.qualifiedTotalCycles ||
      !Number.isSafeInteger(event.nextCycleSequence) ||
      event.nextCycleSequence !== completed ||
      (completed === 0) !== (event.latestCommittedCycleId === null) ||
      (event.latestCommittedCycleId !== null && !validIdentity(event.latestCommittedCycleId)) ||
      !canonicalUtc(event.observedAt) ||
      (event.errorCode !== null && !validIdentity(event.errorCode)) ||
      (phase === "COMPLETED" && completed !== event.qualifiedTotalCycles) ||
      (phase !== "COMPLETED" && completed === event.qualifiedTotalCycles) ||
      (event.eventSequence === 0) !== (event.previousContentDigestHex === null) ||
      (event.previousContentDigestHex !== null && !DIGEST.test(event.previousContentDigestHex)) ||
      !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RUN_LIFECYCLE_REFUSED:EVENT");
  }
  return event;
}

export function projectHistoricalSimulationRunLifecycleV2(
  event: HistoricalSimulationRunLifecycleEventV2,
): HistoricalSimulationRunLifecycleProjectionV2 {
  assertHistoricalSimulationRunLifecycleEventV2(event);
  return Object.freeze({
    phase: event.phase,
    qualifiedTotalCycles: event.qualifiedTotalCycles,
    committedCycles: event.committedCycles,
    remainingCycles: event.qualifiedTotalCycles - event.committedCycles,
    progressBps: Math.floor(event.committedCycles * 10_000 / event.qualifiedTotalCycles),
    nextCycleSequence: event.nextCycleSequence,
    latestCommittedCycleId: event.latestCommittedCycleId,
    observedAt: event.observedAt,
    errorCode: event.errorCode,
    contentDigestHex: event.contentDigestHex,
  });
}
