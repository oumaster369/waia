import { z } from "zod";
import { HISTORICAL_OBSERVABLE_READ_MODEL_V2 } from "./observable-read-model-v2";

const text = z.string().min(1).max(512);
const count = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const utc = z.string().datetime({ precision: 3 });
const decimal = z.string().max(128).regex(/^-?\d+(?:\.\d{1,8})?$/).nullable();
// Validate opaque stage shape without reconstructing it or dropping JSON members.
const opaqueObject = z.unknown().refine(value => value !== null && typeof value === "object" && !Array.isArray(value));
const economics = { cash: decimal, equity: decimal, netPnl: decimal,
  buyAndHoldGrossEquity: decimal, strategyMinusBuyAndHoldGross: decimal };
const cycleSchema = z.object({
  accountId: text, cycleSequence: count, cycleId: text, symbol: z.enum(["BTCUSDT", "ETHUSDT"]),
  partition: z.enum(["DEVELOPMENT", "WALK_FORWARD"]), replayBarClosedAtUtc: utc,
  ...economics, grossRealizedPnl: decimal, netRealizedPnl: decimal, netUnrealizedPnl: decimal,
  buyAndHoldConvention: z.literal("GROSS_MARK_TO_MARKET_NO_FEES"), openPositionsCount: count,
  decisionsCount: count, riskVetoCount: count, ordersCount: count, fillsCount: count,
  pendingModeledOrders: z.array(z.object({ orderId: text, symbol: text, side: z.enum(["buy", "sell"]),
    state: text, quantity: z.string(), filledQuantity: z.string(), remainingQuantity: z.string(),
    cancellationPending: z.boolean() }).strict()),
  // Opaque JSON evidence is compared in full, never interpreted as authority here.
  lastForecast: opaqueObject, lastDecision: z.unknown(), lastPortfolio: z.unknown(), lastRisk: opaqueObject,
  lastExecution: opaqueObject, lastAccounting: opaqueObject, lastGuardian: z.unknown(), lastLearning: z.unknown(),
  observedExecutionEffects: z.array(z.unknown()), modeledRealityArtifacts: z.array(z.unknown()),
  knowledgeArtifacts: z.array(z.unknown()), stages: z.array(text), snapshots: z.array(text),
  checkpoint: z.object({ committedCycleSequence: count, nextRecordIndex: count,
    nextCycleSequence: count, contentDigestHex: digest }).strict(), ledgerHeadContentDigestHex: digest,
}).strict();
const projectionSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_OBSERVABLE_READ_MODEL_V2), mode: z.literal("HISTORICAL_SIMULATION"),
  capitalEligible: z.literal(false), organizationId: text, runId: text, eventId: text, observedAt: utc,
  lifecycle: z.object({ phase: z.literal("COMPLETED"), qualifiedTotalCycles: count,
    committedCycles: count, remainingCycles: z.literal(0), progressBps: z.literal(10000),
    nextCycleSequence: count, latestCommittedCycleId: text, observedAt: utc,
    errorCode: z.null(), contentDigestHex: digest }).strict(),
  accounts: z.array(cycleSchema.extend({ history: z.array(cycleSchema).min(1).max(1000) }).strict()).length(1),
  aggregate: z.object({ accountCount: z.literal(1), ...economics, cycles: count, decisions: count,
    riskVetoes: count, orders: count, fills: count, processedRecords: count, latestCycleSequence: count,
    qualifiedTotalCycles: count, committedCycles: count, progressBps: z.literal(10000),
    runPhase: z.literal("COMPLETED") }).strict(),
}).strict();
const expectedSchema = z.object({ organizationId: text, runId: text, accountId: text,
  initialRecordIndex: count, totalCycles: count.min(1).max(1000) }).strict();
type Expected = z.infer<typeof expectedSchema>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Diagnostic = Readonly<{ status: "MATCH" | "DIFFERENT" | "REFUSED";
  reason: "SUPPLIED_PROJECTIONS_EQUAL" | "PROJECTION_CONTENT_MISMATCH" | "INVALID_OR_INCOMPLETE_EXPORT";
  readinessGranted: false }>;
const MAX_BYTES = 32 * 1024 * 1024;

/** Lexical guard before JSON.parse: do not silently lose duplicate members or round
 * numeric evidence. Real producer JSON.stringify output has round-trip number tokens.
 * JSON.parse still performs the complete grammar validation after this guard.
 */
