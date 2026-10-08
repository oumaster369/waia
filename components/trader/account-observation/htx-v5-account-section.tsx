import type { ReactNode } from "react";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import type {
  HtxV5AccountObservation,
  HtxV5AlgoOrdersObservation,
  HtxV5FillsObservation,
  HtxV5RowsObservation,
  HtxV5ValueObservation,
  ObservationReadError,
} from "@/lib/trader/account-observation/types";
import type {
  HtxV5AlgoOrder,
  HtxV5BalanceDetail,
  HtxV5Fill,
  HtxV5OpenOrder,
  HtxV5Position,
} from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { htxV5PositionOrderDisplay, type StopEvidenceReason } from "@/lib/trader/account-observation/htx-v5-position-order-display";
import { HtxV5BillsSection } from "./htx-v5-bills-section";

const MAX_VISIBLE_ROWS = 100;
const MAX_VISIBLE_POSITION_ORDERS = 10;

const STOP_EVIDENCE_REASON: Record<StopEvidenceReason, string> = {
  READ_FAILED: "Чтение позиций или условных заявок не завершилось успешно.",
  INVALID_READ_TIME: "Время чтения позиций или заявок не прошло проверку.",
  STALE_DATA: "Срок актуальности позиций или заявок истёк.",
  POSITION_UNBOUND: "Позиция не связана с этим снимком счёта.",
  POSITION_AMBIGUOUS: "В снимке несколько строк одной позиции; сопоставление неоднозначно.",
  SOURCE_INCOMPLETE: "Получена неполная выборка: в ней могут отсутствовать стоп-заявки.",
  NO_MATCHING_SL: "Совпавшая стоп-заявка SL не получена; это не доказывает её отсутствие. Цель TP не заменяет стоп.",
  DUPLICATE_ORDER_IDENTITY: "Идентификатор заявки повторяется в полученных данных; объёмы не сравниваются.",
  MULTIPLE_SL_CANDIDATES: "Получено несколько совпавших стоп-заявок; их объёмы не складываются.",
  UNSUPPORTED_QUANTITY: "Полученный объём нельзя точно сравнить в поддерживаемых пределах.",
  UNQUALIFIED_CLOSING_SEMANTICS: "По этим данным не подтверждено, какой объём позиции будет закрыт.",
};

const QUANTITY_RELATION = { LESS: "меньше объёма", EQUAL: "равен объёму", GREATER: "больше объёма" } as const;


function hasPositiveContractVolume(volume: string): boolean {
  const significand = volume.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(significand);
}

const ERROR_COPY: Record<ObservationReadError, string> = {
  TIMEOUT: "Истекло время чтения счёта.",
  RATE_LIMITED: "Биржа временно ограничила чтение счёта.",
  PERMISSION_DENIED: "Нет доступа к данным этого счёта.",
  READ_FAILED: "Не удалось прочитать счёт.",
  INVALID_RESPONSE: "Ответ биржи не прошёл проверку.",
  IDENTITY_MISMATCH: "Не удалось подтвердить личность возвращённого счёта.",
};

const time = (value: number | null) =>
  value !== null && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toISOString()
    : "Недоступно";

function Value({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value ?? "Недоступно"}</dd>
    </div>
  );
}

function isStale(
  status: string,
  completedAt: number | null,
  inheritedStale: boolean,
  nowMs: number,
) {
  return (
    status !== "NOT_CONFIGURED" &&
    (inheritedStale ||
      (completedAt !== null &&
        completedAt <= nowMs &&
        nowMs - completedAt >= ACCOUNT_OBSERVATION_STALE_AFTER_MS))
  );
}

function statusLabel(status: string, stale: boolean) {
  if (status === "NOT_CONFIGURED") return "не настроено";
  if (status === "ERROR") return "ошибка";
  if (stale) return status === "PARTIAL" ? "устарело · частичные данные" : "устарело";
  if (status === "PARTIAL") return "частичные данные";
  return "актуально";
}

