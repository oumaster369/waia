import type { HtxV5BillsObservation } from "@/lib/trader/account-observation/types";
import type { HtxV5BillCategory } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";

const CATEGORY_COPY: Readonly<Record<HtxV5BillCategory, string>> = {
  CLOSE_LONG: "закрытие длинной позиции",
  CLOSE_SHORT: "закрытие короткой позиции",
  OPEN_FEE_TAKER: "комиссия за открытие (taker)",
  OPEN_FEE_MAKER: "комиссия за открытие (maker)",
  CLOSE_FEE_TAKER: "комиссия за закрытие (taker)",
  CLOSE_FEE_MAKER: "комиссия за закрытие (maker)",
  DELIVERY_CLOSE_LONG: "расчёт длинной позиции",
  DELIVERY_CLOSE_SHORT: "расчёт короткой позиции",
  DELIVERY_FEE: "комиссия за расчёт",
  LIQUIDATION_CLOSE_LONG: "закрытие при ликвидации (лонг)",
  LIQUIDATION_CLOSE_SHORT: "закрытие при ликвидации (шорт)",
  SPOT_TO_CONTRACT_TRANSFER: "перевод со спота в контрактный счёт",
  CONTRACT_TO_SPOT_TRANSFER: "перевод с контрактного счёта на спот",
  UNREALIZED_SETTLEMENT_LONG: "расчёт результата (лонг)",
  UNREALIZED_SETTLEMENT_SHORT: "расчёт результата (шорт)",
  CLAWBACK: "корректировка биржи",
  SYSTEM: "системная запись",
  ACTIVITY_REWARD: "награда за активность",
  REBATE: "возврат комиссии",
  FUNDING_INCOME: "поступление финансирования",
  FUNDING_EXPENDITURE: "списание финансирования",
  TRANSFER_TO_SUB: "перевод на субсчёт",
  TRANSFER_FROM_SUB: "перевод с субсчёта",
  TRANSFER_TO_MASTER: "перевод на основной счёт",
  TRANSFER_FROM_MASTER: "перевод с основного счёта",
  TRANSFER_FROM_MARGIN_ACCOUNT: "перевод с маржинального счёта",
  TRANSFER_TO_MARGIN_ACCOUNT: "перевод на маржинальный счёт",
  SYSTEM_ADVANCE_TRANSFER_OUT: "системный перевод наружу",
  SYSTEM_ADVANCE_TRANSFER_IN: "системный перевод внутрь",
  ADL_CLOSE_LONG: "автоматическое сокращение позиции (лонг)",
  ADL_CLOSE_SHORT: "автоматическое сокращение позиции (шорт)",
  LIQUIDATION_FEE: "комиссия за ликвидацию",
  UNKNOWN: "неизвестная категория",
};

const ERROR_COPY: Readonly<Record<string, string>> = {
  TIMEOUT: "Чтение финансовых записей не завершилось вовремя.",
  RATE_LIMITED: "Биржа временно ограничила чтение финансовых записей.",
  PERMISSION_DENIED: "У ключа нет подтверждённого разрешения на это чтение.",
  READ_FAILED: "Не удалось прочитать финансовые записи.",
  INVALID_RESPONSE: "Ответ финансовых записей не прошёл проверку.",
  IDENTITY_MISMATCH: "Не удалось подтвердить привязку счёта для этого чтения.",
};

function utcTime(value: number): string {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? `${new Date(value).toISOString().replace("T", " ").replace("Z", " UTC")}`
    : "Недоступно";
}

function stale(observation: HtxV5BillsObservation, inheritedStale: boolean, nowMs: number) {
  const completedAt = observation.readCompletedAtMs;
  return (
    inheritedStale ||
    (completedAt !== null &&
      completedAt <= nowMs &&
      nowMs - completedAt >= ACCOUNT_OBSERVATION_STALE_AFTER_MS)
  );
}

