"use client";

import * as React from "react";

import type { TreasuryApiResult } from "@/lib/treasury-admin/types";

type QueryError = { code?: string; message: string };

type Settled<T> = {
  requestId: string;
  data: T | null;
  error: QueryError | null;
};

export function useTreasuryQuery<T>(
  enabled: boolean,
  queryKey: string,
  query: () => Promise<TreasuryApiResult<T>>,
): {
  data: T | null;
  error: QueryError | null;
  loading: boolean;
  reload: () => void;
} {
  const [generation, setGeneration] = React.useState(0);
  const [settled, setSettled] = React.useState<Settled<T>>({
    requestId: "",
    data: null,
    error: null,
  });
  const requestId = `${enabled ? "1" : "0"}:${queryKey}:${String(generation)}`;
  const queryRef = React.useRef(query);

  React.useEffect(() => {
    queryRef.current = query;
  });

  React.useEffect(() => {
    if (!enabled) return;
    const activeRequestId = requestId;
    let cancelled = false;
    void queryRef
      .current()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setSettled({
            requestId: activeRequestId,
            data: null,
            error: { code: result.code, message: result.message },
          });
          return;
        }
        setSettled({
          requestId: activeRequestId,
          data: result.data,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSettled({
          requestId: activeRequestId,
          data: null,
          error: {
            code: "REQUEST_FAILED",
            message: cause instanceof Error ? cause.message : "Request failed.",
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, requestId]);

  const reload = React.useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  const loading = enabled && settled.requestId !== requestId;
  return {
    data: loading ? null : settled.data,
    error: loading ? null : settled.error,
    loading,
    reload,
  };
}
