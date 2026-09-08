/** Process-local diagnostics only: never scientific evidence or Human authority. */
export type TechnicalPreparationProgressV2 = Readonly<{
  schemaVersion: "waia.trader.technical_preparation_progress.v2";
  organizationId: string; runId: string; releaseSha: string;
  phase: "SCIENTIFIC_PREPARATION" | "SURFACE_LOAD" | "FORECAST_ANCHORS" |
    "VALIDATION_RESAMPLES" | "TECHNICAL_CANDIDATE_COMPLETE" | "PROPOSAL_PERSISTED" |
    "FINALIZATION_REPLAY";
  surfaceKey?: string;
  trialIdentityDigestHex?: string;
  completed?: number;
  total?: number;
  authorityGranted: false;
}>;

export type TechnicalPreparationObserverV2 = Readonly<{
  signal?: AbortSignal;
  onProgress?: (event: TechnicalPreparationProgressV2) => void;
  flushProgress?: () => Promise<void>;
}>;

export function snapshotTechnicalPreparationObserverV2(
  observer: TechnicalPreparationObserverV2 = {},
): TechnicalPreparationObserverV2 {
  const { signal, onProgress, flushProgress } = observer;
  if ((signal || onProgress || flushProgress) && (typeof process === "undefined" ||
      process.release?.name !== "node" || !process.versions?.node || process.env.WAIA_TRADER_CLI !== "1")) {
    throw new Error("TECHNICAL_PREPARATION_OBSERVER_NODE_CLI_REQUIRED");
  }
  assertTechnicalPreparationActiveV2({ signal });
  return Object.freeze({ signal, onProgress, flushProgress });
}

/** Drain diagnostic I/O BEFORE entering another CPU-bound stage. No authority. */
export async function flushTechnicalPreparationProgressV2(observer: TechnicalPreparationObserverV2): Promise<void> {
  assertTechnicalPreparationActiveV2(observer);
  await observer.flushProgress?.();
  assertTechnicalPreparationActiveV2(observer);
}

export function assertTechnicalPreparationActiveV2(observer: TechnicalPreparationObserverV2): void {
  if (observer.signal?.aborted) throw new Error("TECHNICAL_PREPARATION_CANCELLED");
}

export function emitTechnicalPreparationProgressV2(
  observer: TechnicalPreparationObserverV2,
  scope: Readonly<{ organizationId: string; runId: string; releaseSha: string }>,
  progress: Omit<TechnicalPreparationProgressV2,
    "schemaVersion" | "organizationId" | "runId" | "releaseSha" | "authorityGranted">,
): void {
  assertTechnicalPreparationActiveV2(observer);
  // Explicit fields: never log paths, connection strings, caller extras or data.
  observer.onProgress?.(Object.freeze({
    schemaVersion: "waia.trader.technical_preparation_progress.v2",
    organizationId: scope.organizationId, runId: scope.runId, releaseSha: scope.releaseSha,
    phase: progress.phase, surfaceKey: progress.surfaceKey,
    trialIdentityDigestHex: progress.trialIdentityDigestHex,
    completed: progress.completed, total: progress.total, authorityGranted: false,
  }));
  assertTechnicalPreparationActiveV2(observer);
}
