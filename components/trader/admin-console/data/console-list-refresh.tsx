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
    let generation = 0;
    let timer = 0;
    let controller: AbortController | null = null;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const request = ++generation;
      controller = new AbortController();
      void fetch(url, { signal: controller.signal })
        .then(async (response) => response.json() as Promise<ConsoleListBody<T>>)
        .then((body) => {
          if (stopped || request !== generation) return;
          const parsed = consoleListFromBody(body);
          if (parsed.ok) {
            setItems(parsed.items);
            setReason(null);
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
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(load, CONSOLE_LIST_REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.clearInterval(timer);
        controller?.abort();
        return;
      }
      load();
      start();
    };
    load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      generation += 1;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url]);
  return { items, reason };
}
