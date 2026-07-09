import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export type SwingPoint = Readonly<{
  price: string;
  barCloseTime: string;
  kind: "HIGH" | "LOW";
}>;

export type StructureBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNCLEAR";

export type VolatilityRegime = "EXPANSION" | "COMPRESSION" | "NORMAL" | "UNKNOWN";

export type MarketStructureBlock = Readonly<{
  swingHighs: readonly SwingPoint[];
  swingLows: readonly SwingPoint[];
  structureBias: StructureBias;
  higherHighSequence: boolean;
  lowerLowSequence: boolean;
  priorDayHigh: string | null;
  priorDayLow: string | null;
  sessionHigh: string | null;
  sessionLow: string | null;
  breakOfStructure: boolean;
  changeOfCharacter: boolean;
}>;

export type LiquidityLevel = Readonly<{
  price: string;
  kind: "EQUAL_HIGHS" | "EQUAL_LOWS" | "SWING_HIGH" | "SWING_LOW";
  touchCount: number;
  swept: boolean;
}>;

export type LiquidityStructureBlock = Readonly<{
  levels: readonly LiquidityLevel[];
  nearestObjectiveAbove: string | null;
  nearestObjectiveBelow: string | null;
  unsweptHighCount: number;
  unsweptLowCount: number;
}>;

export type TrendStructureBlock = Readonly<{
  perTimeframeBias: Partial<Record<BarInterval, StructureBias>>;
  mtfAlignment: "ALIGNED" | "CONFLICTING" | "PARTIAL" | "UNCLEAR";
  regimeBias: "TREND" | "RANGE" | "CHOP" | "UNKNOWN";
}>;

export type VolatilityStructureBlock = Readonly<{
  atrUsdt: string | null;
  atrPeriod: number;
  volatilityRegime: VolatilityRegime;
  expansionRatio: string | null;
}>;

export type ParticipationStructureBlock = Readonly<{
  relativeVolume: string | null;
  volumeAnomaly: boolean;
  effortVsResult: "IMPULSE" | "ABSORPTION" | "NEUTRAL" | "UNKNOWN";
}>;

export type ContextStructureBlock = Readonly<{
  sessionPhase: string;
  fearGreedIndex: number | null;
  crossVenueAgreement: string | null;
  contextOnly: true;
}>;

export type ReconstructionSnapshot = Readonly<{
  schemaVersion: typeof RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION;
  instrumentId: InstrumentId;
  evaluatedAt: string;
  marketStructure: MarketStructureBlock;
  liquidityStructure: LiquidityStructureBlock;
  trendStructure: TrendStructureBlock;
  volatilityStructure: VolatilityStructureBlock;
  participationStructure: ParticipationStructureBlock;
  contextStructure: ContextStructureBlock;
  contentDigest: string;
}>;

export const RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION =
  "waia.trader.reconstruction_snapshot.v1" as const;
