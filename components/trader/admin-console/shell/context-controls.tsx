"use client";
import * as React from "react";
import { CalendarDays, SlidersHorizontal } from "lucide-react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { controlClass } from "@/components/trader/admin-console/primitives/console-ui";

export type ConsoleCatalogue = {
  clients: { id: string; name: string }[];
  clientsTotal: number;
  accounts: { organizationId: string; exchangeAccountId: string; venue: string }[];
  accountsTruncated: boolean;
  release: { state: string; sha?: string; reason?: string };
};
export function ContextControls({ catalogue }: { catalogue: ConsoleCatalogue | null }) {
  const { query, update } = useAdminReadContext();
  const params = new URLSearchParams(query);
  const org = params.get("organization_id") ?? "";
  const account = params.get("exchange_account_id") ?? "";
  const [custom, setCustom] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const accounts = catalogue?.accounts.filter((item) => item.organizationId === org) ?? [];
  // Multiple keys of one venue/account have already been collapsed by the identity catalogue.
  const uniqueAccounts = [
    ...new Map(accounts.map((item) => [item.exchangeAccountId, item])).values(),
  ];
  return (
    <div className="border-waia-divider bg-waia-field-mid/40 border-b px-4 py-3 lg:px-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-waia-fg-muted hidden h-9 items-center gap-2 pr-1 text-xs xl:flex">
          <SlidersHorizontal size={14} aria-hidden="true" />
          Охват
        </div>
        <label className="text-waia-fg-muted grid gap-1 text-[11px]">
          Клиент
          <select
            aria-label="Охват: клиент"
            className={`${controlClass} w-48`}
            value={org}
            onChange={(event) => update({ organization_id: event.target.value || null })}
          >
            <option value="">Весь парк</option>
            {org && !catalogue?.clients.some((item) => item.id === org) ? (
              <option value={org}>Клиент {org}</option>
            ) : null}
            {catalogue?.clients.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name || item.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-waia-fg-muted grid gap-1 text-[11px]">
          Биржевой счёт
          <select
            aria-label="Охват: счёт"
            className={`${controlClass} w-44`}
            disabled={!org}
            value={account}
            onChange={(event) => update({ exchange_account_id: event.target.value || null })}
          >
            <option value="">{org ? "Все счета клиента" : "Сначала выберите клиента"}</option>
            {account && !uniqueAccounts.some((item) => item.exchangeAccountId === account) ? (
              <option value={account}>{account}</option>
            ) : null}
            {uniqueAccounts.map((item) => (
              <option value={item.exchangeAccountId} key={item.exchangeAccountId}>
                {item.venue.toUpperCase()} · {item.exchangeAccountId}
              </option>
            ))}
          </select>
        </label>
        <label className="text-waia-fg-muted grid gap-1 text-[11px]">
          Период · МСК
          <select
            aria-label="Период"
            className={controlClass}
            value={custom ? "custom" : (params.get("period") ?? "7d")}
            onChange={(event) => {
              if (event.target.value === "custom") {
                setCustom(true);
                return;
              }
              setCustom(false);
              update({ period: event.target.value, from: null, to: null, tz: "Europe/Moscow" });
            }}
          >
            <option value="today">Сегодня</option>
            <option value="7d">7 дней</option>
            <option value="30d">30 дней</option>
            <option value="90d">90 дней</option>
            <option value="custom">Свой период</option>
          </select>
        </label>
        <label className="text-waia-fg-muted grid gap-1 text-[11px]">
          Валюта
          <select
            aria-label="Валюта"
            className={controlClass}
            value={params.get("currency") ?? "USDT"}
            onChange={(event) => update({ currency: event.target.value })}
          >
            <option>USDT</option>
            <option>USD</option>
          </select>
        </label>
        <fieldset className="ml-auto">
          <legend className="text-waia-fg-muted mb-1 text-[11px]">Контур данных</legend>
          <div className="border-waia-rim flex h-9 rounded-lg border p-0.5">
            {[
              ["live", "Live"],
              ["paper", "Paper"],
              ["history", "History"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={params.get("mode") === id}
                className={`focus-visible:ring-waia-accent-cool rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 ${params.get("mode") === id ? "bg-waia-elevated text-waia-fg" : "text-waia-fg-muted hover:text-waia-fg"}`}
                onClick={() => update({ mode: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {custom ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const start = new Date(`${from}:00+03:00`);
            const end = new Date(`${to}:00+03:00`);
            if (
              !Number.isFinite(start.getTime()) ||
              !Number.isFinite(end.getTime()) ||
              start >= end
            ) {
              setError("Начало периода должно быть раньше окончания.");
              return;
            }
            update({
              period: "custom",
              from: start.toISOString(),
              to: end.toISOString(),
              tz: "Europe/Moscow",
            });
            setCustom(false);
            setError(null);
          }}
        >
          <label className="grid gap-1 text-xs">
            С · МСК
            <input
              type="datetime-local"
              className={controlClass}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1 text-xs">
            До · МСК
            <input
              type="datetime-local"
              className={controlClass}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </label>
          <button className={`${controlClass} inline-flex items-center gap-2`} type="submit">
            <CalendarDays size={14} />
            Применить
          </button>
          {error ? (
            <p role="alert" className="text-waia-warning text-sm">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {catalogue &&
      (catalogue.clients.length < catalogue.clientsTotal || catalogue.accountsTruncated) ? (
        <p className="text-waia-warning mt-2 text-xs">
          Список выбора ограничен: клиентов {catalogue.clients.length}/{catalogue.clientsTotal};
          полную выборку откройте в разделе «Клиенты».
        </p>
      ) : null}
    </div>
  );
}
