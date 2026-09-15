import "server-only";

import { z } from "zod";

import {
  HISTORICAL_OBSERVABLE_READ_MODEL_V2,
  type HistoricalObservableProjectionV2,
} from "./observable-read-model-v2";
import {
  HISTORICAL_TERMINAL_ADMIN_OBSERVATION_PATH_V1,
  HISTORICAL_TERMINAL_TENANT_OBSERVATION_PATH_V1,
  type HistoricalTerminalObservationHttpAdapterV1,
} from "./historical-terminal-launch-verifier-v1";
import { isHistoricalTerminalFixtureIdentityV1 } from "./historical-terminal-receipts-v1";
import { HISTORICAL_SIMULATION_RUN_PHASES_V2 } from "./run-lifecycle-v2";

export const HISTORICAL_TERMINAL_OBSERVATION_MAX_RESPONSE_BYTES_V1 = 32 * 1024 * 1024;
export const HISTORICAL_TERMINAL_OBSERVATION_TIMEOUT_MS_V1 = 30_000;

export type HistoricalTerminalObservationHttpRefusalCodeV1 =
  | "CONFIG"
  | "SESSION"
  | "REQUEST_SCOPE"
  | "ORIGIN"
  | "NETWORK"
  | "TIMEOUT"
  | "REDIRECT"
  | "HTTP_STATUS"
  | "CONTENT_TYPE"
  | "PAYLOAD_SIZE"
  | "PAYLOAD_ENCODING"
  | "PAYLOAD_JSON"
  | "PAYLOAD_SCHEMA"
  | "RESPONSE_SCOPE";

export class HistoricalTerminalObservationHttpRefusalV1 extends Error {
  readonly code: HistoricalTerminalObservationHttpRefusalCodeV1;

  constructor(code: HistoricalTerminalObservationHttpRefusalCodeV1) {
    super(`HISTORICAL_TERMINAL_HTTP_REFUSED:${code}`);
    this.name = "HistoricalTerminalObservationHttpRefusalV1";
    this.code = code;
  }
}

const refuse = (code: HistoricalTerminalObservationHttpRefusalCodeV1): never => {
  throw new HistoricalTerminalObservationHttpRefusalV1(code);
};

const text = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() === value);
const count = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const utc = z.string().refine((value) => {
  const epoch = Date.parse(value);
  return Number.isSafeInteger(epoch) && new Date(epoch).toISOString() === value;
});
const decimal = z
  .string()
  .max(128)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .nullable();
const opaqueJson = z.unknown();

const pendingOrderSchema = z
  .object({
    orderId: text,
    symbol: text,
    side: z.enum(["buy", "sell"]),
    state: text,
    quantity: z.string().max(128),
    filledQuantity: z.string().max(128),
    remainingQuantity: z.string().max(128),
    cancellationPending: z.boolean(),
  })
  .strict();

const cycleShape = {
  accountId: text,
  cycleSequence: count,
  cycleId: text,
  symbol: text,
  partition: z.enum(["DEVELOPMENT", "WALK_FORWARD"]),
  replayBarClosedAtUtc: utc,
  cash: decimal,
  equity: decimal,
  netPnl: decimal,
  grossRealizedPnl: decimal,
  netRealizedPnl: decimal,
  netUnrealizedPnl: decimal,
  buyAndHoldGrossEquity: decimal,
  strategyMinusBuyAndHoldGross: decimal,
  buyAndHoldConvention: z.literal("GROSS_MARK_TO_MARKET_NO_FEES"),
  openPositionsCount: count,
  decisionsCount: count,
  riskVetoCount: count,
  ordersCount: count,
  fillsCount: count,
  pendingModeledOrders: z.array(pendingOrderSchema),
  lastForecast: opaqueJson,
  lastDecision: opaqueJson,
  lastPortfolio: opaqueJson,
  lastRisk: opaqueJson,
  lastExecution: opaqueJson,
  lastAccounting: opaqueJson,
  lastGuardian: opaqueJson,
  lastLearning: opaqueJson,
  observedExecutionEffects: z.array(opaqueJson),
  modeledRealityArtifacts: z.array(opaqueJson),
  knowledgeArtifacts: z.array(opaqueJson),
  stages: z.array(text),
  snapshots: z.array(text),
  checkpoint: z
    .object({
      committedCycleSequence: count,
      nextRecordIndex: count,
      nextCycleSequence: count,
      contentDigestHex: digest,
    })
    .strict()
    .nullable(),
  ledgerHeadContentDigestHex: digest,
} as const;

