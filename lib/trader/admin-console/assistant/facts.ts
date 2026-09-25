import { createHash } from "node:crypto";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { assistantContext, assistantHref } from "@/lib/trader/admin-console/assistant/context";
import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";

export type AssistantFact = {
  id: string;
  tool: string;
  field: string;
  entityId: string | null;
  label: string;
  value: string | null;
  currency: string | null;
  state: string;
  reasons: string[];
  href: string;
  revision: string;
  financeRevision: string | null;
  generatedAt: string | null;
  observedAt: string | null;
  coverage: { included: number; total: number | null } | null;
};
export type AssistantFactSource = { tool: string; body: unknown };
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const str = (value: unknown): string | null =>
  typeof value === "string"
    ? value.slice(0, 280)
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const reasons = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && /^[A-Z0-9_]+$/.test(v)).slice(0, 30)
    : [];
const PATHS: Record<string, string> = {
  get_overview: "/admin",
  list_accounts: "/admin/accounts",
  list_orders: "/admin/orders",
  list_clients: "/admin/clients",
  list_invoices: "/admin/clients",
  strategy_performance: "/admin/strategies",
  list_research_runs: "/admin/research",
  get_research_run: "/admin/research",
  compare_research_runs: "/admin/research",
  list_incidents: "/admin/errors",
  system_status: "/admin/system",
  list_jobs: "/admin/system",
  release_info: "/admin/system",
  list_payments: "/admin/clients",
  list_fills: "/admin/orders",
  list_positions: "/admin/orders",
  no_trade_reasons: "/admin",
  list_cycles: "/admin",
};
const TITLES: Record<string, string> = {
  get_overview: "Сводка",
  list_accounts: "Счета",
  list_orders: "Ордера",
  list_clients: "Клиенты",
  list_invoices: "Счета на оплату",
  strategy_performance: "Стратегии",
  list_research_runs: "Исследования",
  list_incidents: "Инциденты",
  system_status: "Система",
  list_jobs: "Задания",
  release_info: "Релиз",
  list_payments: "Платежи",
  list_fills: "Исполнения",
  list_positions: "Позиции",
  no_trade_reasons: "Причины решений",
  list_cycles: "Циклы",
};

