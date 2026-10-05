// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { bindHtxAccountAcquisitionAssignmentV1, createProtectedHtxAccountAcquisitionSessionV1 } from "@/lib/trader/risk/v2/current-account-capital-service-v1";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import { encryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { decodeHtxAccountAcquisitionPageV1, htxAccountAcquisitionLanesV1,
  htxAccountAcquisitionRequestV1, parseHtxAccountAcquisitionSpecV1,
  htxAccountAcquisitionJournalEntrySchemaV1, validateHtxAccountAcquisitionJournalV1,
  type HtxAccountAcquisitionJournalBodyV1, type HtxAccountAcquisitionSpecV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-v1";
import { attestRawSecretScanV1, buildRawCaptureReceiptAtDurableBoundaryV1, buildRawStorageBindingAtDurableBoundaryV1,
  buildRawValidationReceiptAtDurableBoundaryV1, defineRawCapturePolicyV1, digestRawBytesV1,
  prepareRawCaptureV1 } from "@/lib/trader/mi/raw-capture-v1";
import { createHtxAccountAcquisitionGetTransport, createHtxObservationGetTransport,
  type HtxAccountAcquisitionGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import { openHtxAccountAcquisitionTransport } from "@/lib/trader/account-observation/htx-reader-opener";
import type { ObservationClock } from "@/lib/trader/account-observation/types";

const now = Date.parse("2026-09-27T12:00:00.000Z");
const binding = { organizationId: "00000000-0000-4000-8000-000000000135",
  credentialId: "00000000-0000-4000-8000-000000000136", exchangeAccountId: "135",
  credentialRevision: "1", configurationRevision: "synthetic-acquisition-config" };
const spec: HtxAccountAcquisitionSpecV1 = { binding, accountId: "spot-135",
  acquisitionId: "00000000-0000-4000-8000-000000000137", sourceId: binding.organizationId,
  profileDigest: "a".repeat(64), referenceDigest: "b".repeat(64), assets: ["BTC", "USDT"], symbols: ["BTC/USDT"],
  knownOrders: [{ orderId: "999", symbol: "BTC/USDT" }], historyStartUtc: new Date(now - 60000).toISOString(),
  historyEndUtc: new Date(now).toISOString(), pageSize: 2, maxPages: 20, maxMembers: 20, maxRawBytes: 8192,
  requestTimeoutMs: 1000, retentionSeconds: 3600 };
const lanes = htxAccountAcquisitionLanesV1(spec), signal = () => new AbortController().signal;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function decode(laneId: string, data: unknown, extra = {}) {
  const lane = lanes.find(row => row.laneId === laneId)!;
  return decodeHtxAccountAcquisitionPageV1({ spec, lane, cursor: null,
    acquiredAtUtc: new Date(now).toISOString(), bytes: encode({
      ...(lane.family.startsWith("CONDITIONAL") ? { code: 200 } : { status: "ok" }), data, ...extra }) });
}
function balance() { return { id: 135, type: "spot", state: "working", list: [
  { currency: "btc", type: "trade", balance: "1" }, { currency: "btc", type: "frozen", balance: "0" },
  { currency: "usdt", type: "trade", balance: "2" }, { currency: "usdt", type: "frozen", balance: "0" },
] }; }
const ordinary = (id = "9007199254740993123") => ({ id, "account-id": 135, symbol: "btcusdt",
  type: "buy-market", state: "submitted", amount: "10", "filled-amount": "0.1", price: "0", "created-at": now - 1 });
const conditional = { accountId: 135, clientOrderId: "synthetic-client", symbol: "btcusdt",
  orderType: "market", orderSide: "buy", orderPrice: "0", orderValue: "5", orderStatus: "created",
  orderOrigTime: now - 2000, lastActTime: now - 1000 };
const fill = { "order-id": 999, "trade-id": "9007199254740993999", symbol: "btcusdt",
  type: "buy-limit", price: "2", "filled-amount": "1", "filled-fees": "0.1", "filled-points": "0",
  "fee-currency": "btc", "created-at": now - 1 };

describe("bounded HTX account evidence value construction", () => {
  it("enumerates all three conditional history statuses and only the exact retained own order IDs", () => {
    expect(lanes).toHaveLength(8);
    expect(lanes.filter(lane => lane.family === "CONDITIONAL_HISTORY").map(lane => lane.orderStatus))
      .toEqual(["canceled", "rejected", "triggered"]);
    expect(htxAccountAcquisitionRequestV1(spec, lanes[7]!, null, signal()).path)
      .toBe("/v1/order/orders/999/matchresults");
    expect(() => htxAccountAcquisitionRequestV1(spec, { ...lanes[7]!, orderId: "888" }, null, signal()))
      .toThrow("LANE_IDENTITY");
  });
  it("refuses ambiguous scope, missing bounds and unsupported history windows", () => {
    expect(() => parseHtxAccountAcquisitionSpecV1({ ...spec, maxPages: undefined })).toThrow();
    expect(() => parseHtxAccountAcquisitionSpecV1({ ...spec, knownOrders: [...spec.knownOrders, ...spec.knownOrders] }))
      .toThrow("SPEC_SCOPE_OR_BOUND");
    expect(() => parseHtxAccountAcquisitionSpecV1({ ...spec,
      historyStartUtc: new Date(now - 3600001).toISOString() })).toThrow("SPEC_SCOPE_OR_BOUND");
  });
  it("records every balance bucket but never manufactures dated account truth or complete coverage", () => {
    const result = decode("BALANCE", balance());
    expect(result.responseReportedEnd).toBe(true); expect(result.coverage).toBe("PARTIAL");
    expect(result.members).toHaveLength(4);
    expect(result.members.every(row => row.stateValidTime === "UNKNOWN" && row.sourceEventTimeUtc === null)).toBe(true);
  });
  it("refuses missing, duplicate, foreign and unsupported balance components instead of inferring zero", () => {
    const value = balance();
    for (const data of [{ ...value, list: value.list.slice(1) }, { ...value, list: [...value.list, value.list[0]] },
      { ...value, id: 999 }, { ...value, type: "margin" },
      { ...value, list: [...value.list, { currency: "xyz", type: "trade", balance: "0" }] }])
      expect(() => decode("BALANCE", data)).toThrow();
  });
  it("preserves large lexical order identities and the quote-unit meaning of market BUY amount", () => {
    const result = decodeHtxAccountAcquisitionPageV1({ spec, lane: lanes[1]!, cursor: null,
      acquiredAtUtc: new Date(now).toISOString(), bytes: new TextEncoder().encode(JSON.stringify({ status: "ok",
        data: [ordinary()] }).replace('"9007199254740993123"', '9007199254740993123')) });
    expect(result.members[0]!.fields.orderId).toBe("9007199254740993123");
    expect(result.members[0]!.fields.amountUnit).toBe("QUOTE");
    expect(result.members[0]!.stateValidTime).toBe("UNKNOWN");
  });
  it("retains open conditional orders with declared units and protocol next cursor", () => {
    const result = decode("CONDITIONAL_OPEN", [conditional], { nextId: "9007199254740993999" });
    expect(result.nextCursor).toBe("9007199254740993999"); expect(result.responseReportedEnd).toBe(false);
    expect(result.members[0]!.fields.amountUnit).toBe("QUOTE");
    expect(() => decode("CONDITIONAL_OPEN", [{ ...conditional, accountId: 999 }])).toThrow("ACCOUNT_SCOPE");
  });
  it("checks conditional history origin interval, requested terminal status and triggered ordinary identity", () => {
    expect(decode("CONDITIONAL_HISTORY:BTC/USDT:triggered", [{ ...conditional,
      orderStatus: "triggered", orderId: "999" }]).members[0]!.fields.orderId).toBe("999");
    expect(() => decode("CONDITIONAL_HISTORY:BTC/USDT:triggered", [{ ...conditional, orderStatus: "triggered" }]))
      .toThrow("TRIGGERED_ORDER_ID");
    expect(() => decode("CONDITIONAL_HISTORY:BTC/USDT:canceled", [{ ...conditional, orderStatus: "canceled",
      orderOrigTime: now - 60001 }])).toThrow("HISTORY_INTERVAL");
  });
  it("preserves signed account deltas and individual source-event time separately from state-valid time", () => {
    const result = decode("ACCOUNT_HISTORY", [{ "account-id": 135, "record-id": "9007199254740993777",
      currency: "usdt", "transact-amt": "-1.25", "transact-type": "transfer", "avail-balance": "3",
      "acct-balance": "3", "transact-time": now - 1 }]);
    expect(result.members[0]!.fields.delta).toBe("-1.25");
    expect(result.members[0]!.sourceEventTimeUtc).toBe(new Date(now - 1).toISOString());
    expect(result.members[0]!.stateValidTime).toBe("UNKNOWN");
  });
  it("refuses conditional activity earlier than its actual origin without fabricating a corrected time", () => {
    expect(() => decode("CONDITIONAL_OPEN", [{ ...conditional,
      orderOrigTime: now - 1, lastActTime: now - 1000 }])).toThrow("CONDITIONAL_CHRONOLOGY");
  });
  it("requires an exact own order, genuine nonzero fill and supported explicit fee semantics", () => {
    expect(decode("KNOWN_ORDER_FILLS:999", [fill]).members[0]!.fields.fillId).toBe("9007199254740993999");
    for (const patch of [{ "order-id": 888 }, { "filled-points": "0.1" }, { "filled-points": undefined },
      { "filled-amount": "0" }, { "filled-fees": "0.000000001" }, { "fee-currency": "ht" }])
      expect(() => decode("KNOWN_ORDER_FILLS:999", [{ ...fill, ...patch }])).toThrow();
  });
  it("refuses repeated cursors and malformed lossless input, preserving protocol versus whole-account completeness", () => {
    const lane = lanes[2]!;
    expect(() => decodeHtxAccountAcquisitionPageV1({ spec, lane, cursor: "123",
      acquiredAtUtc: new Date(now).toISOString(), bytes: encode({ code: 200, data: [conditional], nextId: "123" }) }))
      .toThrow("CURSOR_PROGRESS");
    expect(() => decode("CONDITIONAL_OPEN", [], { nextId: "123" })).toThrow("CURSOR_PROGRESS");
    expect(() => decode("ORDINARY_OPEN", [ordinary(), ordinary()])).toThrow("DUPLICATE_MEMBER");
  });
});

const clock: ObservationClock = { now: () => now, sleep: (ms, abort) => new Promise((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new Error("aborted")); };
  const timer = setTimeout(() => { abort.removeEventListener("abort", cancel); resolve(); }, ms);
  abort.addEventListener("abort", cancel, { once: true }); if (abort.aborted) cancel();
}) };
function transportInput() {
  return { binding, symbols: ["BTCUSDT"], knownOrderIds: ["999"], apiKey: "synthetic_acquisition_key",
    apiSecret: "synthetic-unit-secret", host: "api.huobi.pro" as const, clock, timeoutMs: 1000,
    fetchImpl: vi.fn<typeof fetch>(async () => new Response('{"status":"ok","data":[]}')),
    verifyReadAdmission: vi.fn(async () => true) };
}
describe("separate fixed authenticated GET acquisition lane", () => {
  it("admits exact fixed requests with real signing and per-request pre/post admission using inert HTTP", async () => {
    const input = transportInput(), transport = createHtxAccountAcquisitionGetTransport(input);
    try {
      for (const lane of lanes) await transport.signedGet(htxAccountAcquisitionRequestV1(spec, lane, null, signal()));
      expect(input.fetchImpl).toHaveBeenCalledTimes(8); expect(input.verifyReadAdmission).toHaveBeenCalledTimes(16);
      for (const [url, init] of input.fetchImpl.mock.calls) {
        expect(new URL(String(url)).origin).toBe("https://api.huobi.pro"); expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error"); expect(init).not.toHaveProperty("body");
      }
    } finally { transport.dispose(); }
  });
  it("rejects foreign accounts, unselected order IDs, broad filters and future history before signing or HTTP", async () => {
    const examples = [
      { path: "/v2/algo-orders/opening", query: { accountId: "999", limit: "2", sort: "asc" } },
      { path: "/v2/algo-orders/opening", query: { accountId: "135", limit: "2", sort: "asc", symbol: "btcusdt" } },
      { path: "/v1/order/orders/888/matchresults", query: {} },
      { path: "/v1/account/history", query: { "account-id": "135", "start-time": String(now),
        "end-time": String(now + 1), size: "2", sort: "asc" } },
    ];
    for (const example of examples) {
      const input = transportInput(), transport = createHtxAccountAcquisitionGetTransport(input);
      try {
        await expect(transport.signedGet({ ...example, method: "GET", signal: signal(), maxResponseBytes: 8192 } as
          Parameters<HtxAccountAcquisitionGetTransport["signedGet"]>[0])).rejects.toThrow();
        expect(input.fetchImpl).not.toHaveBeenCalled(); expect(input.verifyReadAdmission).not.toHaveBeenCalled();
      } finally { transport.dispose(); }
    }
  });
  it("leaves the existing observation lane closed to the new acquisition endpoints", async () => {
    const input = transportInput(), transport = createHtxObservationGetTransport(input);
    try {
      await expect(transport.signedGet(htxAccountAcquisitionRequestV1(spec, lanes[2]!, null, signal()) as
        Parameters<typeof transport.signedGet>[0])).rejects.toThrow();
      expect(input.fetchImpl).not.toHaveBeenCalled();
    } finally { transport.dispose(); }
  });
  it("refuses literal and escaped opened-key echoes before exposing any raw body to a retention owner", async () => {
    for (const escape of [false, true]) {
      const input = transportInput();
      const value = escape ? [...input.apiKey].map(char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")).join("") : input.apiKey;
      input.fetchImpl.mockImplementation(async () => new Response(`{"status":"ok","data":[],"note":"${value}"}`));
      const transport = createHtxAccountAcquisitionGetTransport(input);
      try {
        await expect(transport.signedGet(htxAccountAcquisitionRequestV1(spec, lanes[1]!, null, signal()))).rejects.toThrow();
      } finally { transport.dispose(); }
    }
  });
  it("uses the protected opener boundary and disposes its synthetic handle exactly once", async () => {
    const input = transportInput(), dispose = vi.fn();
    const transport = await openHtxAccountAcquisitionTransport({ ...input, authorizeOpen: async () => true,
      openCredential: async () => ({ binding, apiKey: input.apiKey, apiSecret: input.apiSecret, dispose }) },
    { binding, symbols: input.symbols, knownOrderIds: input.knownOrderIds, readTimeoutMs: 1000 }, signal());
    await transport.signedGet(htxAccountAcquisitionRequestV1(spec, lanes[7]!, null, signal()));
    transport.dispose(); transport.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
    await expect(transport.signedGet(htxAccountAcquisitionRequestV1(spec, lanes[7]!, null, signal()))).rejects.toThrow();
  });
});

// Pure construction uses the actual receipt builders. It does not assert a DB commit or retained bytes.
function journalFixture() {
  const policy = defineRawCapturePolicyV1({ maxPayloadBytes: spec.maxRawBytes, retentionSeconds: spec.retentionSeconds });
  const entries: HtxAccountAcquisitionJournalBodyV1[] = [];
  const at = (offset: number) => new Date(now + offset).toISOString();
  const push = (kind: HtxAccountAcquisitionJournalBodyV1["kind"], replayKey: string, payload: unknown, offset: number) =>
    entries.push(htxAccountAcquisitionJournalEntrySchemaV1.parse({ schemaVersion: "htx-account-acquisition/v1",
      organizationId: binding.organizationId, accountId: spec.accountId, acquisitionId: spec.acquisitionId,
      jobDigest: "c".repeat(64), sequence: entries.length, previousDigest: entries.length ? "d".repeat(64) : null,
      kind, replayKey, recordedAtUtc: at(offset), payload }));
  push("START", "START", { attemptId: spec.acquisitionId }, 0);
  for (const [index, lane] of lanes.entries()) {
    const tick = 10 + index * 20, request = htxAccountAcquisitionRequestV1(spec, lane, null, signal());
    const bytes = encode({ ...(lane.family.startsWith("CONDITIONAL") ? { code: 200 } : { status: "ok" }),
      data: lane.family === "BALANCE" ? balance() : [] });
    const page = decodeHtxAccountAcquisitionPageV1({ spec, lane, cursor: null, bytes, acquiredAtUtc: at(tick + 1) });
    push("PREPARED", `PREPARED:${lane.laneId}:FIRST`, { lane, cursor: null, path: request.path, query: request.query,
      requestStartedAtUtc: at(tick), acquiredAtUtc: at(tick + 1), rawBytesDigest: digestRawBytesV1(bytes),
      payloadBytes: bytes.length, policyDigest: policy.policyDigest }, tick + 2);
    const prepared = prepareRawCaptureV1({ organizationId: binding.organizationId, sourceId: spec.sourceId, bodyBytes: bytes,
      policy, secretScanReceipt: attestRawSecretScanV1({ status: "PASS", bodyBytes: bytes, scannerId: "synthetic-unit-scan",
        scannerVersion: "v1", completedAt: new Date(at(tick + 1)) }) });
    const retainedBinding = buildRawStorageBindingAtDurableBoundaryV1({ organizationId: binding.organizationId,
      sourceId: spec.sourceId, rawBytesDigest: prepared.rawBytesDigest, storedAt: new Date(at(tick + 3)),
      objectReference: { storageBackendId: "synthetic-unit-values", objectKey: `page-${index}`, objectVersion: "v1",
        encryptionRequirement: "PRIVATE_ENCRYPTED", accessRequirement: "SERVER_ONLY" } });
    const capture = buildRawCaptureReceiptAtDurableBoundaryV1({ prepared, storageBinding: retainedBinding, capturedAt: new Date(at(tick + 4)) });
    const validation = buildRawValidationReceiptAtDurableBoundaryV1({ captureReceipt: capture, validatorId: "htx-account-acquisition",
      validatorVersion: "v1", outcome: { status: "VALID", reasonCodes: [] }, knownAt: new Date(at(tick + 5)) });
    push("PAGE", `PAGE:${lane.laneId}:FIRST`, { page, binding: retainedBinding, capture, validation,
      requestStartedAtUtc: at(tick) }, tick + 6);
  }
  push("TERMINAL", "TERMINAL", { recordingStatus: "RECORDED", reason: null, pages: lanes.length, members: 4,
    coverage: "PARTIAL", stateValidTime: "UNKNOWN", declaredLaneIds: lanes.map(lane => lane.laneId) }, 200);
  return entries;
}

describe("typed immutable acquisition journal prefix values", () => {
  it("accepts the exact full lane roster and raw builder lineage while retaining PARTIAL and UNKNOWN", () => {
    expect(validateHtxAccountAcquisitionJournalV1(spec, journalFixture())).toEqual({ pages: 8, members: 4, closed: true });
  });
  it("accepts an unfinished retained prefix without describing it as recovered or complete", () => {
    expect(validateHtxAccountAcquisitionJournalV1(spec, journalFixture().slice(0, 2)))
      .toEqual({ pages: 0, members: 0, closed: false });
  });
  it("refuses generic payload keys, PAGE before PREPARED and a second START", () => {
    const rows = journalFixture();
    expect(() => htxAccountAcquisitionJournalEntrySchemaV1.parse({ ...rows[0], payload: { approving: true } })).toThrow();
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [rows[0]!, { ...rows[2]!, sequence: 1 }])).toThrow("JOURNAL_PAGE_WITHOUT_PREPARED");
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [rows[0]!, { ...rows[0]!, sequence: 1 }])).toThrow("JOURNAL_START");
  });
  it("refuses a request or scope different from the exact selected lane", () => {
    const rows = journalFixture(), entry = rows[1]!; if (entry.kind !== "PREPARED") throw new Error("fixture");
    rows[1] = { ...entry, payload: { ...entry.payload, query: { "account-id": "999" } } };
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, rows)).toThrow("JOURNAL_REQUEST");
    rows[1] = { ...entry, organizationId: spec.acquisitionId };
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, rows)).toThrow("JOURNAL_TRANSITION");
  });
  it("refuses a genuine but REJECTED validation and a different raw capture lineage", () => {
    const rows = journalFixture(), entry = rows[2]!; if (entry.kind !== "PAGE") throw new Error("fixture");
    const rejected = buildRawValidationReceiptAtDurableBoundaryV1({ captureReceipt: entry.payload.capture,
      validatorId: "htx-account-acquisition", validatorVersion: "v1", knownAt: new Date(entry.payload.validation.knownAtUtc),
      outcome: { status: "REJECTED", reasonCodes: ["RESPONSE_SHAPE"] } });
    rows[2] = { ...entry, payload: { ...entry.payload, validation: rejected } };
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, rows)).toThrow("JOURNAL_PAGE_LINEAGE");
    const other = rows[4]!; if (other.kind !== "PAGE") throw new Error("fixture");
    rows[2] = { ...entry, payload: { ...entry.payload, capture: other.payload.capture } };
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, rows)).toThrow("JOURNAL_PAGE_LINEAGE");
  });
  it("refuses invented terminal counts, missing roster completion and records after terminal", () => {
    const rows = journalFixture(), terminal = rows.at(-1)!; if (terminal.kind !== "TERMINAL") throw new Error("fixture");
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [...rows.slice(0, -1),
      { ...terminal, payload: { ...terminal.payload, pages: 7 } }])).toThrow("JOURNAL_TERMINAL");
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [rows[0]!, { ...terminal, sequence: 1,
      payload: { ...terminal.payload, pages: 0, members: 0 } }])).toThrow("JOURNAL_TERMINAL");
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [...rows, { ...rows[0]!, sequence: rows.length }])).toThrow("JOURNAL_TRANSITION");
  });
  it("closes a failed prefix only with exact recorded counts and a nonempty classified reason", () => {
    const rows = journalFixture(), terminal = rows.at(-1)!; if (terminal.kind !== "TERMINAL") throw new Error("fixture");
    const partial = { ...terminal, sequence: 2, payload: { ...terminal.payload,
      recordingStatus: "PARTIAL" as const, reason: "ABORTED", pages: 0, members: 0 } };
    expect(validateHtxAccountAcquisitionJournalV1(spec, [...rows.slice(0, 2), partial])).toEqual({ pages: 0, members: 0, closed: true });
    expect(() => validateHtxAccountAcquisitionJournalV1(spec, [...rows.slice(0, 2),
      { ...partial, payload: { ...partial.payload, reason: null } }])).toThrow("JOURNAL_TERMINAL");
  });
});