const cycleKeys = Object.keys(cycleShape);
const cycleSchema = z
  .object(cycleShape)
  .strict()
  .superRefine((value, context) => {
    for (const key of cycleKeys) {
      if (!Object.hasOwn(value, key)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `missing ${key}` });
      }
    }
  });

const lifecycleSchema = z
  .object({
    phase: z.enum(HISTORICAL_SIMULATION_RUN_PHASES_V2),
    qualifiedTotalCycles: count,
    committedCycles: count,
    remainingCycles: count,
    progressBps: count.max(10_000),
    nextCycleSequence: count,
    latestCommittedCycleId: text.nullable(),
    observedAt: utc,
    errorCode: text.nullable(),
    contentDigestHex: digest,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.committedCycles > value.qualifiedTotalCycles ||
      value.remainingCycles !== value.qualifiedTotalCycles - value.committedCycles ||
      value.nextCycleSequence !== value.committedCycles ||
      (value.committedCycles === 0) !== (value.latestCommittedCycleId === null)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent lifecycle" });
    }
  });

const accountSchema = z
  .object({
    ...cycleShape,
    history: z.array(cycleSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of cycleKeys) {
      if (!Object.hasOwn(value, key)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `missing ${key}` });
      }
    }
    if (
      value.history.some(
        (cycle) =>
          cycle.accountId !== value.accountId ||
          cycle.cycleSequence > value.cycleSequence ||
          cycle.replayBarClosedAtUtc > value.replayBarClosedAtUtc,
      )
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent account history" });
    }
  });

const aggregateSchema = z
  .object({
    accountCount: count,
    equity: decimal,
    cash: decimal,
    netPnl: decimal,
    buyAndHoldGrossEquity: decimal,
    strategyMinusBuyAndHoldGross: decimal,
    cycles: count,
    decisions: count,
    riskVetoes: count,
    orders: count,
    fills: count,
    processedRecords: count,
    latestCycleSequence: count.nullable(),
    qualifiedTotalCycles: count.nullable(),
    committedCycles: count,
    progressBps: count.max(10_000).nullable(),
    runPhase: z.enum(HISTORICAL_SIMULATION_RUN_PHASES_V2).nullable(),
  })
  .strict();

const projectionSchema = z
  .object({
    schemaVersion: z.literal(HISTORICAL_OBSERVABLE_READ_MODEL_V2),
    mode: z.literal("HISTORICAL_SIMULATION"),
    capitalEligible: z.literal(false),
    organizationId: text,
    runId: text,
    eventId: text,
    observedAt: utc,
    lifecycle: lifecycleSchema.nullable(),
    accounts: z.array(accountSchema).max(1_024),
    aggregate: aggregateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.aggregate.accountCount !== value.accounts.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent account count" });
    }
    if (
      (value.lifecycle === null) !== (value.aggregate.runPhase === null) ||
      (value.lifecycle &&
        (value.aggregate.runPhase !== value.lifecycle.phase ||
          value.aggregate.qualifiedTotalCycles !== value.lifecycle.qualifiedTotalCycles ||
          value.aggregate.committedCycles !== value.lifecycle.committedCycles ||
          value.aggregate.progressBps !== value.lifecycle.progressBps))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inconsistent aggregate lifecycle",
      });
    }
  });

function requireIdentity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 512
  ) {
    return refuse("CONFIG");
  }
  return value;
}

function approvedOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse("ORIGIN");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return refuse("ORIGIN");
  }
  return url;
}

function requireCookie(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.trim() !== value ||
    /[\r\n\0]/.test(value)
  ) {
    return refuse("SESSION");
  }
  return value;
}

function exactSearchParams(url: URL, expected: Readonly<Record<string, string>>): boolean {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) =>
        url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value,
    )
  );
}

function requestUrl(
  raw: string,
  origin: URL,
  role: "admin" | "tenant",
  scope: Readonly<{ organizationId: string; runId: string; accountId: string }>,
): URL {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return refuse("REQUEST_SCOPE");
  }
  const expectedPath =
    role === "admin"
      ? HISTORICAL_TERMINAL_ADMIN_OBSERVATION_PATH_V1
      : HISTORICAL_TERMINAL_TENANT_OBSERVATION_PATH_V1;
  const expectedQuery: Readonly<Record<string, string>> =
    role === "admin"
      ? {
          organization_id: scope.organizationId,
          run_id: scope.runId,
          transport: "poll",
        }
      : {
          run_id: scope.runId,
          account_id: scope.accountId,
          transport: "poll",
        };
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== expectedPath ||
    !exactSearchParams(url, expectedQuery)
  ) {
    return refuse(url.origin === origin.origin ? "REQUEST_SCOPE" : "ORIGIN");
  }
  return url;
}