export function HtxV5BillsSection({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5BillsObservation | null;
  inheritedStale: boolean;
  nowMs: number;
}) {
  return (
    <section aria-label="Финансовые записи HTX" className="border-border space-y-3 rounded-lg border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Финансовые записи HTX</h3>
        <span className="text-muted-foreground text-xs">
          {observation === null
            ? "не настроено"
            : observation.status === "UNAVAILABLE"
              ? "недоступно"
              : observation.status === "ERROR"
                ? "ошибка"
                : "частичные данные · полнота неизвестна"}
        </span>
      </header>
      {observation === null ? (
        <p className="text-sm">Чтение финансовых записей не настроено.</p>
      ) : (
        <>
          {observation.status === "UNAVAILABLE" ? (
            <p role="status" className="text-sm">
              {observation.unavailableReason === "SCOPE_EXPIRED"
                ? "Срок разрешённого периода чтения финансовых записей истёк. Обновление баланса продолжается."
                : "Разрешённый период чтения финансовых записей ещё не начался. Обновление баланса продолжается."}
            </p>
          ) : null}
          {observation.status === "ERROR" ? (
            <p role="alert" className="text-sm">
              {observation.error ? ERROR_COPY[observation.error] : "Финансовые записи недоступны."}
            </p>
          ) : null}
          {observation.status === "PARTIAL" ? (
            <>
              {stale(observation, inheritedStale, nowMs) ? (
                <p role="status" className="text-sm">
                  Показаны последние полученные данные; они устарели, их актуальность не подтверждена.
                </p>
              ) : null}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Запрошенный период (UTC)</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    [{utcTime(observation.windowStartMs)}, {utcTime(observation.windowEndMs)})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Ответ получен (UTC)</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {observation.responseReceivedAtMs === null
                      ? "Недоступно"
                      : utcTime(observation.responseReceivedAtMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Покрытие истории</dt>
                  <dd>Частичное; полнота неизвестна</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Получено записей / страниц</dt>
                  <dd>
                    {observation.values === null ? "Недоступно" : observation.values.length} / {observation.pageScope === null ? "Недоступно" : observation.pageScope.pagesRead}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground text-xs">
                Показаны только записи, полученные в одном ограниченном запросе. Это не полная история,
                не итог за день и не расчёт комиссий, финансирования или прибыли. Суммы сохранены со
                знаком из ответа HTX без преобразования. Сами записи не подтверждают полноту истории
                или привязку счёта.
              </p>
              {observation.groups !== null && observation.groups.length > 0 ? (
                <div className="min-w-0">
                  <table className="block w-full border-collapse text-left text-sm md:table">
                    <caption className="sr-only">Полученные суммы по валюте и типу записи</caption>
                    <thead className="hidden md:table-header-group">
                      <tr className="border-border border-b text-muted-foreground text-xs">
                        <th scope="col" className="py-2 pr-3 font-medium">Валюта</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Тип / категория</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">Записей</th>
                        <th scope="col" className="py-2 text-right font-medium">Полученная сумма</th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group">
                      {observation.groups.map((group, index) => (
                        <tr key={`${group.currency}-${group.type}-${index}`} className="border-border grid gap-2 border-b py-3 last:border-0 md:table-row md:py-0">
                          <td className="min-w-0 break-all font-mono md:py-2 md:pr-3">{group.currency}</td>
                          <td className="min-w-0 break-words md:py-2 md:pr-3">
                            <span className="font-mono">{group.type}</span>
                            <span className="text-muted-foreground"> · {CATEGORY_COPY[group.category] ?? "неизвестная категория"}</span>
                          </td>
                          <td className="tabular-nums md:py-2 md:pr-3 md:text-right"><span className="text-muted-foreground md:hidden">Записей: </span>{group.recordCount}</td>
                          <td className="min-w-0 [overflow-wrap:anywhere] font-mono tabular-nums md:py-2 md:text-right">
                            {group.observedAmountSum} {group.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : observation.values?.length === 0 && observation.groups?.length === 0 ? (
                <p className="text-sm">
                  В этом ограниченном запросе записи не получены. Это не означает нулевые комиссии,
                  выплаты или прибыль.
                </p>
              ) : (
                <p className="text-sm">Сводка полученных записей недоступна.</p>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
