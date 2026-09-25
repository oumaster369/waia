"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const CONTEXT_KEYS = [
  "organization_id",
  "exchange_account_id",
  "period",
  "from",
  "to",
  "tz",
  "currency",
  "mode",
] as const;
export function withConsoleContext(
  path: string,
  context: string,
  extra: Record<string, string | null> = {},
): string {
  const url = new URL(path, "http://console.local");
  const source = new URLSearchParams(context);
  for (const key of CONTEXT_KEYS) if (source.has(key)) url.searchParams.set(key, source.get(key)!);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
}
type ReadContext = {
  query: string;
  pathname: string;
  params: URLSearchParams;
  update: (patch: Record<string, string | null>) => void;
  href: (path: string, extra?: Record<string, string | null>) => string;
};
const fallback: ReadContext = {
  query: "",
  pathname: "/admin",
  params: new URLSearchParams(),
  update: () => undefined,
  href: (path, extra) => withConsoleContext(path, "", extra),
};
const Context = React.createContext<ReadContext>(fallback);
const scrollPositions = new Map<string, number>();
export function AdminReadContextProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const query = React.useMemo(() => {
    const input = new URLSearchParams(search);
    const result = new URLSearchParams();
    for (const key of CONTEXT_KEYS) if (input.has(key)) result.set(key, input.get(key)!);
    if (!result.has("tz")) result.set("tz", "Europe/Moscow");
    if (!result.has("period")) result.set("period", "7d");
    if (!result.has("currency")) result.set("currency", "USDT");
    if (!result.has("mode")) result.set("mode", "live");
    return result.toString();
  }, [search]);
  const identity = `${pathname}?${search}`;
  const [scrollRevision, requestScrollRestore] = React.useReducer((value: number) => value + 1, 0);
  const pendingScroll = React.useRef<{ key: string; position: number } | null>(null);
  React.useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const restore = () => {
      const key = `${window.location.pathname}?${window.location.search.slice(1)}`;
      const position = scrollPositions.get(key);
      pendingScroll.current = position === undefined ? null : { key, position };
      requestScrollRestore();
    };
    window.addEventListener("popstate", restore);
    return () => {
      window.history.scrollRestoration = previous;
      window.removeEventListener("popstate", restore);
    };
  }, []);
  React.useEffect(() => {
    const remember = () => {
      if (pendingScroll.current) return;
      scrollPositions.set(identity, window.scrollY);
      if (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value!);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("scroll", remember);
    };
  }, [identity]);
  React.useEffect(() => {
    const target = pendingScroll.current;
    if (!target || target.key !== identity) return;
    let frame = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (pendingScroll.current === target) pendingScroll.current = null;
    };
    const restore = () => {
      if (stopped) return;
      // A streamed list can still be loading after the URL has changed. Wait until
      // its content is tall enough instead of losing the saved position at zero.
      if (document.documentElement.scrollHeight - window.innerHeight < target.position) return;
      window.scrollTo(0, target.position);
      if (Math.abs(window.scrollY - target.position) < 2) stop();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    });
    observer.observe(document.body);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore);
    });
    const timeout = window.setTimeout(stop, 10_000);
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });
    return () => {
      stop();
      clearTimeout(timeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [identity, scrollRevision]);
  const update = React.useCallback(
    (patch: Record<string, string | null>) => {
      pendingScroll.current = null;
      scrollPositions.set(identity, window.scrollY);
      const params = new URLSearchParams(search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if ("organization_id" in patch && !("exchange_account_id" in patch))
        params.delete("exchange_account_id");
      if (
        Object.keys(patch).some(
          (key) => CONTEXT_KEYS.includes(key as (typeof CONTEXT_KEYS)[number]) || key === "tab",
        )
      ) {
        params.delete("sel");
        params.delete("detail");
        params.delete("cursor");
      }
      router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    },
    [identity, search, pathname, router],
  );
  const value = React.useMemo<ReadContext>(
    () => ({
      query,
      pathname,
      params: new URLSearchParams(search),
      update,
      href: (path, extra) => withConsoleContext(path, query, extra),
    }),
    [query, pathname, search, update],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdminReadContext(): ReadContext {
  return React.useContext(Context);
}
