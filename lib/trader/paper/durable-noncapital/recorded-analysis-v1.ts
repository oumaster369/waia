import { createHash } from "node:crypto";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { listMvpStrategyRegistry } from "@/lib/trader/intelligence/strategies/registry-metadata";
import type { HypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import type { Bar, BarInterval, Quote, EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { NormalizedObservation, FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { CanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-service-postgres";

export const ANALYSIS_CONTRACT = "waia.trader.recorded_noncapital_analysis.v1" as const;
export const NORMALIZATION_CONTRACT = "waia.trader.closed_mandatory_normalization.v1" as const;
export class RecordedAnalysisRefusal extends Error {
  constructor(readonly code: string) { super(code); this.name = "RecordedAnalysisRefusal"; }
}
export function refuse(code: string): never { throw new RecordedAnalysisRefusal(code); }
export function requireCondition(ok: unknown, code = "INVALID_INPUT"): asserts ok { if (!ok) refuse(code); }
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value)).digest("hex");
}
/** Omit undefined fields exactly as the existing canonical serializer; reject nonfinite numbers. */
export function copy<T>(value: T): T {
  const visit = (v: unknown): void => {
    if (typeof v === "number") requireCondition(Number.isFinite(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
    else requireCondition(v === undefined || v === null || ["string", "boolean"].includes(typeof v));
  };
  visit(value); return JSON.parse(canonicalJsonString(value)) as T;
}
export function iso(value: unknown): asserts value is string {
  requireCondition(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}
export function nonempty(value: unknown): asserts value is string {
  requireCondition(typeof value === "string" && value.length > 0 && value === value.trim());
}
export type AnalysisSessionInput = {
  organizationId: string; accountId: string; symbol: string; sessionId: string; releaseSha: string;
  maxPacketBytes: number; maxBarsPerInterval: number; maxCycles: number; leaseDurationMs: number;
};
export type AnalysisSession = AnalysisSessionInput & {
  schemaVersion: typeof ANALYSIS_CONTRACT; interval: "1m"; normalization: typeof NORMALIZATION_CONTRACT;
  miCoreEnabled: true; omitIntelligenceArtifacts: false;
  registry: ReturnType<typeof listMvpStrategyRegistry>; configDigest: string;
};
export function captureSession(input: AnalysisSessionInput): AnalysisSession {
  requireCondition(typeof input.organizationId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.organizationId));
  for (const value of [input.accountId, input.symbol, input.sessionId]) nonempty(value);
  requireCondition(typeof input.releaseSha === "string" && /^[0-9a-f]{40}$/.test(input.releaseSha));
  for (const value of [input.maxPacketBytes, input.maxBarsPerInterval, input.maxCycles, input.leaseDurationMs]) {
    requireCondition(Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647);
  }
  const body = copy({ schemaVersion: ANALYSIS_CONTRACT, interval: "1m" as const, normalization: NORMALIZATION_CONTRACT,
    organizationId: input.organizationId, accountId: input.accountId, symbol: input.symbol,
    sessionId: input.sessionId, releaseSha: input.releaseSha, maxPacketBytes: input.maxPacketBytes,
    maxBarsPerInterval: input.maxBarsPerInterval, maxCycles: input.maxCycles, leaseDurationMs: input.leaseDurationMs,
    miCoreEnabled: true as const, omitIntelligenceArtifacts: false as const, registry: listMvpStrategyRegistry() });
  return { ...body, configDigest: digest(body) };
}
export function assertSession(session: AnalysisSession): void {
  requireCondition(digest(captureSession(session)) === digest(session), "SESSION_CONFIG_CONFLICT");
}
export function assertEnvironment(): void {
  requireCondition(process.env.FHV_IDHPS_SKIP_REGIME_TIMELINE !== "1", "INCOMPATIBLE_FHV_FLAG");
}
export type CapturedMandatory = {
  bars: Partial<Record<BarInterval, Bar[]>>; quote: Quote; observations: NormalizedObservation[];
};
export type NormalizedMandatory = {
  normalization: typeof NORMALIZATION_CONTRACT; captured: CapturedMandatory;
  bars: Partial<Record<BarInterval, Bar[]>>; excludedOpenBars: Array<{ interval: BarInterval; bars: Bar[]; digest: string }>;
  quote: Quote; observations: NormalizedObservation[]; fusedContext: FusedMarketContext; scheduledBarCloseTime: string;
};
export type AnalysisPacket = {
  schemaVersion: typeof ANALYSIS_CONTRACT; session: AnalysisSession; sequence: number;
  analysisPitAnchor: string; normalized: NormalizedMandatory;
  previousCompletionDigest: string | null; previousState: HypothesisSessionState; previousStateDigest: string;
  sources: Array<{ receipt: CanonicalGatewayPitReceiptV1; observation: unknown; trust: unknown; source: unknown }>; contentDigest: string;
};
export type AnalysisOutput = {
  schemaVersion: typeof ANALYSIS_CONTRACT; packetDigest: string; evaluation: EvaluationCycleResult;
  nextState: HypothesisSessionState; nextStateDigest: string; idCount: number; idsDigest: string;
  authority: "OBSERVATIONAL_ONLY"; contentDigest: string;
};
export type AnalysisCompanion = {
  schemaVersion: typeof ANALYSIS_CONTRACT; organizationId: string; sessionId: string; sequence: number;
  packetDigest: string; previousCompletionDigest: string | null; canonicalReceiptDigest: string;
  output: AnalysisOutput; contentDigest: string;
};
export function seal<T extends object>(value: T): T & { contentDigest: string } {
  const body = copy(value); return { ...body, contentDigest: digest(body) };
}
export function assertSeal(value: { contentDigest: string }): void {
  const { contentDigest, ...body } = value; requireCondition(digest(body) === contentDigest, "BODY_CONTENT_CONFLICT");
}
export function assertPacketSize(session: AnalysisSession, packet: unknown): void {
  requireCondition(Buffer.byteLength(canonicalJsonString(packet), "utf8") <= session.maxPacketBytes, "PACKET_LIMIT_EXCEEDED");
}

export type RecordedLoopInput = AnalysisSessionInput & { startSequence: number };
export function captureRecordedLoop(input: RecordedLoopInput) {
  const session = captureSession(input);
  requireCondition(Number.isSafeInteger(input.startSequence) && input.startSequence >= 0 &&
    input.startSequence <= Number.MAX_SAFE_INTEGER - (session.maxCycles - 1));
  return { session, startSequence: input.startSequence };
}
