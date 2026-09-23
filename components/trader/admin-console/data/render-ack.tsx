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
  const offscreen = input.offscreen ?? false;
  const identity = `${input.topic}\n${input.entityId}\n${input.entityVersion}\n${offscreen ? "1" : "0"}`;
  const [stored, setStored] = React.useState<{ identity: string; acks: readonly RenderAck[] }>({
    identity: "",
    acks: [],
  });
  if (stored.identity !== identity) {
    setStored({
      identity,
      acks: recordRenderAck(stored.acks, {
        topic: input.topic,
        entityId: input.entityId,
        entityVersion: input.entityVersion,
        renderedAtMs: 0,
        offscreen,
      }),
    });
  }
  return stored.acks.length;
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
