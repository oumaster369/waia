import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveWaiaAiTraderFoundationBinding } from "@/lib/ai-gateway/trader-foundation-profile";
import {
  assembleReasoningContext,
  parseVaultEvolutionCycle,
  parseVaultRejectionRecord,
} from "@/lib/trader/research/assemble-reasoning-context";
import { buildMarketReasoningPrompt } from "@/lib/trader/research/build-market-reasoning-prompt";
import { buildMarketReasoningProposal } from "@/lib/trader/research/build-market-reasoning-proposal";
import { MarketReasoningAssistError } from "@/lib/trader/research/errors";
import { resolveResearchReasoningAgent } from "@/lib/trader/research/market-reasoning-assist-agent";
import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import { serializeMarketReasoningProposal } from "@/lib/trader/research/serialize-market-reasoning-proposal";
import { serializeReasoningContext } from "@/lib/trader/research/serialize-reasoning-context";
import { computeResearchRejectionRecordDigest } from "@/lib/trader/research/serialize-research-rejection-record";
import { computeEvolutionCycleMvpDigest } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { verifyArtifactContentDigest } from "@/lib/trader/research/assemble-reasoning-context";

export type RunMarketReasoningAssistInput = {
  vaultDir: string;
  agentId?: "market-reasoning-assist";
  assembledAt?: string;
};

export type RunMarketReasoningAssistResult = {
  reasoningContext: ReasoningContext;
  reasoningContextPath: string;
  proposal: MarketReasoningProposal;
  proposalPath: string;
  providerId: string;
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

export async function runMarketReasoningAssist(
  input: RunMarketReasoningAssistInput,
): Promise<RunMarketReasoningAssistResult> {
  const vaultDir = resolve(input.vaultDir);
  const agentId = input.agentId ?? "market-reasoning-assist";
  const { rejectionRecord, evolutionCycle } = loadVaultArtifacts(vaultDir);

  const reasoningContext = assembleReasoningContext({
    rejectionRecord,
    evolutionCycle,
    assembledAt: input.assembledAt,
  });

  const reasoningContextPath = resolve(vaultDir, "reasoning-context.json");
  writeFileSync(reasoningContextPath, serializeReasoningContext(reasoningContext), "utf8");

  const foundation = resolveWaiaAiTraderFoundationBinding();
  const agent = resolveResearchReasoningAgent(agentId);
  const agentResult = await agent.run({ context: reasoningContext, foundation });

  if (!agentResult.ok) {
    throw new MarketReasoningAssistError(agentResult.code, agentResult.message);
  }

  const prompt = buildMarketReasoningPrompt(reasoningContext);
  const proposal = buildMarketReasoningProposal({
    context: reasoningContext,
    draft: agentResult.proposalDraft,
    promptMessages: prompt.all,
    rawProviderJson: agentResult.rawProviderJson,
    foundation,
    providerRequestId: agentResult.providerRequestId,
  });

  const proposalPath = resolve(vaultDir, "market-reasoning-proposal.json");
  writeFileSync(proposalPath, serializeMarketReasoningProposal(proposal), "utf8");

  return {
    reasoningContext,
    reasoningContextPath,
    proposal,
    proposalPath,
    providerId: foundation.providerId,
  };
}
