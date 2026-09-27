import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { types } from "node:util";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { enforceServerOnly } from "@/lib/enforce-server-only";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { buildProvenanceRef, normalizeQuoteObservation } from "@/lib/trader/market-data/normalization/normalize-observation";
import { processCanonicalPitObservationV1Postgres } from "./canonical-pit-service-postgres";
import { persistPreparedRawCaptureV1Postgres, readRawCaptureReceiptV1Postgres,
  recordRawValidationV1Postgres } from "./raw-capture-repository-postgres";
import { attestRawSecretScanV1, buildRawStorageBindingAtDurableBoundaryV1,
  defineRawCapturePolicyV1, digestRawBytesV1, prepareRawCaptureV1,
  isRawStorageBindingV1, serializeRawStorageBindingV1, type RawObjectReferenceV1, type RawStorageBindingV1 } from "./raw-capture-v1";

enforceServerOnly();

export const HTX_REFERENCE_DECODER_V1 = "htx-merged-lossless-scale8/v1";
export class HtxReferenceQuoteRefusedV1 extends Error {
  constructor(readonly reason: string) {
    super(`HTX_REFERENCE_QUOTE_REFUSED:${reason}`);
    this.name = "HtxReferenceQuoteRefusedV1";
  }
}
function refuse(reason: string): never { throw new HtxReferenceQuoteRefusedV1(reason); }

type Token = { readonly numericToken: string };
type Json = string | boolean | null | Token | Json[] | { [key: string]: Json };

/** Narrow bounded JSON decoder. Numeric lexemes never pass through binary floating point. */
export function decodeHtxReferenceJsonV1(bytes: Uint8Array, maxBytes: number): Json {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576 ||
      bytes.length === 0 || bytes.length > maxBytes) refuse("BODY_BOUND");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return refuse("UTF8"); }
  let at = 0, nodes = 0;
  const space = () => { while (/[\t\r\n ]/.test(source[at] ?? "!")) at++; };
  const string = (): string => {
    const start = at++;
    while (at < source.length) {
      const character = source[at++];
      if (character === "\\") { at++; continue; }
      if (character === '"') {
        try { return JSON.parse(source.slice(start, at)) as string; }
        catch { return refuse("STRING"); }
      }
    }
    return refuse("STRING");
  };
  const value = (depth: number): Json => {
    if (++nodes > 16384 || depth > 16) refuse("STRUCTURE_BOUND");
    space();
    const character = source[at];
    if (character === '"') return string();
    if (character === "{") {
      at++; space();
      const object: { [key: string]: Json } = Object.create(null);
      if (source[at] === "}") { at++; return object; }
      while (at < source.length) {
        space();
        if (source[at] !== '"') refuse("OBJECT_KEY");
        const key = string();
        if (Object.hasOwn(object, key) || ["__proto__", "constructor", "prototype", "numericToken"].includes(key))
          refuse("AMBIGUOUS_KEY");
        if (/secret|password|signature|access.?key|api.?key|authorization/i.test(key)) refuse("SECRET_FIELD");
        space(); if (source[at++] !== ":") refuse("OBJECT_COLON");
        object[key] = value(depth + 1); space();
        const end = source[at++];
        if (end === "}") return object;
        if (end !== ",") refuse("OBJECT_DELIMITER");
      }
      return refuse("OBJECT_END");
    }
    if (character === "[") {
      at++; space(); const items: Json[] = [];
      if (source[at] === "]") { at++; return items; }
      while (at < source.length) {
        items.push(value(depth + 1)); space();
        const end = source[at++];
        if (end === "]") return items;
        if (end !== ",") refuse("ARRAY_DELIMITER");
      }
      return refuse("ARRAY_END");
    }
    for (const [word, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(word, at)) { at += word.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at))?.[0];
    if (!number || number.length > 96) return refuse("NUMBER");
    at += number.length;
    return { numericToken: number };
  };
  const result = value(0); space();
  if (at !== source.length) refuse("TRAILING_BYTES");
  return result;
}

