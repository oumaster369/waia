import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  assembleDiscoveryLoopRuns,
  type DiscoveryLoopRunView,
  type DiscoveryLoopTrialView,
  type DiscoveryLoopVerdictView,
} from "@/lib/trader/discovery/discovery-loop-view";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

type DiscoveryDb = Pick<WaiaPostgresDb, "insert" | "select">;

export type DiscoveryLoopPersistInput = {
  runId: string;
  organizationId: string;
  campaignId: string;
  skipped: boolean;
  status: string | null;
  reason: string | null;
  capitalAuthority: string | null;
  trials: readonly DiscoveryLoopTrialView[];
  verdicts: readonly DiscoveryLoopVerdictView[];
};

export async function persistDiscoveryLoopRun(
  ex: DiscoveryDb,
  input: DiscoveryLoopPersistInput,
): Promise<void> {
  const contentDigest = computeSemanticSha256Hex({
    runId: input.runId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    skipped: input.skipped,
    status: input.status,
    reason: input.reason,
    capitalAuthority: input.capitalAuthority,
    trials: input.trials,
    verdicts: input.verdicts,
  });
  await ex.insert(pgSchema.traderDiscoveryLoopRun).values({
    id: input.runId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    skipped: input.skipped,
    status: input.status,
    reason: input.reason,
    capitalAuthority: input.capitalAuthority,
    contentDigest,
  });
  if (input.trials.length > 0) {
    await ex.insert(pgSchema.traderDiscoveryLoopTrial).values(
      input.trials.map((trial) => ({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        runId: input.runId,
        trialIndex: trial.trialIndex,
        hypothesisId: trial.hypothesisId,
        rawPValue: trial.rawPValue,
        adjustedPValue: trial.adjustedPValue,
      })),
    );
  }
  if (input.verdicts.length > 0) {
    await ex.insert(pgSchema.traderDiscoveryLoopVerdict).values(
      input.verdicts.map((verdict) => ({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        runId: input.runId,
        partition: verdict.partition,
        verdict: verdict.verdict,
        admissionVerdict: verdict.admissionVerdict,
        scored: verdict.scored,
        reasonsJson: [...verdict.reasons],
      })),
    );
  }
}

export async function listDiscoveryLoopRuns(
  ex: Pick<WaiaPostgresDb, "select">,
  input: {
    organizationId?: string;
    start: Date;
    end: Date;
    limit: number;
  },
): Promise<DiscoveryLoopRunView[]> {
  const filters = [
    gte(pgSchema.traderDiscoveryLoopRun.createdAt, input.start),
    lte(pgSchema.traderDiscoveryLoopRun.createdAt, input.end),
  ];
  if (input.organizationId) {
    filters.push(eq(pgSchema.traderDiscoveryLoopRun.organizationId, input.organizationId));
  }
  const runs = await ex
    .select({
      id: pgSchema.traderDiscoveryLoopRun.id,
      organizationId: pgSchema.traderDiscoveryLoopRun.organizationId,
      campaignId: pgSchema.traderDiscoveryLoopRun.campaignId,
      skipped: pgSchema.traderDiscoveryLoopRun.skipped,
      status: pgSchema.traderDiscoveryLoopRun.status,
      reason: pgSchema.traderDiscoveryLoopRun.reason,
      capitalAuthority: pgSchema.traderDiscoveryLoopRun.capitalAuthority,
      createdAt: pgSchema.traderDiscoveryLoopRun.createdAt,
    })
    .from(pgSchema.traderDiscoveryLoopRun)
    .where(and(...filters))
    .orderBy(desc(pgSchema.traderDiscoveryLoopRun.createdAt))
    .limit(input.limit);
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) return [];
  const trials = await ex
    .select({
      runId: pgSchema.traderDiscoveryLoopTrial.runId,
      trialIndex: pgSchema.traderDiscoveryLoopTrial.trialIndex,
      hypothesisId: pgSchema.traderDiscoveryLoopTrial.hypothesisId,
      rawPValue: pgSchema.traderDiscoveryLoopTrial.rawPValue,
      adjustedPValue: pgSchema.traderDiscoveryLoopTrial.adjustedPValue,
    })
    .from(pgSchema.traderDiscoveryLoopTrial)
    .where(inArray(pgSchema.traderDiscoveryLoopTrial.runId, runIds))
    .orderBy(asc(pgSchema.traderDiscoveryLoopTrial.trialIndex));
  const verdicts = await ex
    .select({
      runId: pgSchema.traderDiscoveryLoopVerdict.runId,
      partition: pgSchema.traderDiscoveryLoopVerdict.partition,
      verdict: pgSchema.traderDiscoveryLoopVerdict.verdict,
      admissionVerdict: pgSchema.traderDiscoveryLoopVerdict.admissionVerdict,
      scored: pgSchema.traderDiscoveryLoopVerdict.scored,
      reasonsJson: pgSchema.traderDiscoveryLoopVerdict.reasonsJson,
    })
    .from(pgSchema.traderDiscoveryLoopVerdict)
    .where(inArray(pgSchema.traderDiscoveryLoopVerdict.runId, runIds));
  return assembleDiscoveryLoopRuns({
    runs,
    trials,
    verdicts: verdicts.map((verdict) => ({
      runId: verdict.runId,
      partition: verdict.partition,
      verdict: verdict.verdict,
      admissionVerdict: verdict.admissionVerdict,
      scored: verdict.scored,
      reasons: Array.isArray(verdict.reasonsJson) ? verdict.reasonsJson.map(String) : [],
    })),
  });
}