function Header({
  title,
  status,
  completedAt,
}: {
  title: string;
  status: string;
  completedAt?: number | null;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-medium">{title}</h3>
      <span className="text-waia-fg-muted text-xs">{status}</span>
      {completedAt !== undefined ? (
        <span className="text-muted-foreground text-xs">Прочитано: {time(completedAt)}</span>
      ) : null}
    </header>
  );
}

function ReadError({ error }: { error: ObservationReadError | null }) {
  return error ? (
    <p role="alert" className="text-sm">
      {ERROR_COPY[error]}
    </p>
  ) : null;
}

function Coverage({ pageScope }: { pageScope: { completeness: "UNKNOWN" } | null }) {
  return pageScope ? (
    <p className="text-muted-foreground text-xs">В этой выборке могут отсутствовать некоторые записи.</p>
  ) : null;
}

function BalanceDetail({ row }: { row: HtxV5BalanceDetail }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">Обеспечение в {row.currency}</h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Капитал (в единицах валюты)" value={row.equity} />
        <Value label="Доступно (в единицах валюты)" value={row.available} />
        <Value label="Можно вывести (в единицах валюты)" value={row.withdrawAvailable} />
        <Value label="Нереализованный результат (в единицах валюты)" value={row.profitUnreal} />
        <Value label="Начальная маржа (в единицах валюты)" value={row.initialMargin} />
        <Value label="Поддерживающая маржа (в единицах валюты)" value={row.maintenanceMargin} />
      </dl>
    </WaiaSurface>
  );
}

function Balance({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5ValueObservation<NonNullable<HtxV5AccountObservation["balance"]["value"]>>;
  inheritedStale: boolean;
  nowMs: number;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  return (
    <section
      aria-label="HTX futures balance"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="Баланс фьючерсного счёта HTX"
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">Показан последний полученный баланс; данные могут устареть.</p>
      ) : null}
      <ReadError error={observation.error} />
      {observation.status === "COMPLETE" && observation.value ? (
        <>
          <p className="text-muted-foreground text-xs">
            Итоги счёта переданы HTX в USD. Обеспечение в отдельных валютах показано ниже и не
            прибавляется к этим значениям.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Value label="Капитал счёта (USD)" value={observation.value.account.equityUsd} />
            <Value
              label="Доступная маржа (USD)"
              value={observation.value.account.availableMarginUsd}
            />
            <Value
              label="Нереализованный результат (USD)"
              value={observation.value.account.profitUnrealUsd}
            />
            <Value
              label="Начальная маржа (USD)"
              value={observation.value.account.initialMarginUsd}
            />
            <Value
              label="Поддерживающая маржа (USD)"
              value={observation.value.account.maintenanceMarginUsd}
            />
            <Value
              label="Ставка поддерживающей маржи"
              value={observation.value.account.maintenanceMarginRate}
            />
          </dl>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Обеспечение по валютам</h4>
            {observation.value.details.length ? (
              observation.value.details.map((row, index) => (
                <BalanceDetail key={row.currency + "-" + index} row={row} />
              ))
            ) : (
              <p>Строки обеспечения по валютам не получены.</p>
            )}
          </div>
        </>
      ) : (
        <p>Баланс недоступен — это не означает нулевое значение.</p>
      )}
    </section>
  );
}

