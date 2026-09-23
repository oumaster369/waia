export type ClockSample = {
  serverTimeMs: number;
  tSendMs: number;
  tRecvMs: number;
};

export function selectClockOffset(
  samples: readonly ClockSample[],
): { offsetMs: number; errorMs: number } | null {
  let best: { offsetMs: number; errorMs: number } | null = null;
  for (const sample of samples) {
    const errorMs = (sample.tRecvMs - sample.tSendMs) / 2;
    if (errorMs > 100) continue;
    const offsetMs = sample.serverTimeMs - (sample.tSendMs + sample.tRecvMs) / 2;
    if (!best || errorMs < best.errorMs) best = { offsetMs, errorMs };
  }
  return best;
}

export type RenderAck = {
  topic: string;
  entityId: string;
  entityVersion: string;
  renderedAtMs: number;
  offscreen: boolean;
};

export function recordRenderAck(acks: readonly RenderAck[], next: RenderAck): RenderAck[] {
  const already = acks.some(
    (ack) =>
      ack.topic === next.topic &&
      ack.entityId === next.entityId &&
      ack.entityVersion === next.entityVersion &&
      ack.offscreen === next.offscreen,
  );
  return already ? [...acks] : [...acks, next];
}
