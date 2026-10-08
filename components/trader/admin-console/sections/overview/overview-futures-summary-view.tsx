import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { ConsolePanel } from "@/components/trader/admin-console/primitives/console-ui";
import type {
  OverviewFuturesExclusion,
  summarizeOverviewFutures,
} from "@/lib/trader/account-observation/overview-futures-summary";

type Summary = ReturnType<typeof summarizeOverviewFutures>;

const EXCLUSION_COPY: Record<OverviewFuturesExclusion, string> = {
  DIRECTORY_STALE: "Список счетов не удалось обновить",
  IDENTITY_UNAVAILABLE: "Не удалось проверить принадлежность счета",
  DUPLICATE_IDENTITY: "Счет совпадает с другой записью",
  OBSERVATION_UNAVAILABLE: "Текущие данные счета недоступны",
  FUTURES_UNAVAILABLE: "Баланс фьючерсов недоступен",
  TIME_INVALID: "Время последнего чтения неизвестно",
  STALE: "Данные устарели",
  AMOUNT_UNSUPPORTED: "Не удалось точно прочитать сумму",
};

function card(label: string, amount: string | null, summary: Summary) {
  const partial = summary.state === "partial";
  return (
    <div className="border-waia-divider bg-waia-field-mid min-w-0 rounded-xl border p-5">
      <p className="text-waia-fg-muted text-xs">{label}</p>
      <p className="mt-4 text-xl font-semibold tracking-tight break-words tabular-nums">
        {amount === null ? "—" : formatAdminMoney(amount, "").trim()}
        {amount !== null ? (
          <span className="text-waia-fg-muted mt-1 block text-xs font-normal tracking-normal">
            USD
          </span>
        ) : null}
      </p>
      {partial && amount !== null ? (
        <p className="text-waia-warning mt-3 text-xs">Известная часть</p>
      ) : null}
    </div>
  );
}

export function OverviewFuturesSummaryView({
  summary,
  unavailableReason,
}: {
  summary: Summary | null;
  unavailableReason?: string;
}) {
  const values = summary ?? {
    state: "unavailable" as const,
    currency: "USD" as const,
    equityUsd: null,
    availableMarginUsd: null,
    profitUnrealUsd: null,
    included: 0,
    total: 0,
    oldestReadCompletedAtMs: null,
    excluded: [],
  };
  const description =
    unavailableReason ??
    (values.state === "partial"
      ? "Показана известная часть по свежим снимкам; это не результат выбранного периода."
      : values.state === "complete"
        ? "Текущий снимок по подключённым счетам HTX; нереализованный результат не относится к выбранному периоду."
        : values.state === "empty"
          ? "В этом охвате пока нет подключённых счетов HTX."
          : "Нет полного актуального снимка по счетам в выбранном охвате.");
  const observedAt =
    values.oldestReadCompletedAtMs === null
      ? null
      : new Date(values.oldestReadCompletedAtMs).toLocaleString("ru-RU");

  return (
    <ConsolePanel title="Фьючерсы" note="Текущие наблюдения HTX · USD">
      <div className="space-y-4 p-4">
        <p className="text-waia-fg-muted text-sm">{description}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {card("Капитал фьючерсов", values.equityUsd, values)}
          {card("Доступная маржа фьючерсов", values.availableMarginUsd, values)}
          {card("Нереализованный результат фьючерсов", values.profitUnrealUsd, values)}
        </div>
        {summary ? (
          <div className="text-waia-fg-muted flex flex-wrap justify-between gap-2 px-1 text-xs">
            <p>
              Снимки учтены: {values.included} из {values.total}
            </p>
            {observedAt ? <p>Самое раннее чтение: {observedAt}</p> : null}
          </div>
        ) : null}
        {values.excluded.length > 0 ? (
          <ul className="text-waia-fg-muted space-y-1 text-xs" aria-label="Исключённые счета">
            {values.excluded.map((item) => (
              <li key={`${item.exchangeAccountId}:${item.reason}`}>
                Счёт {item.exchangeAccountId}: {EXCLUSION_COPY[item.reason]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ConsolePanel>
  );
}
