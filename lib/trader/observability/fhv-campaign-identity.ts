import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

export const FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION =
  "fhv-campaign-identity-frontier/v1" as const;

/** Namespace seed for injected `newId` factories (FHV rehearsal WP03). */
export const FHV_CAMPAIGN_NEW_ID_NAMESPACE = 416_900;

/** Namespace seed for scoped `randomUuid` factories (FHV rehearsal WP03). */
export const FHV_CAMPAIGN_RANDOM_UUID_NAMESPACE = 416_950;

export type FhvCampaignIdentityFrontierState = Readonly<{
  schemaVersion: typeof FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION;
  runId: string;
  safeResumeThroughCycleIndex: number;
  newIdSeq: number;
  randomUuidSeq: number;
}>;

export type FhvCampaignIdentityContext = Readonly<{
  runId: string;
  newIdSeq: number;
  randomUuidSeq: number;
  createNewIdFactory: () => () => string;
  createRandomUuidFactory: () => () => string;
  captureFrontier: (safeResumeThroughCycleIndex: number) => FhvCampaignIdentityFrontierState;
}>;

export class FhvCampaignIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCampaignIdentityError";
  }
}

function formatCampaignIdentityUuid(namespaceSeed: number, sequence: number): string {
  return `00000000-0000-4000-8000-${String(namespaceSeed + sequence).padStart(12, "0")}`;
}

export function createFhvCampaignIdentityContext(input: {
  runId: string;
  restoredFrontier?: FhvCampaignIdentityFrontierState;
}): FhvCampaignIdentityContext {
  if (input.restoredFrontier && input.restoredFrontier.runId !== input.runId) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_RUN_ID_MISMATCH",
      "Restored identity frontier runId mismatch.",
    );
  }

  const state = {
    newIdSeq: input.restoredFrontier?.newIdSeq ?? 0,
    randomUuidSeq: input.restoredFrontier?.randomUuidSeq ?? 0,
  };

  return {
    runId: input.runId,
    get newIdSeq() {
      return state.newIdSeq;
    },
    get randomUuidSeq() {
      return state.randomUuidSeq;
    },
    createNewIdFactory: () => {
      return () => {
        state.newIdSeq += 1;
        return formatCampaignIdentityUuid(FHV_CAMPAIGN_NEW_ID_NAMESPACE, state.newIdSeq);
      };
    },
    createRandomUuidFactory: () => {
      return () => {
        state.randomUuidSeq += 1;
        return formatCampaignIdentityUuid(FHV_CAMPAIGN_RANDOM_UUID_NAMESPACE, state.randomUuidSeq);
      };
    },
    captureFrontier: (safeResumeThroughCycleIndex: number) => ({
      schemaVersion: FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION,
      runId: input.runId,
      safeResumeThroughCycleIndex,
      newIdSeq: state.newIdSeq,
      randomUuidSeq: state.randomUuidSeq,
    }),
  };
}

export function validateFhvCampaignIdentityFrontier(input: {
  frontier: FhvCampaignIdentityFrontierState;
  runId: string;
  safeResumeThroughCycleIndex: number;
  priorFrontier?: FhvCampaignIdentityFrontierState;
}): void {
  if (input.frontier.schemaVersion !== FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SCHEMA_MISMATCH",
      "Identity frontier schema mismatch.",
    );
  }
  if (input.frontier.runId !== input.runId) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_RUN_ID_MISMATCH",
      "Identity frontier runId mismatch.",
    );
  }
  if (input.frontier.safeResumeThroughCycleIndex !== input.safeResumeThroughCycleIndex) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_FRONTIER_MISMATCH",
      "Identity frontier safeResumeThroughCycleIndex mismatch.",
    );
  }
  if (input.frontier.newIdSeq < 0 || input.frontier.randomUuidSeq < 0) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      "Identity frontier sequence counters must be non-negative.",
    );
  }
  if (
    input.safeResumeThroughCycleIndex >= 0 &&
    input.frontier.newIdSeq === 0 &&
    input.frontier.randomUuidSeq === 0
  ) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK",
      "Identity frontier sequence counters cannot be zero after durable progress.",
    );
  }
  if (input.priorFrontier) {
    if (input.frontier.newIdSeq < input.priorFrontier.newIdSeq) {
      throw new FhvCampaignIdentityError(
        "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK",
        "Identity newIdSeq rolled back.",
      );
    }
    if (input.frontier.randomUuidSeq < input.priorFrontier.randomUuidSeq) {
      throw new FhvCampaignIdentityError(
        "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK",
        "Identity randomUuidSeq rolled back.",
      );
    }
  }
}

export function assertFhvCampaignIdentityFrontierPresent(
  checkpoint: ReplayCheckpointRecord,
): FhvCampaignIdentityFrontierState {
  if (!checkpoint.campaignIdentityFrontierState) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_FRONTIER_MISSING",
      "Checkpoint missing campaign identity frontier state.",
    );
  }
  validateFhvCampaignIdentityFrontier({
    frontier: checkpoint.campaignIdentityFrontierState,
    runId: checkpoint.backtestRunId,
    safeResumeThroughCycleIndex: checkpoint.safeResumeThroughCycleIndex,
  });
  return checkpoint.campaignIdentityFrontierState;
}

export async function runWithScopedRandomUuidFactory<T>(
  randomUuidFactory: () => string,
  run: () => Promise<T>,
): Promise<T> {
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = randomUuidFactory as typeof crypto.randomUUID;
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}
