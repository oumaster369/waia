"use client";
import * as React from "react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import type { AdminReadEnvelope } from "@/lib/trader/admin-console/contracts";

export function useAdminRead<T>(
  path: string | null,
  options: { intervalMs?: number; context?: boolean } = {},
) {
  const context = useAdminReadContext();
  const url = path === null ? null : options.context === false ? path : context.href(path);
  const [result, setResult] = React.useState<{
    key: string;
    envelope: AdminReadEnvelope<T> | null;
    reason: string | null;
    refreshing: boolean;
  }>({ key: "", envelope: null, reason: null, refreshing: false });
  const [refresh, reload] = React.useReducer((n: number) => n + 1, 0);
  const interval = options.intervalMs ?? 15_000;
  React.useEffect(() => {
    if (!url) return;
    let stopped = false;
    let revision = 0;
    let controller: AbortController | null = null;
    const read = async () => {
      if (document.visibilityState === "hidden") return;
      const request = ++revision;
      setResult((current) => ({
        key: url,
        envelope: current.key === url ? current.envelope : null,
        reason: current.key === url ? current.reason : null,
        refreshing: true,
      }));
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (stopped || request !== revision) return;
        if (response.status === 401 || response.status === 403) {
          notifyAdminAccessRevoked();
          setResult({ key: url, envelope: null, reason: "FORBIDDEN", refreshing: false });
          return;
        }
        const body = await response.json();
        if (stopped || request !== revision) return;
        if (!response.ok) throw new Error(body.error?.code ?? `ADMIN_HTTP_${response.status}`);
        if (body.schemaVersion !== "admin-console/v1") throw new Error("ADMIN_RESPONSE_INVALID");
        const requested = new URL(url, window.location.origin).searchParams;
        const organizationId = requested.get("organization_id");
        const accountId = requested.get("exchange_account_id");
        const unavailable =
          body.data?.state === "unavailable" || body.data?.state === "not_applicable";
        const schemaGuard =
          unavailable &&
          ["POSTGRES_REQUIRED", "ADMIN_CONSOLE_SCHEMA_NOT_APPLIED"].includes(
            body.data?.reasons?.[0],
          ) &&
          Object.keys(body.data).every((key) => key === "state" || key === "reasons");
        if (
          !schemaGuard &&
          options.context !== false &&
          (body.scope?.kind !==
            (accountId ? "account" : organizationId ? "organization" : "fleet") ||
            (body.scope?.organizationId ?? null) !== organizationId ||
            (body.scope?.exchangeAccountId ?? null) !== accountId)
        )
          throw new Error("ADMIN_SCOPE_MISMATCH");
        if (
          !schemaGuard &&
          options.context !== false &&
          requested.has("mode") &&
          body.mode !== requested.get("mode")
        )
          throw new Error("ADMIN_MODE_MISMATCH");
        const reason =
          body.data?.state === "unavailable" || body.data?.state === "not_applicable"
            ? (body.data.reasons?.[0] ?? "SOURCE_UNAVAILABLE")
            : null;
        setResult({ key: url, envelope: body, reason, refreshing: false });
        window.dispatchEvent(
          new CustomEvent("waia:admin-read", {
            detail: {
              url,
              generatedAt: body.generatedAt,
              coverage: body.coverage,
              financeRevision: body.financeRevision,
              observedAt:
                body.data?.finance?.equity?.times?.observedAt ??
                body.data?.aggregate?.finance?.equity?.times?.observedAt ??
                null,
            },
          }),
        );
      } catch (error) {
        if (
          stopped ||
          request !== revision ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setResult((current) => ({
          key: url,
          envelope: current.key === url ? current.envelope : null,
          reason:
            error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "ADMIN_NETWORK_UNAVAILABLE",
          refreshing: false,
        }));
      }
    };
    void read();
    const timer = interval > 0 ? window.setInterval(() => void read(), interval) : null;
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [url, interval, refresh, options.context]);
  const current = result.key === url ? result : { envelope: null, reason: null, refreshing: false };
  return { ...current, loading: url !== null && !current.envelope && !current.reason, reload, url };
}
