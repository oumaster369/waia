import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import {
  EXTERNAL_JOURNAL_MAX_CHUNK_BYTES,
  EXTERNAL_JOURNAL_MAX_LINE_BYTES,
  EXTERNAL_JOURNAL_NORMALIZER_VERSION,
  parseExternalJournalChunk,
  type ExternalJournalCursor,
  type ExternalJournalObservation,
  type ExternalJournalQuarantine,
  type TrustedExternalJournalSource,
} from "./parser";

const token = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/);
const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const offset = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine(value => BigInt(value) <= 9223372036854775807n);
const sourceSchema = z.object({
  sourceId: uuid, organizationId: uuid, credentialId: uuid, accountId: token,
  credentialRevision: revision, bindingRevision: revision, externalUid: token,
  market: z.enum(["spot", "futures", "unknown"]), apiMode: token,
  writerDiscriminator: token, sourceFingerprint: hash, verificationReceipt: hash,
  verifiedAtMs: offset, verificationExpiresAtMs: offset,
}).strict().refine(s => s.verificationExpiresAtMs > s.verifiedAtMs);

export type ExternalJournalSourceBinding = Readonly<z.infer<typeof sourceSchema>>;
export interface ExternalJournalStorageSnapshot {
  readonly source: ExternalJournalSourceBinding;
  readonly generationId: string;
  readonly generationFingerprint: string;
  readonly cursorVersion: number;
  readonly cursor: Readonly<ExternalJournalCursor>;
  readonly state: "ACTIVE" | "CLOSED" | "SUSPENDED";
}
export interface ExternalJournalStorageLease extends ExternalJournalStorageSnapshot {
  readonly token: string;
  readonly ownerId: string;
  readonly claimedAtMs: number;
  readonly expiresAtMs: number;
}
/** Supplied only by a separately qualified source reader. No reader is wired here.
 * This evidence is a contract assertion, not a cryptographic source attestation. */
export interface ExternalJournalSourceEvidence {
  readonly sourceFingerprint: string;
  readonly generationFingerprint: string;
  readonly sizeBefore: number;
  readonly sizeAfter: number;
  /** Database clock domain; a future reader must qualify its clock mapping.
   * An unsynchronized host Date.now() is not accepted as database-time proof. */
  readonly observedAtMs: number;
  readonly prefixVerified: true;
}
export type ExternalJournalStorageRecord = Readonly<{
  byteOffset: number;
  byteLength: number;
  rawSha256: string | null;
  normalizerVersion: typeof EXTERNAL_JOURNAL_NORMALIZER_VERSION;
  recordKind: "observation" | "quarantine";
  code: string;
  payload: Readonly<ExternalJournalObservation> | null;
  recordDigest: string;
}>;
export interface PreparedExternalJournalBatch {
  readonly lease: ExternalJournalStorageLease;
  readonly sourceEvidence: ExternalJournalSourceEvidence;
  readonly chunkSha256: string;
  readonly chunkStartOffset: number;
  readonly chunkByteLength: number;
  readonly endOfSource: boolean;
  readonly cursor: Readonly<ExternalJournalCursor>;
  readonly records: readonly ExternalJournalStorageRecord[];
  readonly digest: string;
}
export class ExternalJournalPreparationRefusal extends Error {
  constructor(readonly reason: "INVALID_INPUT" | "SOURCE_CHANGED" | "SOURCE_TRUNCATED" |
    "STALE_EVIDENCE" | "OFFSET_DISCONTINUITY" | "PARSER_REFUSED" | "NO_PROGRESS") {
    super(`EXTERNAL_JOURNAL_${reason}`);
  }
}
const prepared = new WeakSet<object>();
const fail = (reason: ExternalJournalPreparationRefusal["reason"]): never => {
  throw new ExternalJournalPreparationRefusal(reason);
};

// Reject accessors/proxies before validation or copying. Only small JSON-like metadata
// enters this boundary; source bytes take the independent bounded Uint8Array path.
function plainTree(value: unknown, budget = { left: 40000 }, depth = 0): void {
  if (--budget.left < 0 || depth > 12) fail("INVALID_INPUT");
  if (value === null || typeof value !== "object") return;
  if (types.isProxy(value)) fail("INVALID_INPUT");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) fail("INVALID_INPUT");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("INVALID_INPUT");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) fail("INVALID_INPUT");
    plainTree(descriptor.value, budget, depth + 1);
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  return value;
}
export const externalJournalDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function externalJournalParserSource(source: ExternalJournalSourceBinding): TrustedExternalJournalSource {
  return Object.freeze({ sourceId: source.sourceId, organizationId: source.organizationId,
    accountId: source.accountId, externalUid: source.externalUid, market: source.market });
}