async function readBoundedUtf8(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) {
    void response.body?.cancel().catch(() => {});
    return refuse("PAYLOAD_SIZE");
  }
  if (!response.body) return refuse("PAYLOAD_ENCODING");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (
        !chunk.value ||
        typeof chunk.value.byteLength !== "number" ||
        (bytes += chunk.value.byteLength) > maxBytes
      ) {
        return refuse("PAYLOAD_SIZE");
      }
      try {
        body += decoder.decode(chunk.value, { stream: true });
      } catch {
        return refuse("PAYLOAD_ENCODING");
      }
    }
    try {
      body += decoder.decode();
    } catch {
      return refuse("PAYLOAD_ENCODING");
    }
    return body;
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
  }
}

function parseProjection(body: string): HistoricalObservableProjectionV2 {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return refuse("PAYLOAD_JSON");
  }
  const parsed = projectionSchema.safeParse(json);
  if (!parsed.success) return refuse("PAYLOAD_SCHEMA");
  return parsed.data as HistoricalObservableProjectionV2;
}

/**
 * Server-only transport for the canonical Historical V2 polling routes.
 * The caller supplies the real session cookie on every request; this adapter
 * has no session synthesis, route-function, fixture, database, or retry path.
 */
export function createHistoricalTerminalAuthenticatedHttpAdapterV1(
  input: Readonly<{
    origin: string;
    scope: Readonly<{ organizationId: string; runId: string; accountId: string }>;
    fetchImpl?: typeof fetch;
    maxResponseBytes?: number;
    timeoutMs?: number;
  }>,
): HistoricalTerminalObservationHttpAdapterV1 {
  const origin = approvedOrigin(input.origin);
  const scope = Object.freeze({
    organizationId: requireIdentity(input.scope.organizationId),
    runId: requireIdentity(input.scope.runId),
    accountId: requireIdentity(input.scope.accountId),
  });
  if (isHistoricalTerminalFixtureIdentityV1(scope)) refuse("CONFIG");
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const maxResponseBytes =
    input.maxResponseBytes ?? HISTORICAL_TERMINAL_OBSERVATION_MAX_RESPONSE_BYTES_V1;
  const timeoutMs = input.timeoutMs ?? HISTORICAL_TERMINAL_OBSERVATION_TIMEOUT_MS_V1;
  if (
    typeof fetchImpl !== "function" ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > HISTORICAL_TERMINAL_OBSERVATION_MAX_RESPONSE_BYTES_V1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 120_000
  ) {
    refuse("CONFIG");
  }

  return Object.freeze({
    async fetch(request) {
      const url = requestUrl(request.url, origin, request.role, scope);
      const cookie = requireCookie(request.cookie);
      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new HistoricalTerminalObservationHttpRefusalV1("TIMEOUT"));
        }, timeoutMs);
      });
      try {
        const response = await Promise.race([
          fetchImpl(url, {
            method: "GET",
            headers: { Accept: "application/json", Cookie: cookie },
            credentials: "omit",
            cache: "no-store",
            mode: "same-origin",
            referrerPolicy: "no-referrer",
            redirect: "manual",
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (
          response.redirected ||
          (response.status >= 300 && response.status < 400) ||
          (response.url && response.url !== url.href)
        ) {
          void response.body?.cancel().catch(() => {});
          return refuse("REDIRECT");
        }
        if (response.status === 401 || response.status === 403) {
          void response.body?.cancel().catch(() => {});
          return Object.freeze({ status: response.status, authenticated: false, body: null });
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          return refuse("HTTP_STATUS");
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
          void response.body?.cancel().catch(() => {});
          return refuse("CONTENT_TYPE");
        }
        const projection = parseProjection(
          await Promise.race([
            readBoundedUtf8(response, maxResponseBytes, controller.signal),
            timeout,
          ]),
        );
        const accountMatches = projection.accounts.filter(
          (account) => account.accountId === scope.accountId,
        );
        if (
          projection.organizationId !== scope.organizationId ||
          projection.runId !== scope.runId ||
          accountMatches.length !== 1 ||
          (request.role === "tenant" && projection.accounts.length !== 1)
        ) {
          return refuse("RESPONSE_SCOPE");
        }
        return Object.freeze({ status: 200, authenticated: true, body: projection });
      } catch (error) {
        if (error instanceof HistoricalTerminalObservationHttpRefusalV1) throw error;
        return refuse("NETWORK");
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        controller.abort();
      }
    },
  });
}