const object = (value: Json | undefined): { [key: string]: Json } => {
  if (!value || typeof value !== "object" || Array.isArray(value) || "numericToken" in value)
    return refuse("OBJECT_SHAPE");
  return value;
};
const numberToken = (value: Json | undefined): string => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !("numericToken" in value) || typeof value.numericToken !== "string") return refuse("NUMERIC_TOKEN");
  return value.numericToken;
};
function decimal(value: Json | undefined, positive: boolean): string {
  const token = numberToken(value);
  if (!/^(?:0|[1-9]\d{0,39})(?:\.\d{1,8})?$/.test(token)) refuse("UNSUPPORTED_DECIMAL");
  const [whole, fraction = ""] = token.split(".");
  if (positive && BigInt(whole! + fraction.padEnd(8, "0")) <= 0n) refuse("NONPOSITIVE_PRICE");
  return formatDecimal(BigInt(whole! + fraction.padEnd(8, "0")));
}

export function decodeHtxReferenceQuoteV1(bytes: Uint8Array, symbol: string, maxBytes: number) {
  if (!/^[A-Z0-9]+\/USDT$/.test(symbol)) refuse("SYMBOL");
  const root = object(decodeHtxReferenceJsonV1(bytes, maxBytes));
  if (root.status !== "ok" || root.ch !== `market.${symbol.replace("/", "").toLowerCase()}.detail.merged`)
    refuse("RESPONSE_IDENTITY");
  const timestamp = numberToken(root.ts);
  if (!/^[1-9]\d{0,15}$/.test(timestamp)) refuse("REPORT_TIME");
  const milliseconds = BigInt(timestamp);
  if (milliseconds > 8640000000000000n) refuse("REPORT_TIME");
  const reportTimeUtc = new Date(Number(milliseconds)).toISOString();
  const tick = object(root.tick);
  if (!Array.isArray(tick.bid) || tick.bid.length !== 2 || !Array.isArray(tick.ask) || tick.ask.length !== 2)
    refuse("SIDES_MISSING");
  const bid = decimal(tick.bid[0], true), ask = decimal(tick.ask[0], true);
  decimal(tick.bid[1], true); decimal(tick.ask[1], true);
  const last = decimal(tick.close, true);
  if (parseDecimal(bid) > parseDecimal(ask)) refuse("CROSSED_QUOTE");
  return Object.freeze({ symbol, bid, ask, last, reportTimeUtc,
    reportTimeSemantics: "HTX_RESPONSE_GENERATION" as const, decoderVersion: HTX_REFERENCE_DECODER_V1 });
}

export type PrivateRawObjectStoreV1 = Readonly<{
  put(input: { organizationId: string; sourceId: string; bytes: Uint8Array; retentionSeconds: number;
    signal: AbortSignal }): Promise<RawStorageBindingV1>;
  read(binding: RawStorageBindingV1, maxBytes: number): Promise<Uint8Array>;
  inspectRetained(objectKey: string, maxBytes: number): Promise<{ binding: RawStorageBindingV1; retentionSeconds: number }>;
}>;