const cursorSchema = z.object({
  nextOffset: offset, pendingOffset: offset,
  pendingBytes: z.array(z.number().int().min(0).max(255)).max(EXTERNAL_JOURNAL_MAX_LINE_BYTES),
  boundSource: z.object({ sourceId: token, organizationId: token, accountId: token,
    externalUid: token, market: z.enum(["spot", "futures", "unknown"]) }).strict().optional(),
  generationId: token.optional(),
  discardUntilLf: z.object({ lineOffset: offset, bytesSeen: offset.refine(n => n > 0) }).strict().optional(),
}).strict();

/** Database hydration and caller input share one strict immutable snapshot boundary. */
export function snapshotExternalJournalStorage(input: ExternalJournalStorageSnapshot): ExternalJournalStorageSnapshot {
  try {
    plainTree(input);
    const source = sourceSchema.parse(input.source);
    const generationId = token.parse(input.generationId);
    const generationFingerprint = hash.parse(input.generationFingerprint);
    const cursorVersion = offset.parse(input.cursorVersion);
    const state = z.enum(["ACTIVE", "CLOSED", "SUSPENDED"]).parse(input.state);
    const cursor = cursorSchema.parse(input.cursor);
    if (cursor.pendingOffset + cursor.pendingBytes.length !== cursor.nextOffset ||
      (cursor.discardUntilLf && (cursor.pendingBytes.length !== 0 ||
        cursor.discardUntilLf.lineOffset + cursor.discardUntilLf.bytesSeen !== cursor.nextOffset))) fail("INVALID_INPUT");
    const expectedSource = externalJournalParserSource(source);
    const bound = cursor.boundSource !== undefined || cursor.generationId !== undefined;
    if ((bound && (externalJournalDigest(cursor.boundSource) !== externalJournalDigest(expectedSource) ||
      cursor.generationId !== generationId)) || (!bound && (cursor.nextOffset !== 0 ||
        cursor.pendingBytes.length !== 0 || cursor.discardUntilLf))) fail("INVALID_INPUT");
    // Persisted cursors are always fully bound, including the initial empty cursor.
    return freeze({ source, generationId, generationFingerprint, cursorVersion, state,
      cursor: { ...cursor, boundSource: expectedSource, generationId } });
  } catch { return fail("INVALID_INPUT"); }
}

export function snapshotExternalJournalLease(input: ExternalJournalStorageLease): ExternalJournalStorageLease {
  try {
    plainTree(input);
    const snapshot = snapshotExternalJournalStorage(input);
    const lease = { ...snapshot, token: uuid.parse(input.token), ownerId: token.parse(input.ownerId),
      claimedAtMs: offset.parse(input.claimedAtMs), expiresAtMs: offset.parse(input.expiresAtMs) };
    if (lease.state !== "ACTIVE" || lease.expiresAtMs <= lease.claimedAtMs ||
      lease.expiresAtMs - lease.claimedAtMs > 60000 ||
      lease.claimedAtMs < lease.source.verifiedAtMs) fail("INVALID_INPUT");
    return freeze(lease);
  } catch { return fail("INVALID_INPUT"); }
}

export function isPreparedExternalJournalBatch(value: unknown): value is PreparedExternalJournalBatch {
  return !!value && typeof value === "object" && prepared.has(value);
}

/** Owns parsing, so callers cannot supply normalized payloads or terminal records.
 * No raw chunk is retained; only the existing bounded pending-tail cursor may contain bytes. */
