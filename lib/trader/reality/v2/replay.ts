import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { RealityProjectionV2 } from "./contracts";
import { foldRealityProjectionV2 } from "./projection";
import {
  listRealityEventsV2,
  listRealitySourceReportsV2,
  listTruthRecordsV2,
  type RealityAccountContext,
  type RealityV2Executor,
} from "./repository-postgres";

export async function replayRealityProjectionV2FromLedger(
  executor: RealityV2Executor,
  context: RealityAccountContext,
  knowledgeAsOfUtc: string,
): Promise<RealityProjectionV2> {
  const [sources, truths, events] = await Promise.all([
    listRealitySourceReportsV2(executor, context, knowledgeAsOfUtc),
    listTruthRecordsV2(executor, context, knowledgeAsOfUtc),
    listRealityEventsV2(executor, context, knowledgeAsOfUtc),
  ]);
  return foldRealityProjectionV2(context, knowledgeAsOfUtc, { sources, truths, events });
}

export function replayRealityProjectionV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
  knowledgeAsOfUtc: string,
): Promise<RealityProjectionV2> {
  return replayRealityProjectionV2FromLedger(db, context, knowledgeAsOfUtc);
}

export async function readCurrentRealityProjectionV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
): Promise<RealityProjectionV2 | null> {
  const events = await listRealityEventsV2(db, context);
  const head = events.at(-1);
  return head
    ? replayRealityProjectionV2FromLedger(db, context, head.knowledgeAtUtc)
    : null;
}
