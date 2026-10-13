import { createHash } from "node:crypto";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { assistantContext, assistantHref } from "@/lib/trader/admin-console/assistant/context";
import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import { JOB_LABELS, JOB_STATUS } from "@/lib/trader/admin-console/jobs/presentation";

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
  get_client: "/admin/clients",
  get_incident: "/admin/errors",
  changes_since: "/admin/system",
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
  get_overview: "Summary",
  list_accounts: "Accounts",
  list_orders: "Orders",
  list_clients: "Clients",
  list_invoices: "Invoices",
  strategy_performance: "Strategies",
  list_research_runs: "Research",
  list_incidents: "Incidents",
  system_status: "System",
  list_jobs: "Jobs",
  release_info: "Release",
  list_payments: "Payments",
  list_fills: "Fills",
  list_positions: "Positions",
  no_trade_reasons: "Decision reasons",
  list_cycles: "Cycles",
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
    add("availability", TITLES[tool] ?? "Source", null, {
      state: str(data.state) ?? "unavailable",
      reasons: missing.length ? missing : ["SOURCE_UNAVAILABLE"],
    });
    return result;
  }
  if (JSON.stringify(envelope.scope) !== JSON.stringify(context.scope)) {
    add("scope", TITLES[tool] ?? "Source", null, { reasons: ["ADMIN_SCOPE_MISMATCH"] });
    return result;
  }
  if (tool === "get_client" || tool === "get_incident") {
    const row = record(tool === "get_client" ? data.client : data.incident);
    const id = str(row.id);
    const href = assistantHref(PATHS[tool]!, query, { sel: id ?? "" });
    if (tool === "get_client") {
      add("client.access", "Client access", row.access, { entityId: id, href });
      add("client.connectedSince", "Connected since", row.connectedSinceValue, {
        entityId: id,
        href,
        reasons: row.connectedSinceValue ? [] : ["CONNECTED_SINCE_NOT_OBSERVED"],
      });
    } else {
      add("incident.status", "Incident status", row.status, { entityId: id, href });
      add("incident.occurrences", "Occurrences", row.occurrences, { entityId: id, href });
    }
    return result;
  }
  if (tool === "changes_since") {
    add("aggregate.total", "Changes since the previous visit", record(data.aggregate).total, {
      state: str(data.state) ?? "unavailable",
      reasons: reasons(data.reasons),
    });
    add("since", "Observed interval start", data.effectiveSince);
    return result;
  }
  if (tool === "strategy_performance" && Array.isArray(data.performance)) {
    for (const [i, group] of list(data.performance).entries()) {
      const href = assistantHref("/admin/strategies", query, {
        sel: `${str(data.strategyId)}:${str(data.version)}`,
      });
      for (const [key, label] of Object.entries({
        realized: "Period realized result",
        tradingFees: "Trading fees",
        maxRealizedDrawdown: "Realized-result drawdown",
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
        equity: "Replay equity",
        cash: "Available in replay",
        netPnl: "Replay operational result",
      }))
        add(`items.${i}.metrics.${key}`, `${str(run.runId)} · ${label}`, metric[key], {
          currency: str(metric.currency),
          state: metric[key] == null ? "unavailable" : "ok",
          reasons: metric[key] == null ? ["RESEARCH_METRIC_NOT_PERSISTED"] : [],
          href,
          entityId: str(run.id),
        });
      for (const [key, label] of Object.entries({
        dataset: "Dataset",
        period: "Period",
        costs: "Costs",
        version: "Version",
        model: "Model",
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
      equity: "Total equity",
      free: "Available",
      holdings: "In assets",
      reserved: "Reserved in orders",
      pnl: "Trader result before the 30% service fee",
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
        "Last known valuation of stale accounts",
        data.lastKnownEstimate,
        { currency: query.currency, state: "stale", reasons: ["OBSERVATION_STALE"] },
      );
    return result;
  }
  if (tool === "list_invoices") {
    // Aggregate is computed over all matching invoices before LIMIT in the canonical reader.
    for (const [index, row] of list(data.aggregate).entries()) {
      add(`aggregate.${index}.amount`, "Saved invoice total", row.amount, {
        currency: str(row.currency),
        coverage: { included: count(row.count) ?? 0, total: count(row.count) },
      });
      add(`aggregate.${index}.count`, "Invoice count in this currency", row.count, {
        currency: null,
      });
    }
  }
  const items = tool === "list_accounts" ? list(data.accounts ?? data.items) : list(data.items);
  if (Array.isArray(data.items) || Array.isArray(data.accounts)) {
    const n =
        count(data.total) ??
        count(record(data.aggregate).total) ??
        (tool === "list_accounts" ? total : null),
      cap = data.truncated === true || n === null || (n !== null && n > items.length);
    add("list.coverage", "Records in the source selection", items.length, {
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
          "Record";
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
        add(`items.${index}.reason`, `${name} · saved decision reason`, row.reason, {
          ...opts,
          href: assistantHref("/admin", query, { tab: "algorithm", cycle: entityId ?? "" }),
        });
      } else if (tool === "list_accounts") {
        add(`items.${index}.equity`, `${name} · equity`, row.equity, {
          ...opts,
          currency: str(row.currency),
          state: str(row.state) ?? "unavailable",
          observedAt: str(row.observedAt),
          reasons: reasons(row.reasons),
        });
      } else if (tool === "list_orders") {
        add(`items.${index}.state`, `${name} · order`, row.label, { ...opts });
        add(
          `items.${index}.filledQuantity`,
          `${name} · filled quantity`,
          row.filledQuantity,
          { ...opts },
        );
      } else if (tool === "list_clients") {
        add(`items.${index}.access`, `${name} · access`, row.access, opts);
      } else if (tool === "list_invoices") {
        add(`items.${index}.performanceFee`, `${name} · saved fee`, row.performanceFee, {
          ...opts,
          currency: str(row.currency),
        });
        add(
          `items.${index}.status`,
          `${name} · status`,
          record(row.display).status ?? row.status,
          opts,
        );
      } else if (tool === "list_incidents") {
        add(
          `items.${index}.status`,
          `${name} · incident`,
          row.activityLabel ?? row.label ?? row.status,
          opts,
        );
      } else if (tool === "list_research_runs") {
        add(`items.${index}.phase`, `${name} · run`, row.phase ?? row.status, opts);
        add(
          `items.${index}.committedCycles`,
          `${name} · committed cycles`,
          row.committedCycles,
          opts,
        );
      } else if (tool === "strategy_performance") {
        add(
          `items.${index}.status`,
          `${name} · version ${str(row.version ?? row.strategyVersion) ?? "not established"}`,
          row.activityLabel ?? row.label ?? row.status,
          opts,
        );
      }
    }
  }
  if (["system_status", "release_info", "list_jobs"].includes(tool)) {
    const release = record(data.release);
    add("release.sha", "Release SHA; deployment match unconfirmed", release.sha, {
      state: "unavailable",
      reasons: [str(release.reason) ?? "WAIA_RELEASE_SHA_NOT_SET"],
      href: assistantHref("/admin/system", query, { tab: "releases" }),
    });
    if (Array.isArray(data.jobs)) {
      const jobs = list(data.jobs),
        shown = jobs.slice(0, 50),
        href = assistantHref("/admin/system", query, { tab: "jobs" });
      add("jobs.coverage", "Jobs in the response", shown.length, {
        href,
        state: shown.length < jobs.length ? "partial" : shown.length ? "ok" : "empty",
        reasons: shown.length < jobs.length ? ["LIST_COVERAGE_LIMITED"] : [],
        coverage: { included: shown.length, total: jobs.length },
      });
      for (const [index, row] of shown.entries()) {
        const key = str(row.jobKey),
          run = record(row.lastRun),
          status = str(run.status);
        add(
          `jobs.${index}.state`,
          `${(key && JOB_LABELS[key]) ?? key ?? "Job"} · last run`,
          status === null ? null : (JOB_STATUS[status] ?? status),
          {
            entityId: key,
            href,
            state: status === null ? "unavailable" : (str(row.state) ?? "unavailable"),
            reasons: reasons([row.reason ?? (status === null ? "JOB_RUN_NOT_OBSERVED" : null)]),
            observedAt: str(run.at),
            coverage: null,
          },
        );
      }
    }
  }
  if (!result.length)
    add("availability", TITLES[tool] ?? "Source", null, {
      reasons: missing.length ? missing : ["ASSISTANT_FACT_NOT_PROJECTED"],
    });
  return result;
}

export function renderAssistantFact(fact: AssistantFact): string {
  const value =
    fact.value === null ? "unavailable" : `${fact.value}${fact.currency ? ` ${fact.currency}` : ""}`;
  const coverage = fact.coverage
    ? `; coverage ${fact.coverage.included}/${fact.coverage.total ?? "not established"}`
    : "";
  const labels: Record<string, string> = {
    partial: "partial data",
    stale: "stale",
    unavailable: "unavailable",
    empty: "no records",
    not_applicable: "not applicable",
    forbidden: "no access",
  };
  const quality =
    fact.state === "ok" ? "" : `; ${labels[fact.state] ?? "state not established"}`;
  return `${fact.label}: ${value}${coverage}${quality}`;
}
