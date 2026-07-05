import type { HypothesisDefinition } from "@/lib/trader/mi/hypothesis.types";
import type { HypothesisProposalArtifact } from "@/lib/trader/discovery/hypothesis-proposal.types";
import { buildHypothesisProposalContentDigest } from "@/lib/trader/discovery/serialize-discovery";

export type HypothesisMutationOperator =
  | "tighten_regime_scope"
  | "add_falsification_condition"
  | "swap_required_null";

const MUTATION_OPERATORS: readonly HypothesisMutationOperator[] = [
  "tighten_regime_scope",
  "add_falsification_condition",
  "swap_required_null",
] as const;

export function listHypothesisMutationOperators(): readonly HypothesisMutationOperator[] {
  return MUTATION_OPERATORS;
}

function mutateDefinition(
  definition: HypothesisDefinition,
  operator: HypothesisMutationOperator,
): HypothesisDefinition {
  switch (operator) {
    case "tighten_regime_scope":
      return {
        ...definition,
        regimeScope: {
          ...definition.regimeScope,
          description: `${definition.regimeScope.description} (tightened to STRESS-only probe)`,
          notes: "Lineage-preserving mutation: tighten_regime_scope",
        },
      };
    case "add_falsification_condition":
      return {
        ...definition,
        falsificationConditions: [
          ...definition.falsificationConditions,
          "Attribution remains absent after explicit down-regime gate activation over a sealed window.",
        ],
      };
    case "swap_required_null":
      return {
        ...definition,
        requiredNulls:
          definition.requiredNulls[0] === "always-flat-cash"
            ? ["simple-trend-baseline"]
            : ["always-flat-cash"],
      };
    default:
      return definition;
  }
}

export function mutateHypothesisProposal(
  parent: HypothesisProposalArtifact,
  operator: HypothesisMutationOperator,
  proposalId: string,
  createdAt = new Date().toISOString(),
): HypothesisProposalArtifact {
  const nextDefinition = mutateDefinition(parent.mapsToMiRegisterHypothesis.definition, operator);

  const draft: Omit<HypothesisProposalArtifact, "contentDigest"> = {
    ...parent,
    proposalId,
    claimText: `${parent.claimText} [mutation:${operator}]`,
    falsificationConditions: [...nextDefinition.falsificationConditions],
    lineage: {
      ...parent.lineage,
      parentHypothesisRef: parent.proposalId,
    },
    mapsToMiRegisterHypothesis: {
      ...parent.mapsToMiRegisterHypothesis,
      name: `${parent.mapsToMiRegisterHypothesis.name} (${operator})`,
      definition: nextDefinition,
    },
    createdAt,
  };

  return {
    ...draft,
    contentDigest: buildHypothesisProposalContentDigest(draft),
  };
}