function Position({
  row,
  projection,
  stale,
  nowMs,
}: {
  row: HtxV5Position;
  projection: HtxV5AccountObservation;
  stale: boolean;
  nowMs: number;
}) {
  const orders = htxV5PositionOrderDisplay({
    position: row,
    projection,
    stale,
    nowMs,
  });
  return (
      <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {row.positionSide === "long" ? "лонг" : row.positionSide === "short" ? "шорт" : `${row.direction === "buy" ? "лонг" : "шорт"} (односторонний режим)`} ·{" "}
        {row.marginMode === "cross" ? "кросс-маржа" : "изолированная маржа"}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Объём позиции (контракты)" value={row.volume} />
        <Value label="Доступный объём (контракты)" value={row.available} />
        <Value label="Средняя цена входа" value={row.openAveragePrice} />
        <Value label="Расчётная цена" value={row.markPrice} />
        <Value label="Последняя цена" value={row.lastPrice} />
        <Value label="Цена ликвидации" value={row.liquidationPrice} />
        <Value label="Нереализованный результат по данным HTX" value={row.profitUnreal} />
        <Value label="Валюта маржи" value={row.marginCurrency} />
      </dl>
      <div className="border-border space-y-1 rounded-md border p-3 text-sm">
        <h5 className="font-medium">Полученные стоп-заявки и цели</h5>
        {orders.status === "UNAVAILABLE" ? (
          <p>Данные о совпавших заявках недоступны. Наличие защиты не подтверждено.</p>
        ) : orders.status === "STALE" ? (
          <p>Данные о совпавших заявках устарели. Наличие защиты не подтверждено.</p>
        ) : orders.stops.length === 0 && orders.targets.length === 0 ? (
          <p>Совпавшие активные стоп-заявки и цели не получены. Наличие защиты не подтверждено.</p>
        ) : (
          <>
            <ul className="space-y-1">
              {orders.stops.slice(0, MAX_VISIBLE_POSITION_ORDERS).map((order, index) => (
                <li key={`stop-${order.algoId}-${index}`}>
                  Стоп: цена {order.slTriggerPrice}; объём {order.volume} контр.
                </li>
              ))}
              {orders.targets.slice(0, MAX_VISIBLE_POSITION_ORDERS).map((order, index) => (
                <li key={`target-${order.algoId}-${index}`}>
                  Цель: цена {order.tpTriggerPrice}; объём {order.volume} контр.
                </li>
              ))}
            </ul>
            {orders.stops.length > MAX_VISIBLE_POSITION_ORDERS ? (
              <p>
                Показаны первые {MAX_VISIBLE_POSITION_ORDERS} из {orders.stops.length} полученных
                стоп-заявок.
              </p>
            ) : null}
            {orders.targets.length > MAX_VISIBLE_POSITION_ORDERS ? (
              <p>
                Показаны первые {MAX_VISIBLE_POSITION_ORDERS} из {orders.targets.length} полученных
                целей.
              </p>
            ) : null}
            <p>Полнота покрытия позиции неизвестна; защита не подтверждена.</p>
          </>
        )}
        <ul aria-label="Почему защита не подтверждена" className="text-muted-foreground space-y-1 text-xs">
          {orders.reasons.map(reason => <li key={reason}>{STOP_EVIDENCE_REASON[reason]}</li>)}
        </ul>
        {orders.receivedQuantityComparison ? (
          <p>
            Полученный объём одной SL-заявки ({orders.receivedQuantityComparison.stopVolume} контр.){" "}
            {QUANTITY_RELATION[orders.receivedQuantityComparison.relation]} позиции{" "}
            ({orders.receivedQuantityComparison.positionVolume} контр.). Это сравнение полученных чисел, не подтверждение защиты.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Позиции прочитаны: {time(projection.positions.readCompletedAtMs)}.
          Условные заявки прочитаны: {time(projection.algoOrders.readCompletedAtMs)}.
          Эти чтения не являются одновременным снимком.
        </p>
        <p className="text-muted-foreground text-xs">
          Это только полученные условные заявки; полнота покрытия позиции неизвестна.
        </p>
      </div>
    </WaiaSurface>
  );
}

function Rows<T>({
  title,
  observation,
  inheritedStale,
  nowMs,
  empty,
  children,
}: {
  title: string;
  observation: HtxV5RowsObservation<T>;
  inheritedStale: boolean;
  nowMs: number;
  empty: string;
  children: (row: T, index: number) => ReactNode;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section aria-label={title} className="border-border space-y-3 rounded-lg border p-3">
      <Header
        title={title}
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">Показаны последние полученные данные; они могут устареть.</p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Данные недоступны — это не подтверждённый пустой результат.</p>
      ) : visibleValues.length === 0 ? (
        <p>{observation.status === "COMPLETE" ? empty : "В этом чтении строки не получены."}</p>
      ) : (
        <div className="space-y-2">
          {visibleValues.map(children)}
          {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
            <p>
              Показаны первые {MAX_VISIBLE_ROWS} из {observation.values.length} полученных строк.
            </p>
          ) : null}
        </div>
      )}
      <Coverage pageScope={observation.pageScope} />
    </section>
  );
}

