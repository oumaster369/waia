import { createHash } from "node:crypto";

export const C3_MULTI_HOST_OPERATOR_SCHEMA_V1 = "waia.trader.c3_multi_host_operator.v1" as const;

export class C3MultiHostOperatorError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "C3MultiHostOperatorError";
    this.code = code;
  }
}

export type C3CampaignIdentityV1 = Readonly<{
  campaignId: string;
  releaseSha: string;
  p2DigestHex: string;
  g1DigestHex: string;
  originDigestHex: string;
  packageDigestHex: string;
}>;

export type C3CompletedOffsetV1 = Readonly<{
  offset: number;
  evidenceDigestHex: string;
}>;

export type C3MissingInventoryV1 = Readonly<{
  schemaVersion: typeof C3_MULTI_HOST_OPERATOR_SCHEMA_V1;
  identity: C3CampaignIdentityV1;
  completionDigestHex: string;
  offsets: readonly number[];
  contentDigestHex: string;
}>;

export type C3ShardManifestV1 = Readonly<{
  shardId: string;
  hostSlot: number;
  inventoryDigestHex: string;
  offsets: readonly number[];
}>;

export type C3OffsetClaimV1 = Readonly<{
  offset: number;
  hostId: string;
  inventoryDigestHex: string;
}>;

export type C3ShardEvidenceV1 = Readonly<{
  identity: C3CampaignIdentityV1;
  shardId: string;
  hostId: string;
  offset: number;
  evidenceDigestHex: string;
  inventoryDigestHex: string;
}>;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

function refuse(code: string): never {
  throw new C3MultiHostOperatorError(code);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertIdentity(identity: C3CampaignIdentityV1): void {
  if (
    identity.campaignId.trim() === "" ||
    !HEX40.test(identity.releaseSha) ||
    ![
      identity.p2DigestHex,
      identity.g1DigestHex,
      identity.originDigestHex,
      identity.packageDigestHex,
    ].every((item) => HEX64.test(item))
  ) {
    refuse("IDENTITY_INVALID");
  }
}

function assertOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) refuse("OFFSET_INVALID");
}

function completionDigest(completed: readonly C3CompletedOffsetV1[]): string {
  const rows = [...completed].sort((a, b) => a.offset - b.offset);
  return digest(rows.map((row) => [row.offset, row.evidenceDigestHex]));
}

export function captureFreshMissingInventoryV1(input: {
  identity: C3CampaignIdentityV1;
  targetOffsets: readonly number[];
  completed: readonly C3CompletedOffsetV1[];
}): C3MissingInventoryV1 {
  assertIdentity(input.identity);
  if (!Array.isArray(input.targetOffsets) || input.targetOffsets.length < 1) refuse("TARGET_EMPTY");
  const seen = new Set<number>();
  for (const offset of input.targetOffsets) {
    assertOffset(offset);
    if (seen.has(offset)) refuse("TARGET_DUPLICATE");
    seen.add(offset);
  }
  const completed = new Map<number, string>();
  for (const row of input.completed) {
    assertOffset(row.offset);
    if (!HEX64.test(row.evidenceDigestHex)) refuse("EVIDENCE_DIGEST_INVALID");
    if (!seen.has(row.offset)) refuse("COMPLETED_OUTSIDE_TARGET");
    if (completed.has(row.offset) && completed.get(row.offset) !== row.evidenceDigestHex) {
      refuse("COMPLETED_CONFLICT");
    }
    completed.set(row.offset, row.evidenceDigestHex);
  }
  const offsets = Object.freeze(
    [...input.targetOffsets].filter((offset) => !completed.has(offset)).sort((a, b) => a - b),
  );
  const body = {
    schemaVersion: C3_MULTI_HOST_OPERATOR_SCHEMA_V1,
    identity: input.identity,
    completionDigestHex: completionDigest(input.completed),
    offsets,
  };
  return Object.freeze({ ...body, contentDigestHex: digest(body) });
}

export function assertInventoryStillFreshV1(
  inventory: C3MissingInventoryV1,
  completedNow: readonly C3CompletedOffsetV1[],
): void {
  if (completionDigest(completedNow) !== inventory.completionDigestHex) refuse("STALE_INVENTORY");
  if (
    digest({
      schemaVersion: inventory.schemaVersion,
      identity: inventory.identity,
      completionDigestHex: inventory.completionDigestHex,
      offsets: inventory.offsets,
    }) !== inventory.contentDigestHex
  ) {
    refuse("INVENTORY_DIGEST_MISMATCH");
  }
}

