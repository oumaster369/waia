export { HTX_API_DOC_URL, HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
export {
  HtxApiError,
  HtxRestClient,
  type HtxClientConfig,
  type HtxFetchFn,
} from "@/lib/trader/connectors/htx/client";
export {
  DEFAULT_HTX_TRANSPORT_POLICY,
  type HtxTransportPolicy,
} from "@/lib/trader/connectors/htx/transport-policy";
export { HtxTransport } from "@/lib/trader/connectors/htx/transport";
export {
  HtxExchangeConnector,
  type HtxExchangeConnectorConfig,
} from "@/lib/trader/connectors/htx/htx-exchange-connector";
export {
  adaptHtxSpotAccountRealityV2,
  adaptHtxSpotBalanceRealityV2,
  adaptHtxSpotFillRealityV2,
  adaptHtxSpotOrderRealityV2,
  type RawHtxObservationContextV2,
} from "@/lib/trader/connectors/htx/reality-adapter";
