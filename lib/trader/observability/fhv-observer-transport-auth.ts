import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const FHV_OBSERVER_AUTH_HEADER = "x-fhv-observer-auth";
export const FHV_OBSERVER_MAX_BODY_BYTES = 64 * 1024;

export type FhvObserverAuthPayload = Readonly<{
  method: string;
  path: string;
  organizationId: string;
  campaignRunId: string;
  timestampMs: number;
  nonce: string;
  bodySha256: string;
}>;

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildFhvObserverAuthToken(payload: FhvObserverAuthPayload, secret: string): string {
  const canonical = canonicalizeSemanticJsonString(payload);
  const signature = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return `${payload.timestampMs}.${payload.nonce}.${signature}`;
}

export function verifyFhvObserverAuthToken(input: {
  headerValue: string | null;
  payload: FhvObserverAuthPayload;
  secret: string;
  nowMs?: number;
  nonceCache?: {
    has(input: { nonce: string; organizationId: string; campaignRunId: string }): boolean;
    remember(input: {
      nonce: string;
      organizationId: string;
      campaignRunId: string;
      nowMs?: number;
    }): void;
  };
  maxSkewMs?: number;
}): void {
  if (!input.headerValue?.trim()) {
    throw new Error("FHV_OBSERVER_AUTH_MISSING");
  }
  const parts = input.headerValue.trim().split(".");
  if (parts.length !== 3) {
    throw new Error("FHV_OBSERVER_AUTH_INVALID");
  }
  const [timestampRaw, nonce, signature] = parts;
  const timestampMs = Number(timestampRaw);
  const nowMs = input.nowMs ?? Date.now();
  const maxSkewMs = input.maxSkewMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
    throw new Error("FHV_OBSERVER_AUTH_EXPIRED");
  }
  if (!nonce) {
    throw new Error("FHV_OBSERVER_AUTH_INVALID");
  }
  if (
    input.nonceCache?.has({
      nonce,
      organizationId: input.payload.organizationId,
      campaignRunId: input.payload.campaignRunId,
    })
  ) {
    throw new Error("FHV_OBSERVER_AUTH_REPLAY");
  }
  const expected = buildFhvObserverAuthToken(
    { ...input.payload, timestampMs, nonce },
    input.secret,
  ).split(".")[2];
  const a = Buffer.from(expected ?? "", "utf8");
  const b = Buffer.from(signature ?? "", "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("FHV_OBSERVER_AUTH_INVALID");
  }
  input.nonceCache?.remember({
    nonce,
    organizationId: input.payload.organizationId,
    campaignRunId: input.payload.campaignRunId,
    nowMs,
  });
}

export function createFhvObserverAuthNonce(): string {
  return randomBytes(16).toString("hex");
}
