"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import { observationBindingSchema } from "@/lib/trader/account-observation/validation";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { FinancialHistorySection } from "./financial-history-section";
import { AccountObservationPanel } from "./account-observation-panel";
import { readBoundedObservationJson } from "./polling-subscriber";
import { createStreamingObservationSubscriber } from "./streaming-subscriber";
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

function PendingHistoryStatus({
  status,
}: {
  status: "LOADING" | "NOT_CONFIGURED" | "IDENTITY_PENDING" | "ERROR";
}) {
  const copy = {
    LOADING: "Waiting for this account's current observation before checking financial history.",
    NOT_CONFIGURED:
      "Financial history is not available yet. No current observation configuration was returned.",
    IDENTITY_PENDING: "History identity is not yet verified for this account.",
    ERROR:
      "Financial history status is unavailable while this account's current observation cannot be verified.",
  };
  return (
    <section
      aria-label="Financial history status"
      className="border-border space-y-2 rounded-lg border p-4"
    >
      <h2 className="font-medium">Financial history</h2>
      <p className="text-sm">{copy[status]}</p>
      <p className="text-waia-fg-muted text-xs">
        Connecting an account does not automatically enable financial history collection. History
        requires separate authorization for this account.
      </p>
    </section>
  );
}

/** GETs only an authorized stored binding/projection; it never connects to HTX or
 * configures a collector. Unmount/reset target when the authenticated session ends. */
export function ConnectedAccountObservationPanel({
  target,
  mode = "tenant",
  fetcher = browserFetch,
  sessionKey,
}: {
  target: AccountObservationTarget | null;
  mode?: "tenant" | "admin";
  fetcher?: typeof fetch;
  /** Change with the authenticated session, or unmount/reset target on session end. */
  sessionKey?: string;
}) {
  const key = target
    ? JSON.stringify([target.credentialId, target.exchangeAccountId, target.organizationId ?? ""])
    : "";
  const endpoint =
    mode === "admin" ? "/api/trader/admin/account-observation" : "/api/trader/account-observation";
  const scope = useMemo(
    () => ({ key, endpoint, fetcher, sessionKey }),
    [key, endpoint, fetcher, sessionKey],
  );
  const [revokedScope, setRevokedScope] = useState<object | null>(null);
  const historyRevoked = revokedScope === scope;
  const onHistoryRevoked = useCallback(() => setRevokedScope(scope), [scope]);
  // A finite lookup budget per invalidated binding; later legitimate revisions
  // receive their own budget. Never resume a stream for the invalidated revision.
  const [recovery, setRecovery] = useState<{
    scope: object;
    previous: ObservationBinding;
  } | null>(null);
  const activeRecovery = recovery?.scope === scope ? recovery : null;
  const bindingScope = useMemo(() => ({ scope, activeRecovery }), [scope, activeRecovery]);
  const [stored, setStored] = useState<BindingState | null>(null);
  const subscribe = useMemo(
    () => createStreamingObservationSubscriber({ endpointPath: endpoint, fetcher }),
    [endpoint, fetcher],
  );

  useEffect(() => {
    if (!key) return;
    const [credentialId, exchangeAccountId, organizationId] = JSON.parse(key) as string[];
    let stopped = false;
    let failures = 0;
    let attempts = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const publish = (status: BindingState["status"], binding: ObservationBinding | null = null) => {
      if (!stopped) setStored({ scope: bindingScope, status, binding });
    };
    const load = async () => {
      if (stopped) return;
      attempts++;
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
          setStored({ scope: bindingScope, status: "ERROR", binding: null });
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
          if (
            activeRecovery &&
            binding.credentialRevision !== activeRecovery.previous.credentialRevision
          ) {
            publish("REVOKED");
            stopped = true;
            controller.abort();
            return;
          }
          if (
            activeRecovery &&
            (binding.organizationId !== activeRecovery.previous.organizationId ||
              binding.credentialRevision !== activeRecovery.previous.credentialRevision ||
              binding.configurationRevision === activeRecovery.previous.configurationRevision)
          )
            throw new Error("BINDING_NOT_ADVANCED");
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
        if (!stopped && !accepted && (!activeRecovery || attempts < 3))
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
  }, [key, endpoint, fetcher, mode, bindingScope, activeRecovery]);

  const current = stored?.scope === bindingScope ? stored : null;
  const currentBinding = current?.binding ?? null;
  const onBindingChanged = useCallback(() => {
    if (!currentBinding) return;
    setRecovery({ scope, previous: currentBinding });
  }, [scope, currentBinding]);
  const view = useAccountObservation({
    binding: key && !historyRevoked ? (current?.binding ?? null) : null,
    subscribe,
    staleAfterMs: ACCOUNT_OBSERVATION_STALE_AFTER_MS,
    onBindingChanged,
  });
  if (historyRevoked)
    return (
      <AccountObservationPanel view={{ status: "REVOKED", observation: null, stale: false }} />
    );
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
        {!activeRecovery &&
        (current?.status === "NOT_CONFIGURED" || current?.status === "ERROR") ? (
          <p className="text-waia-fg-muted text-sm">Checking again automatically.</p>
        ) : null}
        {activeRecovery && (current?.status === "ERROR" || current?.status === "NOT_CONFIGURED") ? (
          <button type="button" onClick={() => setRecovery({ ...activeRecovery })}>
            Retry current account binding
          </button>
        ) : null}
        {current?.status !== "REVOKED" ? (
          <PendingHistoryStatus status={current?.status ?? "LOADING"} />
        ) : null}
      </div>
    );
  }
  const uid = view.observation?.htxV5?.htxUid;
  const historyKey = JSON.stringify([current.binding, uid, sessionKey]);
  return (
    <div className="space-y-4">
      <AccountObservationPanel view={view} />
      {uid && view.observation && view.status !== "REVOKED" && view.status !== "ERROR" ? (
        <FinancialHistorySection
          key={historyKey}
          binding={current.binding}
          uid={uid}
          endpoint={endpoint}
          fetcher={fetcher}
          onRevoked={onHistoryRevoked}
        />
      ) : view.status !== "REVOKED" ? (
        <PendingHistoryStatus
          status={
            view.status === "ERROR" ? "ERROR" : view.observation ? "IDENTITY_PENDING" : "LOADING"
          }
        />
      ) : null}
    </div>
  );
}
