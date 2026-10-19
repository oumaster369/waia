import { createHash } from "node:crypto";
import { types } from "node:util";

export const EXTERNAL_JOURNAL_NORMALIZER_VERSION = "htx-journal-v1" as const;
export const EXTERNAL_JOURNAL_MAX_CHUNK_BYTES = 256 * 1024;
export const EXTERNAL_JOURNAL_MAX_LINE_BYTES = 32 * 1024;
export const EXTERNAL_JOURNAL_MAX_EVENTS_PER_CHUNK = 500;

export type ExternalJournalMarket = "spot" | "futures" | "unknown";
export type ExternalJournalEventKind =
  | "entry_placed"
  | "entry_filled"
  | "close_sent"
  | "position_closed"
  | "protection_restored"
  | "filled"
  | "closed"
  | "day_result"
  | "daily_stop"
  | "day_start"
  | "entry_cancelled"
  | "leverage_set"
  | "skipped"
  | "unknown";
export type ExternalJournalInstrumentKind = "contract" | "asset";

/** Caller-verified scope. Never construct this from journal fields. */
export interface TrustedExternalJournalSource {
  readonly sourceId: string;
  readonly organizationId: string;
  readonly accountId: string;
  readonly externalUid: string;
  readonly market: ExternalJournalMarket;
}

export interface ExternalJournalCursor {
  /** Absolute offset of the next byte expected from this source generation. */
  readonly nextOffset: number;
  /** Bytes after the last complete LF-delimited record; bounded by maxLineBytes. */
  readonly pendingBytes: readonly number[];
  /** Absolute offset of pendingBytes[0], or nextOffset when pendingBytes is empty. */
  readonly pendingOffset: number;
  /** Bound after the first accepted chunk so append reads cannot silently switch sources. */
  readonly boundSource?: Readonly<TrustedExternalJournalSource>;
  readonly generationId?: string;
  /** A too-long unterminated row is skipped through LF without buffering its suffix. */
  readonly discardUntilLf?: Readonly<{ lineOffset: number; bytesSeen: number }>;
}

export interface ExternalJournalProvenance {
  readonly normalizerVersion: typeof EXTERNAL_JOURNAL_NORMALIZER_VERSION;
  readonly sourceId: string;
  readonly generationId: string;
  readonly byteOffset: number;
  /** Number of exact record bytes, excluding the LF delimiter. CR in CRLF is retained. */
  readonly byteLength: number;
  readonly rawSha256: string;
}

export interface ExternalJournalObservation {
  readonly kind: ExternalJournalEventKind;
  readonly authority: "external_executor_observation";
  readonly canonicalFill: false;
  readonly source: Readonly<TrustedExternalJournalSource>;
  readonly provenance: Readonly<ExternalJournalProvenance>;
  readonly instrumentKind?: ExternalJournalInstrumentKind;
  readonly sourceEventTime?: string;
  readonly contract?: string;
  readonly asset?: string;
  readonly side?: string;
  readonly orderId?: string;
  readonly tradeId?: string;
  /** Source estimate only; never a canonical fill, realized result, or billing input. */
  readonly externalEstimatedPnlUsdt?: string;
}

export type ExternalJournalDiagnosticCode =
  | "invalid_source_scope"
  | "invalid_generation_id"
  | "chunk_too_large"
  | "offset_discontinuity"
  | "line_too_large"
  | "invalid_utf8"
  | "invalid_json"
  | "invalid_event_shape"
  | "source_identity_mismatch"
  | "conflicting_event_fields"
  | "conflicting_instrument_fields"
  | "invalid_parser_limits"
  | "invalid_parser_input"
  | "invalid_cursor"
  | "event_limit_reached";

export interface ExternalJournalDiagnostic {
  readonly code: ExternalJournalDiagnosticCode;
  readonly byteOffset: number;
  readonly byteLength: number;
}

