import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order } from "@/lib/trader/connectors/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  bindExecutionAuthorityV2Postgres,
  type BindExecutionAuthorityV2Input,
  type BoundExecutionAuthorityV2,
} from "./authority-postgres";
import type { ExecutionAttemptV2 } from "./contracts";
import {
  dispatchAndRecordExecutionAttemptV2,
  type DispatchAndRecordExecutionV2Result,
  type ExecutionV2VenueObservation,
} from "./recovery-postgres";

export type ExecutionV2ConnectorResolver = (
  executionMode: BindExecutionAuthorityV2Input["executionMode"],
  venue: string,
) => ExchangeConnector;

export type ExecutionV2SubmissionResult = Readonly<{
  authority: BoundExecutionAuthorityV2;
  outcome: DispatchAndRecordExecutionV2Result;
}>;

/** The only production ExchangeConnector.placeOrder call site. */
async function submitCommittedAttemptToConnectorV2(
  connector: ExchangeConnector,
  attempt: ExecutionAttemptV2,
  timeoutMs: number,
): Promise<ExecutionV2VenueObservation> {
  const payload = attempt.exactRequestPayload;
  const order: Order = await connector.placeOrder({
    clientOrderId: payload.clientOrderId,
    symbol: payload.symbol,
    side: payload.side,
    type: payload.type,
    price: payload.price ?? undefined,
    quantity: payload.quantity,
    timeoutMs,
  });
  const { rawVenueObservation, ...normalizedOrder } = order;
  return Object.freeze({
    order,
    trades: Object.freeze([]),
    raw: Object.freeze({
      order: rawVenueObservation ?? Object.freeze(normalizedOrder),
    }),
  });
}

export function createPostgresExecutionV2Service(input: Readonly<{
  db: WaiaPostgresDb;
  connectorFor: ExecutionV2ConnectorResolver;
  assertLiveAuthorized?: (
    context: OrgContext,
    request: BindExecutionAuthorityV2Input,
  ) => Promise<void>;
}>) {
  return Object.freeze({
    async submit(
      context: OrgContext,
      request: BindExecutionAuthorityV2Input,
    ): Promise<ExecutionV2SubmissionResult> {
      if (request.plan.timeInForce !== "GTC") {
        throw new Error("Execution V2 connector cannot represent non-GTC TIF exactly");
      }
      if (request.executionMode === "live") {
        if (!input.assertLiveAuthorized) throw new Error("Execution V2 live path is not authorized");
        await input.assertLiveAuthorized(context, request);
      }
      const authority = await bindExecutionAuthorityV2Postgres(input.db, context, request);
      const connector = input.connectorFor(request.executionMode, authority.attempt.venue);
      const outcome = await dispatchAndRecordExecutionAttemptV2(
        input.db,
        context,
        authority.attempt.executionAttemptId,
        async (_payload, submittedAuthority) => {
          if (submittedAuthority.effectIdentityDigestHex !== authority.attempt.effectIdentityDigestHex) {
            throw new Error("Execution V2 dispatcher authority mismatch");
          }
          return submitCommittedAttemptToConnectorV2(
            connector,
            authority.attempt,
            submittedAuthority.timeoutMs,
          );
        },
      );
      return Object.freeze({ authority, outcome });
    },
  });
}
