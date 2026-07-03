import { createHash } from "node:crypto";

import type { MarketReasoningProposalBody } from "@/lib/trader/research/market-reasoning-proposal.types";
import { canonicalJsonString } from "@/lib/trader/research/serialize-research-evidence-export";

export function computeMarketReasoningProposalDigest(
  proposalBody: MarketReasoningProposalBody,
): string {
  return createHash("sha256").update(canonicalJsonString(proposalBody), "utf8").digest("hex");
}

export function computeMarketReasoningPromptDigest(
  messages: readonly { role: string; content: string }[],
): string {
  return createHash("sha256").update(canonicalJsonString(messages), "utf8").digest("hex");
}

export function computeMarketReasoningOutputDigest(rawProviderJson: unknown): string {
  return createHash("sha256").update(canonicalJsonString(rawProviderJson), "utf8").digest("hex");
}

export function serializeMarketReasoningProposal(proposal: {
  schemaVersion: string;
  envelope: Record<string, unknown>;
  proposalBody: MarketReasoningProposalBody;
}): string {
  return `${JSON.stringify(proposal, null, 2)}\n`;
}