function guardTokens(raw: string): void {
  const tokens = /\s*("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[\[\]{},:])/gy;
  const stack: { object: boolean; expectingKey: boolean; keys: Set<string> }[] = [];
  let position = 0; let tokenCount = 0;
  while (position < raw.length) {
    tokens.lastIndex = position;
    const match = tokens.exec(raw);
    if (!match) { if (/^\s*$/.test(raw.slice(position))) break; throw new Error(); }
    position = tokens.lastIndex;
    if (++tokenCount > 2000000) throw new Error();
    const token = match[1]!; const current = stack.at(-1);
    if (token === "{" || token === "[") {
      if (stack.length >= 96) throw new Error();
      stack.push({ object: token === "{", expectingKey: token === "{", keys: new Set() });
    } else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.object) current.expectingKey = true;
    else if (token.startsWith('"') && current?.object && current.expectingKey) {
      const key: string = JSON.parse(token);
      if (current.keys.has(key)) throw new Error();
      current.keys.add(key); current.expectingKey = false;
    } else if (/^[-\d]/.test(token) && JSON.stringify(Number(token)) !== token) throw new Error();
  }
}
function parseBounded(raw: string): Json {
  if (typeof raw !== "string" || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error();
  guardTokens(raw);
  const parsed: Json = JSON.parse(raw);
  let values = 0;
  const visit = (value: Json, depth: number) => {
    if (++values > 500000 || depth > 96) throw new Error();
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error();
    if (value && typeof value === "object") for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(parsed, 0); return parsed;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function validate(raw: string, expected: Expected): Record<string, unknown> {
  const parsed = parseBounded(raw);
  const p = projectionSchema.parse(parsed);
  const account = p.accounts[0]!; const { history, ...latest } = account;
  const lifecycle = p.lifecycle; const aggregate = p.aggregate; const n = expected.totalCycles;
  if (p.organizationId !== expected.organizationId || p.runId !== expected.runId ||
      account.accountId !== expected.accountId || history.length !== n ||
      !Number.isSafeInteger(expected.initialRecordIndex + n) ||
      lifecycle.qualifiedTotalCycles !== n || lifecycle.committedCycles !== n || lifecycle.nextCycleSequence !== n ||
      lifecycle.latestCommittedCycleId !== latest.cycleId ||
      aggregate.cycles !== n || aggregate.processedRecords !== n || aggregate.committedCycles !== n ||
      aggregate.qualifiedTotalCycles !== n || aggregate.latestCycleSequence !== n - 1 ||
      canonical(latest) !== canonical(history[n - 1])) throw new Error();
  const cycleIds = new Set<string>();
  for (const [i, cycle] of history.entries()) {
    if (cycle.accountId !== expected.accountId || cycle.cycleSequence !== i || cycleIds.has(cycle.cycleId) ||
        cycle.partition !== latest.partition || cycle.symbol !== latest.symbol ||
        cycle.checkpoint.committedCycleSequence !== i || cycle.checkpoint.nextCycleSequence !== i + 1 ||
        cycle.checkpoint.nextRecordIndex !== expected.initialRecordIndex + i + 1 ||
        (i > 0 && cycle.replayBarClosedAtUtc <= history[i - 1]!.replayBarClosedAtUtc)) throw new Error();
    // z.unknown() permits omitted fields; exports must actually contain each opaque stage.
    for (const key of Object.keys(cycleSchema.shape)) if (!Object.hasOwn(cycle, key)) throw new Error();
    cycleIds.add(cycle.cycleId);
  }
  if (aggregate.decisions !== latest.decisionsCount || aggregate.riskVetoes !== latest.riskVetoCount ||
      aggregate.orders !== latest.ordersCount || aggregate.fills !== latest.fillsCount) throw new Error();
  // Single-account aggregate uses exact scale-8 sums in the producer. Validate value
  // consistency without normalizing either export for the subsequent comparison.
  const units = (value: string | null): bigint | null => {
    if (value === null) return null;
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    return (negative ? -1n : 1n) * (BigInt(whole!) * 100000000n + BigInt(fraction.padEnd(8, "0")));
  };
  for (const key of Object.keys(economics) as (keyof typeof economics)[]) {
    if (units(aggregate[key]) !== units(latest[key])) throw new Error();
  }
  // Return the raw accepted payload so no opaque evidence is stripped by a parser.
  const body = { ...(parsed as Record<string, Json>) };
  delete body.observedAt; delete body.eventId;
  return body;
}

/** Offline comparison ONLY. Caller must obtain each export via the actual authenticated
 * panel path. MATCH cannot prove that this occurred, authenticate payloads, check scientific
 * seals, validate trading logic, prove independent runs, or grant readiness/authority.
 * This never opens files, networks, credentials, databases or starts calculations.
 */
export function compareHistoricalPanelExportsV2(adminJson: string, tenantJson: string, expected: Expected): Diagnostic {
  try {
    const scope = expectedSchema.parse(expected);
    const a = validate(adminJson, scope); const b = validate(tenantJson, scope);
    return canonical(a) === canonical(b)
      ? { status: "MATCH", reason: "SUPPLIED_PROJECTIONS_EQUAL", readinessGranted: false }
      : { status: "DIFFERENT", reason: "PROJECTION_CONTENT_MISMATCH", readinessGranted: false };
  } catch {
    return { status: "REFUSED", reason: "INVALID_OR_INCOMPLETE_EXPORT", readinessGranted: false };
  }
}
