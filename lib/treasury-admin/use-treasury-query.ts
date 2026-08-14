"use client";

import * as React from "react";

import type { TreasuryApiResult } from "@/lib/treasury-admin/types";

export function useTreasuryQuery<T>(
  enabled: boolean,
  queryKey: string,
  query: () => Promise<TreasuryApiResult<T>>,
): {
  data: T | null;
  error: { code?: string; message: string } | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [generation, setGeneration] = React.useState(0);
  const queryRef = React.useRef(query);
  queryRef.current = query;

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void queryRef.current().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        setData(null);
      } else {
        setError(null);
        setData(result.data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, generation, queryKey]);

  const reload = React.useCallback(() => {
    setLoading(true);
    setGeneration((current) => current + 1);
  }, []);

  return { data, error, loading, reload };
}
