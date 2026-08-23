import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  processCanonicalPitObservationV1Postgres,
  type CanonicalPitServiceResultV1,
} from "@/lib/trader/mi/canonical-pit-service-postgres";
import {
  prepareCanonicalPitAttemptV1,
  type PreparedCanonicalPitAttemptV1,
} from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type CanonicalPitReplayBatchV1 = {
  evaluatedAtUtc: string;
  observations: readonly NormalizedObservation[];
};

export function prepareCanonicalPitReplayBatchV1(
  input: CanonicalPitReplayBatchV1,
): PreparedCanonicalPitAttemptV1[] {
  if (!Number.isFinite(Date.parse(input.evaluatedAtUtc))) {
    throw new Error("CANONICAL_PIT_REPLAY_INVALID_CUTOFF");
  }
  return input.observations.map((observation) =>
    prepareCanonicalPitAttemptV1(observation, { pitCutoffUtc: input.evaluatedAtUtc }),
  );
}

/** Replays through the same canonicalizer and persistence service as gateway inputs. */
export async function persistCanonicalPitReplayBatchV1Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: CanonicalPitReplayBatchV1,
): Promise<CanonicalPitServiceResultV1[]> {
  prepareCanonicalPitReplayBatchV1(input);
  const results: CanonicalPitServiceResultV1[] = [];
  for (const observation of input.observations) {
    results.push(
      await processCanonicalPitObservationV1Postgres(db, context, observation, {
        pitCutoffUtc: input.evaluatedAtUtc,
      }),
    );
  }
  return results;
}
