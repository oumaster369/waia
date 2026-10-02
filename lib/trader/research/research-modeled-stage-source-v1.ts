import type { loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "./research-training-payload-postgres-v1";

type LegacySource = Awaited<ReturnType<typeof loadRegisteredResearchTrainingExecutionInputPostgresV1>>;
type LegacyScope = LegacySource["scope"];
/** Internal engine input only. Public owners independently establish durable
 * source/attempt authority; the engine never accepts a caller-supplied port. */
export type ResearchModeledStageSourceV1 = Omit<LegacySource, "scope" | "experiment"> & {
  experiment: Pick<LegacySource["experiment"], "spec" | "specSha256">;
  scope: Omit<LegacyScope, "identity"> & {
    identity: Omit<LegacyScope["identity"], "schemaVersion"> & {
      schemaVersion: string;
      sourceIssuanceDigest?: string;
    };
  };
};
