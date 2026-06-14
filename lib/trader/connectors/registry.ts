import "server-only";

import { UnknownConnectorVenueError } from "@/lib/trader/connectors/errors";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { ConnectorCredentialInput, ConnectorVenueId } from "@/lib/trader/connectors/types";

/** Implemented venue ids for DEE-194 / DEE-195. */
export const IMPLEMENTED_CONNECTOR_VENUES = [
  "mock",
  "htx",
] as const satisfies readonly ConnectorVenueId[];

export type ImplementedConnectorVenueId = (typeof IMPLEMENTED_CONNECTOR_VENUES)[number];

export type HtxConnectorFactoryConfig = {
  credentials: ConnectorCredentialInput;
  restHost?: string;
  fetchImpl?: typeof fetch;
};

export type CreateExchangeConnectorConfig =
  | { venueId: "mock" }
  | ({ venueId: "htx" } & HtxConnectorFactoryConfig);

export function isImplementedConnectorVenue(
  venueId: string,
): venueId is ImplementedConnectorVenueId {
  return (IMPLEMENTED_CONNECTOR_VENUES as readonly string[]).includes(venueId);
}

export function createExchangeConnector(venueId: "mock"): ExchangeConnector;
export function createExchangeConnector(
  venueId: "htx",
  config: HtxConnectorFactoryConfig,
): ExchangeConnector;
export function createExchangeConnector(
  venueId: ImplementedConnectorVenueId,
  config?: HtxConnectorFactoryConfig,
): ExchangeConnector {
  if (venueId === "mock") {
    return new MockExchangeConnector();
  }

  if (venueId === "htx") {
    if (!config?.credentials) {
      throw new Error("[trader] HTX connector requires credentials");
    }
    return new HtxExchangeConnector({
      apiKey: config.credentials.apiKey,
      apiSecret: config.credentials.apiSecret,
      restHost: config.restHost,
      fetchImpl: config.fetchImpl,
    });
  }

  throw new UnknownConnectorVenueError(venueId);
}

/**
 * Resolve a connector by venue id string (throws for unknown or not-yet-implemented venues).
 */
export function createExchangeConnectorFromId(
  venueId: string,
  config?: HtxConnectorFactoryConfig,
): ExchangeConnector {
  if (!isImplementedConnectorVenue(venueId)) {
    throw new UnknownConnectorVenueError(venueId);
  }
  if (venueId === "htx") {
    if (!config?.credentials) {
      throw new Error("[trader] HTX connector requires credentials");
    }
    return createExchangeConnector("htx", config);
  }
  return createExchangeConnector("mock");
}
