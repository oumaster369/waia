import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { incrementTraderCounter } from "@/lib/observability/waia-trader-telemetry";
import type { MiObservationService } from "@/lib/trader/mi/observation-service";
import { recordMsvObservationSafe } from "@/lib/trader/mi/record-msv-observation-safe";
import { runHtxIngestionCycle } from "@/lib/trader/market-brain/htx-ingestion";
import { runMarketBrainPipeline } from "@/lib/trader/market-brain/market-brain-pipeline";
import type { MarketBrainCycleReport, MarketBrainCycleDeps } from "@/lib/trader/market-brain/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type RunMarketBrainCycleInput = {
  deps: MarketBrainCycleDeps;
  organizationId: string;
  telemetrySink?: WaiaTraderTelemetrySink;
  fetchImpl?: typeof fetch;
  newId?: () => string;
};

function emitCycleCounter(
  organizationId: string,
  code: string,
  sink: WaiaTraderTelemetrySink | undefined,
): void {
  incrementTraderCounter(
    {
      organization_id: organizationId,
      domain: "market_brain",
      code,
      delta: 1,
      severity: "info",
    },
    sink,
  );
}

async function persistMsvIfPresent(
  observationService: MiObservationService | undefined,
  organizationId: string,
  pipeline: ReturnType<typeof runMarketBrainPipeline>,
  telemetrySink: WaiaTraderTelemetrySink | undefined,
): Promise<void> {
  if (!observationService || !pipeline.msv || pipeline.halted) {
    return;
  }
  const context = requireOrgContext(organizationId);
  await recordMsvObservationSafe({
    observationService,
    context,
    msv: pipeline.msv,
    marketKnowableEventTime: pipeline.msv.evaluatedAt,
    observedBy: "service:market-brain-cycle",
    telemetrySink,
  });
}

/** Runs one deployed market-brain cycle: HTX ingest → pipeline → optional MSV persist (DEE-197–202). */
export async function runMarketBrainCycle(
  input: RunMarketBrainCycleInput,
): Promise<MarketBrainCycleReport> {
  const startMs = Date.now();
  const { deps, organizationId } = input;
  const telemetrySink = input.telemetrySink;

  if (!deps.config.enabled) {
    deps.logger.log({
      event: "waia_market_brain",
      phase: "cycle_skipped",
      reason: "disabled",
    });
    return {
      outcome: "noop_disabled",
      organizationId,
      symbolResults: [],
      durationMs: Date.now() - startMs,
    };
  }

  const ingestion = await runHtxIngestionCycle({
    fetchImpl: input.fetchImpl ?? deps.fetchImpl,
    restHost: deps.config.htxRestHost,
    symbols: deps.config.symbols,
  });

  const symbolResults = [];

  for (const entry of ingestion.results) {
    if (entry.ingestionError || !entry.snapshot) {
      emitCycleCounter(organizationId, "MARKET_BRAIN_INGESTION_HALT", telemetrySink);
      const pipeline = runMarketBrainPipeline({
        organizationId,
        instrumentId: entry.instrumentId,
        bars: [],
        ingestionError: entry.ingestionError ?? "missing_snapshot",
        newId: input.newId,
        telemetrySink,
      });
      symbolResults.push({
        instrumentId: entry.instrumentId,
        halted: true,
        haltReasonCode: pipeline.haltReasonCode,
        ingestionError: entry.ingestionError,
      });
      continue;
    }

    const pipeline = runMarketBrainPipeline({
      organizationId,
      instrumentId: entry.instrumentId,
      bars: entry.snapshot.bars,
      quote: entry.snapshot.quote,
      evaluatedAt: entry.snapshot.evaluatedAt,
      fusedContext: entry.fusedContext ?? undefined,
      newId: input.newId,
      telemetrySink,
    });

    if (pipeline.halted) {
      emitCycleCounter(organizationId, "MARKET_BRAIN_QUALITY_HALT", telemetrySink);
    } else {
      emitCycleCounter(organizationId, "MARKET_BRAIN_CYCLE_OK", telemetrySink);
    }

    await persistMsvIfPresent(deps.observationService, organizationId, pipeline, telemetrySink);

    symbolResults.push({
      instrumentId: entry.instrumentId,
      halted: pipeline.halted,
      haltReasonCode: pipeline.haltReasonCode,
      ingestionError: null,
      msvId: pipeline.msv?.msvId ?? null,
      dataQualityScore: pipeline.features?.dataQualityScore ?? null,
    });
  }

  const haltedCount = symbolResults.filter((result) => result.halted).length;
  const outcome =
    haltedCount === symbolResults.length
      ? "halted_all"
      : haltedCount > 0
        ? "partial_halt"
        : "success";

  deps.logger.log({
    event: "waia_market_brain",
    phase: "cycle_complete",
    outcome,
    organizationId,
    symbolCount: symbolResults.length,
    haltedCount,
    durationMs: Date.now() - startMs,
  });

  return {
    outcome,
    organizationId,
    symbolResults,
    durationMs: Date.now() - startMs,
  };
}