/** A complete rejected source record, safe to persist atomically with its cursor.
 * Diagnostics alone are not terminal records (for example an unfinished oversized line).
 * Oversized rows have no digest because prior discarded bytes are deliberately not retained.
 */
export interface ExternalJournalQuarantine {
  readonly code:
    | "line_too_large"
    | "invalid_utf8"
    | "invalid_json"
    | "invalid_event_shape"
    | "source_identity_mismatch"
    | "conflicting_event_fields"
    | "conflicting_instrument_fields";
  readonly source: Readonly<TrustedExternalJournalSource>;
  readonly provenance: Readonly<
    Omit<ExternalJournalProvenance, "rawSha256"> & { rawSha256: string | null }
  >;
}

export interface ExternalJournalChunkResult {
  readonly cursor: Readonly<ExternalJournalCursor>;
  readonly observations: readonly Readonly<ExternalJournalObservation>[];
  readonly quarantines: readonly Readonly<ExternalJournalQuarantine>[];
  readonly diagnostics: readonly Readonly<ExternalJournalDiagnostic>[];
  readonly withheldTailBytes: number;
}

const numericToken = Symbol("external-journal-numeric-token");
interface NumericLexeme {
  readonly [numericToken]: true;
  readonly text: string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const own = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isSafeToken(value: unknown, max = 128): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validSource(source: TrustedExternalJournalSource): boolean {
  try {
    if (!source || typeof source !== "object" || types.isProxy(source)) return false;
    const prototype = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(source);
    if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) return false;
    return (
      isSafeToken(source.sourceId) &&
      isSafeToken(source.organizationId) &&
      isSafeToken(source.accountId) &&
      isSafeToken(source.externalUid) &&
      (source.market === "spot" || source.market === "futures" || source.market === "unknown")
    );
  } catch {
    return false;
  }
}

function snapshotSource(
  source: TrustedExternalJournalSource,
): Readonly<TrustedExternalJournalSource> {
  return Object.freeze({
    sourceId: source.sourceId,
    organizationId: source.organizationId,
    accountId: source.accountId,
    externalUid: source.externalUid,
    market: source.market,
  });
}

function diagnostic(
  code: ExternalJournalDiagnosticCode,
  byteOffset: number,
  byteLength: number,
): ExternalJournalDiagnostic {
  return Object.freeze({ code, byteOffset, byteLength });
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor,
    );
  } catch {
    return false;
  }
}

function safeString(value: unknown, max = 256): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function safeScalarId(value: unknown): string | undefined {
  if (typeof value === "string") return safeString(value, 128);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (isNumericLexeme(value) && /^-?(?:0|[1-9]\d{0,127})$/.test(value.text)) return value.text;
  return undefined;
}

function normalizePnl(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (isNumericLexeme(value) && Number.isFinite(Number(value.text))) return value.text;
  if (typeof value === "string" && value.length <= 64 && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }
  return undefined;
}

function isNumericLexeme(value: unknown): value is NumericLexeme {
  return Boolean(
    value &&
    typeof value === "object" &&
    !types.isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertyDescriptor(value, numericToken)?.value === true &&
    typeof Object.getOwnPropertyDescriptor(value, "text")?.value === "string",
  );
}

function identityClaimMatches(
  row: Record<string, unknown>,
  source: TrustedExternalJournalSource,
): boolean {
  const aliases: ReadonlyArray<[string, string]> = [
    ["sourceId", source.sourceId],
    ["organizationId", source.organizationId],
    ["tenantId", source.organizationId],
    ["accountId", source.accountId],
    ["externalUid", source.externalUid],
    ["uid", source.externalUid],
    ["market", source.market],
  ];
  return aliases.every(([key, expected]) => {
    if (!own(row, key)) return true;
    const actual = row[key];
    return typeof actual === "string" && actual === expected;
  });
}

