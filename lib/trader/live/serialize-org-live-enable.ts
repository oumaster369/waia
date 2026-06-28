import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";

import type {
  OrgLiveEnableEventDigestInput,
  OrgLiveEnableEventRecordPayload,
  OrgLiveEnableEventView,
} from "@/lib/trader/live/types";

export const ORG_LIVE_ENABLE_EVENT_SCHEMA_VERSION = "1";

export class OrgLiveEnableDigestMismatchError extends Error {
  constructor() {
    super("Org live-enable event digest mismatch");
    this.name = "OrgLiveEnableDigestMismatchError";
  }
}

export function computeOrgLiveEnableEventDigest(input: OrgLiveEnableEventDigestInput): string {
  const canonical = {
    schemaVersion: ORG_LIVE_ENABLE_EVENT_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildOrgLiveEnableEventPayload(
  input: OrgLiveEnableEventDigestInput,
): OrgLiveEnableEventRecordPayload {
  const recordContentDigest = computeOrgLiveEnableEventDigest(input);
  return {
    schemaVersion: ORG_LIVE_ENABLE_EVENT_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifyOrgLiveEnableEventDigest(
  payload: OrgLiveEnableEventRecordPayload | OrgLiveEnableEventView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as OrgLiveEnableEventRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeOrgLiveEnableEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new OrgLiveEnableDigestMismatchError();
  }
}

export function hashOperatorAckPhrase(ackPhrase: string): string {
  return createHash("sha256").update(ackPhrase, "utf8").digest("hex");
}