function OpenOrder({ row }: { row: HtxV5OpenOrder }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {row.side} · {row.state}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Объём заявки (контракты)" value={row.volume} />
        <Value label="Сторона позиции" value={row.positionSide} />
        <Value label="Полученная цена цели" value={row.tpTriggerPrice} />
        <Value label="Полученная стоп-цена" value={row.slTriggerPrice} />
      </dl>
    </WaiaSurface>
  );
}

const ALGO_TYPE: Record<HtxV5AlgoOrder["type"], string> = {
  tp: "Заявка на фиксацию цели",
  sl: "Стоп-заявка",
  tpsl: "Объединённая стоп-заявка и цель",
  trigger: "Триггерная заявка",
  trailing_stop: "Трейлинг-стоп",
};

function AlgoOrder({ row }: { row: HtxV5AlgoOrder }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {ALGO_TYPE[row.type]}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Объём заявки (контракты)" value={row.volume} />
        <Value label="Сторона позиции" value={row.positionSide} />
        <Value label="Полученная цена цели" value={row.tpTriggerPrice} />
        <Value label="Полученная стоп-цена" value={row.slTriggerPrice} />
        <Value
          label="Только сокращение"
          value={row.reduceOnly === null ? null : row.reduceOnly ? "Да" : "Нет"}
        />
      </dl>
    </WaiaSurface>
  );
}

function AlgoOrders({
  observation,
  inheritedStale,
  nowMs,
  hasOpenPositions,
}: {
  observation: HtxV5AlgoOrdersObservation;
  inheritedStale: boolean;
  nowMs: number;
  hasOpenPositions: boolean;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX conditional orders"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="Условные заявки HTX"
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">
          Показано последнее чтение условных заявок; данные могут устареть.
        </p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Данные условных заявок недоступны. Наличие защиты не подтверждено.</p>
      ) : visibleValues.length === 0 ? (
        <p>Строки условных заявок не получены. Наличие защиты не подтверждено.</p>
      ) : (
        <div className="space-y-2">
          {visibleValues.map((row, index) => (
            <AlgoOrder key={row.algoId + "-" + index} row={row} />
          ))}
          {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
            <p>
              Показаны первые {MAX_VISIBLE_ROWS} из {observation.values.length} полученных строк.
            </p>
          ) : null}
        </div>
      )}
      <Coverage pageScope={observation.pageScope} />
      {hasOpenPositions ? (
        <p role="alert" className="text-sm">
          Наличие защиты открытой позиции не подтверждено этим снимком.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Условные заявки показаны отдельно от позиций; полнота защиты не оценивается.
        </p>
      )}
    </section>
  );
}

function Fill({ row }: { row: HtxV5Fill }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        Исполнение · {row.contractCode} · {row.side}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Объём исполнения (контракты)" value={row.tradeVolume} />
        <Value label="Цена исполнения" value={row.tradePrice} />
        <Value label="Оборот по данным HTX" value={row.tradeTurnover} />
        <Value label="Комиссия" value={row.tradeFee} />
        <Value label="Валюта комиссии" value={row.feeCurrency} />
        <Value label="Результат по данным HTX" value={row.profit} />
      </dl>
      <p className="text-muted-foreground text-xs">Время исполнения HTX: {time(row.createdTimeMs)}</p>
    </WaiaSurface>
  );
}

