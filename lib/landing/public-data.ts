import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { readPublicWorkPlan } from "@/lib/public-work-plan/service";
import type { PublicWorkPlanProjection } from "@/lib/public-work-plan/types";
import { handlePublicTreasuryGet } from "@/lib/waia-core/treasury/public/http";
import {
  PUBLIC_TREASURY_SCHEMA_VERSION,
  type PublicTreasuryProjection,
} from "@/lib/waia-core/treasury/public/types";

function isTreasuryProjection(value: unknown): value is PublicTreasuryProjection {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === PUBLIC_TREASURY_SCHEMA_VERSION
  );
}

/** Content-free frontend boundary over the existing DEE-617 read model. */
export async function readPublicTreasuryForView(): Promise<PublicTreasuryProjection | null> {
  const result = await handlePublicTreasuryGet();
  return result.status === 200 && isTreasuryProjection(result.body) ? result.body : null;
}

/** Existing DEE-673 service already returns a truthful unavailable projection on failure. */
export async function readPublicWorkPlanForView(): Promise<PublicWorkPlanProjection> {
  return (await readPublicWorkPlan()).body;
}
