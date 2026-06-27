import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";
import {
  AccountStatusDigestMismatchError,
  SettlementApplicationDigestMismatchError,
  SettlementDigestMismatchError,
} from "@/lib/trader/settlement/settlement.errors";
import {
  ACCOUNT_STATUS_EVENT_SCHEMA_VERSION,
  SETTLEMENT_APPLICATION_SCHEMA_VERSION,
  SETTLEMENT_SCHEMA_VERSION,
  type AccountStatusEventRecordPayload,
  type AccountStatusEventRecordView,
  type SettlementApplicationRecordPayload,
  type SettlementApplicationRecordView,
  type SettlementRecordPayload,
  type SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";

export type SettlementRecordDigestInput = Omit<
  SettlementRecordPayload,
  "recordContentDigest" | "schemaVersion"
>;

export type SettlementApplicationDigestInput = Omit<
  SettlementApplicationRecordPayload,
  "recordContentDigest" | "schemaVersion"
>;

export type AccountStatusEventDigestInput = Omit<
  AccountStatusEventRecordPayload,
  "recordContentDigest" | "schemaVersion"
>;

export function computeSettlementRecordDigest(input: SettlementRecordDigestInput): string {
  const canonical = {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildSettlementRecordPayload(
  input: SettlementRecordDigestInput,
): SettlementRecordPayload {
  const recordContentDigest = computeSettlementRecordDigest(input);
  return {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifySettlementRecordDigest(
  payload: SettlementRecordPayload | SettlementRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as SettlementRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeSettlementRecordDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new SettlementDigestMismatchError();
  }
}

export function computeSettlementApplicationDigest(
  input: SettlementApplicationDigestInput,
): string {
  const canonical = {
    schemaVersion: SETTLEMENT_APPLICATION_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildSettlementApplicationPayload(
  input: SettlementApplicationDigestInput,
): SettlementApplicationRecordPayload {
  const recordContentDigest = computeSettlementApplicationDigest(input);
  return {
    schemaVersion: SETTLEMENT_APPLICATION_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifySettlementApplicationDigest(
  payload: SettlementApplicationRecordPayload | SettlementApplicationRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as SettlementApplicationRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeSettlementApplicationDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new SettlementApplicationDigestMismatchError();
  }
}

export function computeAccountStatusEventDigest(input: AccountStatusEventDigestInput): string {
  const canonical = {
    schemaVersion: ACCOUNT_STATUS_EVENT_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildAccountStatusEventPayload(
  input: AccountStatusEventDigestInput,
): AccountStatusEventRecordPayload {
  const recordContentDigest = computeAccountStatusEventDigest(input);
  return {
    schemaVersion: ACCOUNT_STATUS_EVENT_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifyAccountStatusEventDigest(
  payload: AccountStatusEventRecordPayload | AccountStatusEventRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as AccountStatusEventRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeAccountStatusEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new AccountStatusDigestMismatchError();
  }
}
