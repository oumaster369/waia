import "server-only";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { AccountObservationReadFailure } from "../service";
import type { HtxObservationCredentialHandle } from "../htx-reader-opener";
import type { ObservationBinding, ObservationClock, ObservationReadError, HtxV5AccountObservation,
  HtxV5RowsObservation, HtxV5ValueObservation, HtxV5FinancialHistoryScope, HtxV5BillsObservation, HtxV5FinancialUnavailableReason } from "../types";
import { HTX_V5_READ_BUDGET_MS } from "../types";
import { observationBindingSchema, sameObservationBinding } from "../validation";
import type { HtxExpectedPermission } from "../htx-read-admission";
import { htxV5FinancialHistoryScopeSchema } from "../coverage";
import { financialScopeUnavailable, unavailableHtxV5Bills, htxV5FinancialScopeAt, htxV5BillGroups } from "./htx-v5-bill-groups";
import { createHtxV5ReadTransport, HtxV5FinancialScopeUnavailable, type HtxV5ReadResponse, type HtxV5ReadTransport } from "./htx-v5-read-transport";
import {
  parseHtxV5Bills, parseHtxV5AlgoOrders, parseHtxV5AssetMode, parseHtxV5Balance, parseHtxV5Fills,
  parseHtxV5OpenOrders, parseHtxV5Positions, type HtxV5AlgoOrder, type HtxV5AlgoType,
  type HtxV5Fill, type HtxV5OpenOrder,
} from "./htx-v5-read-contract";

export const HTX_V5_READ_PAGE_SIZE = 100;
export const HTX_V5_READ_MAX_PAGES = 2;
export const HTX_V5_READ_MAX_CONTRACTS = 8;
export const HTX_V5_READ_LOOKBACK_MS = 86_400_000;
export const HTX_V5_READ_MAX_REQUESTS = 31;
export const HTX_V5_READ_MAX_DURATION_MS = HTX_V5_READ_BUDGET_MS;
const ALGO_TYPES: readonly HtxV5AlgoType[] = Object.freeze(["tp", "sl", "tpsl", "trigger", "trailing_stop"]);
const CONTRACT = /^[A-Z0-9]+-USDT(?:-\d{6})?$/;
const UID = /^[1-9]\d{0,38}$/;
const ALGO_PAGE_SIZE = 20;
const SAFE_ERRORS: readonly ObservationReadError[] = Object.freeze([
  "TIMEOUT", "RATE_LIMITED", "PERMISSION_DENIED", "READ_FAILED", "INVALID_RESPONSE", "IDENTITY_MISMATCH",
]);
const fail = (code: ObservationReadError): never => { throw new AccountObservationReadFailure(code); };

type ReaderInput = Readonly<{
  credential: HtxObservationCredentialHandle;
  clock: ObservationClock;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  expectedHtxUid?: string;
  expectedPermission?: HtxExpectedPermission;
  contracts?: readonly string[];
  financialHistory?: HtxV5FinancialHistoryScope;
  authorizeCurrent(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
}>;
export type HtxV5ObservationReader = Readonly<{
  read(signal: AbortSignal): Promise<HtxV5AccountObservation>;
  dispose(): void;
  settled(): Promise<void>;
}>;

function safeError(error: unknown): ObservationReadError {
  try {
    if (error instanceof AccountObservationReadFailure && SAFE_ERRORS.includes(error.code)) return error.code;
    if (error instanceof Error && error.message === "HTX_V5_INVALID_RESPONSE") return "INVALID_RESPONSE";
  } catch { /* Do not expose hostile error properties. */ }
  return "READ_FAILED";
}
function ownConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_RESPONSE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_RESPONSE");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const rawKey of Reflect.ownKeys(descriptors)) {
    if (typeof rawKey !== "string") fail("INVALID_RESPONSE");
    const key = rawKey as string;
    if (!["credential", "clock", "fetchImpl", "timeoutMs", "maxResponseBytes",
      "expectedHtxUid", "expectedPermission", "contracts", "financialHistory", "authorizeCurrent"].includes(key)) fail("INVALID_RESPONSE");
    const descriptor = (descriptors as Record<string, PropertyDescriptor>)[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("INVALID_RESPONSE");
    result[key] = descriptor.value;
  }
  return result;
}
function snapshotContracts(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > HTX_V5_READ_MAX_CONTRACTS) return fail("INVALID_RESPONSE");
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-7])$/.test(key))))
    return fail("INVALID_RESPONSE");
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" ||
        !CONTRACT.test(descriptor.value)) return fail("INVALID_RESPONSE");
    result.push(descriptor.value);
  }
  if (new Set(result).size !== result.length) return fail("INVALID_RESPONSE");
  return Object.freeze(result);
}
function snapshotClock(value: unknown): ObservationClock {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return fail("INVALID_RESPONSE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail("INVALID_RESPONSE");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || !["now", "sleep"].includes(key))) return fail("INVALID_RESPONSE");
  const now = (descriptors as Record<string, PropertyDescriptor>).now;
  const sleep = (descriptors as Record<string, PropertyDescriptor>).sleep;
  if (!now || !("value" in now) || !now.enumerable || typeof now.value !== "function" ||
      !sleep || !("value" in sleep) || !sleep.enumerable || typeof sleep.value !== "function") return fail("INVALID_RESPONSE");
  return Object.freeze({ now: now.value.bind(value), sleep: sleep.value.bind(value) });
}
function responseTime(response: HtxV5ReadResponse, started: number, completed: number,
  identityAtLeast: number): void {
  if (!Number.isSafeInteger(response.receivedAt) || response.receivedAt < started || response.receivedAt > completed ||
      response.identity.checkedAt < response.receivedAt ||
      response.identity.checkedAt < identityAtLeast || response.identity.checkedAt > completed)
    fail("INVALID_RESPONSE");
}

/** Reader-only V5 projection. It owns transport instances, never the protected credential handle.
 * Every route/page constructs a fresh transport and therefore performs fresh strict admission. */
export function createHtxV5ObservationReader(input: ReaderInput): HtxV5ObservationReader {
  const config = ownConfig(input);
  const credential = config.credential as HtxObservationCredentialHandle;
  const clockInput = snapshotClock(config.clock);
  const fetchImpl = config.fetchImpl as typeof fetch;
  const timeoutMs = config.timeoutMs as number;
  const maxResponseBytes = config.maxResponseBytes as number;
  const authorizeCurrent = config.authorizeCurrent as ReaderInput["authorizeCurrent"];
  const rawExpectedPermission = config.expectedPermission;
  if (rawExpectedPermission !== undefined && rawExpectedPermission !== "readOnly" &&
      rawExpectedPermission !== "readOnly,trade") return fail("INVALID_RESPONSE");
  const expectedPermission: HtxExpectedPermission = rawExpectedPermission === undefined
    ? "readOnly" : rawExpectedPermission;
  let expectedHtxUid: string | undefined;
  if (config.expectedHtxUid !== undefined) {
    if (typeof config.expectedHtxUid !== "string" || !UID.test(config.expectedHtxUid)) return fail("INVALID_RESPONSE");
    expectedHtxUid = config.expectedHtxUid;
  }
  const contracts = snapshotContracts(config.contracts);
  const financialHistory = config.financialHistory === undefined ? undefined :
    Object.freeze(htxV5FinancialHistoryScopeSchema.parse(config.financialHistory));
  if (financialHistory && (!expectedHtxUid || contracts.length)) fail("INVALID_RESPONSE");
  if (!credential || typeof credential !== "object" || typeof fetchImpl !== "function" ||
      typeof authorizeCurrent !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1_048_576 ||
      typeof clockInput.now !== "function" || typeof clockInput.sleep !== "function") fail("INVALID_RESPONSE");
  const clock = clockInput;
  const binding = Object.freeze(observationBindingSchema.parse(credential.binding));
  const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
  let expectedKeyDigest: string;
  let expectedSecretDigest: string;
  try {
    if (typeof credential.apiKey !== "string" || typeof credential.apiSecret !== "string") fail("IDENTITY_MISMATCH");
    expectedKeyDigest = fingerprint(credential.apiKey);
    expectedSecretDigest = fingerprint(credential.apiSecret);
  } catch { return fail("IDENTITY_MISMATCH"); }
  const verifyCredential = () => {
    try {
      const currentBinding = observationBindingSchema.parse(credential.binding);
      if (!sameObservationBinding(currentBinding, binding) || typeof credential.apiKey !== "string" ||
          typeof credential.apiSecret !== "string" || fingerprint(credential.apiKey) !== expectedKeyDigest ||
          fingerprint(credential.apiSecret) !== expectedSecretDigest) fail("IDENTITY_MISMATCH");
    } catch { fail("IDENTITY_MISMATCH"); }
  };
  let disposed = false;
  // A prompt timeout/cancellation can leave fetch or body cleanup pending.
  // Never reuse this owner while those requests may still be active.
  let terminal = false;
  let reading = false;
  let activeController: AbortController | undefined;
  const transports = new Set<HtxV5ReadTransport>();
  const pending = new Set<Promise<unknown>>();
  let cancellationFailed = false;
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    activeController?.abort();
    for (const transport of transports) transport.dispose();
  };
  async function readOnce(signal: AbortSignal): Promise<HtxV5AccountObservation> {
    if (disposed || terminal || reading || !signal || signal.aborted) fail("READ_FAILED");
    reading = true;
    const controller = new AbortController();
    activeController = controller;
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const current = () => { if (disposed || controller.signal.aborted) fail("READ_FAILED"); };
    let firstIdentity: HtxV5ReadResponse["identity"] | undefined;
    let lastIdentityCheck = -1;
    let callCount = 0;
    const now = () => {
      const value = clock.now();
      if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_RESPONSE");
      return value;
    };
    const overallDeadline = now() + HTX_V5_READ_MAX_DURATION_MS;
    type Unit<T> = Readonly<{ value: T; sourceAt: number | null; received: number; started: number; completed: number }>;
    type Attempt<T> = Readonly<{ unit: Unit<T> | null; error: ObservationReadError | null; started: number; completed: number; unavailableReason?: HtxV5FinancialUnavailableReason }>;
    const request = async <T>(run: (transport: HtxV5ReadTransport, signal: AbortSignal) => Promise<HtxV5ReadResponse>,
      parse: (body: string) => Readonly<{ value: T; sourceAt: number | null }>,
      financialScope?: HtxV5FinancialHistoryScope): Promise<Attempt<T>> => {
      current();
      verifyCredential();
      if (++callCount > HTX_V5_READ_MAX_REQUESTS) fail("INVALID_RESPONSE");
      const started = now();
      const remainingMs = overallDeadline - started - (financialScope ? 100 : 0);
      if (remainingMs < 100) {
        if (financialScope) return { unit: null, error: "TIMEOUT", started, completed: started };
        fail("TIMEOUT");
      }
      const requestExpectedUid = expectedHtxUid ?? firstIdentity?.htxUid;
      const transport = createHtxV5ReadTransport({ credential, clock, fetchImpl, timeoutMs: Math.min(timeoutMs, remainingMs),
        maxResponseBytes, ...(requestExpectedUid ? { expectedHtxUid: requestExpectedUid } : {}), expectedPermission, authorizeCurrent });
      transports.add(transport);
      let completed = started;
      let returnPromptly = false;
      try {
        const response = await run(transport, controller.signal);
        current();
        verifyCredential();
        completed = now();
        responseTime(response, started, completed, lastIdentityCheck);
        const identity = response.identity;
        if (!sameObservationBinding(identity.binding, binding) || identity.permission !== expectedPermission ||
          !/^[0-9a-f]{64}$/.test(identity.accessKeySha256) || identity.accessKeySha256 !== expectedKeyDigest ||
          !UID.test(identity.htxUid) ||
          (expectedHtxUid !== undefined && identity.htxUid !== expectedHtxUid) ||
          (firstIdentity && (identity.htxUid !== firstIdentity.htxUid ||
            identity.accessKeySha256 !== firstIdentity.accessKeySha256 ||
            !sameObservationBinding(identity.binding, firstIdentity.binding))))
          fail("IDENTITY_MISMATCH");
        if (identity.checkedAt < lastIdentityCheck) fail("IDENTITY_MISMATCH");
        firstIdentity ??= identity;
        lastIdentityCheck = identity.checkedAt;
        const parsed = parse(response.body);
        return Object.freeze({ unit: Object.freeze({ value: parsed.value, sourceAt: parsed.sourceAt,
          received: response.receivedAt, started, completed }), error: null, started, completed });
      } catch (caught) {
        if (controller.signal.aborted || disposed) {
          terminal = true;
          returnPromptly = true;
          throw new AccountObservationReadFailure("READ_FAILED");
        }
        if (financialScope && caught instanceof HtxV5FinancialScopeUnavailable) {
          returnPromptly = true;
          return { unit: null, error: null, started, completed: now(), unavailableReason: caught.reason };
        }
        const error = safeError(caught);
        if (financialScope && error === "TIMEOUT") {
          returnPromptly = true;
          return { unit: null, error, started, completed: now() };
        }
        if (error === "TIMEOUT") {
          terminal = true;
          returnPromptly = true;
        }
        if (error === "IDENTITY_MISMATCH" || error === "PERMISSION_DENIED" || error === "TIMEOUT")
          throw new AccountObservationReadFailure(error);
        completed = now();
        return Object.freeze({ unit: null, error, started, completed });
      } finally {
        transport.dispose();
        const settling = track(transport.settled().then(() => undefined, () => { cancellationFailed = true; }));
        void settling.then(() => transports.delete(transport));
        // Timeout, parent abort, and owner disposal must reject promptly while
        // `settled()` continues to account for late fetch/body cleanup.
        if (!returnPromptly) await settling;
      }
    };
    const foldTimes = <T>(units: readonly Unit<T>[]) => ({
      readStartedAtMs: units.length ? Math.min(...units.map(item => item.started)) : null,
      readCompletedAtMs: units.length ? Math.max(...units.map(item => item.completed)) : null,
      responseGeneratedAtMs: units.map(item => item.sourceAt).filter((v): v is number => v !== null).at(-1) ?? null,
    });
    const valueResult = <T>(attempt: Attempt<T>): HtxV5ValueObservation<T> => attempt.unit
      ? { status: "COMPLETE", value: attempt.unit.value, ...foldTimes([attempt.unit]), error: null }
      : { status: "ERROR", value: null, readStartedAtMs: attempt.started, readCompletedAtMs: attempt.completed,
        responseGeneratedAtMs: null, error: attempt.error ?? "READ_FAILED" };
    const rowsResult = <T>(units: readonly Unit<readonly T[]>[], error: ObservationReadError | null,
      pageScope: HtxV5AccountObservation["openOrders"]["pageScope"],
      failedTimes?: Readonly<{ started: number; completed: number }>): HtxV5RowsObservation<T> => {
      const values = units.flatMap(item => [...item.value]);
      if (!units.length) return { status: "ERROR", values: null, readStartedAtMs: failedTimes?.started ?? null,
        readCompletedAtMs: failedTimes?.completed ?? null, responseGeneratedAtMs: null, error: error ?? "READ_FAILED", pageScope };
      const times = foldTimes(units);
      return { status: pageScope ? "PARTIAL" : "COMPLETE", values: Object.freeze(values),
        ...times,
        readCompletedAtMs: failedTimes ? Math.max(times.readCompletedAtMs ?? 0, failedTimes.completed) : times.readCompletedAtMs,
        error, pageScope };
    };
    const valueParts: Record<string, HtxV5AccountObservation[keyof HtxV5AccountObservation]> = {};
    try {
      const assetMode = await request((t, s) => t.readAssetMode(s), body => {
        const value = parseHtxV5AssetMode(body); return { value: value.assetMode, sourceAt: value.responseGeneratedAtMs };
      });
      valueParts.assetMode = valueResult(assetMode);
      const balance = await request((t, s) => t.readBalance(s), body => {
        const value = parseHtxV5Balance(body); return { value: { state: value.state, account: value.account,
          details: value.details }, sourceAt: value.responseGeneratedAtMs };
      });
      valueParts.balance = valueResult(balance);
      const positions = await request((t, s) => t.readPositions({}, s), body => {
        const value = parseHtxV5Positions(body); return { value: value.rows, sourceAt: value.responseGeneratedAtMs };
      });
      valueParts.positions = rowsResult(positions.unit ? [positions.unit] : [], positions.error, null,
        { started: positions.started, completed: positions.completed });

      const orderUnits: Unit<readonly HtxV5OpenOrder[]>[] = [];
      const orderIds = new Set<string>();
      let orderCursor: string | undefined;
      let orderError: ObservationReadError | null = null;
      let orderNextFrom: string | null = null;
      let orderFailedTimes: { started: number; completed: number } | undefined;
      for (let page = 0; page < HTX_V5_READ_MAX_PAGES; page++) {
        const attempt = await request((t, s) => t.readOpenOrders({ limit: HTX_V5_READ_PAGE_SIZE,
          ...(orderCursor ? { from: orderCursor } : {}) }, s), body => {
          const value = parseHtxV5OpenOrders(body);
          if (value.rows.length > HTX_V5_READ_PAGE_SIZE) fail("INVALID_RESPONSE");
          return { value: value.rows, sourceAt: value.responseGeneratedAtMs };
        });
        if (!attempt.unit) { orderError = attempt.error; orderFailedTimes = attempt; break; }
        for (const row of attempt.unit.value) {
          if (orderIds.has(row.id)) fail("INVALID_RESPONSE");
          orderIds.add(row.id);
        }
        orderUnits.push(attempt.unit);
        orderNextFrom = attempt.unit.value.at(-1)?.id ?? null;
        if (!orderNextFrom || orderNextFrom === orderCursor) break;
        orderCursor = orderNextFrom;
      }
      const orderScope = orderUnits.length ? Object.freeze({ pageSize: HTX_V5_READ_PAGE_SIZE,
        maxPages: HTX_V5_READ_MAX_PAGES, pagesRead: orderUnits.length, nextFrom: orderNextFrom,
        completeness: "UNKNOWN" as const }) : null;
      valueParts.openOrders = rowsResult(orderUnits, orderError, orderScope ?? null, orderFailedTimes);

      const algoUnits: Unit<readonly HtxV5AlgoOrder[]>[] = [];
      const algoIds = new Set<string>();
      const algoQueries: Array<{ type: HtxV5AlgoType; pagesRead: number; nextFrom: string | null }> = [];
      let algoError: ObservationReadError | null = null;
      let algoFailedTimes: { started: number; completed: number } | undefined;
      for (const type of ALGO_TYPES) {
        let cursor: string | undefined;
        let nextFrom: string | null = null;
        let pagesRead = 0;
        for (let page = 0; page < HTX_V5_READ_MAX_PAGES; page++) {
          const attempt = await request((t, s) => t.readAlgoOrders({ type, limit: ALGO_PAGE_SIZE,
            ...(cursor ? { from: cursor } : {}) }, s), body => {
            const value = parseHtxV5AlgoOrders(body, type);
            if (value.rows.length > ALGO_PAGE_SIZE) fail("INVALID_RESPONSE");
            return { value: value.rows, sourceAt: value.responseGeneratedAtMs };
          });
          if (!attempt.unit) { algoError = attempt.error; algoFailedTimes = attempt; break; }
          pagesRead++;
          for (const row of attempt.unit.value) {
            const id = `${row.type}\0${row.id}`;
            if (algoIds.has(id)) fail("INVALID_RESPONSE");
            algoIds.add(id);
          }
          algoUnits.push(attempt.unit);
          nextFrom = attempt.unit.value.at(-1)?.id ?? null;
          if (!nextFrom || nextFrom === cursor) break;
          cursor = nextFrom;
        }
        algoQueries.push(Object.freeze({ type, pagesRead: Math.max(1, pagesRead), nextFrom }));
        if (algoError) break;
      }
      const algoScope = algoUnits.length ? Object.freeze({ pageSize: ALGO_PAGE_SIZE,
        maxPagesPerType: HTX_V5_READ_MAX_PAGES, queries: Object.freeze(algoQueries), completeness: "UNKNOWN" as const }) : null;
      if (algoError || !algoScope || algoQueries.length !== ALGO_TYPES.length) {
        valueParts.algoOrders = { status: "ERROR", values: null,
          readStartedAtMs: algoUnits[0]?.started ?? algoFailedTimes?.started ?? null,
          readCompletedAtMs: algoFailedTimes?.completed ?? algoUnits.at(-1)?.completed ?? null,
          responseGeneratedAtMs: foldTimes(algoUnits).responseGeneratedAtMs, error: algoError ?? "READ_FAILED", pageScope: null };
      } else {
        valueParts.algoOrders = { status: "PARTIAL", values: Object.freeze(algoUnits.flatMap(item => [...item.value])),
          ...foldTimes(algoUnits), error: null, pageScope: algoScope };
      }

      const fillStart = now();
      if (!contracts.length) {
        valueParts.fills = { status: "NOT_CONFIGURED", values: null, readStartedAtMs: null, readCompletedAtMs: null,
          responseGeneratedAtMs: null, error: null, coverage: "NOT_CONFIGURED", contracts: Object.freeze([]),
          windowStartMs: null, windowEndMs: null, pageScope: null };
      } else {
        const windowEndMs = fillStart;
        const windowStartMs = windowEndMs - HTX_V5_READ_LOOKBACK_MS;
        if (!Number.isSafeInteger(windowStartMs) || windowStartMs < 0) fail("INVALID_RESPONSE");
        const fillUnits: Unit<readonly HtxV5Fill[]>[] = [];
        const fillIds = new Set<string>();
        const queries: Array<{ contractCode: string; pagesRead: number; nextFrom: string | null }> = [];
        const fillPageSize = Math.max(1, Math.floor(HTX_V5_READ_PAGE_SIZE / contracts.length));
        let fillError: ObservationReadError | null = null;
        let fillFailedTimes: { started: number; completed: number } | undefined;
        let totalRows = 0;
        for (const contractCode of contracts) {
          let cursor: string | undefined;
          let nextFrom: string | null = null;
          let pagesRead = 0;
          for (let page = 0; page < HTX_V5_READ_MAX_PAGES; page++) {
            const attempt = await request((t, s) => t.readFills({ contractCode, startTimeMs: windowStartMs,
              endTimeMs: windowEndMs, limit: fillPageSize,
              ...(cursor ? { from: cursor } : {}) }, s), body => {
              const value = parseHtxV5Fills(body, contractCode);
              if (value.rows.length > fillPageSize || value.rows.some(row =>
                row.createdTimeMs !== null && (row.createdTimeMs < windowStartMs || row.createdTimeMs > windowEndMs)))
                fail("INVALID_RESPONSE");
              return { value: value.rows, sourceAt: value.responseGeneratedAtMs };
            });
            if (!attempt.unit) { fillError = attempt.error; fillFailedTimes = attempt; break; }
            pagesRead++;
            for (const row of attempt.unit.value) {
              const id = `${row.contractCode}\0${row.id}`;
              if (fillIds.has(id)) fail("INVALID_RESPONSE");
              fillIds.add(id); totalRows++;
            }
            fillUnits.push(attempt.unit);
            nextFrom = attempt.unit.value.at(-1)?.id ?? null;
            if (totalRows >= 200 || !nextFrom || nextFrom === cursor) break;
            cursor = nextFrom;
          }
          queries.push(Object.freeze({ contractCode, pagesRead: Math.max(1, pagesRead), nextFrom }));
          if (fillError) break;
        }
        const fillScope = fillUnits.length && queries.length === contracts.length ? Object.freeze({
          pageSize: fillPageSize,
          maxPagesPerContract: HTX_V5_READ_MAX_PAGES, queries: Object.freeze(queries), completeness: "UNKNOWN" as const,
        }) : null;
        if (fillError || !fillScope) {
          valueParts.fills = { status: "ERROR", values: null,
            readStartedAtMs: fillUnits[0]?.started ?? fillFailedTimes?.started ?? fillStart,
            readCompletedAtMs: Math.max(fillUnits.at(-1)?.completed ?? 0, fillFailedTimes?.completed ?? 0) || now(),
            responseGeneratedAtMs: foldTimes(fillUnits).responseGeneratedAtMs,
            error: fillError ?? "READ_FAILED", coverage: "CONFIGURED_CONTRACTS_AND_WINDOW", contracts,
            windowStartMs, windowEndMs, pageScope: null };
        } else {
          valueParts.fills = { status: "PARTIAL", values: Object.freeze(fillUnits.flatMap(item => [...item.value])),
            ...foldTimes(fillUnits), error: null, coverage: "CONFIGURED_CONTRACTS_AND_WINDOW", contracts,
            windowStartMs, windowEndMs, pageScope: fillScope };
        }
      }
      let bills: HtxV5BillsObservation | undefined;
      if (financialHistory) {
        const unavailable = financialScopeUnavailable(financialHistory, now());
        if (unavailable) bills = unavailableHtxV5Bills(financialHistory, unavailable);
        else {
          const attempt = await request((transport, requestSignal) => transport.readBills(financialHistory, requestSignal), body => {
            const parsed = parseHtxV5Bills(body);
            if (parsed.rows.length > 100 || parsed.rows.some(row => row.createdTimeMs < financialHistory.windowStartMs ||
              row.createdTimeMs >= financialHistory.windowEndMs)) fail("INVALID_RESPONSE");
            let groups: ReturnType<typeof htxV5BillGroups>;
            try { groups = htxV5BillGroups(parsed.rows); } catch { return fail("INVALID_RESPONSE"); }
            return { value: { rows: parsed.rows, groups, nextFrom: parsed.nextFrom }, sourceAt: parsed.responseGeneratedAtMs };
          }, financialHistory);
          const reason = attempt.unavailableReason ?? financialScopeUnavailable(financialHistory, now());
          if (reason) bills = unavailableHtxV5Bills(financialHistory, reason);
          else {
            const empty = unavailableHtxV5Bills(financialHistory, "SCOPE_EXPIRED");
            bills = attempt.unit ? Object.freeze({ ...empty, status: "PARTIAL", unavailableReason: null,
              values: attempt.unit.value.rows, groups: attempt.unit.value.groups, ...foldTimes([attempt.unit]),
              responseReceivedAtMs: attempt.unit.received,
              pageScope: { pageSize: 100, maxPages: 1, pagesRead: 1, nextFrom: attempt.unit.value.nextFrom,
                completeness: "UNKNOWN" } as const }) : Object.freeze({ ...empty, status: "ERROR", unavailableReason: null,
              readStartedAtMs: attempt.started, readCompletedAtMs: attempt.completed, error: attempt.error ?? "READ_FAILED" });
          }
        }
      }
      current();
      if (cancellationFailed) fail("READ_FAILED");
      const anySuccessfulComponent = [valueParts.assetMode, valueParts.balance, valueParts.positions,
        valueParts.openOrders, valueParts.algoOrders, valueParts.fills, bills].some(value =>
          value !== undefined && typeof value === "object" && value !== null &&
          "status" in value && (value.status === "COMPLETE" || value.status === "PARTIAL"));
      const htxV5: HtxV5AccountObservation = Object.freeze({
        ...(bills ? { schemaVersion: "htx-v5-observation/v2" as const, bills } : { schemaVersion: "htx-v5-observation/v1" as const }),
        htxUid: anySuccessfulComponent ? firstIdentity?.htxUid ?? null : null,
        assetMode: valueParts.assetMode as HtxV5AccountObservation["assetMode"],
        balance: valueParts.balance as HtxV5AccountObservation["balance"],
        positions: valueParts.positions as HtxV5AccountObservation["positions"],
        openOrders: valueParts.openOrders as HtxV5AccountObservation["openOrders"],
        algoOrders: valueParts.algoOrders as HtxV5AccountObservation["algoOrders"],
        fills: valueParts.fills as HtxV5AccountObservation["fills"],
      });
      return htxV5FinancialScopeAt(htxV5, now());
    } catch (caught) {
      const error = controller.signal.aborted || disposed ? "READ_FAILED" : safeError(caught);
      if (error === "TIMEOUT" || error === "READ_FAILED" && (controller.signal.aborted || disposed)) terminal = true;
      throw new AccountObservationReadFailure(error);
    } finally {
      signal.removeEventListener("abort", cancel);
      if (activeController === controller) activeController = undefined;
      controller.abort();
      reading = false;
    }
  }
  async function read(signal: AbortSignal): Promise<HtxV5AccountObservation> {
    if (disposed || terminal || reading || !signal || signal.aborted) fail("READ_FAILED");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        terminal = true;
        activeController?.abort();
        reject(new AccountObservationReadFailure("TIMEOUT"));
      }, HTX_V5_READ_MAX_DURATION_MS);
    });
    try {
      return await Promise.race([readOnce(signal), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return Object.freeze({
    read: (signal: AbortSignal) => track(read(signal)),
    dispose,
    async settled() {
      dispose();
      while (pending.size) await Promise.allSettled([...pending]);
      for (const transport of transports) await transport.settled();
      if (cancellationFailed) fail("READ_FAILED");
    },
  });
}
