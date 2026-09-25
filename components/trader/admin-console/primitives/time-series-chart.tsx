"use client";
import * as React from "react";
import { parseDecimal, formatDecimal } from "@/lib/trader/risk/numeric";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import {
  ConsolePanel,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import type { OverviewSeriesPoint } from "@/lib/trader/admin-console/money/period-series";

/** Decimal money stays bigint; only time and SVG pixel coordinates use ordinary numbers. */
export function AdminTimeSeriesChart({
  points = [],
  currency = "USDT",
  grain = "hour",
  reason,
  fxAt,
}: {
  points?: OverviewSeriesPoint[];
  currency?: string;
  grain?: string;
  reason?: string | null;
  fxAt?: string | null;
}) {
  const [metric, setMetric] = React.useState<"equity" | "pnl" | "drawdown">("equity");
  const labels = { equity: "Капитал", pnl: "Результат Трейдера", drawdown: "Просадка в валюте" };
  const values = points.flatMap((p) => (p[metric] === null ? [] : [parseDecimal(p[metric]!)]));
  const min = values.reduce((a, b) => (a < b ? a : b), values[0] ?? 0n);
  const max = values.reduce((a, b) => (a > b ? a : b), values[0] ?? 0n);
  const range = max - min || 100000000n;
  const interval = grain === "minute" ? 300000 : grain === "hour" ? 3600000 : 86400000;
  const first = Date.parse(points[0]?.at ?? ""),
    last = Date.parse(points.at(-1)?.at ?? "");
  const path = points
    .map((point, index) => {
      if (point[metric] === null || point.included !== point.total) {
        return "";
      }
      const previous = points[index - 1];
      const x = 24 + ((Date.parse(point.at) - first) / Math.max(1, last - first)) * 712;
      const y = (200n - ((parseDecimal(point[metric]!) - min) * 176n) / range).toString();
      const command =
        previous &&
        previous[metric] !== null &&
        previous.included === previous.total &&
        Date.parse(point.at) - Date.parse(previous.at) <= interval * 1.5
          ? "L"
          : "M";
      return `${command}${x.toFixed(2)},${y}`;
    })
    .join(" ");
  return (
    <ConsolePanel
      title="История капитала и результата"
      note={
        fxAt
          ? "USD: сохранённый ряд USDT пересчитан по текущей подтверждённой котировке"
          : "Сохранённые оценки. Вводы и выводы не считаются торговым результатом"
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Показатель графика">
          {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              className={`${controlClass} ${metric === key ? "border-waia-accent-cool text-waia-accent-cool" : ""}`}
              onClick={() => setMetric(key)}
            >
              {labels[key]}
            </button>
          ))}
        </div>
        {values.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center">
            <DataState state="unavailable" reason={reason ?? "UNREALIZED_HISTORY_MISSING"} />
          </div>
        ) : (
          <figure>
            <div className="text-waia-fg-muted flex justify-between text-xs tabular-nums">
              <span>{formatAdminMoney(formatDecimal(max), currency)}</span>
              <span>{labels[metric]}</span>
            </div>
            <svg
              viewBox="0 0 760 224"
              className="text-waia-accent-cool h-56 w-full"
              role="img"
              aria-label={`${labels[metric]}, ${currency}. Разрывы означают отсутствие полной оценки.`}
            >
              {[24, 112, 200].map((y) => (
                <line key={y} x1="24" y1={y} x2="736" y2={y} stroke="currentColor" opacity="0.12" />
              ))}
              <path
                d={path}
                stroke="currentColor"
                fill="none"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((point, index) =>
                point[metric] !== null && point.included === point.total ? (
                  <circle
                    key={`${point.at}:${index}`}
                    cx={24 + ((Date.parse(point.at) - first) / Math.max(1, last - first)) * 712}
                    cy={(200n - ((parseDecimal(point[metric]!) - min) * 176n) / range).toString()}
                    r="2"
                    fill="currentColor"
                  >
                    <title>
                      {new Date(point.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}:{" "}
                      {formatAdminMoney(point[metric]!, currency)}
                    </title>
                  </circle>
                ) : null,
              )}
            </svg>
            <figcaption className="text-waia-fg-muted flex flex-wrap justify-between gap-2 text-xs">
              <span>{formatAdminMoney(formatDecimal(min), currency)}</span>
              <span>
                История собирается с <EvidenceTime at={points[0]?.at} />
              </span>
            </figcaption>
          </figure>
        )}
        {fxAt ? <EvidenceTime at={fxAt} /> : null}
        <div>
          <p className="text-waia-fg-muted text-xs">Доходность и просадка в процентах</p>
          <DataState state="unavailable" reason="RETURN_METHOD_NOT_RATIFIED" />
        </div>
        {points.some((point) => point.included !== point.total) ? (
          <DataState state="partial" reason="HISTORY_COVERAGE_INCOMPLETE" />
        ) : null}
        {points.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer py-2">Точные значения и охват</summary>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="p-2">Время, Москва</th>
                    <th className="p-2">{labels[metric]}</th>
                    <th className="p-2">Охват</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.at}>
                      <td className="p-2">
                        <EvidenceTime at={point.at} />
                      </td>
                      <td className="p-2 tabular-nums">
                        {point[metric] === null
                          ? "Нет полной оценки"
                          : formatAdminMoney(point[metric]!, currency)}
                      </td>
                      <td className="p-2">
                        {point.included}/{point.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>
    </ConsolePanel>
  );
}
