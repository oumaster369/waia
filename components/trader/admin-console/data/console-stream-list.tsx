"use client";

import * as React from "react";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { WORKING_ORDER_STATES } from "@/lib/trader/admin-console/read-models/order-trace";
import { isXidCursor } from "@/lib/trader/admin-console/stream/protocol";

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
      typeof parsed.entityVersion !== "string" ||
      !isXidCursor(parsed.entityVersion) ||
      ![
        "upsert",
        "entity_removed",
        "snapshot",
        "resync_required",
        "access_revoked",
        "heartbeat",
      ].includes(parsed.type)
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
  const [snapshot, setSnapshot] = React.useState<{
    key: string;
    items: (T & LiveListRow)[] | null;
    reason: string | null;
  }>({ key: "", items: null, reason: null });
  const key = `${topic}:${listUrl}`;
  const items = snapshot.key === key ? snapshot.items : null;
  const reason = snapshot.key === key ? snapshot.reason : null;
  React.useEffect(() => {
    let stopped = false;
    let generation = 0;
    let paintedStreamVersion = 0;
    let timer = 0;
    let reconnect = 0;
    const setReason = (reason: string | null) =>
      setSnapshot((current) => ({
        key,
        items: current.key === key ? current.items : null,
        reason,
      }));
    const clearData = (reason: string | null) => setSnapshot({ key, items: null, reason });
    let source: EventSource | null = null;
    let session: StreamSession = createStreamSession();
    const versions = new Map<string, VersionMark>();
    let controller: AbortController | null = null;

    const paint = (rows: T[], observedVersions: Map<string, VersionMark>) => {
      const next = rows.map((row) => {
        const mark = observedVersions.get(
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
      });
      setSnapshot({ key, items: next, reason: null });
    };

    const load = () => {
      if (document.visibilityState === "hidden" || session.accessRevoked || stopped) return;
      controller?.abort();
      const request = ++generation;
      controller = new AbortController();
      const observedVersions = new Map(versions);
      const versionAtRequest = paintedStreamVersion;
      void fetch(listUrl, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403)
            return { error: { code: "FORBIDDEN" } } as ConsoleListBody<T>;
          if (!response.ok)
            return { error: { code: `ADMIN_HTTP_${response.status}` } } as ConsoleListBody<T>;
          return response.json() as Promise<ConsoleListBody<T>>;
        })
        .then((body) => {
          if (stopped || request !== generation) return;
          const parsed = consoleListFromBody(body);
          if (parsed.ok) {
            if (paintedStreamVersion !== versionAtRequest) return;
            paint(parsed.items, observedVersions);
            if (!session.cursor && body.cursor && isXidCursor(body.cursor))
              session = createStreamSession(body.cursor);
            live = true;
            if (!source && session.transport === "sse" && session.cursor) openStream();
            return;
          }
          if (parsed.reason === "FORBIDDEN" || parsed.reason === "UNAUTHORIZED") {
            session = { ...createStreamSession(), accessRevoked: true };
            versions.clear();
            stopTimers();
            clearData("FORBIDDEN");
            notifyAdminAccessRevoked();
            return;
          }
          clearData(parsed.reason);
        })
        .catch((error: unknown) => {
          if (stopped || request !== generation) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setReason("ADMIN_NETWORK_UNAVAILABLE");
        });
    };

    let refresh = 0;
    let failures = 0;
    let live = false;
    const stopTimers = () => {
      window.clearInterval(timer);
      timer = 0;
      window.clearTimeout(reconnect);
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
      const previous = versions.get(event.entityId);
      const next = enqueueStreamEvent(session, event);
      if (next === session) return false;
      session = drainStreamFrame(next);
      if (
        event.type === "upsert" &&
        event.topic === topic &&
        (!previous || BigInt(event.entityVersion) > BigInt(previous.version))
      ) {
        versions.set(event.entityId, {
          version: event.entityVersion,
          acceptedAt: event.acceptedAt ?? "",
          eventId: event.eventId,
        });
      }
      return true;
    };

    const applyOrderProjection = (event: ClientStreamEvent): boolean => {
      if (topic !== "orders" || event.topic !== "orders") return false;
      if (event.type === "entity_removed") {
        paintedStreamVersion++;
        setSnapshot((current) =>
          current.key !== key
            ? current
            : {
                ...current,
                items:
                  current.items?.filter((r) => `trader_orders:${r.id}` !== event.entityId) ?? null,
              },
        );
        return true;
      }
      const row = event.payload as (T & { state?: string; createdAt?: string }) | null;
      if (
        event.type !== "upsert" ||
        !row ||
        typeof row.id !== "string" ||
        event.entityId !== `trader_orders:${row.id}` ||
        typeof row.state !== "string"
      )
        return false;
      paintedStreamVersion++;
      const query = new URL(listUrl, window.location.origin).searchParams;
      const visible =
        query.get("tab") === "all" ||
        WORKING_ORDER_STATES.includes(row.state as (typeof WORKING_ORDER_STATES)[number]);
      setSnapshot((current) => {
        if (current.key !== key || !current.items) return current;
        const next = current.items.filter((item) => item.id !== row.id);
        if (visible)
          next.push({
            ...row,
            entityVersion: event.entityVersion,
            acceptedAt: event.acceptedAt,
            eventId: event.eventId,
          });
        next.sort((a, b) => {
          const left = (a as { createdAt?: string }).createdAt ?? "";
          const right = (b as { createdAt?: string }).createdAt ?? "";
          return right.localeCompare(left) || b.id.localeCompare(a.id);
        });
        return {
          ...current,
          items: next.slice(0, Math.min(200, Number(query.get("limit") ?? "50"))),
          reason: null,
        };
      });
      return true;
    };

    const openStream = () => {
      stopTimers();
      const activity = streamActivity({
        hidden: document.visibilityState === "hidden",
        connected: true,
      });
      if (activity === "paused" || session.accessRevoked || !session.cursor) return;
      const context = new URL(listUrl, window.location.origin);
      context.pathname = "/api/trader/admin/console/stream";
      context.searchParams.delete("cursor");
      const url = streamRequestUrl(`${context.pathname}${context.search}`, session, topic);
      source = new EventSource(url);
      const onEvent = (message: Event) => {
        const data = (message as MessageEvent<string>).data;
        const event = eventFromMessage(data);
        if (!event || !remember(event)) return;
        failures = 0;
        if (session.accessRevoked) {
          generation++;
          controller?.abort();
          stopTimers();
          versions.clear();
          clearData("FORBIDDEN");
          notifyAdminAccessRevoked();
          return;
        }
        if (session.resync) {
          stopTimers();
          versions.clear();
          session = createStreamSession();
          clearData(null);
          load();
          return;
        }
        if (event.type === "upsert" && event.topic === topic) {
          const target = window as Window & {
            __waiaAdminReceived?: { eventId: string; entityId: string; receivedAt: number }[];
          };
          const bucket = (target.__waiaAdminReceived ??= []);
          bucket.push({ eventId: event.eventId, entityId: event.entityId, receivedAt: Date.now() });
          if (bucket.length > 10_000) bucket.splice(0, bucket.length - 10_000);
        }
        if (event.type !== "heartbeat" && !applyOrderProjection(event)) scheduleLoad();
      };
      for (const name of [
        "upsert",
        "entity_removed",
        "snapshot",
        "resync_required",
        "access_revoked",
        "heartbeat",
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
        reconnect = window.setTimeout(() => {
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
      if (live && session.transport === "sse" && session.cursor) openStream();
    };

    load();
    const listRefresh = window.setInterval(() => {
      if (!source) load();
    }, STREAM_DISCONNECT_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      generation += 1;
      controller?.abort();
      window.clearInterval(listRefresh);
      stopTimers();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [listUrl, topic, key]);
  return { items, reason };
}