function Fills({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5FillsObservation;
  inheritedStale: boolean;
  nowMs: number;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX futures fills"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="Исполнения фьючерсных заявок HTX"
        status={statusLabel(observation.status, stale)}
        completedAt={
          observation.status === "NOT_CONFIGURED" ? undefined : observation.readCompletedAtMs
        }
      />
      {stale ? (
        <p className="text-sm">Показано последнее чтение исполнений; данные могут устареть.</p>
      ) : null}
      {observation.status === "NOT_CONFIGURED" || observation.coverage === "NOT_CONFIGURED" ? (
        <p>История исполнений недоступна; число исполнений неизвестно.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Контракты чтения: {observation.contracts.join(", ") || "недоступно"}
          </p>
          <p className="text-muted-foreground text-sm">
            Период истории: {time(observation.windowStartMs)} – {time(observation.windowEndMs)}
          </p>
          <ReadError error={observation.error} />
          {visibleValues === null ? (
            <p>Данные исполнений недоступны — это не подтверждённое отсутствие исполнений.</p>
          ) : visibleValues.length === 0 ? (
            <p>
              {observation.status === "COMPLETE"
                ? "Исполнения по указанным контрактам и за показанный период не получены."
                : "В этом чтении строки исполнений не получены."}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleValues.map((row, index) => (
                <Fill key={row.id + "-" + index} row={row} />
              ))}
              {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
                <p>
                  Показаны первые {MAX_VISIBLE_ROWS} из {observation.values.length} полученных
                  исполнений.
                </p>
              ) : null}
            </div>
          )}
          <Coverage
            pageScope={
              observation.pageScope ? { completeness: observation.pageScope.completeness } : null
            }
          />
          <p className="text-sm">
            Этот период не подтверждает полную дневную активность или итог за день.
          </p>
        </>
      )}
    </section>
  );
}

export function HtxV5AccountSection({
  projection,
  stale: inheritedStale,
  nowMs,
}: {
  projection: HtxV5AccountObservation;
  stale: boolean;
  nowMs: number;
}) {
  const positionsStale = isStale(
    projection.positions.status,
    projection.positions.readCompletedAtMs,
    inheritedStale,
    nowMs,
  );
  const visiblePositions = projection.positions.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX futures snapshot"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div>
        <h3 className="text-base font-semibold">Снимок фьючерсного счёта HTX</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Последние полученные данные счёта HTX. Объёмы позиций и заявок указаны в контрактах.
        </p>
      </div>
      <Balance observation={projection.balance} inheritedStale={inheritedStale} nowMs={nowMs} />
      <section aria-label="HTX positions" className="border-border space-y-3 rounded-lg border p-3">
        <Header
          title="Позиции HTX"
          status={statusLabel(projection.positions.status, positionsStale)}
          completedAt={projection.positions.readCompletedAtMs}
        />
        {positionsStale ? (
          <p className="text-sm">Показаны последние полученные позиции; данные могут устареть.</p>
        ) : null}
        <ReadError error={projection.positions.error} />
        {visiblePositions === null ? (
          <p>Данные позиций недоступны — это не подтверждённый нулевой объём.</p>
        ) : visiblePositions.length === 0 ? (
          <p>
            {projection.positions.status === "COMPLETE"
              ? "Открытые позиции не получены."
              : "В этом чтении строки позиций не получены."}
          </p>
        ) : (
          <div className="space-y-2">
          {visiblePositions.map((row, index) => (
            <Position
              key={row.contractCode + "-" + row.positionSide + "-" + index}
              row={row}
              projection={projection}
              stale={inheritedStale}
              nowMs={nowMs}
            />
          ))}
            {projection.positions.values &&
            projection.positions.values.length > MAX_VISIBLE_ROWS ? (
              <p>
                Показаны первые {MAX_VISIBLE_ROWS} из {projection.positions.values.length}{" "}
                полученных позиций.
              </p>
            ) : null}
          </div>
        )}
      </section>
      <Rows
        title="Открытые заявки HTX"
        observation={projection.openOrders}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
        empty="No open orders were returned."
      >
        {(row, index) => <OpenOrder key={row.orderId + "-" + index} row={row} />}
      </Rows>
      <AlgoOrders
        observation={projection.algoOrders}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
        hasOpenPositions={Boolean(
          projection.positions.values?.some((row) => hasPositiveContractVolume(row.volume)),
        )}
      />
      <Fills observation={projection.fills} inheritedStale={inheritedStale} nowMs={nowMs} />
      <HtxV5BillsSection
        observation={projection.schemaVersion === "htx-v5-observation/v2" ? projection.bills : null}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
      />
    </section>
  );
}
