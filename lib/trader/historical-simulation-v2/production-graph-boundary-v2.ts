import type postgres from "postgres";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

/** Caller supplies identity only. Paths and sealed cycles are internal deployment authorities. */
export type HistoricalSimulationV2ClosedGraphRequest = Readonly<{
  sql: postgres.Sql; organizationId: string; accountId: string; runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
  defaultQuantity: string;
}>;

const ALLOWED = new Set(["sql", "organizationId", "accountId", "runId", "partition", "symbol",
  "defaultQuantity"]);
const FORBIDDEN = /(credential|secret|private|connector|exchangeClient|live|capitalAuthority|reality|blind.?holdout|resolve|persist|sink|cycle|root|path)/i;
const QTY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
function quantityUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0") || "0");
}

export function assertHistoricalSimulationV2ClosedGraphRequest(value: unknown): asserts value is HistoricalSimulationV2ClosedGraphRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_GRAPH_REFUSED:UNSAFE_LAUNCH_REQUEST");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const quantity = input.defaultQuantity;
  const sql = input.sql as { reserve?: unknown } | undefined;
  const parsedQuantityUnits = typeof quantity === "string" && QTY.test(quantity)
    ? quantityUnits(quantity)
    : null;
  if (keys.length !== ALLOWED.size || [...ALLOWED].some((key) => !Object.hasOwn(input, key)) ||
      keys.some((key) => !ALLOWED.has(key) || FORBIDDEN.test(key)) ||
      keys.some((key) => key !== "sql" && typeof input[key] === "function") ||
      typeof input.sql !== "function" || typeof sql?.reserve !== "function" ||
      typeof input.organizationId !== "string" || !input.organizationId ||
      typeof input.accountId !== "string" || !input.accountId || typeof input.runId !== "string" || !input.runId ||
      parsedQuantityUnits === null || parsedQuantityUnits <= 0n || parsedQuantityUnits > 100_000_000_000_000_000n ||
      !["DEVELOPMENT", "WALK_FORWARD"].includes(input.partition as string) ||
      !["BTCUSDT", "ETHUSDT"].includes(input.symbol as string)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_GRAPH_REFUSED:UNSAFE_LAUNCH_REQUEST");
  }
}

export const HISTORICAL_FORECAST_PIT_AUTHORITY_RECEIPT_V2 =
  "waia.trader.historical_forecast_pit_authority_receipt.v2" as const;
export type HistoricalForecastPitAuthorityReceiptV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_PIT_AUTHORITY_RECEIPT_V2;
  organizationId: string; accountId: string; runId: string; cycleId: string; pitAnchor: string;
  datasetMembershipContentDigestHex: string; datasetSealDigestHex: string; buildSha: string;
  forecastId: string; forecastAuthorityContentDigestHex: string; verificationReceiptDigestHex: string;
  preregistrationId: string; authorityBundleDigestHex: string; contentDigestHex: string;
}>;
type ReceiptSeed = Omit<HistoricalForecastPitAuthorityReceiptV2, "schemaVersion" | "contentDigestHex">;
const RECEIPT_KEYS = new Set(["schemaVersion", "organizationId", "accountId", "runId", "cycleId", "pitAnchor",
  "datasetMembershipContentDigestHex", "datasetSealDigestHex", "buildSha", "forecastId",
  "forecastAuthorityContentDigestHex", "verificationReceiptDigestHex", "preregistrationId",
  "authorityBundleDigestHex", "contentDigestHex"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createHistoricalForecastPitAuthorityReceiptV2(seed: ReceiptSeed): HistoricalForecastPitAuthorityReceiptV2 {
  const body = { schemaVersion: HISTORICAL_FORECAST_PIT_AUTHORITY_RECEIPT_V2, ...seed };
  const receipt = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  assertHistoricalForecastPitAuthorityReceiptV2(receipt, seed);
  return Object.freeze(receipt);
}

export function assertHistoricalForecastPitAuthorityReceiptV2(value: unknown, expected: Readonly<{
  organizationId: string; accountId: string; runId: string; cycleId: string; pitAnchor: string;
  datasetMembershipContentDigestHex: string; datasetSealDigestHex: string; buildSha: string;
}>): asserts value is HistoricalForecastPitAuthorityReceiptV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HISTORICAL_PIT_AUTHORITY_REFUSED");
  const receipt = value as HistoricalForecastPitAuthorityReceiptV2;
  const keys = Object.keys(receipt);
  const { contentDigestHex, ...body } = receipt;
  const digests = [receipt.datasetMembershipContentDigestHex, receipt.datasetSealDigestHex,
    receipt.forecastAuthorityContentDigestHex, receipt.verificationReceiptDigestHex, receipt.authorityBundleDigestHex];
  if (keys.length !== RECEIPT_KEYS.size || [...RECEIPT_KEYS].some((key) => !Object.hasOwn(receipt, key)) ||
      keys.some((key) => !RECEIPT_KEYS.has(key) || typeof (receipt as unknown as Record<string, unknown>)[key] === "function") ||
      receipt.schemaVersion !== HISTORICAL_FORECAST_PIT_AUTHORITY_RECEIPT_V2 ||
      receipt.organizationId !== expected.organizationId || receipt.accountId !== expected.accountId ||
      receipt.runId !== expected.runId || receipt.cycleId !== expected.cycleId || receipt.pitAnchor !== expected.pitAnchor ||
      receipt.datasetMembershipContentDigestHex !== expected.datasetMembershipContentDigestHex ||
      receipt.datasetSealDigestHex !== expected.datasetSealDigestHex || receipt.buildSha !== expected.buildSha ||
      new Date(receipt.pitAnchor).toISOString() !== receipt.pitAnchor || !/^[0-9a-f]{40}$/.test(receipt.buildSha) ||
      digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest)) || !UUID.test(receipt.forecastId) ||
      !UUID.test(receipt.preregistrationId) ||
      contentDigestHex !== computeSemanticSha256Hex(body)) throw new Error("HISTORICAL_PIT_AUTHORITY_REFUSED");
}

export type HistoricalForecastPitAuthorityPortV2 = Readonly<{
  loadExact(input: Omit<ReceiptSeed, "forecastId" | "forecastAuthorityContentDigestHex" |
    "verificationReceiptDigestHex" | "preregistrationId" | "authorityBundleDigestHex">):
    Promise<HistoricalForecastPitAuthorityReceiptV2>;
}>;