/** Synthetic SQL catalog/row responses only. The real readers, envelope crypto, metadata
 * admission and signing transport execute; actual PG17 role/environment proof remains separate. */
async function protectedAcquisitionFixture() {
  const provider = await SecretsStoreMasterKeyProvider.create({
    secretGetter: async () => Buffer.alloc(32, 9).toString("base64"), productionReady: true });
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
    maxBackoffMs: 1000, readTimeoutMs: 100, leaseTtlMs: 1000,
    htxCoverage: { host: "api.huobi.pro", pageSize: 100, maxPages: 10,
      maxRecords: 1000, maxResponseBytes: 1048576, tradeWindowMs: 60000 } });
  const actualBinding = { ...binding, configurationRevision: config.revision };
  const actualSpec = { ...spec, binding: actualBinding, requestTimeoutMs: 100 };
  const encrypted = await encryptCredentialPayload(provider, { apiKey: "synthetic-key", apiSecret: "synthetic-secret" });
  const state = { current: true, revision: "1", supported: true, rowStatus: "active", permission: "readOnly" };
  const statements: string[] = [], paths: string[] = [];
  const sql = (credential: boolean): Sql => {
    const query = async (strings: TemplateStringsArray | string) => {
      const text = typeof strings === "string" ? strings : strings.join("?"); statements.push(text);
      if (text.includes("AS supported")) return [{
        login: credential ? "waia_account_observation_credential_login" : "synthetic-reader",
        original_session: true, supported: state.supported, safe_login: true, safe_role: true,
        can_set: true, exclusive_role: true, no_ciphertext: true, no_destructive: true,
        reader_no_writes: true, forced_rls: true, membership: true, no_direct_acl: true,
        no_ownership: true, no_create: true, exact_projection: true, rls: true,
      }];
      if (text.includes("SELECT state.symbols")) return state.current ? [{ symbols: ["BTCUSDT"] }] : [];
      if (text.includes("SELECT c.observation_revision")) return state.current ? [{
        credential_revision: state.revision, configuration_revision: config.revision }] : [];
      if (text.includes("encrypted_payload") && !text.includes("AS supported")) return [{
        id: binding.credentialId, organization_id: binding.organizationId, exchange_account_id: binding.exchangeAccountId,
        status: state.rowStatus, observation_read_permitted: true, encrypted_payload: encrypted.encryptedPayload, payload_key_version: encrypted.payloadKeyVersion,
        wrapped_dek_key_version: encrypted.wrappedDekKeyVersion, wrapped_dek_key: encrypted.wrappedDekKey }];
      return [];
    };
    const tx = Object.assign(query, { unsafe: query });
    return Object.assign(query, { begin: (body: (value: unknown) => Promise<unknown>) => body(tx),
      options: { max: 2, connect_timeout: 3, max_lifetime: 300, prepare: false } }) as unknown as Sql;
  };
  const fetchImpl = vi.fn<typeof fetch>(async url => {
    const target = new URL(String(url)); paths.push(target.pathname);
    expect(target.searchParams.get("AccessKeyId")).toBe("synthetic-key");
    if (target.pathname === "/v1/account/accounts") return Response.json({ status: "ok",
      data: [{ id: 135, type: "spot", state: "working" }] });
    if (target.pathname === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
    if (target.pathname === "/v2/user/api-key") return Response.json({ code: 200,
      data: [{ accessKey: "synthetic-key", status: "normal", permission: state.permission }] });
    return Response.json({ status: "ok", data: balance() });
  });
  const input = { readerSql: sql(false), credentialSql: sql(true), masterKeyProvider: provider,
    assignment: { binding: actualBinding, config }, spec: actualSpec,
    host: "api.huobi.pro" as const, clock: accountObservationClock, fetchImpl };
  const request = (signal = new AbortController().signal) => htxAccountAcquisitionRequestV1(actualSpec,
    htxAccountAcquisitionLanesV1(actualSpec)[0]!, null, signal);
  return { input, state, statements, paths, provider, request };
}