/** Explicit private deployment storage, no import-time I/O. The directory must already be provisioned. */
export async function createEncryptedReferenceRawStoreV1(input: {
  directory: string; masterKeyProvider: MasterKeyProvider; maxStoredBytes: number; maxStoredObjects: number;
}): Promise<PrivateRawObjectStoreV1> {
  if (!isAbsolute(input.directory) || !Number.isSafeInteger(input.maxStoredBytes) || input.maxStoredBytes < 1 ||
      !Number.isSafeInteger(input.maxStoredObjects) || input.maxStoredObjects < 1 || input.maxStoredObjects > 8192)
    refuse("STORAGE_DIRECTORY_OR_CAPACITY");
  const directory = await realpath(input.directory);
  const directoryStat = await stat(directory);
  const uid = process.getuid?.();
  if (uid === undefined || !directoryStat.isDirectory() || directoryStat.uid !== uid ||
      (directoryStat.mode & 0o077) !== 0) refuse("STORAGE_PERMISSIONS");
  for (let ancestor = dirname(directory); ; ancestor = dirname(ancestor)) {
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 ||
        info.uid !== 0 && info.uid !== uid) refuse("STORAGE_ANCESTRY");
    if (ancestor === dirname(ancestor)) break;
  }
  const verifyDirectory = async () => {
    const actual = await lstat(directory);
    if (!actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== directoryStat.dev ||
        actual.ino !== directoryStat.ino || actual.uid !== uid || (actual.mode & 0o077) !== 0)
      refuse("STORAGE_DIRECTORY_CHANGED");
  };
  const provider = input.masterKeyProvider;
  const maxStoredBytes = input.maxStoredBytes, maxStoredObjects = input.maxStoredObjects;
  const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine(value => Buffer.from(value, "base64").toString("base64") === value, "Noncanonical base64");
  const exactBase64 = (bytes: number) => base64.refine(value => Buffer.from(value, "base64").length === bytes,
    `Expected ${bytes} decoded bytes`);
  const wrappedKeySchema = z.object({ keyVersion: z.string().min(1).max(128),
    wrappedKey: exactBase64(60) }).strict();
  const envelope = z.object({ organizationId: z.string().uuid(), sourceId: z.string().uuid(),
    rawBytesDigest: z.string().regex(/^[0-9a-f]{64}$/),
    binding: z.custom<RawStorageBindingV1>(value => isRawStorageBindingV1(value as RawStorageBindingV1)),
    retentionSeconds: z.number().int().positive().max(315360000),
    wrapped: wrappedKeySchema,
    iv: exactBase64(12), tag: exactBase64(16),
    ciphertext: base64.refine(value => value.length >= 4 && value.length <= 1398104),
  }).strict();
  const readObject = async (objectKey: string, maxBytes: number) => {
    await verifyDirectory();
    if (!/^[0-9a-f-]{36}$/.test(objectKey) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576)
      return refuse("STORAGE_REFERENCE");
    const handle = await open(join(directory, objectKey), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      const bound = maxBytes * 2 + 8192;
      if (!info.isFile() || info.uid !== uid || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > bound)
        refuse("STORAGE_BOUND");
      // Bound the actual read, not just an earlier stat: growth cannot enlarge this buffer.
      const buffer = Buffer.alloc(bound + 1);
      let length = 0;
      while (length <= bound) {
        const next = await handle.read(buffer, length, bound + 1 - length, length);
        if (next.bytesRead === 0) break;
        length += next.bytesRead;
      }
      if (length > bound) refuse("STORAGE_BOUND");
      const after = await handle.stat();
      if (after.size !== length || after.size !== info.size || after.mtimeMs !== info.mtimeMs ||
          after.ctimeMs !== info.ctimeMs) refuse("STORAGE_MUTATED");
      const serialized = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
      const stored = envelope.parse(JSON.parse(serialized));
      if (JSON.stringify(stored) !== serialized) refuse("STORAGE_ENVELOPE_ENCODING");
      const binding = stored.binding, ref = binding.objectReference;
      if (ref.storageBackendId !== "private-aes-gcm-reference-file/v1" || ref.objectVersion !== "1" ||
          ref.objectKey !== objectKey) refuse("STORAGE_REFERENCE");
      if (stored.organizationId !== binding.organizationId || stored.sourceId !== binding.sourceId ||
          stored.rawBytesDigest !== binding.rawBytesDigest) refuse("STORAGE_SCOPE");
      const key = await provider.decryptDataKey(stored.wrapped);
      try {
        if (!types.isUint8Array(key) || key.length !== 32) refuse("STORAGE_UNWRAPPED_KEY");
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"));
        decipher.setAAD(Buffer.from(JSON.stringify({ binding, retentionSeconds: stored.retentionSeconds })));
        decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
        const body = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "base64")), decipher.final()]);
        if (body.length > maxBytes || digestRawBytesV1(body) !== binding.rawBytesDigest) refuse("STORAGE_READBACK");
        await verifyDirectory();
        return { body, binding, retentionSeconds: stored.retentionSeconds };
      } finally { key.fill(0); }
    } finally { await handle.close(); }
  };
  const read: PrivateRawObjectStoreV1["read"] = async (binding, maxBytes) => {
    if (!isRawStorageBindingV1(binding)) refuse("STORAGE_BINDING");
    const recovered = await readObject(binding.objectReference.objectKey, maxBytes);
    if (serializeRawStorageBindingV1(recovered.binding) !== serializeRawStorageBindingV1(binding)) refuse("STORAGE_BINDING");
    return recovered.body;
  };
  return Object.freeze({ read,
    async inspectRetained(objectKey, maxBytes) {
      const recovered = await readObject(objectKey, maxBytes);
      return { binding: recovered.binding, retentionSeconds: recovered.retentionSeconds };
    },
    async put({ organizationId, sourceId, bytes, retentionSeconds, signal }) {
    bytes = Uint8Array.from(bytes);
    await verifyDirectory();
    if (bytes.length < 1 || bytes.length > 1048576 ||
        !/^[0-9a-f-]{36}$/.test(organizationId) || !/^[0-9a-f-]{36}$/.test(sourceId) ||
        !Number.isSafeInteger(retentionSeconds) || retentionSeconds < 1 || retentionSeconds > 315360000)
      refuse("STORAGE_INPUT");
    if (signal.aborted) refuse("ABORTED");
    // Shared across processes. A crash leaves the marker and partial object retained; a later
    // writer refuses until separately governed recovery accounts for the evidence.
    const objectKey = randomUUID();
    const reservationPath = join(directory, ".write-reservation");
    const reservation = await open(reservationPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      constants.O_NOFOLLOW, 0o600);
    let completed = false;
    try {
    await reservation.writeFile(JSON.stringify({ schema: "reference-store-reservation/v1", objectKey,
      organizationId, sourceId, rawBytesDigest: digestRawBytesV1(bytes), retentionSeconds,
      startedAtUtc: new Date().toISOString() }));
    await reservation.sync();
    let count = 0, total = 0;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (entry.name === ".write-reservation") continue;
      if (++count > maxStoredObjects || !/^[0-9a-f-]{36}$/.test(entry.name)) refuse("STORAGE_CAPACITY_OR_ORPHAN");
      const retained = await lstat(join(directory, entry.name));
      if (!retained.isFile() || retained.uid !== uid || retained.nlink !== 1 ||
          (retained.mode & 0o077) !== 0) refuse("STORAGE_OBJECT_CHANGED");
      total += retained.size;
      if (!Number.isSafeInteger(total) || total > maxStoredBytes) refuse("STORAGE_CAPACITY");
    }
    if (count >= maxStoredObjects || total + bytes.length * 2 + 8192 > maxStoredBytes) refuse("STORAGE_CAPACITY");
    if (signal.aborted) refuse("ABORTED");
    const rawBytesDigest = digestRawBytesV1(bytes);
    // Own this allocation before awaiting wrapping: even a rejected wrap zeroizes the DEK.
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    try {
      const wrapped = wrappedKeySchema.parse(await provider.encryptDataKey(plaintext));
      if (signal.aborted) refuse("ABORTED");
      const objectReference: RawObjectReferenceV1 = { storageBackendId: "private-aes-gcm-reference-file/v1",
        objectKey, objectVersion: "1", encryptionRequirement: "PRIVATE_ENCRYPTED", accessRequirement: "SERVER_ONLY" };
      const binding = buildRawStorageBindingAtDurableBoundaryV1({ organizationId, sourceId, rawBytesDigest,
        objectReference, storedAt: new Date() });
      const cipher = createCipheriv("aes-256-gcm", plaintext, iv);
      cipher.setAAD(Buffer.from(JSON.stringify({ binding, retentionSeconds })));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const handle = await open(join(directory, objectKey), constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(JSON.stringify({ organizationId, sourceId, rawBytesDigest, binding, retentionSeconds, wrapped,
          iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }));
        await handle.sync();
      } finally { await handle.close(); }
      const directoryHandle = await open(directory, constants.O_RDONLY);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      await read(binding, bytes.length);
      if (signal.aborted) refuse("ABORTED");
      completed = true;
      return binding;
    } finally { plaintext.fill(0); }
    } finally {
      await reservation.close();
      // No body deletion, automatic retry or stale-lock stealing. Failed reservations remain.
      if (completed) {
        await verifyDirectory();
        await unlink(reservationPath);
        const directoryHandle = await open(directory, constants.O_RDONLY);
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
    }
  } });
}

