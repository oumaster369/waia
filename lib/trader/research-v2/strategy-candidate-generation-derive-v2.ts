import { addDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import {
  assertResearchStrategyIdentityAllowedV2,
  type StrategyCandidateGenerationKindV2,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";

export type DerivedStrategyEvolutionGenerationV2 = Readonly<{
  kind: StrategyCandidateGenerationKindV2;
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  parents: readonly StrategyParentRefV2[];
  params: Readonly<Record<string, string>>;
}>;

export type DeriveStrategyEvolutionGenerationV2Input = Readonly<{
  candidateId: string;
  parents: readonly StrategyParentRefV2[];
  researchCodeIdentity: string;
}>;

function isNumericParam(value: string): boolean {
  try {
    parseDecimal(value);
    return true;
  } catch {
    return false;
  }
}

function sortedParamKeys(params: Readonly<Record<string, string>>): string[] {
  return Object.keys(params).sort();
}

function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  const last = parts.at(-1);
  if (last && /^\d+$/.test(last)) {
    parts[parts.length - 1] = String(Number.parseInt(last, 10) + 1);
    return parts.join(".");
  }
  return `${version}.1`;
}

function mutateNumericParams(
  params: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const keys = sortedParamKeys(params);
  const numericKey = keys.find((key) => {
    const value = params[key];
    return value !== undefined && isNumericParam(value);
  });
  if (!numericKey) {
    throw new StrategyEvolutionResearchError(
      "PARAMETER_MUTATION_REQUIRES_NUMERIC_PARAM",
      "PARAMETER_MUTATION requires at least one numeric parent param",
    );
  }
  const current = params[numericKey];
  if (current === undefined) {
    throw new StrategyEvolutionResearchError("PARAMETER_MUTATION_REQUIRES_NUMERIC_PARAM");
  }
  return Object.freeze({
    ...params,
    [numericKey]: addDecimal(current, "1"),
  });
}

function mergeParentParams(
  parents: readonly StrategyParentRefV2[],
): Readonly<Record<string, string>> {
  const first = parents[0];
  if (!first) {
    throw new StrategyEvolutionResearchError("CANDIDATE_LINEAGE_INVALID");
  }
  const merged: Record<string, string> = { ...first.params };
  let laterContributed = false;
  for (const parent of parents.slice(1)) {
    for (const key of sortedParamKeys(parent.params)) {
      const value = parent.params[key];
      if (value === undefined) continue;
      if (merged[key] === undefined || merged[key] !== value) {
        merged[key] = value;
        laterContributed = true;
      }
    }
  }
  if (!laterContributed) {
    throw new StrategyEvolutionResearchError(
      "COMBINATION_PARENTS_NOT_DISTINCT",
      "MULTI_PARENT_COMBINATION requires a later parent to contribute a distinct param",
    );
  }
  return Object.freeze(merged);
}

export function deriveStrategyEvolutionGenerationV2(
  input: DeriveStrategyEvolutionGenerationV2Input,
): DerivedStrategyEvolutionGenerationV2 {
  requireResearchV2NonEmpty(input.candidateId, "CANDIDATE_LINEAGE_INVALID");
  requireResearchV2NonEmpty(input.researchCodeIdentity, "CANDIDATE_LINEAGE_INVALID");
  if (input.parents.length === 0) {
    throw new StrategyEvolutionResearchError("GENERATION_INCOMPLETE");
  }

  for (const parent of input.parents) {
    assertResearchStrategyIdentityAllowedV2(parent.strategyId);
  }

  if (input.parents.length === 1) {
    const parent = input.parents[0];
    if (!parent) {
      throw new StrategyEvolutionResearchError("GENERATION_INCOMPLETE");
    }
    return Object.freeze({
      kind: "PARAMETER_MUTATION",
      candidateId: input.candidateId,
      strategyId: parent.strategyId,
      strategyVersion: bumpPatchVersion(parent.strategyVersion),
      parents: Object.freeze([parent]),
      params: mutateNumericParams(parent.params),
    });
  }

  const strategyId = `combination/${[...input.parents.map((parent) => parent.strategyId)].sort().join("+")}`;
  assertResearchStrategyIdentityAllowedV2(strategyId);
  return Object.freeze({
    kind: "MULTI_PARENT_COMBINATION",
    candidateId: input.candidateId,
    strategyId,
    strategyVersion: "0.1.0",
    parents: Object.freeze([...input.parents]),
    params: mergeParentParams(input.parents),
  });
}