describe("DEE-1135 fixed protected acquisition composition", () => {
  it("binds actual assignment, narrow decrypted credential and fresh same-key metadata before every acquisition GET", async () => {
    const f = await protectedAcquisitionFixture(), owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    try {
      const transport = await owner.open(new AbortController().signal);
      expect(f.paths).toEqual(["/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key"]);
      const result = await transport.signedGet(f.request());
      expect(result.httpStatus).toBe(200);
      expect(f.paths).toEqual(["/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key",
        "/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key", "/v1/account/accounts/135/balance",
        "/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key"]);
      expect(f.statements).toContain("SET LOCAL ROLE waia_account_observation_credential");
      expect(f.statements).toContain("SET LOCAL ROLE waia_account_observation_reader");
      expect(f.statements).toContain("SET LOCAL transaction_timeout = '5000ms'");
      expect(f.statements.some(text => /SELECT \*/.test(text))).toBe(false);
    } finally { await owner.dispose(); }
    await expect(owner.open(new AbortController().signal)).rejects.toThrow("PROTECTED_OWNER_CLOSED");
  });
  it("rejects altered timeout, symbol/host/credential identity and unbound coverage before any I/O", async () => {
    const f = await protectedAcquisitionFixture();
    for (const patch of [{ spec: { ...f.input.spec, requestTimeoutMs: 101 } },
      { spec: { ...f.input.spec, symbols: ["ETH/USDT"] } }, { host: "api-aws.huobi.pro" as const },
      { spec: { ...f.input.spec, binding: { ...f.input.spec.binding, credentialRevision: "2" } } },
      { assignment: { ...f.input.assignment, config: { ...f.input.assignment.config, htxCoverage: undefined } } }])
      expect(() => createProtectedHtxAccountAcquisitionSessionV1({ ...f.input, ...patch })).toThrow();
    expect(f.statements).toEqual([]); expect(f.paths).toEqual([]);
  });
  it("captures the exact persisted roster and configuration before callers mutate their objects", async () => {
    const f = await protectedAcquisitionFixture();
    const bound = bindHtxAccountAcquisitionAssignmentV1(f.input);
    f.input.spec.symbols = ["ETH/USDT"]; f.input.spec.knownOrders = [];
    expect(bound.options.symbols).toEqual(["BTCUSDT"]);
    expect(bound.options.knownOrderIds).toEqual(["999"]);
    expect(bound.spec.symbols).toEqual(["BTC/USDT"]);
    expect(Object.isFrozen(bound.options.symbols)).toBe(true);
  });
  it("refuses unsupported production PostgreSQL posture before credential or HTTP effects", async () => {
    const f = await protectedAcquisitionFixture(); f.state.supported = false;
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    try { await expect(owner.open(new AbortController().signal)).rejects.toThrow("OBSERVATION_HOST_ROLE_REFUSED"); }
    finally { await owner.dispose(); }
    expect(f.paths).toEqual([]);
    expect(f.statements.some(text => text.includes("SET LOCAL ROLE waia_account_observation_credential"))).toBe(false);
  });
  it("refuses an unready actual master provider without decrypting the credential", async () => {
    const f = await protectedAcquisitionFixture();
    const decrypt = vi.spyOn(f.provider, "decryptDataKey"); vi.spyOn(f.provider, "isProductionReady").mockReturnValue(false);
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    try { await expect(owner.open(new AbortController().signal)).rejects.toThrow(); }
    finally { await owner.dispose(); }
    expect(decrypt).not.toHaveBeenCalled(); expect(f.paths).toEqual([]);
  });
  it("refuses actual current-assignment loss or credential revision movement before signing", async () => {
    for (const variant of ["current", "revision"] as const) {
      const f = await protectedAcquisitionFixture();
      if (variant === "current") f.state.current = false; else f.state.revision = "2";
      const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
      try { await expect(owner.open(new AbortController().signal)).rejects.toThrow(); }
      finally { await owner.dispose(); }
      expect(f.paths).toEqual([]);
    }
  });
  it("does not let assignment authorization replace the exact-key venue metadata refusal", async () => {
    const f = await protectedAcquisitionFixture(); f.state.permission = "trade";
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    try { await expect(owner.open(new AbortController().signal)).rejects.toThrow(); }
    finally { await owner.dispose(); }
    expect(f.paths).toEqual(["/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key"]);
  });
  it("refuses a post-open assignment revoke before the next acquisition request", async () => {
    const f = await protectedAcquisitionFixture(), owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    try {
      const transport = await owner.open(new AbortController().signal);
      f.state.current = false;
      await expect(transport.signedGet(f.request())).rejects.toThrow();
      expect(f.paths).toHaveLength(3);
    } finally { await owner.dispose(); }
  });
  it("keeps disposal pending until a late real unwrap settles and never signs its abandoned payload", async () => {
    const f = await protectedAcquisitionFixture(), abort = new AbortController();
    const actual = f.provider.decryptDataKey.bind(f.provider);
    let started!: () => void, release!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.provider, "decryptDataKey").mockImplementation(async value => { started(); await held; return actual(value); });
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    const opening = owner.open(abort.signal); const rejected = expect(opening).rejects.toThrow();
    await began; abort.abort(); await rejected;
    let closed = false; const closing = owner.dispose().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release(); await closing; expect(closed).toBe(true); expect(f.paths).toEqual([]);
  });
  it("waits for a late metadata fetch and its body cancellation while refusing open immediately", async () => {
    const f = await protectedAcquisitionFixture(), abort = new AbortController();
    let fetched!: () => void, releaseFetch!: (response: Response) => void, cancelled!: () => void, releaseCancel!: () => void;
    const began = new Promise<void>(resolve => { fetched = resolve; });
    const response = new Promise<Response>(resolve => { releaseFetch = resolve; });
    const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
    const cancelHeld = new Promise<void>(resolve => { releaseCancel = resolve; });
    f.input.fetchImpl.mockImplementation(async () => { fetched(); return response; });
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    const rejected = expect(owner.open(abort.signal)).rejects.toThrow();
    await began; abort.abort(); await rejected;
    let closed = false; const closing = owner.dispose().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    releaseFetch(new Response(new ReadableStream({ cancel() { cancelled(); return cancelHeld; } })));
    await cancellation; expect(closed).toBe(false);
    releaseCancel(); await closing; expect(closed).toBe(true);
    expect(f.input.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("waits for actual in-flight metadata body cancellation rather than only the public timeout promise", async () => {
    const f = await protectedAcquisitionFixture(), abort = new AbortController();
    let reading!: () => void, cancelled!: () => void, release!: () => void;
    const began = new Promise<void>(resolve => { reading = resolve; });
    const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.input.fetchImpl.mockImplementation(async () => new Response(new ReadableStream({
      pull() { reading(); }, cancel() { cancelled(); return held; },
    })));
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    const rejected = expect(owner.open(abort.signal)).rejects.toThrow();
    await began; abort.abort(); await rejected; await cancellation;
    let closed = false; const closing = owner.dispose().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release(); await closing; expect(closed).toBe(true);
    expect(f.input.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("preserves a failed metadata body cancellation as failed settlement", async () => {
    const f = await protectedAcquisitionFixture(), abort = new AbortController();
    let reading!: () => void;
    const began = new Promise<void>(resolve => { reading = resolve; });
    f.input.fetchImpl.mockImplementation(async () => new Response(new ReadableStream({
      pull() { reading(); }, cancel() { return Promise.reject(new Error("synthetic cancellation failure")); },
    })));
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    const rejected = expect(owner.open(abort.signal)).rejects.toThrow();
    await began; abort.abort(); await rejected;
    await expect(owner.dispose()).rejects.toThrow("TRANSPORT_SETTLEMENT_FAILED");
  });
  it("disposes a successfully opened session on owner abort and cannot reuse its credentials", async () => {
    const f = await protectedAcquisitionFixture(), abort = new AbortController();
    const owner = createProtectedHtxAccountAcquisitionSessionV1(f.input);
    const transport = await owner.open(abort.signal); abort.abort(); await owner.dispose();
    expect(() => transport.signedGet(f.request())).toThrow("PROTECTED_OWNER_CLOSED");
    expect(f.paths).toHaveLength(3);
  });
});
