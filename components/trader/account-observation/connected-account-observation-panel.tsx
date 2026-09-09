"use client";

import { useEffect, useMemo, useState } from "react";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import { observationBindingSchema } from "@/lib/trader/account-observation/validation";
import { AccountObservationPanel } from "./account-observation-panel";
import {
  createPollingObservationSubscriber,
  readBoundedObservationJson,
} from "./polling-subscriber";
import { useAccountObservation } from "./use-account-observation";

const browserFetch: typeof fetch = (input, init) => fetch(input, init);
export type AccountObservationTarget = Readonly<{
  credentialId: string;
  exchangeAccountId: string;
  organizationId?: string;
}>;
type BindingState = {
  scope: object;
  binding: ObservationBinding | null;
  status: "LOADING" | "NOT_CONFIGURED" | "ERROR" | "REVOKED";
};

/** GETs only an authorized stored binding/projection; it never connects to HTX or
 * configures a collector. Unmount/reset target when the authenticated session ends. */
export function ConnectedAccountObservationPanel({
  target,
  mode = "tenant",
  fetcher = browserFetch,
}: {
  target: AccountObservationTarget | null;
  mode?: "tenant" | "admin";
  fetcher?: typeof fetch;
}) {
  const key = target
    ? JSON.stringify([target.credentialId, target.exchangeAccountId, target.organizationId ?? ""])
    : "";
  const endpoint =
    mode === "admin" ? "/api/trader/admin/account-observation" : "/api/trader/account-observation";
  const scope = useMemo(() => ({ key, endpoint, fetcher }), [key, endpoint, fetcher]);
  const [stored, setStored] = useState<BindingState | null>(null);
  const subscribe = useMemo(
    () => createPollingObservationSubscriber({ endpointPath: endpoint, fetcher }),
    [endpoint, fetcher],
  );

  useEffect(() => {
    if (!key) return;
    const [credentialId, exchangeAccountId, organizationId] = JSON.parse(key) as string[];
    let stopped = false;
    let failures = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const publish = (status: BindingState["status"], binding: ObservationBinding | null = null) => {
      if (!stopped) setStored({ scope, status, binding });
    };
    const load = async () => {
      if (stopped) return;
      const controller = new AbortController();
      request = controller;
      let accepted = false;
      deadline = setTimeout(() => {
        if (!stopped) {
          controller.abort();
          failures = Math.min(failures + 1, 4);
          publish("ERROR");
        }
      }, 10_000);
      try {
        if (
          !observationBindingSchema.shape.credentialId.safeParse(credentialId).success ||
          !exchangeAccountId ||
          exchangeAccountId.length > 256 ||
          (mode === "admin" &&
            !observationBindingSchema.shape.organizationId.safeParse(organizationId).success)
        ) {
          stopped = true;
          setStored({ scope, status: "ERROR", binding: null });
          return;
        }
        const params = new URLSearchParams({ credentialId, exchangeAccountId });
        if (mode === "admin") params.set("organizationId", organizationId);
        const response = await fetcher(`${endpoint}/binding?${params}`, {
          method: "GET",
          credentials: "same-origin",
          mode: "same-origin",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (stopped || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          publish("REVOKED");
          stopped = true;
          controller.abort();
          return;
        }
        if (response.status === 204) {
          publish("NOT_CONFIGURED");
          failures = 0;
        } else {
          if (!response.ok) throw new Error("BINDING_UNAVAILABLE");
          const binding = observationBindingSchema.parse(
            await readBoundedObservationJson(response, controller.signal, 8192),
          );
          if (stopped || controller.signal.aborted) return;
          if (
            binding.credentialId !== credentialId ||
            binding.exchangeAccountId !== exchangeAccountId ||
            (mode === "admin" && binding.organizationId !== organizationId)
          )
            throw new Error("BINDING_MISMATCH");
          accepted = true;
          publish("LOADING", binding);
        }
      } catch {
        if (!stopped && !controller.signal.aborted) {
          failures = Math.min(failures + 1, 4);
          publish("ERROR");
        }
      } finally {
        clearTimeout(deadline);
        request = undefined;
        if (!stopped && !accepted)
          next = setTimeout(
            () => {
              void load();
            },
            Math.min(30_000, 5_000 * 2 ** failures),
          );
      }
    };
    void Promise.resolve().then(() => {
      if (!stopped) {
        publish("LOADING");
        void load();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(next);
      clearTimeout(deadline);
      request?.abort();
    };
  }, [key, endpoint, fetcher, mode, scope]);

  const current = stored?.scope === scope ? stored : null;
  const view = useAccountObservation({
    binding: key ? (current?.binding ?? null) : null,
    subscribe,
  });
  if (!key)
    return (
      <AccountObservationPanel view={{ status: "DISCONNECTED", observation: null, stale: false }} />
    );
  if (!current?.binding) {
    return (
      <div className="space-y-2">
        <AccountObservationPanel
          view={{
            status: !current || current.status === "NOT_CONFIGURED" ? "LOADING" : current.status,
            observation: null,
            stale: false,
          }}
        />
        {current?.status === "NOT_CONFIGURED" && (
          <p className="text-waia-fg-muted text-sm">
            Automatic collection is not configured for this account. No current observation is
            available; checking again automatically.
          </p>
        )}
        {current?.status === "ERROR" && (
          <p className="text-waia-fg-muted text-sm">
            Account observation is unavailable. Retrying automatically; no account values are
            inferred.
          </p>
        )}
      </div>
    );
  }
  return <AccountObservationPanel view={view} />;
}
