"use client";

import * as React from "react";

import {
  consoleListFromBody,
  type ConsoleListBody,
} from "@/components/trader/admin-console/data/console-list";
import {
  createStreamSession,
  drainStreamFrame,
  enqueueStreamEvent,
  STREAM_DISCONNECT_POLL_MS,
  streamActivity,
  streamRequestUrl,
  type ClientStreamEvent,
  type StreamSession,
} from "@/components/trader/admin-console/data/stream-session";

export type LiveListRow = {
  id: string;
  entityVersion?: string;
  acceptedAt?: string;
  eventId?: string;
};

type VersionMark = { version: string; acceptedAt: string; eventId: string };

function eventFromMessage(raw: string): ClientStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ClientStreamEvent> & { acceptedAt?: string };
    if (
      typeof parsed.eventId !== "string" ||
      typeof parsed.type !== "string" ||
      typeof parsed.topic !== "string" ||
      typeof parsed.entityId !== "string" ||
      typeof parsed.entityVersion !== "string"
    ) {
      return null;
    }
    return {
      eventId: parsed.eventId,
      type: parsed.type,
      topic: parsed.topic,
      entityId: parsed.entityId,
      entityVersion: parsed.entityVersion,
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : "",
      payload: parsed.payload,
      acceptedAt: typeof parsed.acceptedAt === "string" ? parsed.acceptedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function useConsoleStreamList<T extends { id: string }>(
  listUrl: string,
  topic: string,
): { items: (T & LiveListRow)[] | null; reason: string | null } {
  const [items, setItems] = React.useState<(T & LiveListRow)[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    let stopped = false;
    let generation = 0;
    let timer = 0;
    let source: EventSource | null = null;
    let session: StreamSession = createStreamSession();
    const versions = new Map<string, VersionMark>();
    let controller: AbortController | null = null;

    const paint = (rows: T[]) => {
      setItems(
        rows.map((row) => {
          const mark = versions.get(
            `${topic === "orders" ? "trader_orders" : "trader_admin_incident"}:${row.id}`,
          );
          return mark
            ? {
                ...row,
                entityVersion: mark.version,
                acceptedAt: mark.acceptedAt,
                eventId: mark.eventId,
              }
            : row;
        }),
      );
      setReason(null);
    };

    const load = () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const request = ++generation;
      controller = new AbortController();
      void fetch(listUrl, { signal: controller.signal })
        .then(async (response) => response.json() as Promise<ConsoleListBody<T>>)
        .then((body) => {
          if (stopped || request !== generation) return;
          const parsed = consoleListFromBody(body);
          if (parsed.ok) {
            paint(parsed.items);
            return;
          }
          setReason(parsed.reason);
        })
        .catch((error: unknown) => {
          if (stopped || request !== generation) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setReason("POSTGRES_REQUIRED");
        });
    };

    let refresh = 0;
    let failures = 0;
    const stopTimers = () => {
      window.clearInterval(timer);
      timer = 0;
      window.clearTimeout(refresh);
      refresh = 0;
      source?.close();
      source = null;
    };

    const startPoll = () => {
      window.clearInterval(timer);
      timer = window.setInterval(load, STREAM_DISCONNECT_POLL_MS);
    };

    const scheduleLoad = () => {
      if (refresh) return;
      refresh = window.setTimeout(() => {
        refresh = 0;
        load();
      }, 200);
    };

    const remember = (event: ClientStreamEvent) => {
      const next = enqueueStreamEvent(session, event);
      if (next === session) return false;
      session = drainStreamFrame(next);
      if (event.type === "upsert" && event.topic === topic) {
        versions.set(event.entityId, {
          version: event.entityVersion,
          acceptedAt: event.acceptedAt ?? "",
          eventId: event.eventId,
        });
        const target = window as Window & {
          __waiaAdminDelivery?: {
            eventId: string;
            entityId: string;
            acceptedAt: string;
            renderedAt: number;
          }[];
        };
        const bucket = target.__waiaAdminDelivery ?? [];
        bucket.push({
          eventId: event.eventId,
          entityId: event.entityId,
          acceptedAt: event.acceptedAt ?? "",
          renderedAt: Date.now(),
        });
        target.__waiaAdminDelivery = bucket;
      }
      return true;
    };

    const openStream = () => {
      stopTimers();
      const activity = streamActivity({
        hidden: document.visibilityState === "hidden",
        connected: true,
      });
      if (activity === "paused") return;
      const url = streamRequestUrl("/api/trader/admin/console/stream", session, topic);
      source = new EventSource(url);
      const onEvent = (message: Event) => {
        const data = (message as MessageEvent<string>).data;
        const event = eventFromMessage(data);
        if (!event || !remember(event)) return;
        failures = 0;
        scheduleLoad();
      };
      for (const name of [
        "upsert",
        "entity_removed",
        "snapshot",
        "resync_required",
        "access_revoked",
      ]) {
        source.addEventListener(name, onEvent);
      }
      source.onerror = () => {
        source?.close();
        source = null;
        failures += 1;
        if (document.visibilityState === "hidden") return;
        if (failures >= 3) {
          session = { ...session, transport: "poll" };
          startPoll();
          return;
        }
        window.setTimeout(() => {
          if (!stopped && !source) openStream();
        }, 250);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopTimers();
        controller?.abort();
        return;
      }
      load();
      openStream();
    };

    load();
    openStream();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      generation += 1;
      controller?.abort();
      stopTimers();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [listUrl, topic]);
  return { items, reason };
}