/** Small JSON reader for one already byte-bounded record; preserves numeric lexemes and rejects duplicate keys. */
function parseBoundedJournalJson(source: string): unknown {
  let at = 0;
  let nodes = 0;
  const fail = (): never => {
    throw new Error("invalid journal JSON");
  };
  const space = () => {
    while (/[\t\r\n ]/.test(source[at] ?? "!")) at += 1;
  };
  const string = (): string => {
    const start = at;
    at += 1;
    while (at < source.length) {
      const character = source[at++];
      if (character === "\\") {
        if (at >= source.length) fail();
        at += 1;
      } else if (character === '"') {
        try {
          return JSON.parse(source.slice(start, at)) as string;
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (++nodes > 8192 || depth > 24) fail();
    space();
    const character = source[at];
    if (character === '"') return string();
    if (character === "{") {
      at += 1;
      space();
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (source[at] === "}") {
        at += 1;
        return result;
      }
      while (at < source.length) {
        space();
        if (source[at] !== '"') fail();
        const key = string();
        if (Object.hasOwn(result, key) || ["__proto__", "constructor", "prototype"].includes(key)) {
          fail();
        }
        space();
        if (source[at++] !== ":") fail();
        result[key] = value(depth + 1);
        space();
        const delimiter = source[at++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") fail();
      }
      return fail();
    }
    if (character === "[") {
      at += 1;
      space();
      const result: unknown[] = [];
      if (source[at] === "]") {
        at += 1;
        return result;
      }
      while (at < source.length) {
        result.push(value(depth + 1));
        space();
        const delimiter = source[at++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") fail();
      }
      return fail();
    }
    for (const [word, primitive] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(word, at)) {
        at += word.length;
        return primitive;
      }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at));
    if (!match || match[0].length > 128) return fail();
    at += match[0].length;
    return Object.freeze({ [numericToken]: true as const, text: match[0] });
  };

  const parsed = value(0);
  space();
  if (at !== source.length) fail();
  return parsed;
}

function normalizeEventKind(value: unknown): ExternalJournalEventKind {
  if (typeof value !== "string" || value.length > 64) return "unknown";
  switch (value) {
    case "entry_placed":
    case "entry_filled":
    case "close_sent":
    case "position_closed":
    case "protection_restored":
    case "filled":
    case "closed":
    case "day_result":
    case "daily_stop":
    case "day_start":
    case "entry_cancelled":
    case "leverage_set":
    case "skipped":
      return value;
    default:
      return "unknown";
  }
}

/** Normalize a single decoded JSON value. The trusted source is always supplied separately. */
function normalizeExternalJournalEvent(
  value: unknown,
  source: TrustedExternalJournalSource,
  provenance: ExternalJournalProvenance,
): { observation?: ExternalJournalObservation; diagnostic?: ExternalJournalQuarantine["code"] } {
  if (!isSafeRecord(value)) return { diagnostic: "invalid_event_shape" };
  const row = value;
  if (own(row, "__proto__") || own(row, "constructor") || own(row, "prototype")) {
    return { diagnostic: "invalid_event_shape" };
  }
  if (!identityClaimMatches(row, source)) return { diagnostic: "source_identity_mismatch" };

  const hasKind = own(row, "kind");
  const hasEvent = own(row, "event");
  const hasType = own(row, "type");
  const canonicalKind = hasKind ? row.kind : hasEvent ? row.event : undefined;
  if (
    (hasKind && typeof row.kind !== "string") ||
    (hasEvent && typeof row.event !== "string") ||
    (hasKind && hasEvent && row.kind !== row.event)
  ) {
    return { diagnostic: "conflicting_event_fields" };
  }
  // `type` is a legacy event alias only when canonical event keys are absent. With `kind` or
  // `event` present it is an order detail (for example `limit`) and is intentionally ignored.
  const kind = normalizeEventKind(canonicalKind ?? (hasType ? row.type : undefined));

  const hasContract = own(row, "contract");
  const hasSymbol = own(row, "symbol");
  const hasCoin = own(row, "coin");
  const hasContractField = hasContract || hasSymbol;
  if (
    (hasContract && typeof row.contract !== "string") ||
    (hasSymbol && typeof row.symbol !== "string") ||
    (hasContract && hasSymbol && row.contract !== row.symbol) ||
    (hasContractField && hasCoin) ||
    (source.market === "spot" && hasContractField) ||
    (source.market === "futures" && hasCoin)
  ) {
    return { diagnostic: "conflicting_instrument_fields" };
  }
  const contract = row.contract ?? row.symbol;
  const asset = row.coin;
  if (
    (contract !== undefined && !safeString(contract, 64)) ||
    (asset !== undefined && !safeString(asset, 64))
  ) {
    return { diagnostic: "invalid_event_shape" };
  }
  const sourceEventTime = safeString(row.ts ?? row.timestamp, 64);
  const normalizedContract = safeString(contract, 64);
  const normalizedAsset = safeString(asset, 64);
  const side = safeString(row.side ?? row.direction, 32);
  const orderId = safeScalarId(row.order_id ?? row.orderId);
  const tradeId = safeScalarId(row.trade_id ?? row.tradeId);
  const estimatedPnl = normalizePnl(row.pnl_est_usdt ?? row.pnl_usdt);

  if (
    !isSafeRecord(provenance) ||
    provenance.normalizerVersion !== EXTERNAL_JOURNAL_NORMALIZER_VERSION ||
    provenance.sourceId !== source.sourceId ||
    !isSafeToken(provenance.generationId) ||
    !Number.isSafeInteger(provenance.byteOffset) ||
    provenance.byteOffset < 0 ||
    !Number.isSafeInteger(provenance.byteLength) ||
    provenance.byteLength < 0 ||
    typeof provenance.rawSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(provenance.rawSha256)
  ) {
    return { diagnostic: "invalid_event_shape" };
  }
  const observation: ExternalJournalObservation = Object.freeze({
    kind,
    authority: "external_executor_observation",
    canonicalFill: false,
    source: snapshotSource(source),
    provenance: Object.freeze({
      normalizerVersion: provenance.normalizerVersion,
      sourceId: provenance.sourceId,
      generationId: provenance.generationId,
      byteOffset: provenance.byteOffset,
      byteLength: provenance.byteLength,
      rawSha256: provenance.rawSha256,
    }),
    ...(normalizedContract
      ? { instrumentKind: "contract" as const }
      : normalizedAsset
        ? { instrumentKind: "asset" as const }
        : {}),
    ...(sourceEventTime ? { sourceEventTime } : {}),
    ...(normalizedContract ? { contract: normalizedContract } : {}),
    ...(normalizedAsset ? { asset: normalizedAsset } : {}),
    ...(side ? { side } : {}),
    ...(orderId ? { orderId } : {}),
    ...(tradeId ? { tradeId } : {}),
    ...(estimatedPnl ? { externalEstimatedPnlUsdt: estimatedPnl } : {}),
  });
  return { observation };
}

export function createExternalJournalCursor(startOffset = 0): ExternalJournalCursor {
  if (!Number.isSafeInteger(startOffset) || startOffset < 0)
    throw new RangeError("Invalid start offset");
  return Object.freeze({
    nextOffset: startOffset,
    pendingBytes: Object.freeze([]),
    pendingOffset: startOffset,
  });
}

function validCursor(cursor: unknown): cursor is ExternalJournalCursor {
  if (!isSafeRecord(cursor)) return false;
  const state = cursor as unknown as ExternalJournalCursor;
  const allowedKeys = new Set([
    "nextOffset",
    "pendingBytes",
    "pendingOffset",
    "boundSource",
    "generationId",
    "discardUntilLf",
  ]);
  if (
    Object.keys(state).some((key) => !allowedKeys.has(key)) ||
    Reflect.ownKeys(state).length !== Object.keys(state).length
  )
    return false;
  if (
    !Number.isSafeInteger(state.nextOffset) ||
    state.nextOffset < 0 ||
    !Number.isSafeInteger(state.pendingOffset) ||
    state.pendingOffset < 0 ||
    !Array.isArray(state.pendingBytes) ||
    types.isProxy(state.pendingBytes) ||
    Object.getPrototypeOf(state.pendingBytes) !== Array.prototype ||
    Object.values(Object.getOwnPropertyDescriptors(state.pendingBytes)).some(
      (descriptor) => !("value" in descriptor),
    ) ||
    state.pendingBytes.length > EXTERNAL_JOURNAL_MAX_LINE_BYTES
  )
    return false;
  for (let index = 0; index < state.pendingBytes.length; index += 1) {
    const byte = state.pendingBytes[index];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return false;
  }
  const pendingEnd = state.pendingOffset + state.pendingBytes.length;
  if (!Number.isSafeInteger(pendingEnd) || pendingEnd !== state.nextOffset) return false;

  const bound = state.boundSource !== undefined || state.generationId !== undefined;
  if (state.pendingBytes.length > 0 && !bound) return false;
  if (
    bound &&
    (!state.boundSource || !validSource(state.boundSource) || !isSafeToken(state.generationId))
  ) {
    return false;
  }
  if (state.discardUntilLf !== undefined) {
    const discard = state.discardUntilLf;
    if (
      !isSafeRecord(discard) ||
      Reflect.ownKeys(discard).some((key) => key !== "lineOffset" && key !== "bytesSeen") ||
      !bound ||
      state.pendingBytes.length !== 0 ||
      !Number.isSafeInteger(discard.lineOffset) ||
      discard.lineOffset < 0 ||
      !Number.isSafeInteger(discard.bytesSeen) ||
      discard.bytesSeen < 1 ||
      !Number.isSafeInteger(discard.lineOffset + discard.bytesSeen) ||
      discard.lineOffset + discard.bytesSeen !== state.nextOffset
    )
      return false;
  }
  return true;
}

function cursorResult(
  cursor: ExternalJournalCursor,
  diagnostics: readonly ExternalJournalDiagnostic[],
  withheldTailBytes = cursor.pendingBytes.length,
): ExternalJournalChunkResult {
  return Object.freeze({
    cursor,
    observations: Object.freeze([]),
    quarantines: Object.freeze([]),
    diagnostics: Object.freeze(diagnostics.slice()),
    withheldTailBytes,
  });
}

/**
 * Frame LF-delimited JSON bytes incrementally. `generationId` is a caller-owned stable file/stream
 * identity; it must remain constant across append reads and change when the source is rotated.
 */
export function parseExternalJournalChunk(input: {
  readonly source: TrustedExternalJournalSource;
  readonly generationId: string;
  readonly cursor: ExternalJournalCursor;
  readonly chunk: Uint8Array;
  readonly chunkStartOffset: number;
  /** Set only when the source is known to be complete. An incomplete final line stays withheld. */
  readonly endOfSource?: boolean;
  readonly maxChunkBytes?: number;
  readonly maxLineBytes?: number;
  readonly maxEvents?: number;
}): ExternalJournalChunkResult {
  if (types.isProxy(input) || !isSafeRecord(input)) {
    return cursorResult(
      createExternalJournalCursor(),
      [diagnostic("invalid_parser_input", 0, 0)],
      0,
    );
  }
  const source = input.source as TrustedExternalJournalSource;
  const generationId = input.generationId as string;
  const cursor = input.cursor as ExternalJournalCursor;
  const chunk = input.chunk as Uint8Array;
  const chunkStartOffset = input.chunkStartOffset as number;
  if (!validCursor(cursor)) {
    return cursorResult(createExternalJournalCursor(), [diagnostic("invalid_cursor", 0, 0)], 0);
  }
  if (types.isProxy(chunk) || !types.isUint8Array(chunk)) {
    return cursorResult(cursor, [diagnostic("invalid_parser_input", cursor.nextOffset, 0)]);
  }
  if (input.endOfSource !== undefined && typeof input.endOfSource !== "boolean") {
    return cursorResult(cursor, [diagnostic("invalid_parser_input", cursor.nextOffset, 0)]);
  }
  const maxChunkBytes = input.maxChunkBytes ?? EXTERNAL_JOURNAL_MAX_CHUNK_BYTES;
  const maxLineBytes = input.maxLineBytes ?? EXTERNAL_JOURNAL_MAX_LINE_BYTES;
  const maxEvents = input.maxEvents ?? EXTERNAL_JOURNAL_MAX_EVENTS_PER_CHUNK;
  const diagnostics: ExternalJournalDiagnostic[] = [];
  const observations: ExternalJournalObservation[] = [];
  const quarantines: ExternalJournalQuarantine[] = [];
  const quarantine = (
    code: ExternalJournalQuarantine["code"],
    byteOffset: number,
    byteLength: number,
    rawBytes?: Uint8Array,
  ): ExternalJournalQuarantine =>
    Object.freeze({
      code,
      source: snapshotSource(source),
      provenance: Object.freeze({
        normalizerVersion: EXTERNAL_JOURNAL_NORMALIZER_VERSION,
        sourceId: source.sourceId,
        generationId,
        byteOffset,
        byteLength,
        rawSha256: rawBytes ? createHash("sha256").update(rawBytes).digest("hex") : null,
      }),
    });

  if (
    !Number.isSafeInteger(chunkStartOffset) ||
    chunkStartOffset < 0 ||
    !Number.isSafeInteger(chunkStartOffset + chunk.byteLength)
  ) {
    diagnostics.push(diagnostic("invalid_parser_input", 0, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }

  if (!validSource(source)) {
    diagnostics.push(diagnostic("invalid_source_scope", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (!isSafeToken(generationId)) {
    diagnostics.push(diagnostic("invalid_generation_id", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (
    !Number.isSafeInteger(maxChunkBytes) ||
    maxChunkBytes < 1 ||
    maxChunkBytes > EXTERNAL_JOURNAL_MAX_CHUNK_BYTES ||
    !Number.isSafeInteger(maxLineBytes) ||
    maxLineBytes < 1 ||
    maxLineBytes > EXTERNAL_JOURNAL_MAX_LINE_BYTES ||
    !Number.isSafeInteger(maxEvents) ||
    maxEvents < 1 ||
    maxEvents > EXTERNAL_JOURNAL_MAX_EVENTS_PER_CHUNK
  ) {
    diagnostics.push(diagnostic("invalid_parser_limits", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (chunk.byteLength > maxChunkBytes) {
    diagnostics.push(diagnostic("chunk_too_large", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (chunkStartOffset !== cursor.nextOffset) {
    diagnostics.push(diagnostic("offset_discontinuity", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (
    cursor.generationId !== undefined &&
    (cursor.generationId !== generationId ||
      !cursor.boundSource ||
      cursor.boundSource.sourceId !== source.sourceId ||
      cursor.boundSource.organizationId !== source.organizationId ||
      cursor.boundSource.accountId !== source.accountId ||
      cursor.boundSource.externalUid !== source.externalUid ||
      cursor.boundSource.market !== source.market)
  ) {
    diagnostics.push(diagnostic("source_identity_mismatch", chunkStartOffset, chunk.byteLength));
    return cursorResult(cursor, diagnostics);
  }
  if (cursor.pendingBytes.length > maxLineBytes) {
    const overflowDiagnostic = diagnostic(
      "line_too_large",
      cursor.pendingOffset,
      cursor.pendingBytes.length,
    );
    const discardCursor: ExternalJournalCursor = Object.freeze({
      nextOffset: cursor.nextOffset,
      pendingBytes: Object.freeze([]),
      pendingOffset: cursor.nextOffset,
      boundSource: snapshotSource(cursor.boundSource!),
      generationId: cursor.generationId,
      discardUntilLf: Object.freeze({
        lineOffset: cursor.pendingOffset,
        bytesSeen: cursor.pendingBytes.length,
      }),
    });
    const discarded = parseExternalJournalChunk({ ...input, cursor: discardCursor });
    // A record-budget rejection must roll back the original persisted pending bytes too.
    if (discarded.cursor === discardCursor)
      return cursorResult(cursor, [overflowDiagnostic, ...discarded.diagnostics]);
    return Object.freeze({
      ...discarded,
      diagnostics: Object.freeze([overflowDiagnostic, ...discarded.diagnostics]),
    });
  }

  if (cursor.discardUntilLf) {
    const delimiterIndex = chunk.indexOf(0x0a);
    if (delimiterIndex < 0) {
      const bytesSeen = cursor.discardUntilLf.bytesSeen + chunk.byteLength;
      const nextOffset = chunkStartOffset + chunk.byteLength;
      if (!Number.isSafeInteger(bytesSeen) || !Number.isSafeInteger(nextOffset)) {
        return cursorResult(cursor, [
          diagnostic("invalid_cursor", chunkStartOffset, chunk.byteLength),
        ]);
      }
      const discardUntilLf = input.endOfSource
        ? undefined
        : Object.freeze({ lineOffset: cursor.discardUntilLf.lineOffset, bytesSeen });
      const nextCursor: ExternalJournalCursor = Object.freeze({
        nextOffset,
        pendingBytes: Object.freeze([]),
        pendingOffset: nextOffset,
        boundSource: snapshotSource(cursor.boundSource!),
        generationId: cursor.generationId,
        discardUntilLf,
      });
      const result = cursorResult(nextCursor, diagnostics, 0);
      return input.endOfSource
        ? Object.freeze({
            ...result,
            quarantines: Object.freeze([
              quarantine("line_too_large", cursor.discardUntilLf.lineOffset, bytesSeen),
            ]),
          })
        : result;
    }
    const consumed = delimiterIndex + 1;
    const remainderOffset = chunkStartOffset + consumed;
    const recoveredCursor: ExternalJournalCursor = Object.freeze({
      nextOffset: remainderOffset,
      pendingBytes: Object.freeze([]),
      pendingOffset: remainderOffset,
      boundSource: snapshotSource(cursor.boundSource!),
      generationId: cursor.generationId,
    });
    const recovered = parseExternalJournalChunk({
      ...input,
      cursor: recoveredCursor,
      chunk: chunk.subarray(consumed),
      chunkStartOffset: remainderOffset,
    });
    if (
      recovered.diagnostics.some((item) => item.code === "event_limit_reached") ||
      recovered.observations.length + recovered.quarantines.length >= maxEvents
    ) {
      return cursorResult(cursor, [
        diagnostic(
          "event_limit_reached",
          cursor.discardUntilLf.lineOffset,
          cursor.discardUntilLf.bytesSeen + delimiterIndex,
        ),
      ]);
    }
    return Object.freeze({
      ...recovered,
      quarantines: Object.freeze([
        quarantine(
          "line_too_large",
          cursor.discardUntilLf.lineOffset,
          cursor.discardUntilLf.bytesSeen + delimiterIndex,
        ),
        ...recovered.quarantines,
      ]),
    });
  }

  const combined = new Uint8Array(cursor.pendingBytes.length + chunk.byteLength);
  combined.set(cursor.pendingBytes, 0);
  combined.set(chunk, cursor.pendingBytes.length);
  const combinedOffset = cursor.pendingBytes.length > 0 ? cursor.pendingOffset : cursor.nextOffset;
  let lineStart = 0;
  let processedEvents = 0;
  let withheldTailBytes = 0;
  let stopAt = combined.byteLength;
  let discardUntilLf: ExternalJournalCursor["discardUntilLf"];

  for (let i = 0; i <= combined.byteLength; i += 1) {
    const isNewline = i < combined.byteLength && combined[i] === 0x0a;
    if (!isNewline && i !== combined.byteLength) continue;
    const lineLength = i - lineStart;
    const absoluteOffset = combinedOffset + lineStart;
    const hasDelimiter = isNewline;
    const isFinalTail = !hasDelimiter;

    if (isFinalTail && !input.endOfSource) {
      if (lineLength > maxLineBytes) {
        diagnostics.push(diagnostic("line_too_large", absoluteOffset, lineLength));
        withheldTailBytes = 0;
        discardUntilLf = Object.freeze({ lineOffset: absoluteOffset, bytesSeen: lineLength });
      } else {
        withheldTailBytes = lineLength;
      }
      stopAt = lineStart;
      break;
    }

    if (lineLength > 0 && processedEvents >= maxEvents) {
      diagnostics.push(diagnostic("event_limit_reached", absoluteOffset, lineLength));
      return cursorResult(cursor, diagnostics);
    }
    if (lineLength > 0) processedEvents += 1;
    if (lineLength > maxLineBytes) {
      diagnostics.push(diagnostic("line_too_large", absoluteOffset, lineLength));
      quarantines.push(quarantine("line_too_large", absoluteOffset, lineLength));
    } else if (lineLength > 0) {
      const rawBytes = combined.slice(lineStart, i);
      let text: string;
      try {
        text = utf8Decoder.decode(rawBytes);
      } catch {
        diagnostics.push(diagnostic("invalid_utf8", absoluteOffset, lineLength));
        quarantines.push(quarantine("invalid_utf8", absoluteOffset, lineLength, rawBytes));
        lineStart = i + 1;
        continue;
      }
      try {
        const value: unknown = parseBoundedJournalJson(text);
        const provenance: ExternalJournalProvenance = Object.freeze({
          normalizerVersion: EXTERNAL_JOURNAL_NORMALIZER_VERSION,
          sourceId: source.sourceId,
          generationId,
          byteOffset: absoluteOffset,
          byteLength: lineLength,
          rawSha256: createHash("sha256").update(rawBytes).digest("hex"),
        });
        const normalized = normalizeExternalJournalEvent(value, source, provenance);
        if (normalized.observation) observations.push(normalized.observation);
        else {
          const code = normalized.diagnostic ?? "invalid_event_shape";
          diagnostics.push(diagnostic(code, absoluteOffset, lineLength));
          quarantines.push(quarantine(code, absoluteOffset, lineLength, rawBytes));
        }
      } catch {
        diagnostics.push(diagnostic("invalid_json", absoluteOffset, lineLength));
        quarantines.push(quarantine("invalid_json", absoluteOffset, lineLength, rawBytes));
      }
    }
    lineStart = i + 1;
  }

  const pendingBytes = withheldTailBytes > 0 ? combined.slice(stopAt) : new Uint8Array();
  const nextCursor: ExternalJournalCursor = Object.freeze({
    nextOffset: chunkStartOffset + chunk.byteLength,
    pendingBytes: Object.freeze(Array.from(pendingBytes)),
    pendingOffset:
      pendingBytes.length > 0 ? combinedOffset + stopAt : chunkStartOffset + chunk.byteLength,
    boundSource: snapshotSource(cursor.boundSource ?? source),
    generationId: cursor.generationId ?? generationId,
    ...(discardUntilLf ? { discardUntilLf } : {}),
  });
  return Object.freeze({
    cursor: nextCursor,
    observations: Object.freeze(observations.slice()),
    quarantines: Object.freeze(quarantines.slice()),
    diagnostics: Object.freeze(diagnostics.slice()),
    withheldTailBytes,
  });
}