/** Fixed public producer. Transport/storage are I/O ports, never approval or market-value callbacks. */
export async function collectHtxReferenceQuoteV1Postgres(input: {
  db: WaiaPostgresDb; context: OrgContext; sourceId: string; symbol: string;
  maxBytes: number; requestTimeoutMs: number; retentionSeconds: number;
  store: PrivateRawObjectStoreV1; fetchImpl: typeof fetch; signal: AbortSignal;
}) {
  const { context, symbol } = input;
  if (!/^[A-Z0-9]+\/USDT$/.test(symbol) || !Number.isSafeInteger(input.requestTimeoutMs) ||
      input.requestTimeoutMs < 1 || input.requestTimeoutMs > 120000 ||
      !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 1048576 ||
      !Number.isSafeInteger(input.retentionSeconds) || input.retentionSeconds < 1 ||
      input.retentionSeconds > 315360000) refuse("REQUEST_INPUT");
  const policy = defineRawCapturePolicyV1({ maxPayloadBytes: input.maxBytes, retentionSeconds: input.retentionSeconds });
  const started = new Date();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, input.requestTimeoutMs);
  const current = () => { if (controller.signal.aborted || input.signal.aborted) refuse("ABORTED"); };
  try {
    if (input.signal.aborted) refuse("ABORTED");
    const response = await input.fetchImpl(`https://api.huobi.pro/market/detail/merged?symbol=${symbol.replace("/", "").toLowerCase()}`,
      { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) refuse("HTTP_STATUS");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) refuse("ABORTED");
        if (next.done) break;
        length += next.value.length;
        if (length > input.maxBytes || length > 1048576) refuse("BODY_BOUND");
        chunks.push(next.value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const acquiredAt = new Date(), bytes = Buffer.concat(chunks);
    current();
    const decoded = decodeHtxReferenceQuoteV1(bytes, symbol, input.maxBytes);
    if (Date.parse(decoded.reportTimeUtc) > acquiredAt.getTime()) refuse("REPORT_IN_FUTURE");
    const prepared = prepareRawCaptureV1({ organizationId: context.organizationId, sourceId: input.sourceId,
      bodyBytes: bytes, policy, secretScanReceipt: attestRawSecretScanV1({ status: "PASS", bodyBytes: bytes,
        scannerId: "fixed-public-htx-merged-key-scan", scannerVersion: HTX_REFERENCE_DECODER_V1, completedAt: acquiredAt }) });
    const binding = await input.store.put({ organizationId: context.organizationId, sourceId: input.sourceId, bytes,
      retentionSeconds: input.retentionSeconds, signal: controller.signal });
    current();
    const retained = await input.store.read(binding, input.maxBytes);
    current();
    if (digestRawBytesV1(retained) !== prepared.rawBytesDigest ||
        JSON.stringify(decodeHtxReferenceQuoteV1(retained, symbol, input.maxBytes)) !== JSON.stringify(decoded))
      refuse("RAW_READBACK");
    const capture = await persistPreparedRawCaptureV1Postgres(input.db, context, { prepared, storageBinding: binding });
    // A completed owner write remains durable. Cancellation refuses this operation's
    // positive result; it does not pretend to roll back any previously committed prefix.
    current();
    const validation = await recordRawValidationV1Postgres(input.db, context, {
      captureReceiptDigest: capture.receipt.contentDigest, validatorId: "htx-reference-quote",
      validatorVersion: HTX_REFERENCE_DECODER_V1, outcome: { status: "VALID", reasonCodes: [] } });
    current();
    const reread = await readRawCaptureReceiptV1Postgres(input.db, context, capture.receipt.contentDigest);
    current();
    if (!reread || reread.rawBytesDigest !== prepared.rawBytesDigest ||
        reread.storageBindingDigest !== binding.contentDigest) refuse("CAPTURE_READBACK");
    const observation = normalizeQuoteObservation({ quote: { ...decoded, timestamp: decoded.reportTimeUtc },
      provenance: buildProvenanceRef({ providerId: "htx_spot", venue: "HTX", feedKind: "quote_l1", symbol,
        eventTimeUtc: decoded.reportTimeUtc, ingestTimeUtc: acquiredAt.toISOString() }),
      latencyMs: acquiredAt.getTime() - started.getTime(), evaluatedAt: acquiredAt.toISOString() });
    const canonical = await processCanonicalPitObservationV1Postgres(input.db, context, observation,
      { pitCutoffUtc: acquiredAt.toISOString() });
    current();
    if (canonical.receipt.status !== "AVAILABLE" || !canonical.observation ||
        canonical.observation.sourceId !== input.sourceId) refuse("CANONICAL_UNAVAILABLE");
    return Object.freeze({ decoded, requestStartedAtUtc: started.toISOString(), acquiredAtUtc: acquiredAt.toISOString(),
      capture: capture.receipt, validation: validation.receipt, binding, canonical });
  } finally { clearTimeout(timeout); input.signal.removeEventListener("abort", cancel); controller.abort(); }
}
