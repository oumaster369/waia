import { readFileSync } from "node:fs";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  EXTERNAL_EVENT_INGEST_SCHEMA_VERSION,
  type ExternalEventFixture,
  type OperatorEventIngestConfig,
} from "@/lib/trader/events/event-ingestion.types";
import { normalizeExternalEventFixture } from "@/lib/trader/events/event-normalizer";
import type { NormalizedEventRecord } from "@/lib/trader/events/event-attribution.types";
import { insertExternalEventFactPostgres } from "@/lib/trader/events/event-record-repository-postgres";
import { buildExternalEventFactContentDigest } from "@/lib/trader/events/serialize-event-attribution";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function parseFixtureFile(path: string): ExternalEventFixture[] {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ExternalEventFixture | ExternalEventFixture[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Operator batch fixture ingest only — local files, no external API calls.
 */
export async function ingestExternalEventFixturesPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: {
    config: OperatorEventIngestConfig;
    newId?: () => string;
  },
): Promise<NormalizedEventRecord[]> {
  if (!input.config.enabled) {
    return [];
  }

  const paths = input.config.fixturePaths ?? [];
  const newId = input.newId ?? (() => crypto.randomUUID());
  const normalized: NormalizedEventRecord[] = [];

  for (const fixturePath of paths) {
    const fixtures = parseFixtureFile(fixturePath);
    for (const fixture of fixtures) {
      const record = normalizeExternalEventFixture({
        organizationId: context.organizationId,
        fixture,
      });
      normalized.push(record);

      const factDigest = buildExternalEventFactContentDigest({
        organizationId: context.organizationId,
        eventKey: fixture.eventKey,
        sourceRef: fixture.sourceRef,
        eventTime: fixture.eventTime,
      });

      await insertExternalEventFactPostgres(ex, context, {
        id: newId(),
        subjectRef: fixture.eventKey,
        payloadJson: JSON.stringify({
          schemaVersion: EXTERNAL_EVENT_INGEST_SCHEMA_VERSION,
          fixture,
        }),
        eventTime: new Date(fixture.eventTime),
        contentDigest: factDigest,
        createdAt: new Date(fixture.eventTime),
      });
    }
  }

  return normalized;
}
