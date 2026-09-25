"use client";
import * as React from "react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { EvidenceTime } from "@/components/trader/admin-console/primitives/console-ui";
import type { ConsoleCatalogue } from "@/components/trader/admin-console/shell/context-controls";
type Status = "STREAMING" | "POLLING" | "RECONNECTING" | "OFFLINE";
export function StatusBar({
  p95Ms,
  release,
}: {
  p95Ms?: number | null;
  release?: ConsoleCatalogue["release"];
}) {
  const { query } = useAdminReadContext();
  const [stream, setStream] = React.useState<Status>("POLLING");
  const [finance, setFinance] = React.useState<{
    query: string;
    observedAt: string | null;
    included: number;
    total: number;
  } | null>(null);
  React.useEffect(() => {
    const online = () => setStream(navigator.onLine ? "POLLING" : "OFFLINE");
    const transport = (event: Event) =>
      setStream((event as CustomEvent<{ status: Status }>).detail.status);
    const read = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          url: string;
          financeRevision?: string;
          observedAt?: string | null;
          coverage?: { included: number; total: number };
        }>
      ).detail;
      if (!detail.financeRevision || !detail.coverage) return;
      const source = new URL(detail.url, window.location.origin).searchParams;
      const expected = new URLSearchParams(query);
      if ([...expected].some(([key, value]) => source.get(key) !== value)) return;
      setFinance({ query, observedAt: detail.observedAt ?? null, ...detail.coverage });
    };
    online();
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    window.addEventListener("waia:admin-transport", transport);
    window.addEventListener("waia:admin-read", read);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      window.removeEventListener("waia:admin-transport", transport);
      window.removeEventListener("waia:admin-read", read);
    };
  }, [query]);
  const current = finance?.query === query ? finance : null;
  return (
    <div
      aria-label="Состояние данных"
      className="border-waia-divider text-waia-fg-muted flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-[10px] lg:px-8"
    >
      <span className="inline-flex items-center gap-2 font-medium tracking-wider">
        <span
          className={`h-1.5 w-1.5 rounded-full ${stream === "OFFLINE" ? "bg-waia-warning" : stream === "STREAMING" ? "bg-waia-success" : "bg-waia-fg-muted"}`}
        />
        {stream}
      </span>
      <span>
        {current
          ? `Финансовый охват ${current.included}/${current.total}`
          : "Финансовый охват: нет снимка"}
      </span>
      {current?.observedAt ? <EvidenceTime at={current.observedAt} label="Наблюдения от" /> : null}
      <span title="Измеряется после отображения данных; без достоверного измерения значение не показывается.">
        {p95Ms == null ? "p95: нет измерения" : `p95: ${p95Ms} мс`}
      </span>
      <span
        className="ml-auto"
        title={
          release?.sha
            ? `${release.sha} · совпадение с деплоем не подтверждено`
            : "WAIA_RELEASE_SHA_NOT_SET"
        }
      >
        {release?.sha
          ? `Релиз ${release.sha.slice(0, 8)} · не подтверждён`
          : "Релиз: не установлен"}
      </span>
    </div>
  );
}
