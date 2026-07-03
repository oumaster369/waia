import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveTraderAIFoundation } from "@/lib/ai-gateway/trader-foundation-profile";
import {
  assembleReasoningContext,
  parseVaultEvolutionCycle,
  parseVaultRejectionRecord,
  verifyArtifactContentDigest,
} from "@/lib/trader/research/assemble-reasoning-context";
import { buildMarketReasoningPrompt } from "@/lib/trader/research/build-market-reasoning-prompt";
import { buildMarketReasoningProposal } from "@/lib/trader/research/build-market-reasoning-proposal";
import { MarketReasoningAssistError } from "@/lib/trader/research/errors";
import { resolveResearchReasoningAgent } from "@/lib/trader/research/market-reasoning-assist-agent";
import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";
import { emptyReasoningMemory } from "@/lib/trader/research/reasoning-memory.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import {
  createReasoningSessionAuditBuilder,
  finalizeReasoningSessionAudit,
} from "@/lib/trader/research/reasoning-session-audit.types";
import { emitReasoningSessionTelemetry } from "@/lib/trader/research/reasoning-telemetry";
import { serializeMarketReasoningProposal } from "@/lib/trader/research/serialize-market-reasoning-proposal";
import { computeMarketReasoningPromptDigest } from "@/lib/trader/research/serialize-market-reasoning-proposal";
import { serializeReasoningContext } from "@/lib/trader/research/serialize-reasoning-context";
import { serializeReasoningSessionAudit } from "@/lib/trader/research/serialize-reasoning-session-audit";
import { computeResearchRejectionRecordDigest } from "@/lib/trader/research/serialize-research-rejection-record";
import { computeEvolutionCycleMvpDigest } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { MARKET_REASONING_PROMPT_VERSION } from "@/lib/trader/research/build-market-reasoning-prompt";

export type RunMarketReasoningAssistInput = {
  vaultDir: string;
  agentId?: "market-reasoning-assist";
  assembledAt?: string;
  reasoningSessionId?: string;
  traceId?: string;
};

export type RunMarketReasoningAssistResult = {
  reasoningContext: ReasoningContext;
  reasoningContextPath: string;
  proposal: MarketReasoningProposal;
  proposalPath: string;
  reasoningSessionAuditPath: string;
  providerId: string;
  reasoningSessionId: string;
};

export function loadVaultArtifacts(vaultDir: string): {
  rejectionRecordPath: string;
  evolutionCyclePath: string;
  rejectionRecord: ReturnType<typeof parseVaultRejectionRecord>;
  evolutionCycle: ReturnType<typeof parseVaultEvolutionCycle>;
} {
  const rejectionRecordPath = resolve(vaultDir, "research-rejection-record.json");
  const evolutionCyclePath = resolve(vaultDir, "evolution-cycle-mvp.json");

  let rejectionRaw: unknown;
  let evolutionRaw: unknown;
  try {
    rejectionRaw = JSON.parse(readFileSync(rejectionRecordPath, "utf8")) as unknown;
  } catch {
    throw new MarketReasoningAssistError(
      "VAULT_ARTIFACT_MISSING",
      `missing or unreadable ${rejectionRecordPath}`,
    );
  }
  try {
    evolutionRaw = JSON.parse(readFileSync(evolutionCyclePath, "utf8")) as unknown;
  } catch {
    throw new MarketReasoningAssistError(
      "VAULT_ARTIFACT_MISSING",
      `missing or unreadable ${evolutionCyclePath}`,
    );
  }

  const rejectionRecord = parseVaultRejectionRecord(rejectionRaw);
  const evolutionCycle = parseVaultEvolutionCycle(evolutionRaw);

  verifyArtifactContentDigest(
    "rejectionRecord",
    rejectionRecord,
    computeResearchRejectionRecordDigest,
    rejectionRecord.recordBody,
  );
  verifyArtifactContentDigest(
    "evolutionCycle",
    evolutionCycle,
    computeEvolutionCycleMvpDigest,
    evolutionCycle.cycleBody,
  );

  return { rejectionRecordPath, evolutionCyclePath, rejectionRecord, evolutionCycle };
}

function writeSessionAudit(
  vaultDir: string,
  audit: ReturnType<typeof finalizeReasoningSessionAudit>,
): string {
  const reasoningSessionAuditPath = resolve(vaultDir, "reasoning-session-audit.json");
  writeFileSync(reasoningSessionAuditPath, serializeReasoningSessionAudit(audit), "utf8");
  return reasoningSessionAuditPath;
}

