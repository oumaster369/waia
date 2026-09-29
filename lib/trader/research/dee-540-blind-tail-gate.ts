import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { ResearchOrchestratorError } from "@/lib/trader/research/errors";
import {
  assertM9BlindAuthorizationV2,
  type M9BlindAuthorizationScope,
  type M9BlindAuthorizationScopeV2,
} from "@/lib/trader/research/m9-operator-authorization";

export const DEE540_OFFICIAL_HOLDOUT_STATUS = "SEALED_NOT_ACCESSED" as const;

export type Dee540BlindTailGrant = Readonly<{
  operatorBlindAuthorization: string;
  blindAuthorizationScope: M9BlindAuthorizationScopeV2;
  officialHoldoutStatus: typeof DEE540_OFFICIAL_HOLDOUT_STATUS;
}>;

/**
 * DEE-540 gate for a research blind tail.
 *
 * Refuses to authorize a blind backtest unless the content-bound operator digest
 * matches the supplied scope. The official 2025 FHV holdout stays
 * `SEALED_NOT_ACCESSED`; this function does not read holdout bars.
 */
export function assertDee540BlindTailAuthorized(input: {
  operatorBlindAuthorization?: string;
  blindAuthorizationScope?: M9BlindAuthorizationScope;
  officialHoldoutAccessRequested?: boolean;
}): Dee540BlindTailGrant {
  if (FHV_DATASET_PARTITIONS_V1.blindHoldout.status !== DEE540_OFFICIAL_HOLDOUT_STATUS) {
    throw new ResearchOrchestratorError(
      "DEE540_OFFICIAL_HOLDOUT_SEAL_BROKEN",
      "Official 2025 holdout must stay SEALED_NOT_ACCESSED",
    );
  }
  if (input.officialHoldoutAccessRequested === true) {
    throw new ResearchOrchestratorError(
      "DEE540_OFFICIAL_HOLDOUT_SEALED",
      "Official 2025 holdout remains SEALED_NOT_ACCESSED",
    );
  }
  if (!input.operatorBlindAuthorization?.trim() || !input.blindAuthorizationScope) {
    throw new ResearchOrchestratorError(
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
      "Blind tail refused without the DEE-540 authorization gate",
    );
  }
  try {
    assertM9BlindAuthorizationV2(input.operatorBlindAuthorization, input.blindAuthorizationScope);
  } catch (error) {
    const message = error instanceof Error ? error.message : "blind authorization rejected";
    throw new ResearchOrchestratorError("DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED", message);
  }
  return {
    operatorBlindAuthorization: input.operatorBlindAuthorization.trim(),
    blindAuthorizationScope: input.blindAuthorizationScope,
    officialHoldoutStatus: DEE540_OFFICIAL_HOLDOUT_STATUS,
  };
}

export function resolveResearchPipelineCliBlindTail(
  flags: Map<string, string>,
): Dee540BlindTailGrant {
  if (flags.get("official-holdout") === "true" || flags.get("partition") === "blind-holdout") {
    return assertDee540BlindTailAuthorized({ officialHoldoutAccessRequested: true });
  }
  const operatorBlindAuthorization = flags.get("operator-blind-authorization");
  const scopeRaw = flags.get("blind-authorization-scope");
  if (!scopeRaw) {
    return assertDee540BlindTailAuthorized({
      operatorBlindAuthorization,
    });
  }
  let blindAuthorizationScope: M9BlindAuthorizationScope;
  try {
    blindAuthorizationScope = JSON.parse(scopeRaw) as M9BlindAuthorizationScope;
  } catch {
    throw new ResearchOrchestratorError(
      "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED",
      "blind-authorization-scope must be JSON",
    );
  }
  return assertDee540BlindTailAuthorized({
    operatorBlindAuthorization,
    blindAuthorizationScope,
    officialHoldoutAccessRequested: false,
  });
}
