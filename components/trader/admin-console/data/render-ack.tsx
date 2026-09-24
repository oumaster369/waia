"use client";

import * as React from "react";
import {
  recordRenderAck,
  type RenderAck,
} from "@/components/trader/admin-console/data/delivery-metrics";

type RenderInput = {
  topic: string;
  entityId: string;
  entityVersion: string;
  acceptedAt?: string;
  eventId?: string;
  offscreen?: boolean;
};

export function useRenderAck(
  input: RenderInput,
  element?: React.RefObject<HTMLSpanElement | null>,
): number {
  const { topic, entityId, entityVersion, acceptedAt, eventId, offscreen = false } = input;
  const [acks, setAcks] = React.useState<readonly RenderAck[]>([]);
  React.useEffect(() => {
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        const row = element?.current?.closest<HTMLElement>("[data-order-id], [data-incident-id]");
        const rect = row?.getBoundingClientRect();
        const outsideViewport =
          offscreen || Boolean(rect && (rect.bottom <= 0 || rect.top >= window.innerHeight));
        const renderedAt = Date.now();
        setAcks((current) =>
          recordRenderAck(current, {
            topic,
            entityId,
            entityVersion,
            renderedAtMs: renderedAt,
            offscreen: outsideViewport,
          }).slice(-100),
        );
        if (row) row.dataset.renderedAt = String(renderedAt);
        if (!eventId || !acceptedAt) return;
        const target = window as Window & {
          __waiaAdminDelivery?: Array<{
            eventId: string;
            entityId: string;
            entityVersion: string;
            acceptedAt: string;
            renderedAt: number;
            offscreen: boolean;
          }>;
        };
        const bucket = target.__waiaAdminDelivery ?? [];
        if (
          !bucket.some(
            (entry) =>
              entry.eventId === eventId &&
              entry.entityVersion === entityVersion &&
              entry.offscreen === outsideViewport,
          )
        ) {
          target.__waiaAdminDelivery = [
            ...bucket,
            {
              eventId,
              entityId,
              entityVersion,
              acceptedAt,
              renderedAt,
              offscreen: outsideViewport,
            },
          ].slice(-10_000);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [topic, entityId, entityVersion, acceptedAt, eventId, offscreen, element]);
  return acks.length;
}

export function RenderAckMarker(input: RenderInput) {
  const element = React.useRef<HTMLSpanElement>(null);
  const count = useRenderAck(input, element);
  return <span ref={element} className="sr-only" data-render-ack={String(count)} />;
}