export function partitionShardManifestsV1(input: {
  inventory: C3MissingInventoryV1;
  hostCount: number;
}): readonly C3ShardManifestV1[] {
  if (!Number.isSafeInteger(input.hostCount) || input.hostCount < 1 || input.hostCount > 64) {
    refuse("HOST_COUNT_INVALID");
  }
  if (input.inventory.offsets.length < 1) refuse("INVENTORY_EMPTY");
  const hostCount = Math.min(input.hostCount, input.inventory.offsets.length);
  const shards: C3ShardManifestV1[] = [];
  const size = Math.ceil(input.inventory.offsets.length / hostCount);
  for (let slot = 0; slot < hostCount; slot += 1) {
    const offsets = input.inventory.offsets.slice(slot * size, (slot + 1) * size);
    if (offsets.length < 1) continue;
    shards.push(
      Object.freeze({
        hostSlot: slot,
        inventoryDigestHex: input.inventory.contentDigestHex,
        offsets: Object.freeze([...offsets]),
        shardId: digest({
          inventoryDigestHex: input.inventory.contentDigestHex,
          hostSlot: slot,
          offsets,
        }),
      }),
    );
  }
  const union = shards.flatMap((shard) => [...shard.offsets]);
  const unique = new Set(union);
  if (unique.size !== union.length || unique.size !== input.inventory.offsets.length) {
    refuse("SHARD_COVERAGE_INVALID");
  }
  return Object.freeze(shards);
}

export function claimOffsetV1(
  claims: readonly C3OffsetClaimV1[],
  next: C3OffsetClaimV1,
): readonly C3OffsetClaimV1[] {
  assertOffset(next.offset);
  if (next.hostId.trim() === "" || !HEX64.test(next.inventoryDigestHex)) refuse("CLAIM_INVALID");
  const existing = claims.find((claim) => claim.offset === next.offset);
  if (
    existing &&
    (existing.hostId !== next.hostId || existing.inventoryDigestHex !== next.inventoryDigestHex)
  ) {
    refuse("CLAIM_COLLISION");
  }
  if (existing) return claims;
  return Object.freeze([...claims, Object.freeze({ ...next })]);
}

export function importShardEvidenceV1(
  accepted: readonly C3ShardEvidenceV1[],
  evidence: C3ShardEvidenceV1,
  allowedShardIds: ReadonlySet<string>,
): readonly C3ShardEvidenceV1[] {
  assertIdentity(evidence.identity);
  assertOffset(evidence.offset);
  if (!HEX64.test(evidence.evidenceDigestHex) || !HEX64.test(evidence.inventoryDigestHex)) {
    refuse("EVIDENCE_DIGEST_INVALID");
  }
  if (!allowedShardIds.has(evidence.shardId) || evidence.hostId.trim() === "")
    refuse("SHARD_IDENTITY_INVALID");
  const existing = accepted.find((row) => row.offset === evidence.offset);
  if (!existing) return Object.freeze([...accepted, Object.freeze({ ...evidence })]);
  const same =
    existing.evidenceDigestHex === evidence.evidenceDigestHex &&
    existing.shardId === evidence.shardId &&
    existing.hostId === evidence.hostId &&
    existing.inventoryDigestHex === evidence.inventoryDigestHex &&
    existing.identity.releaseSha === evidence.identity.releaseSha &&
    existing.identity.packageDigestHex === evidence.identity.packageDigestHex;
  if (!same) refuse("EVIDENCE_CONFLICT");
  return accepted;
}

export function retryMissingOffsetsV1(input: {
  identity: C3CampaignIdentityV1;
  targetOffsets: readonly number[];
  completed: readonly C3CompletedOffsetV1[];
  accepted: readonly C3ShardEvidenceV1[];
}): C3MissingInventoryV1 {
  const completed = [
    ...input.completed,
    ...input.accepted.map((row) => ({
      offset: row.offset,
      evidenceDigestHex: row.evidenceDigestHex,
    })),
  ];
  return captureFreshMissingInventoryV1({
    identity: input.identity,
    targetOffsets: input.targetOffsets,
    completed,
  });
}

export function reconcileExactCoverageV1(input: {
  targetOffsets: readonly number[];
  completed: readonly C3CompletedOffsetV1[];
  accepted: readonly C3ShardEvidenceV1[];
}): Readonly<{ covered: number }> {
  const covered = new Map<number, string>();
  for (const row of input.completed) {
    if (covered.has(row.offset)) refuse("COVERAGE_DUPLICATE");
    covered.set(row.offset, row.evidenceDigestHex);
  }
  for (const row of input.accepted) {
    const prior = covered.get(row.offset);
    if (prior !== undefined && prior !== row.evidenceDigestHex) refuse("COVERAGE_CONFLICT");
    if (prior === undefined) covered.set(row.offset, row.evidenceDigestHex);
  }
  for (const offset of input.targetOffsets) {
    if (!covered.has(offset)) refuse("COVERAGE_GAP");
  }
  if (covered.size !== input.targetOffsets.length) refuse("COVERAGE_EXTRA");
  return Object.freeze({ covered: covered.size });
}
