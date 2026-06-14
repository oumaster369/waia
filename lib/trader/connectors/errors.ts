/** Thrown when a connector method is not supported (e.g. futures in spot-only MVP). */
export class ConnectorNotSupportedError extends Error {
  readonly code = "CONNECTOR_NOT_SUPPORTED";

  constructor(feature: string) {
    super(`[trader] connector feature not supported in MVP: ${feature}`);
    this.name = "ConnectorNotSupportedError";
  }
}

/** Thrown when an exchange connector venue id is unknown to the registry. */
export class UnknownConnectorVenueError extends Error {
  readonly code = "UNKNOWN_CONNECTOR_VENUE";

  constructor(venueId: string) {
    super(`[trader] unknown connector venue: ${venueId}`);
    this.name = "UnknownConnectorVenueError";
  }
}
