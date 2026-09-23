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
    void fetch("/api/trader/admin/console/overview", { signal: controller.signal })
      .then(async (response) => overviewFromEnvelope(await response.json()))
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
