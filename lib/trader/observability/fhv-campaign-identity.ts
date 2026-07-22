import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

export const FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION =
  "fhv-campaign-identity-frontier/v1" as const;

/** Maximum supported UUID sequence offset (12-digit decimal tail). */
export const FHV_CAMPAIGN_IDENTITY_MAX_SEQUENCE = 999_999_999_999;

export type FhvCampaignIdentityFrontierState = Readonly<{
  schemaVersion: typeof FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  safeResumeThroughCycleIndex: number;
  newIdSeq: number;
  randomUuidSeq: number;
}>;

export type FhvCampaignIdentityStream = "newId" | "randomUuid";

export type FhvCampaignIdentityContext = Readonly<{
  runId: string;
  organizationId: string;
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

function deriveCampaignIdentityNamespaceSeed(input: {
  organizationId: string;
  runId: string;
  identityStream: FhvCampaignIdentityStream;
}): number {
  const digest = computePayloadDigest({
    organizationId: input.organizationId,
    runId: input.runId,
    identityStream: input.identityStream,
    version: 1,
  });
  const numeric = Number.parseInt(digest.slice(0, 10), 16);
  return 100_000 + (numeric % 899_999);
}

function formatScopedIdentityUuid(namespaceSeed: number, sequence: number): string {
  return `00000000-0000-4000-8000-${String(namespaceSeed + sequence).padStart(12, "0")}`;
}

export function assertSafeIdentityCounter(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      `${field} must be a number.`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      `${field} must be finite.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      `${field} must be a safe integer.`,
    );
  }
  if (value < 0) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      `${field} must be non-negative.`,
    );
  }
  if (value > FHV_CAMPAIGN_IDENTITY_MAX_SEQUENCE) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_SEQUENCE_INVALID",
      `${field} exceeds supported UUID sequence range.`,
    );
  }
  return value;
}

export function createFhvCampaignIdentityContext(input: {
  runId: string;
  organizationId: string;
  restoredFrontier?: FhvCampaignIdentityFrontierState;
}): FhvCampaignIdentityContext {
  if (input.restoredFrontier) {
    if (input.restoredFrontier.runId !== input.runId) {
      throw new FhvCampaignIdentityError(
        "FHV_CAMPAIGN_IDENTITY_RUN_ID_MISMATCH",
        "Restored identity frontier runId mismatch.",
      );
    }
    if (input.restoredFrontier.organizationId !== input.organizationId) {
      throw new FhvCampaignIdentityError(
        "FHV_CAMPAIGN_IDENTITY_ORG_MISMATCH",
        "Restored identity frontier organizationId mismatch.",
      );
    }
  }

  const newIdNamespace = deriveCampaignIdentityNamespaceSeed({
    organizationId: input.organizationId,
    runId: input.runId,
    identityStream: "newId",
  });
  const randomUuidNamespace = deriveCampaignIdentityNamespaceSeed({
    organizationId: input.organizationId,
    runId: input.runId,
    identityStream: "randomUuid",
  });

  const state = {
    newIdSeq: input.restoredFrontier?.newIdSeq ?? 0,
    randomUuidSeq: input.restoredFrontier?.randomUuidSeq ?? 0,
  };

  return {
    runId: input.runId,
    organizationId: input.organizationId,
    get newIdSeq() {
      return state.newIdSeq;
    },
    get randomUuidSeq() {
      return state.randomUuidSeq;
    },
    createNewIdFactory: () => {
      return () => {
        state.newIdSeq += 1;
        return formatScopedIdentityUuid(newIdNamespace, state.newIdSeq);
      };
    },
    createRandomUuidFactory: () => {
      return () => {
        state.randomUuidSeq += 1;
        return formatScopedIdentityUuid(randomUuidNamespace, state.randomUuidSeq);
      };
    },
    captureFrontier: (safeResumeThroughCycleIndex: number) => ({
      schemaVersion: FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION,
      runId: input.runId,
      organizationId: input.organizationId,
      safeResumeThroughCycleIndex,
      newIdSeq: state.newIdSeq,
      randomUuidSeq: state.randomUuidSeq,
    }),
  };
}

export function validateFhvCampaignIdentityFrontier(input: {
  frontier: FhvCampaignIdentityFrontierState;
  runId: string;
  organizationId: string;
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
  if (input.frontier.organizationId !== input.organizationId) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_ORG_MISMATCH",
      "Identity frontier organizationId mismatch.",
    );
  }
  if (input.frontier.safeResumeThroughCycleIndex !== input.safeResumeThroughCycleIndex) {
    throw new FhvCampaignIdentityError(
      "FHV_CAMPAIGN_IDENTITY_FRONTIER_MISMATCH",
      "Identity frontier safeResumeThroughCycleIndex mismatch.",
    );
  }

  assertSafeIdentityCounter(input.frontier.newIdSeq, "newIdSeq");
  assertSafeIdentityCounter(input.frontier.randomUuidSeq, "randomUuidSeq");

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
    if (
      input.frontier.safeResumeThroughCycleIndex < input.priorFrontier.safeResumeThroughCycleIndex
    ) {
      throw new FhvCampaignIdentityError(
        "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK",
        "Identity safeResumeThroughCycleIndex rolled back.",
      );
    }
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

export function assertIdentityFrontierMonotonicWrite(input: {
  runRoot: string;
  frontier: FhvCampaignIdentityFrontierState;
}): void {
  const priorCheckpoint = readReplayCheckpoint(input.runRoot);
  validateFhvCampaignIdentityFrontier({
    frontier: input.frontier,
    runId: input.frontier.runId,
    organizationId: input.frontier.organizationId,
    safeResumeThroughCycleIndex: input.frontier.safeResumeThroughCycleIndex,
    priorFrontier: priorCheckpoint?.campaignIdentityFrontierState,
  });
}

export function assertFhvCampaignIdentityFrontierPresent(
  checkpoint: ReplayCheckpointRecord,
  organizationId: string,
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
    organizationId,
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

export function previewScopedIdentityId(input: {
  organizationId: string;
  runId: string;
  identityStream: FhvCampaignIdentityStream;
  sequence: number;
}): string {
  const namespace = deriveCampaignIdentityNamespaceSeed(input);
  return formatScopedIdentityUuid(namespace, input.sequence);
}
