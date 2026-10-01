import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { deterministicUuidV8 } from "@/lib/trader/execution/deterministic-execution-id";
import { captureHistoricalMockLedgerScope } from "@/lib/trader/execution/historical-mock-ledger-scope";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { loadRegisteredResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";

const commandSchema = z.object({
  specSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRunId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}(?![\s\S])/),
  // A protocol key, not a user-visible label. Identical ASCII validation in
  // PostgreSQL avoids JS trim()/SQL btrim() Unicode whitespace disagreement.
  commandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}(?![\s\S])/),
}).strict();

export type RegisteredResearchAttemptV1 = Readonly<{
  authority: "ATTEMPT_IDENTITY_ONLY";
  id: string;
  organizationId: string;
  specSha256: string;
  sourceRunId: string;
  commandId: string;
  registeredAt: string;
}>;

function scope(context: OrgContext): OrgContext {
  return Object.freeze({ organizationId: requireOrgContext(context.organizationId).organizationId.toLowerCase() });
}

function mapAttempt(row: typeof pgSchema.traderResearchAttemptsV1.$inferSelect): RegisteredResearchAttemptV1 {
  return Object.freeze({ authority: "ATTEMPT_IDENTITY_ONLY", id: row.id,
    organizationId: row.organizationId, specSha256: row.specSha256, sourceRunId: row.sourceRunId,
    commandId: row.commandId, registeredAt: row.registeredAt.toISOString() });
}

/** Root commit and database-issued ID before any stage is constructed. A retry
 * of the same command cannot silently start another ledger or change its spec/source.
 * This does not acquire an execution lease, authorize scoring, or reset split use. */
export async function registerResearchAttemptPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof commandSchema>,
): Promise<RegisteredResearchAttemptV1> {
  assertResearchRootPostgresDbV1(db);
  const captured = scope(context);
  const command = commandSchema.parse(supplied);
  await loadRegisteredResearchExperimentPostgresV1(db, captured, command.specSha256);
  const table = pgSchema.traderResearchAttemptsV1;
  await db.transaction(async tx => {
    await tx.insert(table).values({ ...command, organizationId: captured.organizationId })
      .onConflictDoNothing({ target: [table.organizationId, table.commandId] });
    const [row] = await tx.select().from(table).where(and(
      eq(table.organizationId, captured.organizationId), eq(table.commandId, command.commandId),
    )).limit(1);
    if (!row || row.specSha256 !== command.specSha256 || row.sourceRunId !== command.sourceRunId) {
      throw new Error("RESEARCH_ATTEMPT_COMMAND_CONFLICT");
    }
  });
  const [row] = await db.select().from(table).where(and(
    eq(table.organizationId, captured.organizationId), eq(table.commandId, command.commandId),
  )).limit(1);
  if (!row || row.specSha256 !== command.specSha256 || row.sourceRunId !== command.sourceRunId) {
    throw new Error("RESEARCH_ATTEMPT_COMMIT_UNCONFIRMED");
  }
  return mapAttempt(row);
}

/** Re-read durable identity and immutable proposal. Caller-created metadata is
 * never accepted instead of either record. This function reads no market bars. */
export async function loadResearchTrainingLedgerScopePostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: Readonly<{ attemptId: string; trialIndex: number }>,
) {
  assertResearchRootPostgresDbV1(db);
  const captured = scope(context);
  const request = z.object({ attemptId: z.string().uuid(), trialIndex: z.number().int().min(0).max(31) })
    .strict().parse(supplied);
  const table = pgSchema.traderResearchAttemptsV1;
  const [row] = await db.select().from(table).where(and(
    eq(table.organizationId, captured.organizationId), eq(table.id, request.attemptId),
  )).limit(1);
  if (!row) throw new Error("RESEARCH_ATTEMPT_NOT_REGISTERED");
  const experiment = await loadRegisteredResearchExperimentPostgresV1(db, captured, row.specSha256);
  const parameters = experiment.spec.orderedTrials[request.trialIndex];
  if (!parameters) throw new Error("RESEARCH_TRIAL_NOT_DECLARED");
  const identity = Object.freeze({ schemaVersion: "waia.research.training_ledger_scope.v1",
    organizationId: captured.organizationId, attemptId: row.id, experimentSpecSha256: row.specSha256,
    sourceRunId: row.sourceRunId,
    trialIndex: request.trialIndex, parameters, partitionSha256: experiment.spec.partitions.train.contentSha256 });
  const contentDigest = computeStableJsonDigest(identity);
  const stageId = deterministicUuidV8(contentDigest);
  return Object.freeze({ authority: "ROW_SCOPE_ONLY" as const, identity, contentDigest,
    // The declared logical account is retained; each trial has a distinct mock
    // lifecycle account so account-key-only projections cannot mix trials.
    logicalAccountKey: experiment.spec.replay.accountKey,
    ledgerScope: captureHistoricalMockLedgerScope({ organizationId: captured.organizationId,
      historicalRunId: stageId, historicalAccountKey: `research-stage:${stageId}` }) });
}
