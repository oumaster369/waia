import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { decodeHtxReferenceJsonV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { observationBindingSchema } from "@/lib/trader/account-observation/validation";
import type { HtxAccountAcquisitionGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import { defineRawCapturePolicyV1, isRawCaptureReceiptV1, isRawStorageBindingV1, isRawValidationReceiptV1,
  type RawCaptureReceiptV1, type RawStorageBindingV1, type RawValidationReceiptV1 } from "@/lib/trader/mi/raw-capture-v1";

export const HTX_ACCOUNT_ACQUISITION_SCHEMA_V1 = "htx-account-acquisition/v1" as const;
const digest = z.string().regex(/^[0-9a-f]{64}$/), id = z.string().regex(/^[1-9]\d{0,39}$/);
const iso = z.string().datetime({ offset: false }).refine(value => new Date(value).toISOString() === value);
const asset = z.string().regex(/^[A-Z0-9]{1,32}$/);
export class HtxAccountAcquisitionRefusedV1 extends Error {
  constructor(readonly reason: string) { super(`HTX_ACCOUNT_ACQUISITION_REFUSED:${reason}`); }
}
function fail(reason: string): never { throw new HtxAccountAcquisitionRefusedV1(reason); }
export const htxAccountAcquisitionSpecSchemaV1 = z.object({
  acquisitionId: z.string().uuid(), accountId: z.string().min(1).max(256),
  binding: observationBindingSchema, sourceId: z.string().uuid(), profileDigest: digest, referenceDigest: digest,
  assets: z.array(asset).min(2).max(64), symbols: z.array(z.string().regex(/^[A-Z0-9]+\/USDT$/)).min(1).max(32),
  knownOrders: z.array(z.object({ orderId: id, symbol: z.string().regex(/^[A-Z0-9]+\/USDT$/) }).strict()).max(8192),
  historyStartUtc: iso, historyEndUtc: iso,
  pageSize: z.number().int().min(1).max(500), maxPages: z.number().int().min(1).max(512),
  maxMembers: z.number().int().min(1).max(8192), maxRawBytes: z.number().int().min(1).max(1048576),
  requestTimeoutMs: z.number().int().min(100).max(120000), retentionSeconds: z.number().int().min(1).max(315360000),
}).strict();
export type HtxAccountAcquisitionSpecV1 = z.infer<typeof htxAccountAcquisitionSpecSchemaV1>;
export type HtxAccountAcquisitionFamilyV1 = "BALANCE" | "ORDINARY_OPEN" | "CONDITIONAL_OPEN" |
  "CONDITIONAL_HISTORY" | "ACCOUNT_HISTORY" | "KNOWN_ORDER_FILLS";
export type HtxAccountAcquisitionLaneV1 = Readonly<{ family: HtxAccountAcquisitionFamilyV1;
  laneId: string; symbol: string | null; orderId: string | null; orderStatus: "canceled" | "rejected" | "triggered" | null }>;
export type HtxAccountAcquisitionMemberV1 = Readonly<{
  identity: string; family: HtxAccountAcquisitionFamilyV1; rawMemberPath: string;
  stateValidTime: "UNKNOWN"; sourceEventTimeUtc: string | null;
  fields: Readonly<Record<string, string>>;
}>;
export type HtxAccountAcquisitionPageV1 = Readonly<{
  lane: HtxAccountAcquisitionLaneV1; requestCursor: string | null; nextCursor: string | null;
  responseReportedEnd: boolean; acquiredAtUtc: string; rawBytesDigest: string;
  members: readonly HtxAccountAcquisitionMemberV1[]; coverage: "PARTIAL";
}>;

// Infrastructure ceilings only: none supplies account freshness, coverage or a financial bound.
export const HTX_ACQUISITION_JOURNAL_ENTRY_BYTES_V1 = 1048576;
export const HTX_ACQUISITION_JOURNAL_BYTES_V1 = 8388608;
export const HTX_ACQUISITION_DB_READ_BYTES_V1 = 67108864;
const familySchema = z.enum(["BALANCE", "ORDINARY_OPEN", "CONDITIONAL_OPEN", "CONDITIONAL_HISTORY", "ACCOUNT_HISTORY", "KNOWN_ORDER_FILLS"]);
const laneSchema = z.object({ family: familySchema, laneId: z.string().min(1).max(256),
  symbol: z.string().max(64).nullable(), orderId: id.nullable(), orderStatus: z.enum(["canceled", "rejected", "triggered"]).nullable() }).strict();
const pageSchema = z.object({ lane: laneSchema, requestCursor: id.nullable(), nextCursor: id.nullable(),
  responseReportedEnd: z.boolean(), acquiredAtUtc: iso, rawBytesDigest: digest,
  members: z.array(z.object({ identity: z.string().min(1).max(256), family: familySchema,
    rawMemberPath: z.string().regex(/^data(?:\.list)?\[\d+\]$/), stateValidTime: z.literal("UNKNOWN"),
    sourceEventTimeUtc: iso.nullable(), fields: z.record(z.string().min(1).max(256)) }).strict()).max(8192),
  coverage: z.literal("PARTIAL") }).strict();
const journalBaseSchema = z.object({ schemaVersion: z.literal(HTX_ACCOUNT_ACQUISITION_SCHEMA_V1),
  organizationId: z.string().uuid(), accountId: z.string().min(1).max(256), acquisitionId: z.string().uuid(), jobDigest: digest,
  sequence: z.number().int().min(0).max(1025), previousDigest: digest.nullable(),
  replayKey: z.string().min(1).max(512), recordedAtUtc: iso }).strict();
const terminalPayloadSchema = z.object({ recordingStatus: z.enum(["RECORDED", "PARTIAL"]),
  reason: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).nullable(), pages: z.number().int().min(0).max(512),
  members: z.number().int().min(0).max(8192), coverage: z.literal("PARTIAL"), stateValidTime: z.literal("UNKNOWN"),
  declaredLaneIds: z.array(z.string().min(1).max(256)).max(8292) }).strict();
export const htxAccountAcquisitionJournalEntrySchemaV1 = z.discriminatedUnion("kind", [
  journalBaseSchema.extend({ kind: z.literal("START"), payload: z.object({ attemptId: z.string().uuid() }).strict() }),
  journalBaseSchema.extend({ kind: z.literal("PREPARED"), payload: z.object({ lane: laneSchema, cursor: id.nullable(),
    path: z.string().min(1).max(512), query: z.record(z.string().max(256)), requestStartedAtUtc: iso, acquiredAtUtc: iso,
    rawBytesDigest: digest, payloadBytes: z.number().int().min(1).max(1048576), policyDigest: digest }).strict() }),
  journalBaseSchema.extend({ kind: z.literal("PAGE"), payload: z.object({ page: pageSchema,
    binding: z.custom<RawStorageBindingV1>(isRawStorageBindingV1),
    capture: z.custom<RawCaptureReceiptV1>(isRawCaptureReceiptV1),
    validation: z.custom<RawValidationReceiptV1>(isRawValidationReceiptV1), requestStartedAtUtc: iso }).strict() }),
  journalBaseSchema.extend({ kind: z.literal("TERMINAL"), payload: terminalPayloadSchema }),
]);
export type HtxAccountAcquisitionJournalBodyV1 = z.infer<typeof htxAccountAcquisitionJournalEntrySchemaV1>;

/** Validate an immutable observational prefix, not its authority to publish account state.
 * Raw bytes must still be read and decoded by the future publisher; receipt integrity alone is not market truth.
 */
export function validateHtxAccountAcquisitionJournalV1(spec: HtxAccountAcquisitionSpecV1,
  entries: readonly HtxAccountAcquisitionJournalBodyV1[]) {
  spec = parseHtxAccountAcquisitionSpecV1(spec);
  const lanes = htxAccountAcquisitionLanesV1(spec), policy = defineRawCapturePolicyV1({
    maxPayloadBytes: spec.maxRawBytes, retentionSeconds: spec.retentionSeconds });
  if (entries.length > spec.maxPages * 2 + 2) fail("JOURNAL_BOUND");
  let pending: Extract<HtxAccountAcquisitionJournalBodyV1, { kind: "PREPARED" }> | null = null;
  let laneIndex = 0, cursor: string | null = null, pages = 0, members = 0, closed = false;
  const seen = new Set<string>(), cursorKeys = new Set<string>();
  for (const [index, value] of entries.entries()) {
    const entry = htxAccountAcquisitionJournalEntrySchemaV1.parse(value);
    if (closed || entry.sequence !== index || entry.organizationId !== spec.binding.organizationId ||
        entry.accountId !== spec.accountId || entry.acquisitionId !== spec.acquisitionId ||
        index > 0 && entry.recordedAtUtc < entries[index - 1]!.recordedAtUtc) fail("JOURNAL_TRANSITION");
    if (entry.kind === "START") {
      if (index !== 0 || entry.replayKey !== "START") fail("JOURNAL_START");
    } else if (index === 0) fail("JOURNAL_START");
    else if (entry.kind === "PREPARED") {
      const lane = lanes[laneIndex], payload = entry.payload;
      if (!lane || pending || pages >= spec.maxPages || canonicalJsonString(payload.lane) !== canonicalJsonString(lane) ||
          payload.cursor !== cursor || payload.requestStartedAtUtc > payload.acquiredAtUtc ||
          payload.requestStartedAtUtc < entries[0]!.recordedAtUtc || payload.acquiredAtUtc > entry.recordedAtUtc ||
          payload.payloadBytes > spec.maxRawBytes || payload.policyDigest !== policy.policyDigest) fail("JOURNAL_PREPARED");
      const key = `${lane.laneId}:${cursor ?? "FIRST"}`;
      if (entry.replayKey !== `PREPARED:${key}` || cursorKeys.has(key)) fail("JOURNAL_CURSOR");
      cursorKeys.add(key);
      const request = htxAccountAcquisitionRequestV1(spec, lane, cursor, new AbortController().signal);
      if (request.path !== payload.path || canonicalJsonString(request.query) !== canonicalJsonString(payload.query)) fail("JOURNAL_REQUEST");
      pending = entry;
    } else if (entry.kind === "PAGE") {
      if (!pending) fail("JOURNAL_PAGE_WITHOUT_PREPARED");
      const { page, binding, capture, validation } = entry.payload, prepared = pending.payload;
      if (entry.replayKey !== `PAGE:${prepared.lane.laneId}:${prepared.cursor ?? "FIRST"}` ||
          canonicalJsonString(page.lane) !== canonicalJsonString(prepared.lane) || page.requestCursor !== prepared.cursor ||
          page.rawBytesDigest !== prepared.rawBytesDigest || page.acquiredAtUtc !== prepared.acquiredAtUtc ||
          entry.payload.requestStartedAtUtc !== prepared.requestStartedAtUtc ||
          page.responseReportedEnd !== (page.nextCursor === null) || page.nextCursor !== null &&
            (page.nextCursor === page.requestCursor || page.members.length === 0) ||
          binding.organizationId !== entry.organizationId || binding.sourceId !== spec.sourceId ||
          binding.rawBytesDigest !== page.rawBytesDigest || binding.storedAtUtc < page.acquiredAtUtc ||
          capture.organizationId !== entry.organizationId || capture.sourceId !== spec.sourceId ||
          capture.rawBytesDigest !== page.rawBytesDigest || capture.storageBindingDigest !== binding.contentDigest ||
          capture.payloadBytes !== prepared.payloadBytes || capture.policyDigest !== policy.policyDigest ||
          capture.capturedAtUtc < binding.storedAtUtc || validation.organizationId !== entry.organizationId ||
          validation.sourceId !== spec.sourceId || validation.captureReceiptDigest !== capture.contentDigest ||
          validation.validatorId !== "htx-account-acquisition" || validation.validatorVersion !== "v1" ||
          validation.status !== "VALID" || validation.knownAtUtc < capture.capturedAtUtc ||
          validation.knownAtUtc > entry.recordedAtUtc) fail("JOURNAL_PAGE_LINEAGE");
      pages++; members += page.members.length;
      if (members > spec.maxMembers) fail("MEMBER_BUDGET");
      for (const member of page.members) {
        if (member.family !== page.lane.family || seen.has(member.identity) ||
            member.sourceEventTimeUtc !== null && member.sourceEventTimeUtc > page.acquiredAtUtc)
          fail("DUPLICATE_OR_MOVING_MEMBER");
        seen.add(member.identity);
      }
      cursor = page.nextCursor; if (cursor === null) laneIndex++;
      pending = null;
    } else if (entry.kind === "TERMINAL") {
      const payload = entry.payload;
      if (entry.replayKey !== "TERMINAL" || payload.pages !== pages || payload.members !== members ||
          canonicalJsonString(payload.declaredLaneIds) !== canonicalJsonString(lanes.map(lane => lane.laneId)) ||
          (payload.recordingStatus === "RECORDED" ? payload.reason !== null || pending !== null || laneIndex !== lanes.length : payload.reason === null))
        fail("JOURNAL_TERMINAL");
      closed = true;
    }
  }
  return { pages, members, closed };
}

/** Value validation only: a profile/ledger owner must establish the provenance of this selection. */
export function parseHtxAccountAcquisitionSpecV1(value: unknown): HtxAccountAcquisitionSpecV1 {
  const result = htxAccountAcquisitionSpecSchemaV1.parse(value);
  const start = Date.parse(result.historyStartUtc), end = Date.parse(result.historyEndUtc);
  if (end <= start || end - start > 3600000 || new Set(result.assets).size !== result.assets.length ||
      new Set(result.symbols).size !== result.symbols.length ||
      new Set(result.knownOrders.map(row => row.orderId)).size !== result.knownOrders.length ||
      result.knownOrders.some(row => !result.symbols.includes(row.symbol)) || !result.assets.includes("USDT") ||
      4 + result.symbols.length * 3 + result.knownOrders.length > result.maxPages ||
      result.symbols.some(symbol => !result.assets.includes(symbol.split("/")[0]!))) fail("SPEC_SCOPE_OR_BOUND");
  id.parse(result.binding.exchangeAccountId);
  return result;
}
export function htxAccountAcquisitionLanesV1(spec: HtxAccountAcquisitionSpecV1): readonly HtxAccountAcquisitionLaneV1[] {
  spec = parseHtxAccountAcquisitionSpecV1(spec);
  const rows: HtxAccountAcquisitionLaneV1[] = ["BALANCE", "ORDINARY_OPEN", "CONDITIONAL_OPEN", "ACCOUNT_HISTORY"]
    .map(family => ({ family: family as HtxAccountAcquisitionFamilyV1, laneId: family,
      symbol: null, orderId: null, orderStatus: null }));
  for (const symbol of spec.symbols) for (const orderStatus of ["canceled", "rejected", "triggered"] as const)
    rows.push({ family: "CONDITIONAL_HISTORY", laneId: `CONDITIONAL_HISTORY:${symbol}:${orderStatus}`,
      symbol, orderStatus, orderId: null });
  for (const order of spec.knownOrders) rows.push({ family: "KNOWN_ORDER_FILLS", laneId: `KNOWN_ORDER_FILLS:${order.orderId}`,
    symbol: order.symbol, orderId: order.orderId, orderStatus: null });
  return Object.freeze(rows.map(row => Object.freeze(row)));
}
export function htxAccountAcquisitionRequestV1(spec: HtxAccountAcquisitionSpecV1,
  lane: HtxAccountAcquisitionLaneV1, cursor: string | null, signal: AbortSignal,
): Parameters<HtxAccountAcquisitionGetTransport["signedGet"]>[0] {
  spec = parseHtxAccountAcquisitionSpecV1(spec);
  if (!htxAccountAcquisitionLanesV1(spec).some(actual => canonicalJsonString(actual) === canonicalJsonString(lane)))
    fail("LANE_IDENTITY");
  if (cursor !== null) id.parse(cursor);
  const common = { method: "GET" as const, signal, maxResponseBytes: spec.maxRawBytes };
  const account = spec.binding.exchangeAccountId, size = String(spec.pageSize);
  const start = String(Date.parse(spec.historyStartUtc)), end = String(Date.parse(spec.historyEndUtc));
  switch (lane.family) {
    case "BALANCE":
      if (cursor !== null) fail("CURSOR_UNSUPPORTED");
      return { ...common, path: `/v1/account/accounts/${account}/balance`, query: {} };
    case "ORDINARY_OPEN": return { ...common, path: "/v1/order/openOrders",
      query: { "account-id": account, size, ...(cursor === null ? {} : { from: cursor, direct: "next" }) } };
    case "CONDITIONAL_OPEN": return { ...common, path: "/v2/algo-orders/opening",
      query: { accountId: account, limit: size, sort: "asc", ...(cursor === null ? {} : { fromId: cursor }) } };
    case "CONDITIONAL_HISTORY": return { ...common, path: "/v2/algo-orders/history",
      query: { accountId: account, symbol: lane.symbol!.replace("/", "").toLowerCase(), orderStatus: lane.orderStatus!,
        startTime: start, endTime: end, limit: size, sort: "asc", ...(cursor === null ? {} : { fromId: cursor }) } };
    case "ACCOUNT_HISTORY": return { ...common, path: "/v1/account/history",
      query: { "account-id": account, "start-time": start, "end-time": end, size, sort: "asc",
        ...(cursor === null ? {} : { "from-id": cursor }) } };
    case "KNOWN_ORDER_FILLS":
      if (cursor !== null) fail("CURSOR_UNSUPPORTED");
      return { ...common, path: `/v1/order/orders/${lane.orderId}/matchresults`, query: {} };
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || "numericToken" in value) fail("OBJECT");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) fail("TEXT");
  return value;
}
function numericLexeme(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 1 && "numericToken" in value && typeof value.numericToken === "string")
    return value.numericToken;
  return fail("NUMERIC_TOKEN");
}
function exactId(value: unknown): string { return id.parse(numericLexeme(value)); }
function quantity(value: unknown, signed = false): string {
  const token = numericLexeme(value);
  if (!(signed ? /^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,8})?$/ : /^(?:0|[1-9]\d{0,39})(?:\.\d{1,8})?$/).test(token))
    fail("DECIMAL_DOMAIN");
  return formatDecimal(parseDecimal(token));
}
function eventTime(value: unknown, acquired: number): string {
  const token = numericLexeme(value);
  if (!/^[1-9]\d{0,15}$/.test(token)) fail("EVENT_TIME");
  const number = Number(token);
  if (!Number.isSafeInteger(number) || number > acquired || !Number.isFinite(new Date(number).getTime())) fail("EVENT_TIME");
  return new Date(number).toISOString();
}
function responseSymbol(value: unknown, spec: HtxAccountAcquisitionSpecV1, expected: string | null): string {
  const compact = text(value);
  const match = spec.symbols.find(symbol => symbol.replace("/", "").toLowerCase() === compact);
  if (!match || expected !== null && expected !== match) fail("SYMBOL_SCOPE");
  return match;
}
function rows(value: unknown, cap: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > cap) fail("MEMBER_BOUND");
  return value.map(object);
}