export function prepareExternalJournalBatch(input: {
  readonly lease: ExternalJournalStorageLease;
  readonly chunk: Uint8Array;
  readonly chunkStartOffset: number;
  readonly sourceEvidence: ExternalJournalSourceEvidence;
  readonly endOfSource?: boolean;
}): PreparedExternalJournalBatch {
  if (!input || typeof input !== "object" || types.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(key => typeof key !== "string" ||
      !["lease", "chunk", "chunkStartOffset", "sourceEvidence", "endOfSource"].includes(key) ||
      !("value" in Object.getOwnPropertyDescriptor(input, key)!))) return fail("INVALID_INPUT");
  const { lease: leaseInput, chunk: sourceBytes, chunkStartOffset, sourceEvidence: evidenceInput,
    endOfSource = false } = input;
  const lease = snapshotExternalJournalLease(leaseInput);
  try { plainTree(evidenceInput); } catch { return fail("INVALID_INPUT"); }
  const evidenceResult = z.object({ sourceFingerprint: hash, generationFingerprint: hash,
    sizeBefore: offset, sizeAfter: offset, observedAtMs: offset, prefixVerified: z.literal(true),
  }).strict().safeParse(evidenceInput);
  if (!evidenceResult.success || types.isProxy(sourceBytes) || !types.isUint8Array(sourceBytes) ||
    typeof endOfSource !== "boolean") return fail("INVALID_INPUT");
  // Use intrinsic typed-array operations, never caller byteLength/iterator/species.
  // A shared buffer could change while we snapshot bytes, so it is not admitted.
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  let chunk: Uint8Array;
  try {
    const length = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!.call(sourceBytes) as number;
    const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!.call(sourceBytes);
    if (length > EXTERNAL_JOURNAL_MAX_CHUNK_BYTES || types.isSharedArrayBuffer(buffer)) return fail("INVALID_INPUT");
    chunk = new Uint8Array(length);
    Uint8Array.prototype.set.call(chunk, sourceBytes);
  } catch { return fail("INVALID_INPUT"); }
  const sourceEvidence = evidenceResult.data;
  if (sourceEvidence.sourceFingerprint !== lease.source.sourceFingerprint ||
    sourceEvidence.generationFingerprint !== lease.generationFingerprint) return fail("SOURCE_CHANGED");
  if (chunkStartOffset !== lease.cursor.nextOffset) return fail("OFFSET_DISCONTINUITY");
  const endOffset = chunkStartOffset + chunk.byteLength;
  if (!Number.isSafeInteger(endOffset)) return fail("INVALID_INPUT");
  if (sourceEvidence.sizeBefore < endOffset || sourceEvidence.sizeAfter < sourceEvidence.sizeBefore ||
    (endOfSource && sourceEvidence.sizeAfter !== endOffset)) return fail("SOURCE_TRUNCATED");
  if (sourceEvidence.observedAtMs < lease.claimedAtMs || sourceEvidence.observedAtMs >= lease.expiresAtMs ||
    sourceEvidence.observedAtMs >= lease.source.verificationExpiresAtMs) return fail("STALE_EVIDENCE");
  const result = parseExternalJournalChunk({ source: externalJournalParserSource(lease.source),
    generationId: lease.generationId, cursor: lease.cursor, chunk,
    chunkStartOffset, endOfSource });
  const terminalCodes = new Set(["line_too_large", "invalid_utf8", "invalid_json", "invalid_event_shape",
    "source_identity_mismatch", "conflicting_event_fields", "conflicting_instrument_fields"]);
  if (result.diagnostics.some(item => !terminalCodes.has(item.code))) return fail("PARSER_REFUSED");
  if (!endOfSource && externalJournalDigest(result.cursor) === externalJournalDigest(lease.cursor)) return fail("NO_PROGRESS");
  const cursor = snapshotExternalJournalStorage({ ...lease, cursor: result.cursor }).cursor;
  const records: ExternalJournalStorageRecord[] = [];
  const add = (row: ExternalJournalObservation | ExternalJournalQuarantine, recordKind: "observation" | "quarantine") => {
    const payload = "authority" in row ? row : null;
    if (payload && Buffer.byteLength(JSON.stringify(payload), "utf8") > 16000) return fail("PARSER_REFUSED");
    const value = { byteOffset: row.provenance.byteOffset, byteLength: row.provenance.byteLength,
      rawSha256: row.provenance.rawSha256, normalizerVersion: row.provenance.normalizerVersion,
      recordKind, code: "kind" in row ? row.kind : row.code, payload };
    records.push({ ...value, recordDigest: externalJournalDigest(value) });
  };
  result.observations.forEach(row => add(row, "observation"));
  result.quarantines.forEach(row => add(row, "quarantine"));
  records.sort((a, b) => a.byteOffset - b.byteOffset);
  const value = { lease, sourceEvidence, chunkSha256: createHash("sha256").update(chunk).digest("hex"),
    chunkStartOffset, chunkByteLength: chunk.byteLength,
    endOfSource, cursor, records };
  const batch = freeze({ ...value, digest: externalJournalDigest(value) });
  prepared.add(batch);
  return batch;
}
