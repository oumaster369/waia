import "server-only";

import { UnknownConnectorVenueError } from "@/lib/trader/connectors/errors";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { ConnectorVenueId } from "@/lib/trader/connectors/types";

/** Implemented venue ids for DEE-194. */
export const IMPLEMENTED_CONNECTOR_VENUES = ["mock"] as const satisfies readonly ConnectorVenueId[];

export type ImplementedConnectorVenueId = (typeof IMPLEMENTED_CONNECTOR_VENUES)[number];

export function isImplementedConnectorVenue(
  venueId: string,
): venueId is ImplementedConnectorVenueId {
  return (IMPLEMENTED_CONNECTOR_VENUES as readonly string[]).includes(venueId);
}

/**
 * Factory for exchange connectors. Extensible for HTX and future venues (DEE-195+).
 */
export function createExchangeConnector(venueId: ImplementedConnectorVenueId): ExchangeConnector {
  if (venueId === "mock") {
    return new MockExchangeConnector();
  }
  throw new UnknownConnectorVenueError(venueId);
}

/**
 * Resolve a connector by venue id string (throws for unknown or not-yet-implemented venues).
 */
export function createExchangeConnectorFromId(venueId: string): ExchangeConnector {
  if (!isImplementedConnectorVenue(venueId)) {
    throw new UnknownConnectorVenueError(venueId);
  }
  return createExchangeConnector(venueId);
}
