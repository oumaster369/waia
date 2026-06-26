import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { MiObservationService } from "@/lib/trader/mi/observation-service";
import type { InstrumentId } from "@/lib/trader/intelligence/types";
import {
  DATA_QUALITY_HALT_REASON,
  INGESTION_HALT_REASON,
} from "@/lib/trader/market-data/data-quality-gate";

export type MarketBrainLogger = {
  log: (payload: Record<string, unknown>) => void;
};

export type MarketBrainWorkerConfig = {
  enabled: boolean;
  organizationId: string;
  htxRestHost?: string;
  symbols: readonly InstrumentId[];
};

export type MarketBrainCycleDeps = {
  config: MarketBrainWorkerConfig;
  observationService?: MiObservationService;
  logger: MarketBrainLogger;
  fetchImpl?: typeof fetch;
};

export type MarketBrainSymbolCycleResult = {
  instrumentId: InstrumentId;
  halted: boolean;
  haltReasonCode: typeof DATA_QUALITY_HALT_REASON | typeof INGESTION_HALT_REASON | null;
  ingestionError: string | null;
  msvId?: string | null;
  dataQualityScore?: number | null;
};

export type MarketBrainCycleReport = {
  outcome: "success" | "partial_halt" | "halted_all" | "noop_disabled";
  organizationId: string;
  symbolResults: readonly MarketBrainSymbolCycleResult[];
  durationMs: number;
};