/** Only this explicit projection can authorize a model fact. Never recursively scrape arbitrary payloads or numbers. */
export function factsFromTool(
  source: AssistantFactSource,
  query: AdminConsoleQuery,
): AssistantFact[] {
  if (source.tool === "aggregate")
    return factsFromTool(
      {
        ...source,
        tool: record(record(source.body).data).finance ? "get_overview" : "list_invoices",
      },
      query,
    );
  const envelope = record(source.body),
    data = record(envelope.data),
    tool = source.tool;
  const revision = str(envelope.revision) ?? "unavailable",
    context = assistantContext(query);
  const result: AssistantFact[] = [];
  const selection =
    tool === "list_invoices"
      ? { tab: "invoices" }
      : tool === "list_research_runs"
        ? { tab: "runs" }
        : tool === "list_payments"
          ? { tab: "payments" }
          : undefined;
  const baseHref = assistantHref(PATHS[tool] ?? "/admin", query, selection);
  const baseCoverage = record(envelope.coverage);
  const included = count(baseCoverage.included),
    total = count(baseCoverage.total);
  const coverage = included === null ? null : { included, total };
  const add = (
    field: string,
    label: string,
    value: unknown,
    options: Partial<AssistantFact> = {},
  ) => {
    const id = createHash("sha256")
      .update(JSON.stringify([tool, field, revision, context.contextKey]))
      .digest("hex");
    result.push({
      id,
      tool,
      field,
      entityId: null,
      label: redactDiagnosticText(label),
      value: str(value),
      currency: null,
      state: value == null ? "unavailable" : "ok",
      reasons: [],
      href: baseHref,
      revision,
      financeRevision: str(envelope.financeRevision),
      generatedAt: str(envelope.generatedAt),
      observedAt: null,
      coverage,
      ...options,
    });
  };
  const missing = reasons(data.reasons).concat(reasons(envelope.missingSources));
  if (data.state === "unavailable" || data.state === "not_applicable" || !envelope.data) {
    add("availability", TITLES[tool] ?? "Источник", null, {
      state: str(data.state) ?? "unavailable",
      reasons: missing.length ? missing : ["SOURCE_UNAVAILABLE"],
    });
    return result;
  }
  if (JSON.stringify(envelope.scope) !== JSON.stringify(context.scope)) {
    add("scope", TITLES[tool] ?? "Источник", null, { reasons: ["ADMIN_SCOPE_MISMATCH"] });
    return result;
  }
  if (tool === "strategy_performance" && Array.isArray(data.performance)) {
    for (const [i, group] of list(data.performance).entries()) {
      const href = assistantHref("/admin/strategies", query, {
        sel: `${str(data.strategyId)}:${str(data.version)}`,
      });
      for (const [key, label] of Object.entries({
        realized: "Реализованный результат периода",
        tradingFees: "Торговые комиссии",
        maxRealizedDrawdown: "Просадка реализованного результата",
      }))
        add(`performance.${i}.${key}`, `${str(group.mode)} · ${label}`, group[key], {
          currency: str(group.currency),
          state: str(group.state) ?? "unavailable",
          reasons: reasons(group.reasons),
          href,
        });
    }
    return result;
  }
  if (tool === "get_research_run" || tool === "compare_research_runs") {
    for (const [i, run] of list(data.items).entries()) {
      const metric = record(run.metrics),
        href = assistantHref("/admin/research", query, { tab: "runs", run: str(run.id) ?? "" });
      for (const [key, label] of Object.entries({
        equity: "Капитал воспроизведения",
        cash: "Свободно в воспроизведении",
        netPnl: "Операционный результат воспроизведения",
      }))
        add(`items.${i}.metrics.${key}`, `${str(run.runId)} · ${label}`, metric[key], {
          currency: str(metric.currency),
          state: metric[key] == null ? "unavailable" : "ok",
          reasons: metric[key] == null ? ["RESEARCH_METRIC_NOT_PERSISTED"] : [],
          href,
          entityId: str(run.id),
        });
      for (const [key, label] of Object.entries({
        dataset: "Набор данных",
        period: "Период",
        costs: "Издержки",
        version: "Версия",
        model: "Модель",
      }))
        add(`items.${i}.conditions.${key}`, label, record(run.conditions)[key], {
          href,
          entityId: str(run.id),
          reasons: record(run.conditions)[key] == null ? ["RESEARCH_CONDITION_NOT_PERSISTED"] : [],
        });
    }
    return result;
  }
  if (tool === "get_overview") {
    const finance = record(data.finance);
    for (const [key, label] of Object.entries({
      equity: "Общий капитал",
      free: "Свободно",
      holdings: "В активах",
      reserved: "Резерв в ордерах",
      pnl: "Результат Трейдера до комиссии сервиса 30%",
    })) {
      const fact = record(finance[key]),
        money = record(fact.value);
      add(`finance.${key}`, label, money.amount, {
        currency: str(money.currency),
        state: str(fact.state) ?? "unavailable",
        reasons: reasons(fact.reasons),
        observedAt: str(record(fact.times).observedAt),
      });
    }
    if (data.lastKnownEstimate != null)
      add(
        "lastKnownEstimate",
        "Последняя известная оценка устаревших счетов",
        data.lastKnownEstimate,
        { currency: query.currency, state: "stale", reasons: ["OBSERVATION_STALE"] },
      );
    return result;
  }
  if (tool === "list_invoices") {
    // Aggregate is computed over all matching invoices before LIMIT in the canonical reader.
    for (const [index, row] of list(data.aggregate).entries()) {
      add(`aggregate.${index}.amount`, "Сохранённая сумма счетов на оплату", row.amount, {
        currency: str(row.currency),
        coverage: { included: count(row.count) ?? 0, total: count(row.count) },
      });
      add(`aggregate.${index}.count`, "Количество счетов в этой валюте", row.count, {
        currency: null,
      });
    }
  }
  const items = tool === "list_accounts" ? list(data.accounts ?? data.items) : list(data.items);
  if (Array.isArray(data.items) || Array.isArray(data.accounts)) {
    const n = count(data.total) ?? (tool === "list_accounts" ? total : null),
      cap = data.truncated === true || n === null || (n !== null && n > items.length);
    add("list.coverage", "Записей в выборке источника", items.length, {
      state: cap ? "partial" : items.length ? "ok" : "empty",
      reasons: cap ? ["LIST_COVERAGE_LIMITED"] : [],
      coverage: { included: items.length, total: n },
    });
    for (const [index, row] of items.slice(0, 12).entries()) {
      const entityId = str(row.id ?? row.runId),
        name =
          str(
            row.name ??
              row.symbol ??
              row.exchangeAccountId ??
              row.strategyId ??
              row.title ??
              row.runId,
          ) ??
          entityId ??
          "Запись";
      const href = assistantHref(PATHS[tool] ?? "/admin", query, {
        ...selection,
        ...(entityId
          ? {
              [tool === "list_orders" ? "order" : tool === "list_research_runs" ? "run" : "sel"]:
                entityId,
            }
          : {}),
      });
      const opts = { entityId, href, coverage: null };
      if (tool === "no_trade_reasons" || tool === "list_cycles") {
        add(`items.${index}.reason`, `${name} · сохранённая причина решения`, row.reason, {
          ...opts,
          href: assistantHref("/admin", query, { tab: "algorithm", cycle: entityId ?? "" }),
        });
      } else if (tool === "list_accounts") {
        add(`items.${index}.equity`, `${name} · капитал`, row.equity, {
          ...opts,
          currency: str(row.currency),
          state: str(row.state) ?? "unavailable",
          observedAt: str(row.observedAt),
          reasons: reasons(row.reasons),
        });
      } else if (tool === "list_orders") {
        add(`items.${index}.state`, `${name} · ордер`, row.label, { ...opts });
        add(
          `items.${index}.filledQuantity`,
          `${name} · исполненное количество`,
          row.filledQuantity,
          { ...opts },
        );
      } else if (tool === "list_clients") {
        add(`items.${index}.access`, `${name} · доступ`, row.access, opts);
      } else if (tool === "list_invoices") {
        add(`items.${index}.performanceFee`, `${name} · сохранённая комиссия`, row.performanceFee, {
          ...opts,
          currency: str(row.currency),
        });
        add(
          `items.${index}.status`,
          `${name} · статус`,
          record(row.display).status ?? row.status,
          opts,
        );
      } else if (tool === "list_incidents") {
        add(
          `items.${index}.status`,
          `${name} · инцидент`,
          row.activityLabel ?? row.label ?? row.status,
          opts,
        );
      } else if (tool === "list_research_runs") {
        add(`items.${index}.phase`, `${name} · запуск`, row.phase ?? row.status, opts);
        add(
          `items.${index}.committedCycles`,
          `${name} · зафиксировано циклов`,
          row.committedCycles,
          opts,
        );
      } else if (tool === "strategy_performance") {
        add(
          `items.${index}.status`,
          `${name} · версия ${str(row.version ?? row.strategyVersion) ?? "не установлена"}`,
          row.activityLabel ?? row.label ?? row.status,
          opts,
        );
      }
    }
  }
  if (["system_status", "release_info", "list_jobs"].includes(tool)) {
    const release = record(data.release);
    add("release.sha", "SHA релиза; совпадение с деплоем не подтверждено", release.sha, {
      state: "unavailable",
      reasons: [str(release.reason) ?? "WAIA_RELEASE_SHA_NOT_SET"],
    });
    for (const [index, row] of list(data.jobs).slice(0, 12).entries())
      add(
        `jobs.${index}.state`,
        `${str(row.title ?? row.name ?? row.id) ?? "Задание"} · состояние`,
        row.state ?? row.status,
        {
          href: assistantHref("/admin/system", query, { tab: "jobs" }),
          reasons: reasons(row.reasons),
        },
      );
  }
  if (!result.length)
    add("availability", TITLES[tool] ?? "Источник", null, {
      reasons: missing.length ? missing : ["ASSISTANT_FACT_NOT_PROJECTED"],
    });
  return result;
}

export function renderAssistantFact(fact: AssistantFact): string {
  const value =
    fact.value === null ? "недоступно" : `${fact.value}${fact.currency ? ` ${fact.currency}` : ""}`;
  const coverage = fact.coverage
    ? `; охват ${fact.coverage.included}/${fact.coverage.total ?? "не установлен"}`
    : "";
  const labels: Record<string, string> = {
    partial: "неполные данные",
    stale: "устарело",
    unavailable: "недоступно",
    empty: "записей нет",
    not_applicable: "не применяется",
    forbidden: "нет доступа",
  };
  const quality =
    fact.state === "ok" ? "" : `; ${labels[fact.state] ?? "состояние не установлено"}`;
  return `${fact.label}: ${value}${coverage}${quality}`;
}
