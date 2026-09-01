import type postgres from "postgres";
import { loadHistoricalObservableProjectionPostgresV2 } from "./observable-read-model-postgres-v2";
import { createHistoricalObservablePollingStreamV2, HISTORICAL_OBSERVABLE_STREAM_HEADERS } from "./observable-stream-v2";

export type HistoricalObservableHttpScopeV2 = Readonly<{
  organizationId: string; runId: string; accountId?: string;
}>;

export async function serveHistoricalObservableV2(input: Readonly<{
  request: Request; sql: Pick<postgres.Sql, "unsafe">; scope: HistoricalObservableHttpScopeV2;
  dispose: () => Promise<void>;
}>): Promise<Response> {
  const url = new URL(input.request.url);
  const pollingFallback = url.searchParams.get("transport") === "poll" ||
    !input.request.headers.get("accept")?.includes("text/event-stream");
  const load = () => loadHistoricalObservableProjectionPostgresV2(input.sql, input.scope);
  if (pollingFallback) {
    try {
      return Response.json(await load(), { headers: { "Cache-Control": "private, no-store" } });
    } finally { await input.dispose(); }
  }
  const body = createHistoricalObservablePollingStreamV2({
    signal: input.request.signal, lastEventId: input.request.headers.get("last-event-id"),
    load, dispose: input.dispose,
  });
  return new Response(body, { status: 200, headers: HISTORICAL_OBSERVABLE_STREAM_HEADERS });
}

