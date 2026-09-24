"use client";

import * as React from "react";

import {
  CONSOLE_LIST_REFRESH_MS,
  consoleListFromBody,
  type ConsoleListBody,
} from "@/components/trader/admin-console/data/console-list";

export function useConsoleList<T>(url: string): { items: T[] | null; reason: string | null } {
  const [items, setItems] = React.useState<T[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    let stopped = false;
    const load = () => {
      void fetch(url)
        .then(async (response) => response.json() as Promise<ConsoleListBody<T>>)
        .then((body) => {
          if (stopped) return;
          const parsed = consoleListFromBody(body);
          if (parsed.ok) {
            setItems(parsed.items);
            setReason(null);
            return;
          }
          setReason(parsed.reason);
        })
        .catch(() => {
          if (!stopped) setReason("POSTGRES_REQUIRED");
        });
    };
    load();
    const timer = window.setInterval(load, CONSOLE_LIST_REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [url]);
  return { items, reason };
}
