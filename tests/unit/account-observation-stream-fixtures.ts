import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";
export const binding: ObservationBinding = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "1",
};
export function observation(): AccountObservation {
  const now = Date.now();
  const empty = {
    status: "COMPLETE" as const,
    values: [],
    error: null,
    sourceAsOfMs: now,
    readStartedAtMs: now,
    readCompletedAtMs: now,
  };
  return {
    schemaVersion: "account-observation/v1",
    observationId: "33333333-3333-4333-8333-333333333333",
    binding,
    collectionStartedAtMs: now,
    collectionCompletedAtMs: now,
    status: "COMPLETE",
    balances: empty,
    openOrders: empty,
    holdings: [],
    trades: [{ symbol: "BTCUSDT", component: empty }],
  };
}
export const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
export const streamed = (body: string) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });
