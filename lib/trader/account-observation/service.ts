import type { Balance } from "@/lib/trader/connectors/types";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES, type HtxDerivativesAccountFamily,
  type HtxDerivativesAccountRow } from "./derivatives/types";
import type { AccountObservation, AccountObservationReader, ObservationBinding, ObservationClock,
  DerivativesAccountFamilyObservation, DerivativesAccountObservation, ObservationComponent,
  ObservationConfig, ObservationLease, ObservationReadError, ObservationRepository,
  ObservationTickResult, ObservedOrder, ObservedTrade, ReadEnvelope } from "./types";
import { deriveAccountObservationStatus, parseAccountObservation, sameObservationBinding } from "./validation";

const bindingKeys = ["organizationId", "credentialId", "exchangeAccountId", "credentialRevision",
  "configurationRevision"] as const;
const errors: readonly ObservationReadError[] = ["TIMEOUT", "RATE_LIMITED", "PERMISSION_DENIED",
  "READ_FAILED", "INVALID_RESPONSE", "IDENTITY_MISMATCH"];
export class AccountObservationReadFailure extends Error {
  constructor(readonly code: ObservationReadError) { super(code); }
}
/** Classified diagnostics only; never attach raw transport/database exceptions. */
export class AccountObservationFailure extends Error {
  readonly secondary: string[] = [];
  constructor(readonly code: string) { super(code); }
}
function invalid(): never { throw new AccountObservationReadFailure("INVALID_RESPONSE"); }
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) invalid();
  return value;
}
function decimal(value: unknown): string {
  const result = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(result)) invalid();
  return result;
}
function optionalClientId(value: unknown): string { return value === "" ? "" : text(value); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) invalid();
  return value as T;
}
function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}
function dateText(value: unknown): string {
  const result = text(value); if (!Number.isFinite(Date.parse(result))) invalid(); return result;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function copyBinding(value: ObservationBinding): ObservationBinding {
  return Object.freeze(Object.fromEntries(bindingKeys.map(key => [key, text(value[key])]))) as ObservationBinding;
}
function sameBinding(a: ObservationBinding, b: ObservationBinding): boolean {
  return !!b && bindingKeys.every(key => a[key] === b[key]);
}
function balance(value: unknown): Balance {
  const r = row(value);
  return Object.freeze({ asset: text(r.asset), free: decimal(r.free), locked: decimal(r.locked), total: decimal(r.total) });
}
function order(value: unknown): ObservedOrder {
  const r = row(value);
  return Object.freeze({ orderId: text(r.orderId), clientOrderId: optionalClientId(r.clientOrderId), symbol: text(r.symbol),
    side: enumValue(r.side, ["buy", "sell"]), type: enumValue(r.type, ["limit", "market"]),
    status: enumValue(r.status, ["open", "partially_filled"]),
    ...(r.price === undefined ? {} : { price: decimal(r.price) }), quantity: decimal(r.quantity),
    filledQuantity: decimal(r.filledQuantity), createdAt: dateText(r.createdAt),
    updatedAt: r.updatedAt === null ? null : dateText(r.updatedAt) });
}
function trade(value: unknown, symbol: string): ObservedTrade {
  const r = row(value); if (r.symbol !== symbol) invalid();
  return Object.freeze({ tradeId: text(r.tradeId), orderId: text(r.orderId), clientOrderId: optionalClientId(r.clientOrderId),
    symbol, side: enumValue(r.side, ["buy", "sell"]), price: decimal(r.price), quantity: decimal(r.quantity),
    fee: decimal(r.fee), feeAsset: text(r.feeAsset), executedAt: dateText(r.executedAt) });
}

/** Injected domain core. NOT a runtime or PostgreSQL adapter; no background work starts here. */
export function createAccountObservationService(deps: Readonly<{
  repository: ObservationRepository; clock: ObservationClock; newObservationId(): string;
  openReader(binding: ObservationBinding, signal: AbortSignal): Promise<AccountObservationReader>;
}>, inputConfig: ObservationConfig) {
  const rawDerivativeFamilies = inputConfig.htxDerivativesFamilies;
  if (rawDerivativeFamilies !== undefined && (!Array.isArray(rawDerivativeFamilies) ||
    rawDerivativeFamilies.length === 0 || rawDerivativeFamilies.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length)) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  }
  const derivativeFamilies = rawDerivativeFamilies === undefined
    ? undefined : Object.freeze([...rawDerivativeFamilies]);
  const config = Object.freeze({ ...inputConfig, symbols: Object.freeze([...inputConfig.symbols]),
    ...(derivativeFamilies ? { htxDerivativesFamilies: Object.freeze([...derivativeFamilies]) } : {}) });
  text(config.revision);
  if (!config.symbols.length || config.symbols.length > 32 || new Set(config.symbols).size !== config.symbols.length ||
    config.symbols.some(symbol => !/^[A-Z0-9]{2,32}$/.test(symbol)) ||
    (derivativeFamilies !== undefined && (!Array.isArray(derivativeFamilies) || !derivativeFamilies.length ||
      derivativeFamilies.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length ||
      new Set(derivativeFamilies).size !== derivativeFamilies.length ||
      derivativeFamilies.some(family => !HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)))) ||
    [config.pollIntervalMs, config.maxBackoffMs, config.readTimeoutMs, config.leaseTtlMs]
      .some(value => !Number.isSafeInteger(value) || value <= 0) || config.maxBackoffMs < config.pollIntervalMs ||
    config.leaseTtlMs <= config.readTimeoutMs * (3 + config.symbols.length + (derivativeFamilies?.length ?? 0))) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  }
  const now = () => timestamp(deps.clock.now());
  async function open(binding: ObservationBinding, signal?: AbortSignal): Promise<AccountObservationReader> {
    if (signal?.aborted) throw new AccountObservationFailure("ACCOUNT_OBSERVATION_OPEN_FAILED");
    const abort = new AbortController(); let abandoned = false; let resolved: AccountObservationReader | undefined;
    let disposed = false;
    const failure = new AccountObservationFailure("ACCOUNT_OBSERVATION_OPEN_FAILED");
    const disposeLate = () => {
      if (disposed || !resolved) return; disposed = true;
      try { resolved.dispose(); } catch { failure.secondary.push("LATE_DISPOSAL_FAILED"); }
    };
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => { abort.abort(); reject(failure); };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    const pending = Promise.resolve().then(() => deps.openReader(binding, abort.signal));
    void pending.then(reader => { resolved = reader; if (abandoned) disposeLate(); }, () => {});
    try {
      return await Promise.race([pending, cancelled, deps.clock.sleep(config.readTimeoutMs, abort.signal)
        .then(() => { failure.secondary.push("OPEN_TIMEOUT"); throw failure; })]);
    } catch { abandoned = true; disposeLate(); throw failure; }
    finally { signal?.removeEventListener("abort", cancel); abort.abort(); }
  }
  async function current(lease: ObservationLease) {
    const time = now(); return Number.isSafeInteger(lease.expiresAtMs) && time < lease.expiresAtMs &&
      await deps.repository.isCurrent(lease, time);
  }
  async function read<T>(lease: ObservationLease, fetch: (signal: AbortSignal) => Promise<ReadEnvelope<T>>,
    normalize: (item: unknown) => T, signal?: AbortSignal): Promise<ObservationComponent<T>> {
    const started = now(); const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new AccountObservationReadFailure("READ_FAILED");
      const response = await Promise.race([fetch(abort.signal), deps.clock.sleep(config.readTimeoutMs, abort.signal)
        .then(() => { throw new AccountObservationReadFailure("TIMEOUT"); })]);
      const ended = now();
      if (ended < started) invalid();
      if (!response || !sameBinding(lease.binding, response.binding)) {
        throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
      }
      if (!Array.isArray(response.values) || typeof response.complete !== "boolean") invalid();
      const sourceAsOfMs = response.sourceAsOfMs === null ? null : timestamp(response.sourceAsOfMs);
      if (sourceAsOfMs !== null && sourceAsOfMs > ended) invalid();
      const values = Object.freeze(Array.from(response.values, normalize));
      return Object.freeze({ status: response.complete ? "COMPLETE" : "PARTIAL", values, sourceAsOfMs,
        readStartedAtMs: started, readCompletedAtMs: ended, error: null });
    } catch (error) {
      const code = error instanceof AccountObservationReadFailure && errors.includes(error.code)
        ? error.code : "READ_FAILED";
      return Object.freeze({ status: "ERROR", values: null, sourceAsOfMs: null,
        readStartedAtMs: started, readCompletedAtMs: now(), error: code });
    } finally { signal?.removeEventListener("abort", cancel); abort.abort(); }
  }
  async function readDerivative(lease: ObservationLease, family: HtxDerivativesAccountFamily,
    reader: AccountObservationReader,
    signal?: AbortSignal): Promise<DerivativesAccountFamilyObservation | null> {
    const started = now(); const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const failed = (error: ObservationReadError, completedAt = now()): DerivativesAccountFamilyObservation =>
      Object.freeze({ family, status: "ERROR", accounts: null, readStartedAtMs: started,
        readCompletedAtMs: completedAt, responseGeneratedAtMs: null, error });
    try {
      if (signal?.aborted) throw new AccountObservationReadFailure("READ_FAILED");
      const readDerivativesAccount = reader.readDerivativesAccount;
      if (typeof readDerivativesAccount !== "function") {
        throw new AccountObservationFailure("ACCOUNT_OBSERVATION_DERIVATIVES_READER_UNAVAILABLE");
      }
      const response = await Promise.race([
        readDerivativesAccount.call(reader, family, abort.signal),
        deps.clock.sleep(config.readTimeoutMs, abort.signal)
          .then(() => { throw new AccountObservationReadFailure("TIMEOUT"); }),
      ]);
      const ended = now();
      if (ended < started) invalid();
      if (!response) invalid();
      if (!response.binding || !sameObservationBinding(lease.binding, response.binding)) return null;
      const snapshot = response.snapshot;
      if (!snapshot) invalid();
      if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(snapshot.family)) invalid();
      if (snapshot.family !== family) return null;
      if (snapshot.schemaVersion !== "htx-derivatives-account/v1") invalid();
      if (!Array.isArray(snapshot.accounts) || snapshot.accounts.length > 100) invalid();
      const responseGeneratedAtMs = snapshot.responseGeneratedAtMs === null
        ? null : timestamp(snapshot.responseGeneratedAtMs);
      if (responseGeneratedAtMs !== null && responseGeneratedAtMs > ended) invalid();
      const accounts = Object.freeze(Array.from(snapshot.accounts, account =>
        Object.freeze({ ...row(account) }) as unknown as HtxDerivativesAccountRow));
      // Cross-margin exposes withdraw_available as transferable account balance;
      // other families use margin_available. Optional position metrics remain null.
      const partial = accounts.some(account => account.marginBalance === null ||
        (family === "usdt_cross_shared"
          ? account.withdrawAvailable == null
          : account.marginAvailable === null));
      return Object.freeze({ family, status: partial ? "PARTIAL" : "COMPLETE", accounts,
        readStartedAtMs: started, readCompletedAtMs: ended, responseGeneratedAtMs, error: null });
    } catch (error) {
      if (error instanceof AccountObservationFailure) throw error;
      const code = error instanceof AccountObservationReadFailure && errors.includes(error.code)
        ? error.code : error instanceof Error && error.message === "HTX_DERIVATIVES_INVALID_RESPONSE"
          ? "INVALID_RESPONSE" : "READ_FAILED";
      if (code === "IDENTITY_MISMATCH") return null;
      return failed(code);
    } finally { signal?.removeEventListener("abort", cancel); abort.abort(); }
  }
  return Object.freeze({
    async tick(requestedBinding: ObservationBinding, ownerId: string, signal?: AbortSignal): Promise<ObservationTickResult> {
      const binding = copyBinding(requestedBinding); text(ownerId);
      if (binding.configurationRevision !== config.revision || signal?.aborted) return { status: "FENCED" };
      const started = now();
      let reader: AccountObservationReader | undefined;
      let primary: AccountObservationFailure | undefined; let committed = false;
      let releaseClaim: Pick<ObservationLease, "binding" | "ownerId" | "token"> | undefined;
      const dispose = () => { const owned = reader; reader = undefined; owned?.dispose(); };
      try {
        let rawLease: ObservationLease | null;
        try { rawLease = await deps.repository.claimDue(binding, ownerId, started, config.leaseTtlMs); }
        catch { throw new AccountObservationFailure("ACCOUNT_OBSERVATION_CLAIM_FAILED"); }
        if (!rawLease) return { status: "NOT_CLAIMED" };
        releaseClaim = Object.freeze({ binding, ownerId, token: text(rawLease.token) });
        const lease = Object.freeze({ ...rawLease, binding: copyBinding(rawLease.binding) });
        // Cancellation may arrive while the bounded database currentness check
        // is in flight. A true DB result cannot revive a cancelled tick.
        const active = async () => !signal?.aborted && await current(lease) && !signal?.aborted;
        if (!sameBinding(binding, lease.binding) || lease.ownerId !== ownerId || !lease.token ||
          !Number.isSafeInteger(lease.consecutiveFailures) || lease.consecutiveFailures < 0 ||
          !await active()) return { status: "FENCED" };
        reader = await open(binding, signal);
        if (!await active()) return { status: "FENCED" };
        if (config.htxDerivativesFamilies?.length && typeof reader.readDerivativesAccount !== "function") {
          throw new AccountObservationFailure("ACCOUNT_OBSERVATION_DERIVATIVES_READER_UNAVAILABLE");
        }
        const balances = await read(lease, requestSignal => reader!.readBalances(requestSignal), balance, signal);
        if (balances.error === "IDENTITY_MISMATCH" || !await active()) return { status: "FENCED" };
        const openOrders = await read(lease, requestSignal => reader!.readOpenOrders(requestSignal), order, signal);
        if (openOrders.error === "IDENTITY_MISMATCH") return { status: "FENCED" };
        const trades: AccountObservation["trades"][number][] = [];
        for (const symbol of config.symbols) {
          if (!await active()) return { status: "FENCED" };
          trades.push(Object.freeze({ symbol,
            component: await read(lease, requestSignal => reader!.readTrades(symbol, requestSignal), value => trade(value, symbol), signal) }));
          if (trades.at(-1)!.component.error === "IDENTITY_MISMATCH") return { status: "FENCED" };
        }
        const components = [balances, openOrders, ...trades.map(item => item.component)];
        const observationId = text(deps.newObservationId());
        const holdings = balances.status === "COMPLETE" ? balances.values : null;
        const common = (collectionCompletedAtMs: number,
          derivativeFamilies: readonly DerivativesAccountFamilyObservation[] = []) => ({ observationId, binding,
          collectionStartedAtMs: started, collectionCompletedAtMs,
          status: deriveAccountObservationStatus([
            ...components.map(item => item.status),
            ...derivativeFamilies.flatMap(item =>
              item.status === "NOT_CONFIGURED" ? [] : [item.status]),
          ]),
          balances, openOrders, trades: Object.freeze(trades), holdings });
        let derivatives: DerivativesAccountObservation | undefined;
        if (config.htxDerivativesFamilies?.length) {
          const families: DerivativesAccountFamilyObservation[] = HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(family =>
            Object.freeze({ family, status: "NOT_CONFIGURED" as const, accounts: null,
              readStartedAtMs: null, readCompletedAtMs: null, responseGeneratedAtMs: null, error: null }));
          for (const family of config.htxDerivativesFamilies) {
            if (!await active()) return { status: "FENCED" };
            const result = await readDerivative(lease, family, reader!, signal);
            if (!result || !await active()) return { status: "FENCED" };
            const index = families.findIndex(item => item.family === family);
            families[index] = result;
            if (result.status !== "ERROR") {
              try {
                const candidateEnd = now();
                if (candidateEnd < started) invalid();
                parseAccountObservation({ schemaVersion: "account-observation/v2", ...common(candidateEnd, families),
                  derivatives: { schemaVersion: "htx-derivatives-observation/v1", families } });
              } catch {
                families[index] = Object.freeze({ family, status: "ERROR", accounts: null,
                  readStartedAtMs: result.readStartedAtMs, readCompletedAtMs: result.readCompletedAtMs,
                  responseGeneratedAtMs: null, error: "INVALID_RESPONSE" });
              }
            }
          }
          derivatives = Object.freeze({ schemaVersion: "htx-derivatives-observation/v1",
            families: Object.freeze(families) });
        }
        dispose();
        if (!await active()) return { status: "FENCED" };
        const ended = now(); if (ended < started) invalid();
        const candidate = Object.freeze(derivatives
          ? { schemaVersion: "account-observation/v2" as const, ...common(ended, derivatives.families), derivatives }
          : { schemaVersion: "account-observation/v1" as const, ...common(ended) });
        parseAccountObservation(candidate);
        const observation: AccountObservation = candidate;
        // Bounded venue coverage remains PARTIAL, but is not a transport/collection failure.
        const failed = components.some(item => item.status === "ERROR") ||
          (derivatives?.families.some(item => item.status === "ERROR") ?? false);
        const failures = failed ? Math.min(lease.consecutiveFailures + 1, 30) : 0;
        const delay = !failed ? config.pollIntervalMs :
          Math.min(config.maxBackoffMs, config.pollIntervalMs * 2 ** failures);
        const nextDueAtMs = timestamp(ended + delay);
        if (signal?.aborted) return { status: "FENCED" };
        committed = await deps.repository.commitIfCurrent({ lease, observation, nowMs: ended,
          nextDueAtMs, consecutiveFailures: failures });
        return committed ? { status: "COMMITTED", observation, nextDueAtMs } : { status: "FENCED" };
      } catch (error) {
        primary = error instanceof AccountObservationFailure ? error :
          new AccountObservationFailure("ACCOUNT_OBSERVATION_INTERNAL_FAILURE");
        throw primary;
      }
      finally {
        let cleanup: AccountObservationFailure | undefined;
        try { dispose(); } catch { cleanup = new AccountObservationFailure("ACCOUNT_OBSERVATION_DISPOSAL_FAILED"); }
        // Successful commit atomically released its token; do not invent a second release obligation.
        if (!committed && releaseClaim) try {
          // Even a malformed claim response cannot redirect cleanup into another scope/owner.
          await deps.repository.release(releaseClaim);
        }
        catch {
          if (cleanup) cleanup.secondary.push("ACCOUNT_OBSERVATION_RELEASE_FAILED");
          else cleanup = new AccountObservationFailure("ACCOUNT_OBSERVATION_RELEASE_FAILED");
        }
        if (cleanup && primary) primary.secondary.push(cleanup.code, ...cleanup.secondary);
        else if (cleanup) throw cleanup;
      }
    },
  });
}
