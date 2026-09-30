export type DiscoveryLoopTrialView = Readonly<{
  trialIndex: number;
  hypothesisId: string;
  rawPValue: string;
  adjustedPValue: string;
}>;

export type DiscoveryLoopVerdictView = Readonly<{
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  verdict: string;
  admissionVerdict: string;
  scored: boolean;
  reasons: readonly string[];
}>;

/** Read-only operator row. No orders, fills, or capital commands. */
export type DiscoveryLoopRunView = Readonly<{
  id: string;
  organizationId: string;
  campaignId: string;
  skipped: boolean;
  status: string | null;
  reason: string | null;
  capitalAuthority: string | null;
  createdAt: string;
  trials: readonly DiscoveryLoopTrialView[];
  verdicts: readonly DiscoveryLoopVerdictView[];
}>;

export type DiscoveryLoopRunRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  skipped: boolean;
  status: string | null;
  reason: string | null;
  capitalAuthority: string | null;
  createdAt: Date;
};

export type DiscoveryLoopTrialRow = {
  runId: string;
  trialIndex: number;
  hypothesisId: string;
  rawPValue: string;
  adjustedPValue: string;
};

export type DiscoveryLoopVerdictRow = {
  runId: string;
  partition: string;
  verdict: string;
  admissionVerdict: string;
  scored: boolean;
  reasons: readonly string[];
};

export function assembleDiscoveryLoopRuns(input: {
  runs: readonly DiscoveryLoopRunRow[];
  trials: readonly DiscoveryLoopTrialRow[];
  verdicts: readonly DiscoveryLoopVerdictRow[];
}): DiscoveryLoopRunView[] {
  const trialsByRun = new Map<string, DiscoveryLoopTrialView[]>();
  for (const trial of input.trials) {
    const list = trialsByRun.get(trial.runId) ?? [];
    list.push({
      trialIndex: trial.trialIndex,
      hypothesisId: trial.hypothesisId,
      rawPValue: trial.rawPValue,
      adjustedPValue: trial.adjustedPValue,
    });
    trialsByRun.set(trial.runId, list);
  }
  const verdictsByRun = new Map<string, DiscoveryLoopVerdictView[]>();
  for (const verdict of input.verdicts) {
    if (verdict.partition !== "DEVELOPMENT" && verdict.partition !== "WALK_FORWARD") continue;
    const list = verdictsByRun.get(verdict.runId) ?? [];
    list.push({
      partition: verdict.partition,
      verdict: verdict.verdict,
      admissionVerdict: verdict.admissionVerdict,
      scored: verdict.scored,
      reasons: Object.freeze([...verdict.reasons]),
    });
    verdictsByRun.set(verdict.runId, list);
  }
  return input.runs.map((run) =>
    Object.freeze({
      id: run.id,
      organizationId: run.organizationId,
      campaignId: run.campaignId,
      skipped: run.skipped,
      status: run.status,
      reason: run.reason,
      capitalAuthority: run.capitalAuthority,
      createdAt: run.createdAt.toISOString(),
      trials: Object.freeze(
        (trialsByRun.get(run.id) ?? []).sort((left, right) => left.trialIndex - right.trialIndex),
      ),
      verdicts: Object.freeze(verdictsByRun.get(run.id) ?? []),
    }),
  );
}