/** Retained observations only. Protocol pagination closure never asserts a dated whole-account cut. */
export function decodeHtxAccountAcquisitionPageV1(input: { spec: HtxAccountAcquisitionSpecV1;
  lane: HtxAccountAcquisitionLaneV1; cursor: string | null; bytes: Uint8Array; acquiredAtUtc: string;
}): HtxAccountAcquisitionPageV1 {
  const spec = parseHtxAccountAcquisitionSpecV1(input.spec), lane = Object.freeze({ ...input.lane });
  htxAccountAcquisitionRequestV1(spec, lane, input.cursor, new AbortController().signal);
  iso.parse(input.acquiredAtUtc); const acquired = Date.parse(input.acquiredAtUtc);
  if (Date.parse(spec.historyEndUtc) > acquired) fail("FUTURE_REQUEST");
  const raw = object(decodeHtxReferenceJsonV1(input.bytes, spec.maxRawBytes));
  const conditional = lane.family === "CONDITIONAL_OPEN" || lane.family === "CONDITIONAL_HISTORY";
  if (conditional ? numericLexeme(raw.code) !== "200" : raw.status !== "ok") fail("RESPONSE_STATUS");
  const members: HtxAccountAcquisitionMemberV1[] = [];
  const exactAccount = (value: unknown) => { if (exactId(value) !== spec.binding.exchangeAccountId) fail("ACCOUNT_SCOPE"); };
  const add = (identity: string, path: string, fields: Record<string, string>, sourceEventTimeUtc: string | null = null) => {
    if (members.some(row => row.identity === identity)) fail("DUPLICATE_MEMBER");
    members.push(Object.freeze({ identity, family: lane.family, rawMemberPath: path, fields: Object.freeze(fields),
      stateValidTime: "UNKNOWN", sourceEventTimeUtc }));
  };
  let nextCursor: string | null = null;
  if (lane.family === "BALANCE") {
    const data = object(raw.data); exactAccount(data.id);
    if (data.type !== "spot" || data.state !== "working") fail("ACCOUNT_CLASS_OR_STATE");
    for (const [index, row] of rows(data.list, spec.maxMembers).entries()) {
      const currency = text(row.currency).toUpperCase(), kind = text(row.type);
      if (!spec.assets.includes(currency) || !["trade", "frozen"].includes(kind)) fail("ASSET_OR_BALANCE_KIND");
      add(`BALANCE:${currency}:${kind}`, `data.list[${index}]`, { asset: currency, kind, quantity: quantity(row.balance) });
    }
    if (members.length !== spec.assets.length * 2) fail("BALANCE_COMPONENT_MISSING");
  } else {
    const values = rows(raw.data, lane.family === "KNOWN_ORDER_FILLS" ? spec.maxMembers : spec.pageSize);
    for (const [index, row] of values.entries()) {
      const path = `data[${index}]`;
      if (lane.family === "ORDINARY_OPEN") {
        exactAccount(row["account-id"]);
        const symbol = responseSymbol(row.symbol, spec, null), type = text(row.type), state = text(row.state);
        if (!/^(buy|sell)-(market|limit|ioc|limit-maker|stop-limit|limit-fok|stop-limit-fok)$/.test(type) ||
            !["created", "submitted", "partial-filled"].includes(state)) fail("ORDER_TYPE_OR_STATE");
        const amount = quantity(row.amount), filled = quantity(row["filled-amount"]);
        // Market BUY's amount is quote currency; it is never relabeled guaranteed base inventory.
        add(`ORDER:${exactId(row.id)}`, path, { orderId: exactId(row.id), symbol, type, state,
          amount, amountUnit: type === "buy-market" ? "QUOTE" : "BASE", filledBaseQuantity: filled,
          price: quantity(row.price) }, eventTime(row["created-at"], acquired));
      } else if (conditional) {
        exactAccount(row.accountId);
        const symbol = responseSymbol(row.symbol, spec, lane.symbol), status = text(row.orderStatus), type = text(row.orderType);
        if (!["buy", "sell"].includes(text(row.orderSide)) || !["market", "limit"].includes(type) ||
            (lane.orderStatus === null ? status !== "created" : status !== lane.orderStatus)) fail("CONDITIONAL_STATE");
        const origin = eventTime(row.orderOrigTime, acquired);
        const activity = eventTime(row.lastActTime, acquired);
        if (activity < origin) fail("CONDITIONAL_CHRONOLOGY");
        if (lane.family === "CONDITIONAL_HISTORY" && (origin < spec.historyStartUtc || origin > spec.historyEndUtc))
          fail("HISTORY_INTERVAL");
        if (status === "triggered" && row.orderId === undefined) fail("TRIGGERED_ORDER_ID");
        const marketBuy = row.orderSide === "buy" && type === "market";
        const amount = quantity(marketBuy ? row.orderValue : row.orderSize);
        const clientOrderId = text(row.clientOrderId);
        add(`CONDITIONAL:${clientOrderId}`, path, { clientOrderId, symbol, status, type, orderOriginTimeUtc: origin,
          side: text(row.orderSide), amount, amountUnit: marketBuy ? "QUOTE" : "BASE",
          price: quantity(row.orderPrice), ...(row.orderId === undefined ? {} : { orderId: exactId(row.orderId) }) },
        activity);
      } else if (lane.family === "ACCOUNT_HISTORY") {
        exactAccount(row["account-id"]);
        const currency = text(row.currency).toUpperCase(); if (!spec.assets.includes(currency)) fail("ASSET_SCOPE");
        const when = eventTime(row["transact-time"], acquired);
        if (when < spec.historyStartUtc || when > spec.historyEndUtc) fail("HISTORY_INTERVAL");
        add(`ACCOUNT_HISTORY:${exactId(row["record-id"])}`, path, { recordId: exactId(row["record-id"]),
          asset: currency, delta: quantity(row["transact-amt"], true), kind: text(row["transact-type"]),
          available: quantity(row["avail-balance"]), total: quantity(row["acct-balance"]) }, when);
      } else if (lane.family === "KNOWN_ORDER_FILLS") {
        if (exactId(row["order-id"]) !== lane.orderId) fail("ORDER_SCOPE");
        const symbol = responseSymbol(row.symbol, spec, lane.symbol), type = text(row.type);
        if (!/^(buy|sell)-/.test(type)) fail("FILL_SIDE");
        const feeAsset = text(row["fee-currency"]).toUpperCase(); if (!spec.assets.includes(feeAsset)) fail("FEE_ASSET");
        // This first domain does not reinterpret HT/point fee deductions as a zero fee.
        if (row["filled-points"] === undefined || quantity(row["filled-points"]) !== "0") fail("FEE_DEDUCTION_UNSUPPORTED");
        if (parseDecimal(quantity(row["filled-amount"])) <= 0n || parseDecimal(quantity(row.price)) <= 0n)
          fail("FILL_NONPOSITIVE");
        add(`FILL:${exactId(row["trade-id"])}`, path, { fillId: exactId(row["trade-id"]),
          orderId: lane.orderId!, symbol, side: type.startsWith("buy-") ? "buy" : "sell",
          quantity: quantity(row["filled-amount"]), price: quantity(row.price),
          feeAmount: quantity(row["filled-fees"]), feeAsset }, eventTime(row["created-at"], acquired));
      }
    }
    if (lane.family === "ORDINARY_OPEN" && values.length === spec.pageSize) nextCursor = exactId(values.at(-1)!.id);
    else if (conditional && raw.nextId !== undefined && raw.nextId !== null) nextCursor = exactId(raw.nextId);
    else if (lane.family === "ACCOUNT_HISTORY" && raw["next-id"] !== undefined && raw["next-id"] !== null)
      nextCursor = exactId(raw["next-id"]);
    if (nextCursor !== null && (values.length === 0 || nextCursor === input.cursor)) fail("CURSOR_PROGRESS");
  }
  return Object.freeze({ lane, requestCursor: input.cursor, nextCursor, responseReportedEnd: nextCursor === null,
    acquiredAtUtc: input.acquiredAtUtc, rawBytesDigest: createHash("sha256").update(input.bytes).digest("hex"),
    members: Object.freeze(members), coverage: "PARTIAL" });
}
