import { z } from "zod";

import { adminClientError, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import type { AdminMode, AdminScope } from "@/lib/trader/admin-console/contracts";
import { ADMIN_STREAM_TOPICS, type AdminStreamTopic } from "@/lib/trader/admin-console/contracts";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

const querySchema = z.object({
  period: z.enum(["today", "7d", "30d", "90d", "custom"]).default("7d"),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  tz: z.string().min(1).default("UTC"),
  mode: z.enum(["live", "paper", "history", "all"]).default("all"),
  currency: z.enum(["USDT", "USD"]).default("USDT"),
  organization_id: z.string().uuid().optional(),
  exchange_account_id: z.string().min(1).max(200).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().max(80).optional(),
  topics: z.string().max(500).optional(),
  resume: z.string().max(80).optional(),
  transport: z.enum(["poll"]).optional(),
});

export type AdminConsoleQuery = z.infer<typeof querySchema>;

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseAdminConsoleQuery(
  url: URL,
): { ok: true; query: AdminConsoleQuery } | { ok: false; result: AdminRouteHandlerResult } {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (raw[key] === undefined) raw[key] = value;
  }
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, result: adminClientError(400, "BAD_REQUEST", "Query is invalid.") };
  }
  if (!isIanaTimeZone(parsed.data.tz)) {
    return {
      ok: false,
      result: adminClientError(400, "BAD_REQUEST", "tz is not an IANA time zone."),
    };
  }
  if (parsed.data.period === "custom" && (!parsed.data.from || !parsed.data.to)) {
    return {
      ok: false,
      result: adminClientError(400, "BAD_REQUEST", "custom period requires from and to."),
    };
  }
  if (parsed.data.exchange_account_id && !parsed.data.organization_id) {
    return {
      ok: false,
      result: adminClientError(400, "BAD_REQUEST", "Account scope requires organization_id."),
    };
  }
  if (
    parsed.data.period === "custom" &&
    Date.parse(parsed.data.from!) >= Date.parse(parsed.data.to!)
  ) {
    return { ok: false, result: adminClientError(400, "BAD_REQUEST", "from must precede to.") };
  }
  return { ok: true, query: parsed.data };
}

export function adminScopeFromQuery(query: AdminConsoleQuery): AdminScope {
  if (query.organization_id && query.exchange_account_id) {
    return {
      kind: "account",
      organizationId: query.organization_id,
      exchangeAccountId: query.exchange_account_id,
    };
  }
  if (query.organization_id) {
    return { kind: "organization", organizationId: query.organization_id };
  }
  return { kind: "fleet" };
}

export function parseAdminStreamTopics(
  value: string | undefined,
): { ok: true; topics: AdminStreamTopic[] } | { ok: false; result: AdminRouteHandlerResult } {
  const parts = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return {
      ok: false,
      result: adminClientError(400, ADMIN_REASON.unknownTopic, "topics required."),
    };
  }
  const allowed = new Set<string>(ADMIN_STREAM_TOPICS);
  for (const part of parts) {
    if (!allowed.has(part)) {
      return {
        ok: false,
        result: adminClientError(400, ADMIN_REASON.unknownTopic, "Unknown topic."),
      };
    }
  }
  return { ok: true, topics: parts as AdminStreamTopic[] };
}

function startOfZonedDay(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = asUtc - now.getTime();
  return new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - offset,
  );
}

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

export function periodBounds(
  query: Pick<AdminConsoleQuery, "period" | "from" | "to" | "tz">,
  now: Date,
): { start: string; end: string } {
  if (query.period === "custom" && query.from && query.to) {
    return { start: query.from, end: query.to };
  }
  const end = now.toISOString();
  if (query.period === "today") {
    return { start: startOfZonedDay(now, query.tz).toISOString(), end };
  }
  const days = PERIOD_DAYS[query.period === "custom" ? "7d" : query.period];
  return { start: new Date(now.getTime() - days * DAY_MS).toISOString(), end };
}

export function modeOfQuery(query: AdminConsoleQuery): AdminMode | "all" {
  return query.mode;
}
