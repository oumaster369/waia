import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { EventAttributionExplanationPayload } from "@/lib/trader/events/event-attribution.types";

export function buildEventRecordContentDigest(input: {
  organizationId: string;
  eventKey: string;
  sourceRef: string;
  eventTime: string;
  symbolScope: string;
  payloadJson: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        eventKey: input.eventKey,
        sourceRef: input.sourceRef,
        eventTime: input.eventTime,
        symbolScope: input.symbolScope,
        payloadJson: input.payloadJson,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildEventClassificationContentDigest(input: {
  organizationId: string;
  eventKey: string;
  eventDigest: string;
  classificationKind: string;
  ruleId: string;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}

export function buildEventAttributionContentDigest(input: {
  organizationId: string;
  eventKey: string;
  eventDigest: string;
  subjectRef: string;
  attributionStrength: string;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}

export function buildEventExplanationContentDigest(input: {
  organizationId: string;
  subjectRef: string;
  payload: EventAttributionExplanationPayload;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        subjectRef: input.subjectRef,
        payload: input.payload,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildExternalEventFactContentDigest(input: {
  organizationId: string;
  eventKey: string;
  sourceRef: string;
  eventTime: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        eventKey: input.eventKey,
        sourceRef: input.sourceRef,
        eventTime: input.eventTime,
      }),
      "utf8",
    )
    .digest("hex");
}
