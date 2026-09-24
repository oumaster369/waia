"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { AdminAuditPanel } from "@/components/trader/admin/admin-audit-panel";
import { AdminRuntimeAuthorityPanel } from "@/components/trader/admin/admin-runtime-authority-panel";
import { RU } from "@/components/trader/admin-console/i18n/ru";
import { GovernedProcessLinks } from "@/components/trader/admin-console/shell/governed-links";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { AdminTimeSeriesChart } from "@/components/trader/admin-console/primitives/time-series-chart";

type SystemBody = {
  release?: { state: string; reason?: string; sha?: string };
  missedMinuteJobs?: string[];
  researchReasoning?: { reason?: string };
};

export default function AdminSystemPage() {
  const tab = useSearchParams().get("tab");
  const [body, setBody] = React.useState<SystemBody | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/system", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{ data?: SystemBody & { reasons?: string[] } }>,
      )
      .then((payload) => {
        if (payload.data && payload.data.release) {
          setBody(payload.data);
          return;
        }
        setReason(payload.data?.reasons?.[0] ?? "POSTGRES_REQUIRED");
      })
      .catch(() => setReason("POSTGRES_REQUIRED"));
    return () => controller.abort();
  }, []);
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-semibold">{RU.sections.system}</h2>
      {tab === "audit" ? <AdminAuditPanel /> : null}
      {tab === "controls" ? <AdminRuntimeAuthorityPanel /> : null}
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {body?.release?.state === "value" && body.release.sha ? (
        <p>{`Релиз ${body.release.sha} задан переменной и не подтверждён.`}</p>
      ) : null}
      {body?.release && body.release.state !== "value" ? (
        <DataState state="unavailable" reason={body.release.reason ?? "WAIA_RELEASE_SHA_NOT_SET"} />
      ) : null}
      {body?.researchReasoning ? (
        <p>Записи исследовательского контура из консоли недоступны.</p>
      ) : null}
      {body?.missedMinuteJobs && body.missedMinuteJobs.length > 0 ? (
        <p>{`Пропущенные минутные задания: ${body.missedMinuteJobs.join(", ")}`}</p>
      ) : null}
      <AdminTimeSeriesChart />
      <GovernedProcessLinks section="system" />
    </section>
  );
}
