import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  HumanReviewBridge,
  HumanReviewDisposition,
} from "@/lib/trader/research/human-review-bridge.types";
import type { MarketReasoningProposal } from "@/lib/trader/research/market-reasoning-proposal.types";
import { MARKET_REASONING_PROPOSAL_SCHEMA_VERSION } from "@/lib/trader/research/market-reasoning-proposal.types";

export class HumanReviewBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "HumanReviewBridgeError";
    this.code = code;
  }
}

function parseProposal(raw: string): MarketReasoningProposal {
  const parsed = JSON.parse(raw) as MarketReasoningProposal;
  if (parsed.schemaVersion !== MARKET_REASONING_PROPOSAL_SCHEMA_VERSION) {
    throw new HumanReviewBridgeError(
      "HUMAN_REVIEW_UNSUPPORTED_SCHEMA",
      `Unsupported proposal schema: ${parsed.schemaVersion}`,
    );
  }
  return parsed;
}

export function createHumanReviewBridge(): HumanReviewBridge {
  return {
    loadPendingProposal(vaultDir: string): MarketReasoningProposal {
      const proposalPath = resolve(vaultDir, "market-reasoning-proposal.json");
      const raw = readFileSync(proposalPath, "utf8");
      return parseProposal(raw);
    },
    validateProposalForReview(proposal: MarketReasoningProposal): void {
      if (proposal.proposalBody.humanReview.disposition !== "pending") {
        throw new HumanReviewBridgeError(
          "HUMAN_REVIEW_NOT_PENDING",
          "Proposal disposition is not pending",
        );
      }
      if (!proposal.proposalBody.recommendedNextHypothesis.claimText.trim()) {
        throw new HumanReviewBridgeError(
          "HUMAN_REVIEW_MISSING_CLAIM",
          "Recommended hypothesis claim is empty",
        );
      }
    },
  };
}

export function assertValidHumanDisposition(
  disposition: HumanReviewDisposition,
): asserts disposition is Exclude<HumanReviewDisposition, "pending"> {
  if (disposition === "pending") {
    throw new HumanReviewBridgeError(
      "HUMAN_REVIEW_PENDING_DISPOSITION",
      "Operator disposition must not remain pending",
    );
  }
}
