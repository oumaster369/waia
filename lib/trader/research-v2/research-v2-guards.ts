import {
  assertNoDiscoveryFitnessPayload,
  BANNED_DISCOVERY_FIELDS,
} from "@/lib/trader/discovery/no-reinforcement-guard";
import { parseDecimal } from "@/lib/trader/risk/numeric";

export const RESEARCH_V2_DIGEST_HEX = /^[0-9a-f]{64}$/;

export class StrategyEvolutionResearchError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "StrategyEvolutionResearchError";
    this.code = code;
  }
}

export function requireResearchV2DigestHex(value: string, code: string): void {
  if (!RESEARCH_V2_DIGEST_HEX.test(value)) {
    throw new StrategyEvolutionResearchError(code);
  }
}

export function requireResearchV2NonEmpty(value: string, code: string): void {
  if (value.trim() === "") {
    throw new StrategyEvolutionResearchError(code);
  }
}

export function requireResearchV2IsoUtc(value: string, code: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new StrategyEvolutionResearchError(code);
  }
}

export function requireResearchV2Decimal(value: string, code: string): void {
  try {
    parseDecimal(value);
  } catch {
    throw new StrategyEvolutionResearchError(code);
  }
}

export function uniqueSortedReasonCodes(codes: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(codes)].sort());
}

export function assertResearchDiscoveryFitnessV2(
  payload: unknown,
  context = "strategy-evolution discovery fitness",
): void {
  assertNoDiscoveryFitnessPayload(payload, context);
}

export const RESEARCH_V2_BANNED_DISCOVERY_FIELDS = BANNED_DISCOVERY_FIELDS;
