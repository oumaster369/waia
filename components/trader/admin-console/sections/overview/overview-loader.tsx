"use client";

import * as React from "react";

import {
  OverviewPanel,
  overviewFromEnvelope,
  type OverviewView,
} from "@/components/trader/admin-console/sections/overview/overview-panel";

export function OverviewLoader() {
  const [view, setView] = React.useState<OverviewView | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/overview", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          const code =
            body && typeof body === "object" && "error" in body
              ? (body as { error?: { code?: string } }).error?.code
              : null;
          return overviewFromEnvelope({
            data: { state: "unavailable", reasons: [code ?? "OVERVIEW_HTTP"] },
          });
        }
        return overviewFromEnvelope(body);
      })
      .then(setView)
      .catch(() =>
        setView(
          overviewFromEnvelope({ data: { state: "unavailable", reasons: ["POSTGRES_REQUIRED"] } }),
        ),
      );
    return () => controller.abort();
  }, []);
  if (!view) return <p>Загрузка</p>;
  return <OverviewPanel view={view} />;
}
