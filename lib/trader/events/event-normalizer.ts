import type { ExternalEventFixture } from "@/lib/trader/events/event-ingestion.types";
import type { NormalizedEventRecord } from "@/lib/trader/events/event-attribution.types";
import { buildEventRecordContentDigest } from "@/lib/trader/events/serialize-event-attribution";

export function normalizeExternalEventFixture(input: {
  organizationId: string;
  fixture: ExternalEventFixture;
}): NormalizedEventRecord {
  const payloadJson = JSON.stringify({
    metadata: input.fixture.metadata ?? {},
    sourceRef: input.fixture.sourceRef,
  });
  const contentDigest = buildEventRecordContentDigest({
    organizationId: input.organizationId,
    eventKey: input.fixture.eventKey,
    sourceRef: input.fixture.sourceRef,
    eventTime: input.fixture.eventTime,
    symbolScope: input.fixture.symbolScope,
    payloadJson,
  });

  return {
    eventKey: input.fixture.eventKey,
    sourceRef: input.fixture.sourceRef,
    eventTime: input.fixture.eventTime,
    symbolScope: input.fixture.symbolScope,
    payloadJson,
    contentDigest,
  };
}

export function parseExternalEventMetadata(
  record: NormalizedEventRecord,
): Record<string, string | number | boolean> {
  try {
    const parsed = JSON.parse(record.payloadJson) as { metadata?: Record<string, unknown> };
    const metadata = parsed.metadata ?? {};
    const result: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}
