/**
 * Closed, immutable schema_version ↔ int2 mapping for proportional Forecast V2 tables.
 * Unknown values fail closed. Canonical digests do not depend on DB encoding.
 */
export const FORECAST_V2_SCHEMA_VERSION_INT2 = {
  "forecast-bundle/v2": 1,
  "forecast/v2": 2,
  "forecast-scenario/v2": 3,
  "forecast-outcome/v2": 4,
  "forecast-calibration/v2": 5,
} as const;

export type ForecastV2SchemaVersionTextV1 = keyof typeof FORECAST_V2_SCHEMA_VERSION_INT2;

const INT2_TO_TEXT: Readonly<Record<number, ForecastV2SchemaVersionTextV1>> = {
  1: "forecast-bundle/v2",
  2: "forecast/v2",
  3: "forecast-scenario/v2",
  4: "forecast-outcome/v2",
  5: "forecast-calibration/v2",
};

export function schemaVersionTextToInt2(value: string): number {
  const mapped = FORECAST_V2_SCHEMA_VERSION_INT2[value as ForecastV2SchemaVersionTextV1];
  if (mapped === undefined) {
    throw new Error(`[schema-version-storage] unknown schema_version text: ${value}`);
  }
  return mapped;
}

export function schemaVersionInt2ToText(value: number): ForecastV2SchemaVersionTextV1 {
  const mapped = INT2_TO_TEXT[value];
  if (mapped === undefined) {
    throw new Error(`[schema-version-storage] unknown schema_version int2: ${value}`);
  }
  return mapped;
}