export async function runMarketReasoningAssist(
  input: RunMarketReasoningAssistInput,
): Promise<RunMarketReasoningAssistResult> {
  const vaultDir = resolve(input.vaultDir);
  const agentId = input.agentId ?? "market-reasoning-assist";
  const reasoningSessionId = input.reasoningSessionId ?? randomUUID();
  const traceId = input.traceId ?? randomUUID();
  const sessionStartedAt = input.assembledAt ?? new Date().toISOString();

  const { rejectionRecord, evolutionCycle } = loadVaultArtifacts(vaultDir);

  const reasoningContext = assembleReasoningContext({
    rejectionRecord,
    evolutionCycle,
    assembledAt: sessionStartedAt,
    reasoningSessionId,
  });

  const reasoningContextPath = resolve(vaultDir, "reasoning-context.json");
  writeFileSync(reasoningContextPath, serializeReasoningContext(reasoningContext), "utf8");

  const foundation = resolveTraderAIFoundation();
  const prompt = buildMarketReasoningPrompt(reasoningContext);
  const promptDigest = computeMarketReasoningPromptDigest(prompt.all);

  const auditBuilder = createReasoningSessionAuditBuilder({
    reasoningSessionId,
    traceId,
    sessionStartedAt,
    agentId,
    rejectionRecordDigest: rejectionRecord.envelope.contentDigest,
    evolutionCycleDigest: evolutionCycle.envelope.contentDigest,
    reasoningContextDigest: reasoningContext.envelope.contentDigest,
    memorySnapshotId: emptyReasoningMemory.snapshotId,
    promptVersion: MARKET_REASONING_PROMPT_VERSION,
    promptDigest,
    promptMessageCount: prompt.all.length,
    providerId: foundation.providerId,
    providerClass: foundation.providerClass,
    providerLifecycle: foundation.lifecycle,
    providerVersion: foundation.auditConfig.providerVersion,
    modelVersion: foundation.model,
  });

  const agent = resolveResearchReasoningAgent(agentId);
  const agentResult = await agent.run({
    context: reasoningContext,
    memory: emptyReasoningMemory,
    foundation,
  });

  const sessionCompletedAt = new Date().toISOString();

  if (!agentResult.ok) {
    auditBuilder.sessionOutcome =
      agentResult.code === "GUARDRAIL_REJECTED"
        ? "guardrail_rejected"
        : agentResult.code === "PARSE_ERROR"
          ? "parse_error"
          : agentResult.code === "BUDGET_EXCEEDED"
            ? "budget_exceeded"
            : "provider_error";
    auditBuilder.guardrailOutcome =
      agentResult.code === "GUARDRAIL_REJECTED" ? "rejected" : "not_reached";
    auditBuilder.guardrailCode = agentResult.code;
    auditBuilder.retryCount = agentResult.retryCount ?? 0;
    auditBuilder.latencyMs = agentResult.latencyMs ?? 0;

    writeSessionAudit(vaultDir, finalizeReasoningSessionAudit(auditBuilder, sessionCompletedAt));

    emitReasoningSessionTelemetry({
      organizationId: reasoningContext.envelope.organizationId,
      foundation,
      reasoningSessionId,
      traceId,
      outcome: auditBuilder.sessionOutcome,
      durationMs: auditBuilder.latencyMs,
      promptVersion: MARKET_REASONING_PROMPT_VERSION,
      reasoningContextDigest: reasoningContext.envelope.contentDigest,
      retryCount: auditBuilder.retryCount,
    });

    throw new MarketReasoningAssistError(agentResult.code, agentResult.message);
  }

  auditBuilder.retryCount = agentResult.retryCount;
  auditBuilder.latencyMs = agentResult.latencyMs;
  auditBuilder.responseDigest = agentResult.responseDigest;
  auditBuilder.providerRequestId = agentResult.providerRequestId;
  auditBuilder.finishReason = agentResult.finishReason;
  if (agentResult.tokenUsage !== undefined) {
    auditBuilder.tokenUsage = {
      prompt: agentResult.tokenUsage.prompt ?? 0,
      completion: agentResult.tokenUsage.completion ?? 0,
      total: agentResult.tokenUsage.total ?? 0,
    };
  }

  const proposal = buildMarketReasoningProposal({
    context: reasoningContext,
    draft: agentResult.proposalDraft,
    promptMessages: prompt.all,
    rawProviderJson: agentResult.rawProviderJson,
    foundation,
    providerRequestId: agentResult.providerRequestId,
    completedAt: sessionCompletedAt,
  });

  auditBuilder.proposalDigest = proposal.envelope.contentDigest;
  auditBuilder.guardrailOutcome = "passed";
  auditBuilder.sessionOutcome = "success";

  const proposalPath = resolve(vaultDir, "market-reasoning-proposal.json");
  writeFileSync(proposalPath, serializeMarketReasoningProposal(proposal), "utf8");

  const reasoningSessionAuditPath = writeSessionAudit(
    vaultDir,
    finalizeReasoningSessionAudit(auditBuilder, sessionCompletedAt),
  );

  emitReasoningSessionTelemetry({
    organizationId: reasoningContext.envelope.organizationId,
    foundation,
    reasoningSessionId,
    traceId,
    outcome: "success",
    durationMs: agentResult.latencyMs,
    promptVersion: MARKET_REASONING_PROMPT_VERSION,
    reasoningContextDigest: reasoningContext.envelope.contentDigest,
    providerRequestId: agentResult.providerRequestId,
    finishReason: agentResult.finishReason,
    retryCount: agentResult.retryCount,
    promptTokens: agentResult.tokenUsage?.prompt,
    completionTokens: agentResult.tokenUsage?.completion,
    totalTokens: agentResult.tokenUsage?.total,
  });

  return {
    reasoningContext,
    reasoningContextPath,
    proposal,
    proposalPath,
    reasoningSessionAuditPath,
    providerId: foundation.providerId,
    reasoningSessionId,
  };
}
