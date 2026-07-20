import type { ResearchCampaignBridge } from "@/lib/trader/research/human-review-bridge.types";

export type ResearchCampaignIntent = {
  hypothesisId: string;
  candidateId: string;
  operatorAttestation: string;
  requiresOperatorAttestation: true;
  intentKind: "register_and_run_research_pipeline";
  notes: string;
};

export function createResearchCampaignBridge(): ResearchCampaignBridge {
  return {
    buildCampaignIntent(input: {
      hypothesisId: string;
      candidateId: string;
      operatorAttestation: string;
    }): ResearchCampaignIntent {
      if (!input.operatorAttestation.trim()) {
        throw new Error("[actuation] research campaign intent requires operator attestation");
      }
      return {
        hypothesisId: input.hypothesisId,
        candidateId: input.candidateId,
        operatorAttestation: input.operatorAttestation,
        requiresOperatorAttestation: true,
        intentKind: "register_and_run_research_pipeline",
        notes:
          "Human-initiated RI campaign intent — blind consumption and pipeline execution require separate operator authorization.",
      };
    },
  };
}
