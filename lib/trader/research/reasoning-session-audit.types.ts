export const REASONING_SESSION_AUDIT_SCHEMA_VERSION =
  "waia.trader.reasoning-session-audit.v1" as const;

export type ReasoningSessionOutcome =
  | "success"
  | "provider_error"
  | "parse_error"
  | "guardrail_rejected"
  | "budget_exceeded";

export type ReasoningSessionAudit = {
  schemaVersion: typeof REASONING_SESSION_AUDIT_SCHEMA_VERSION;
  session: {
    reasoningSessionId: string;
    traceId: string;
    sessionStartedAt: string;
    sessionCompletedAt: string;
    sessionOutcome: ReasoningSessionOutcome;
    agentId: string;
    foundationProfile: "ai-trader";
  };
  lineage: {
    rejectionRecordDigest: string;
    evolutionCycleDigest: string;
    reasoningContextDigest: string;
  };
  evidence: {
    memorySnapshotId: string;
    memoryAvailability: "empty" | "partial" | "loaded";
  };
  prompt: {
    promptVersion: string;
    promptDigest: string;
    promptMessageCount: number;
  };
  provider: {
    providerId: string;
    providerClass: "fake" | "external" | "local" | "waia-foundation";
    providerLifecycle: "fake" | "sandbox" | "production" | "deprecated";
    providerVersion: string;
    modelVersion: string;
    providerRequestId?: string;
    finishReason?: string;
    retryCount: number;
    latencyMs: number;
    tokenUsage?: { prompt: number; completion: number; total: number };
    estimatedCostUsd?: number;
  };
  output: {
    responseDigest?: string;
    proposalDigest?: string;
    guardrailOutcome: "passed" | "rejected" | "not_reached";
    guardrailCode?: string;
  };
};

export type ReasoningSessionAuditBuilderState = {
  reasoningSessionId: string;
  traceId: string;
  sessionStartedAt: string;
  agentId: string;
  rejectionRecordDigest: string;
  evolutionCycleDigest: string;
  reasoningContextDigest: string;
  memorySnapshotId: string;
  memoryAvailability: "empty" | "partial" | "loaded";
  promptVersion: string;
  promptDigest: string;
  promptMessageCount: number;
  providerId: string;
  providerClass: "fake" | "external" | "local" | "waia-foundation";
  providerLifecycle: "fake" | "sandbox" | "production" | "deprecated";
  providerVersion: string;
  modelVersion: string;
  providerRequestId?: string;
  finishReason?: string;
  retryCount: number;
  latencyMs: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
  responseDigest?: string;
  proposalDigest?: string;
  guardrailOutcome: "passed" | "rejected" | "not_reached";
  guardrailCode?: string;
  sessionOutcome: ReasoningSessionOutcome;
};

export function createReasoningSessionAuditBuilder(input: {
  reasoningSessionId: string;
  traceId: string;
  sessionStartedAt: string;
  agentId: string;
  rejectionRecordDigest: string;
  evolutionCycleDigest: string;
  reasoningContextDigest: string;
  memorySnapshotId: string;
  promptVersion: string;
  promptDigest: string;
  promptMessageCount: number;
  providerId: string;
  providerClass: "fake" | "external" | "local" | "waia-foundation";
  providerLifecycle: "fake" | "sandbox" | "production" | "deprecated";
  providerVersion: string;
  modelVersion: string;
}): ReasoningSessionAuditBuilderState {
  return {
    ...input,
    memoryAvailability: "empty",
    retryCount: 0,
    latencyMs: 0,
    guardrailOutcome: "not_reached",
    sessionOutcome: "provider_error",
  };
}

export function finalizeReasoningSessionAudit(
  state: ReasoningSessionAuditBuilderState,
  sessionCompletedAt: string,
): ReasoningSessionAudit {
  return {
    schemaVersion: REASONING_SESSION_AUDIT_SCHEMA_VERSION,
    session: {
      reasoningSessionId: state.reasoningSessionId,
      traceId: state.traceId,
      sessionStartedAt: state.sessionStartedAt,
      sessionCompletedAt,
      sessionOutcome: state.sessionOutcome,
      agentId: state.agentId,
      foundationProfile: "ai-trader",
    },
    lineage: {
      rejectionRecordDigest: state.rejectionRecordDigest,
      evolutionCycleDigest: state.evolutionCycleDigest,
      reasoningContextDigest: state.reasoningContextDigest,
    },
    evidence: {
      memorySnapshotId: state.memorySnapshotId,
      memoryAvailability: state.memoryAvailability,
    },
    prompt: {
      promptVersion: state.promptVersion,
      promptDigest: state.promptDigest,
      promptMessageCount: state.promptMessageCount,
    },
    provider: {
      providerId: state.providerId,
      providerClass: state.providerClass,
      providerLifecycle: state.providerLifecycle,
      providerVersion: state.providerVersion,
      modelVersion: state.modelVersion,
      ...(state.providerRequestId !== undefined
        ? { providerRequestId: state.providerRequestId }
        : {}),
      ...(state.finishReason !== undefined ? { finishReason: state.finishReason } : {}),
      retryCount: state.retryCount,
      latencyMs: state.latencyMs,
      ...(state.tokenUsage !== undefined ? { tokenUsage: state.tokenUsage } : {}),
    },
    output: {
      ...(state.responseDigest !== undefined ? { responseDigest: state.responseDigest } : {}),
      ...(state.proposalDigest !== undefined ? { proposalDigest: state.proposalDigest } : {}),
      guardrailOutcome: state.guardrailOutcome,
      ...(state.guardrailCode !== undefined ? { guardrailCode: state.guardrailCode } : {}),
    },
  };
}
