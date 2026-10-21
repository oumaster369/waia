"use client";

import { useEffect, useRef, useState } from "react";
import {
  assertFinancialHistoryResponse,
  financialHistoryResponseSchema,
  FINANCIAL_HISTORY_LIMITS,
  type FinancialHistoryResponse,
  type FinancialHistoryRequest,
} from "@/lib/trader/account-observation/financial-history";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import { readBoundedObservationJson } from "./polling-subscriber";

export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_MAX_ROWS = 200;
export const HISTORY_MAX_PAGES = 10;
type State = {
  status: "LOADING" | "READY" | "UNAVAILABLE" | "ERROR" | "REVOKED";
  data: FinancialHistoryResponse | null;
  loadingMore: boolean;
  capped: boolean;
  receivedAt: number | null;
};
const initial: State = {
  status: "LOADING",
  data: null,
  loadingMore: false,
  capped: false,
  receivedAt: null,
};

/** The owning component MUST remount on binding, UID, session or transport changes. */
export function useFinancialHistory({
  binding,
  uid,
  endpoint,
  fetcher,
  onRevoked,
  filters,
}: {
  binding: ObservationBinding;
  uid: string;
  endpoint: "/api/trader/account-observation" | "/api/trader/admin/account-observation";
  fetcher: typeof fetch;
  onRevoked: () => void;
  filters: FinancialHistoryRequest["filters"];
}) {
  const { windowStartMs, windowEndMs } = filters;
  const [state, setState] = useState<State>(initial);
  const actions = useRef<{ refresh: () => void; more: () => void } | null>(null);
  useEffect(() => {
    let stopped = false,
      revoked = false,
      busy = false,
      pages = 0;
    let data: FinancialHistoryResponse | null = null;
    let request: AbortController | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cursors = new Set<string>();
    const capped = () =>
      pages >= HISTORY_MAX_PAGES ||
      (data?.records.length ?? 0) >= HISTORY_MAX_ROWS ||
      (data?.coverage.length ?? 0) >= HISTORY_MAX_ROWS;
    const publish = (next: State) => {
      if (!stopped) setState(next);
    };
    const clear = (status: State["status"]) => {
      data = null;
      publish({ ...initial, status });
    };
    const load = async (more: boolean) => {
      if (stopped || revoked || busy || (more && (!data?.nextCursor || capped()))) return;
      busy = true;
      const cursor = more ? data!.nextCursor : null;
      if (!more) {
        data = null;
        pages = 0;
        cursors.clear();
      }
      publish({ ...initial, data, loadingMore: more, status: more ? "READY" : "LOADING" });
      const controller = new AbortController();
      request = controller;
      deadline = setTimeout(() => {
        controller.abort();
        clear("UNAVAILABLE");
        // Keep busy until even an abort-ignoring fetch settles: no overlapping requests.
      }, 7_000);
      try {
        const params = new URLSearchParams({
          credentialId: binding.credentialId,
          exchangeAccountId: binding.exchangeAccountId,
          pageSize: String(HISTORY_PAGE_SIZE),
        });
        if (endpoint.includes("/admin/")) params.set("organizationId", binding.organizationId);
        if (windowStartMs !== null) params.set("windowStartMs", String(windowStartMs));
        if (windowEndMs !== null) params.set("windowEndMs", String(windowEndMs));
        if (cursor) params.set("cursor", cursor);
        const response = await fetcher(`${endpoint}/financial-history?${params}`, {
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
          revoked = true;
          clear("REVOKED");
          controller.abort();
          onRevoked();
          return;
        }
        if (response.status === 204 || response.status === 503) {
          clear("UNAVAILABLE");
          return;
        }
        if (!response.ok) throw new Error("HISTORY_UNAVAILABLE");
        const page = financialHistoryResponseSchema.parse(
          await readBoundedObservationJson(
            response,
            controller.signal,
            FINANCIAL_HISTORY_LIMITS.responseBytes,
          ),
        );
        if (stopped || controller.signal.aborted) return;
        assertFinancialHistoryResponse(
          {
            binding,
            pageSize: HISTORY_PAGE_SIZE,
            cursor,
            filters: { windowStartMs, windowEndMs },
          },
          page,
        );
        if (
          page.htxUid !== uid ||
          (page.nextCursor && (page.nextCursor === cursor || cursors.has(page.nextCursor)))
        )
          throw new Error("HISTORY_CONTEXT");
        const merge = <T>(previous: T[], incoming: T[], key: (row: T) => string): T[] => {
          const rows = new Map(previous.map((row) => [key(row), row]));
          for (const row of incoming) {
            const prior = rows.get(key(row));
            if (prior && JSON.stringify(prior) !== JSON.stringify(row))
              throw new Error("HISTORY_CONFLICT");
            rows.set(key(row), row);
          }
          if (rows.size > HISTORY_MAX_ROWS) throw new Error("HISTORY_LIMIT");
          return [...rows.values()];
        };
        data = {
          ...page,
          records: merge(data?.records ?? [], page.records, (row) => row.bill.id),
          coverage: merge(
            data?.coverage ?? [],
            page.coverage,
            (row) => row.provenance.observationId,
          ),
        };
        pages++;
        if (cursor) cursors.add(cursor);
        publish({
          status: "READY",
          data,
          loadingMore: false,
          capped: capped(),
          receivedAt: Date.now(),
        });
      } catch {
        if (!stopped && !controller.signal.aborted) clear("ERROR");
      } finally {
        clearTimeout(deadline);
        request = null;
        busy = false;
      }
    };
    actions.current = {
      refresh: () => {
        void load(false);
      },
      more: () => {
        void load(true);
      },
    };
    void Promise.resolve().then(() => {
      if (!stopped) void load(false);
    });
    return () => {
      stopped = true;
      clearTimeout(deadline);
      request?.abort();
      actions.current = null;
    };
  }, [binding, uid, endpoint, fetcher, onRevoked, windowStartMs, windowEndMs]);
  return {
    ...state,
    refresh: () => actions.current?.refresh(),
    loadMore: () => actions.current?.more(),
  };
}
