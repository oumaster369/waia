import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { incrementTraderCounter } from "@/lib/observability/waia-trader-telemetry";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import {
  type MiObservationService,
  resolveMsvMarketKnowableEventTime,
} from "@/lib/trader/mi/observation-service";
import { serializeMsvPayloadJson } from "@/lib/trader/mi/serialize-observation";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const MI_OBSERVATION_PERSIST_FAILED_CODE = "MI_OBSERVATION_PERSIST_FAILED" as const;

export type RecordMsvObservationSafeInput = {
  observationService: MiObservationService;
  context: OrgContext;
  msv: MsvEnvelope;
  /** Market-knowable timestamp (e.g. bar close) used to validate MsvEnvelope.evaluatedAt (R4). */
  marketKnowableEventTime: string;
  observedBy?: string;
  ingestTime?: Date;
  telemetrySink?: WaiaTraderTelemetrySink;
};

function emitPersistFailure(
  organizationId: string,
  sink: WaiaTraderTelemetrySink | undefined,
): void {
  incrementTraderCounter(
    {
      organization_id: organizationId,
      domain: "mi_observation",
      code: MI_OBSERVATION_PERSIST_FAILED_CODE,
      delta: 1,
      severity: "info",
    },
    sink,
  );
}

/**
 * Fail-open MSV observation recorder (DEE-281 / R5).
 * Never throws; returns void; must not be awaited on trading/decision paths.
 */
export async function recordMsvObservationSafe(
  input: RecordMsvObservationSafeInput,
): Promise<void> {
  try {
    const eventTime = resolveMsvMarketKnowableEventTime({
      msvEvaluatedAt: input.msv.evaluatedAt,
      marketKnowableEventTime: input.marketKnowableEventTime,
    });
    const ingestTime = input.ingestTime ?? new Date();
    const source = await input.observationService.resolveInternalMsvSource(input.context);

    await input.observationService.recordObservation(input.context, {
      sourceId: source.id,
      observationKind: "msv_envelope",
      subjectRef: input.msv.instrumentId,
      payloadJson: serializeMsvPayloadJson(input.msv),
      eventTime,
      ingestTime,
      observedBy: input.observedBy ?? "service:mi-observation-recorder",
      actorType: "service",
    });
  } catch {
    emitPersistFailure(input.context.organizationId, input.telemetrySink);
  }
}
