import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  adaptHtxSpotAccountRealityV2,
  adaptHtxSpotBalanceRealityV2,
  adaptHtxSpotFillRealityV2,
  adaptHtxSpotOrderRealityV2,
  type RawHtxObservationContextV2,
} from "@/lib/trader/connectors/htx/reality-adapter";
import type { AccountInfo, Balance, Order, Trade } from "@/lib/trader/connectors/types";
import type { ExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import { adaptExecutionReportV2ToReality } from "@/lib/trader/execution/v2/reality-adapter";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { AppendRealitySourceReportV2Input, RealityAccountContext } from "./repository-postgres";
import {
  ingestRealitySourceReportV2Postgres,
  type RealityIngestResultV2,
} from "./ingest-postgres";

export type RealityIngressV2 =
  | Readonly<{ kind: "EXECUTION_REPORT_V2"; report: ExecutionReportV2 }>
  | Readonly<{ kind: "HTX_SPOT_ORDER_REST"; context: RawHtxObservationContextV2; order: Order }>
  | Readonly<{ kind: "HTX_SPOT_FILL_REST"; context: RawHtxObservationContextV2; trade: Trade }>
  | Readonly<{
      kind: "HTX_SPOT_BALANCE_REST";
      context: RawHtxObservationContextV2 & Readonly<{ sourceNativeId: string }>;
      balance: Balance;
    }>
  | Readonly<{
      kind: "HTX_SPOT_ACCOUNT_REST";
      context: RawHtxObservationContextV2;
      account: AccountInfo & Readonly<{ accountState: string }>;
    }>
  | Readonly<{ kind: "EXCLUDED"; sourceClass: string; evidence: unknown }>;

export type RealityIngressRouteV2 =
  | Readonly<{
      status: "ADMITTED";
      sourceKind: Exclude<RealityIngressV2["kind"], "EXCLUDED">;
      drafts: readonly AppendRealitySourceReportV2Input[];
    }>
  | Readonly<{
      status: "EXCLUDED";
      sourceClass: string;
      reasonCode: "SOURCE_CLASS_NOT_RATIFIED";
      evidenceDigestHex: string;
    }>
  | Readonly<{
      status: "FAIL_UNCERTAIN";
      sourceClass: "UNKNOWN_SOURCE_CLASS";
      reasonCode: "UNKNOWN_SOURCE_CLASS";
      evidenceDigestHex: string;
    }>;

/** Exhaustive ingress router. Excluded evidence receives a digest receipt and is never silently dropped. */
export function routeRealityIngressV2(input: RealityIngressV2): RealityIngressRouteV2 {
  switch (input.kind) {
    case "EXECUTION_REPORT_V2":
      return Object.freeze({
        status: "ADMITTED",
        sourceKind: input.kind,
        drafts: adaptExecutionReportV2ToReality(input.report),
      });
    case "HTX_SPOT_ORDER_REST":
      return Object.freeze({
        status: "ADMITTED",
        sourceKind: input.kind,
        drafts: [adaptHtxSpotOrderRealityV2(input.context, input.order)],
      });
    case "HTX_SPOT_FILL_REST":
      return Object.freeze({
        status: "ADMITTED",
        sourceKind: input.kind,
        drafts: [adaptHtxSpotFillRealityV2(input.context, input.trade)],
      });
    case "HTX_SPOT_BALANCE_REST":
      return Object.freeze({
        status: "ADMITTED",
        sourceKind: input.kind,
        drafts: [adaptHtxSpotBalanceRealityV2(input.context, input.balance)],
      });
    case "HTX_SPOT_ACCOUNT_REST":
      return Object.freeze({
        status: "ADMITTED",
        sourceKind: input.kind,
        drafts: [adaptHtxSpotAccountRealityV2(input.context, input.account)],
      });
    case "EXCLUDED":
      return Object.freeze({
        status: "EXCLUDED",
        sourceClass: input.sourceClass,
        reasonCode: "SOURCE_CLASS_NOT_RATIFIED",
        evidenceDigestHex: computeStableJsonDigest(input.evidence),
      });
    default:
      return Object.freeze({
        status: "FAIL_UNCERTAIN",
        sourceClass: "UNKNOWN_SOURCE_CLASS",
        reasonCode: "UNKNOWN_SOURCE_CLASS",
        evidenceDigestHex: computeStableJsonDigest({
          sourceClass: "UNKNOWN_SOURCE_CLASS",
          inputType: typeof input,
        }),
      });
  }
}

export async function ingestRealityIngressV2Postgres(
  db: WaiaPostgresDb,
  context: RealityAccountContext,
  input: RealityIngressV2,
): Promise<RealityIngressRouteV2 | readonly RealityIngestResultV2[]> {
  const routed = routeRealityIngressV2(input);
  if (routed.status !== "ADMITTED") return routed;
  const results: RealityIngestResultV2[] = [];
  for (const draft of routed.drafts) {
    results.push(await ingestRealitySourceReportV2Postgres(db, context, draft));
  }
  return Object.freeze(results);
}
