"use client";

import * as React from "react";

import {
  recordRenderAck,
  type RenderAck,
} from "@/components/trader/admin-console/data/delivery-metrics";

export function useRenderAck(input: {
  topic: string;
  entityId: string;
  entityVersion: string;
  offscreen?: boolean;
}): number {
  const [acks, setAcks] = React.useState<readonly RenderAck[]>([]);
  const offscreen = input.offscreen ?? false;
  React.useEffect(() => {
    setAcks((current) =>
      recordRenderAck(current, {
        topic: input.topic,
        entityId: input.entityId,
        entityVersion: input.entityVersion,
        renderedAtMs: Date.now(),
        offscreen,
      }),
    );
  }, [input.topic, input.entityId, input.entityVersion, offscreen]);
  return acks.length;
}

export function RenderAckMarker(input: {
  topic: string;
  entityId: string;
  entityVersion: string;
  offscreen?: boolean;
}) {
  const count = useRenderAck(input);
  return <span className="sr-only" data-render-ack={String(count)} />;
}
