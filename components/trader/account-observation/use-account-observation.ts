"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";

export type ObservationEvent =
  | { type: "observation"; observation: AccountObservation }
  | { type: "transport"; transport: "STREAMING" | "POLLING" | "RECONNECTING" }
  | { type: "connected" | "disconnected" | "error" | "revoked" };

/** The adapter owns authenticated transport, validation and bounded reconnects.
 * It must honor abort, release resources on unsubscribe and emit no raw errors. */
export type ObservationSubscriber = (
  binding: ObservationBinding,
  emit: (event: ObservationEvent) => void,
  signal: AbortSignal,
) => () => void;

export type AccountObservationView = Readonly<{
  status: "DISCONNECTED" | "LOADING" | "CURRENT" | "STALE" | "PARTIAL" | "ERROR" | "REVOKED";
  observation: AccountObservation | null;
  stale: boolean;
  transport?: "STREAMING" | "POLLING" | "RECONNECTING";
}>;

function bindingKey(binding: ObservationBinding | null): string {
  return binding
    ? JSON.stringify([
        binding.organizationId,
        binding.credentialId,
        binding.exchangeAccountId,
        binding.credentialRevision,
        binding.configurationRevision,
      ])
    : "";
}

type StoredView = {
  scope: object;
  observation: AccountObservation | null;
  connection: "LOADING" | "CONNECTED" | "DISCONNECTED" | "ERROR" | "REVOKED";
  transport?: AccountObservationView["transport"];
};

/** Local UI port, not a production stream. Pass binding=null when access/session ends. */
export function useAccountObservation({
  binding,
  subscribe,
  staleAfterMs = 30_000,
}: {
  binding: ObservationBinding | null;
  subscribe: ObservationSubscriber;
  staleAfterMs?: number;
}): AccountObservationView {
  const key = bindingKey(binding);
  const expiryMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : 30_000;
  const scope = useMemo(() => ({ key, subscribe, expiryMs }), [key, subscribe, expiryMs]);
  const [stored, setStored] = useState<StoredView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!key) return;
    const [
      organizationId,
      credentialId,
      exchangeAccountId,
      credentialRevision,
      configurationRevision,
    ] = JSON.parse(key) as string[];
    const exactBinding: ObservationBinding = Object.freeze({
      organizationId,
      credentialId,
      exchangeAccountId,
      credentialRevision,
      configurationRevision,
    });
    const controller = new AbortController();
    let stopped = false;
    let revoked = false;
    let latest: AccountObservation | null = null;
    let connection: StoredView["connection"] = "LOADING";
    let transport: AccountObservationView["transport"];
    let unsubscribe: (() => void) | undefined;
    const dispose = () => {
      const cleanup = unsubscribe;
      unsubscribe = undefined;
      try {
        cleanup?.();
      } catch {
        /* Cleanup errors never expose adapter details. */
      }
    };
    const startedAt = Date.now();
    const publish = (next: StoredView["connection"]) => {
      connection = next;
      if (!stopped) setStored({ scope, observation: latest, connection, transport });
    };
    const emit = (event: ObservationEvent) => {
      if (stopped || revoked) return;
      if (event.type === "transport") {
        transport = event.transport;
        publish(connection);
      } else if (event.type === "revoked") {
        revoked = true;
        transport = undefined;
        latest = null;
        publish("REVOKED");
        controller.abort();
        clearInterval(timer);
        dispose();
      } else if (event.type === "observation") {
        const incoming = event.observation;
        if (bindingKey(incoming.binding) !== key) {
          latest = null;
          publish("ERROR");
          return;
        }
        // A valid reply restores transport health even when collection has not advanced.
        // Keep the newest evidence (and its original age) on duplicate/older replies.
        if (!latest || incoming.collectionCompletedAtMs > latest.collectionCompletedAtMs) {
          latest = incoming;
        }
        publish("CONNECTED");
      } else {
        publish(
          event.type === "connected"
            ? "CONNECTED"
            : event.type === "error"
              ? "ERROR"
              : "DISCONNECTED",
        );
      }
    };
    // Defer initial subscribe one microtask so effect cleanup can cancel StrictMode's first pass.
    void Promise.resolve().then(() => {
      if (stopped) return;
      publish("LOADING");
      try {
        const cleanup = subscribe(exactBinding, emit, controller.signal);
        unsubscribe = cleanup;
        if (revoked || stopped) dispose();
      } catch {
        if (!revoked) publish("ERROR");
      }
    });
    const timer = setInterval(
      () => {
        if (stopped || revoked) return;
        setNow(Date.now());
        if (!latest && Date.now() - startedAt >= expiryMs) publish("ERROR");
      },
      Math.max(250, Math.min(1_000, expiryMs)),
    );
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      dispose();
    };
  }, [key, subscribe, expiryMs, scope]);

  if (!key) return { status: "DISCONNECTED", observation: null, stale: false };
  // Prevent even a single render of previous account/session data before effect cleanup.
  if (!stored || stored.scope !== scope) {
    return { status: "LOADING", observation: null, stale: false };
  }
  const observation = stored.observation;
  const stale = !!observation && now - observation.collectionCompletedAtMs >= expiryMs;
  const status =
    stored.connection === "CONNECTED"
      ? !observation
        ? "LOADING"
        : observation.status === "ERROR"
          ? "ERROR"
          : stale
            ? "STALE"
            : observation.status === "PARTIAL"
              ? "PARTIAL"
              : "CURRENT"
      : stored.connection;
  return { status, observation, stale, transport: stored.transport };
}
