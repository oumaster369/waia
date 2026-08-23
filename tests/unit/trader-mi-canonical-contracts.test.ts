import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1,
  CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  DOWNSTREAM_MEASUREMENT_CATEGORIES_V1,
  EXCLUDED_UNMODELED_GATEWAY_KINDS_V1,
  GATEWAY_PRIMITIVE_DISPOSITION_V1,
  type CanonicalGatewayRejectionReasonV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import {
  defineCanonicalMeasurementV1,
  identifyCanonicalMeasurementValueV1,
} from "@/lib/trader/mi/measurement-lineage-v1";
import { MI_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/observation.types";
import { validateCanonicalPrimitiveContractV1 } from "@/lib/trader/market-data/normalization/canonical-pit-contract";
import {
  NORMALIZED_OBSERVATION_KINDS,
  OBSERVATION_SCHEMA_VERSION,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";

const HEX = (value: string): string => createHash("sha256").update(value).digest("hex");

function quote(overrides: Partial<NormalizedObservation> = {}): NormalizedObservation {
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "quote_l1",
    sessionPhase: "US",
    provenance: {
      providerId: "htx_spot",
      venue: "htx",
      feedKind: "quote_l1",
      symbol: "BTC/USDT",
      eventTimeUtc: "2026-08-23T00:00:00.000Z",
      ingestTimeUtc: "2026-08-23T00:00:01.000Z",
    },
    health: "HEALTHY",
    freshnessMs: 1_000,
    latencyMs: 10,
    confidence: 0.9,
    payload: {
      bid: "100",
      ask: "101",
      last: "100.5",
      timestamp: "2026-08-23T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("DEE-681 canonical PIT contracts", () => {
  it("keeps a missing canonical source explicit", () => {
    const reason: CanonicalGatewayRejectionReasonV1 = "SOURCE_UNKNOWN";
    expect(reason).toBe("SOURCE_UNKNOWN");
  });

  it("closes the seven admitted and eleven excluded primitive vocabularies", () => {
    expect(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1).toHaveLength(7);
    expect(CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1).toHaveLength(6);
    expect(EXCLUDED_UNMODELED_GATEWAY_KINDS_V1).toHaveLength(11);
    expect(Object.keys(GATEWAY_PRIMITIVE_DISPOSITION_V1).sort()).toEqual(
      [...NORMALIZED_OBSERVATION_KINDS].sort(),
    );
    expect(DOWNSTREAM_MEASUREMENT_CATEGORIES_V1).toEqual([
      "cross_exchange_confirmation",
      "news_event_cluster",
    ]);
    for (const category of DOWNSTREAM_MEASUREMENT_CATEGORIES_V1) {
      expect(GATEWAY_PRIMITIVE_DISPOSITION_V1[category]).toMatchObject({
        disposition: "EXCLUDED_UNMODELED",
        observationKind: null,
        downstreamMeasurementCategory: category,
      });
    }
  });

  it("maps exact existing provider provenance and rejects provider/kind mismatches", () => {
    expect(validateCanonicalPrimitiveContractV1(quote())).toEqual({
      status: "AVAILABLE",
      kind: "quote_l1",
      source: {
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "quote_l1",
        symbol: "BTC/USDT",
      },
      reason: null,
    });

    expect(
      validateCanonicalPrimitiveContractV1(
        quote({ provenance: { ...quote().provenance, providerId: "alternative_me" } }),
      ),
    ).toMatchObject({ status: "REJECTED", reason: "PROVIDER_KIND_MISMATCH" });
  });

  it("keeps unavailable, invalid, and excluded evidence explicit", () => {
    expect(validateCanonicalPrimitiveContractV1(quote({ health: "UNAVAILABLE", payload: {} }))).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SOURCE_UNAVAILABLE",
    });
    expect(validateCanonicalPrimitiveContractV1(quote({ payload: {} }))).toMatchObject({
      status: "REJECTED",
      reason: "INVALID_PAYLOAD",
    });
    expect(
      validateCanonicalPrimitiveContractV1(
        quote({
          kind: "cross_exchange_confirmation",
          provenance: { ...quote().provenance, feedKind: "cross_exchange_confirmation" },
        }),
      ),
    ).toEqual({ status: "REJECTED", kind: null, source: null, reason: "EXCLUDED_UNMODELED" });
  });

  it("builds deterministic inert definition and value lineage identities", () => {
    const definition = defineCanonicalMeasurementV1({
      organizationId: "org-a",
      category: "cross_exchange_confirmation",
      name: "cross-venue evidence identity",
      inputContracts: [
        {
          observationKind: "quote_l1",
          observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "cross-exchange-confirmation-output-v1",
    });
    const lineageInput = {
      observationId: "00000000-0000-4000-8000-000000000001",
      observationKind: "quote_l1" as const,
      observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
      observationContentDigest: HEX("observation"),
      sourceId: "00000000-0000-4000-8000-000000000002",
      trustAsOfReceiptId: HEX("trust-receipt"),
      trustRevisionId: "00000000-0000-4000-8000-000000000003",
      trustRevisionContentDigest: HEX("trust-revision"),
    };
    const first = identifyCanonicalMeasurementValueV1({
      organizationId: "org-a",
      definition,
      outputContentDigest: HEX("opaque-output"),
      inputs: [lineageInput],
    });
    const second = identifyCanonicalMeasurementValueV1({
      organizationId: "org-a",
      definition,
      outputContentDigest: HEX("opaque-output"),
      inputs: [lineageInput],
    });

    expect(first).toEqual(second);
    expect(first.id).toBe(first.contentDigest);
    expect(first.authority).toBe("INERT_LINEAGE_ONLY");
    expect(definition.authority).toBe("INERT_DEFINITION_ONLY");
    expect(definition).not.toHaveProperty("formula");
    expect(definition).not.toHaveProperty("units");
    expect(definition).not.toHaveProperty("window");
    expect(first).not.toHaveProperty("value");
  });

  it("recomputes definition identity and admits internal MSV lineage without external trust", () => {
    const definition = defineCanonicalMeasurementV1({
      organizationId: "org-a",
      category: "feature_transform",
      name: "internal MSV identity",
      inputContracts: [
        {
          observationKind: "msv_envelope",
          observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        },
      ],
      outputSchemaVersion: "opaque-msv-output-v1",
    });
    const inputs = [
      {
        observationId: "00000000-0000-4000-8000-000000000004",
        observationKind: "msv_envelope" as const,
        observationSchemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        observationContentDigest: HEX("msv-observation"),
        sourceId: "00000000-0000-4000-8000-000000000005",
        trustAsOfReceiptId: null,
        trustRevisionId: null,
        trustRevisionContentDigest: null,
      },
    ];

    const value = identifyCanonicalMeasurementValueV1({
      organizationId: "org-a",
      definition,
      outputContentDigest: HEX("opaque-msv-output"),
      inputs,
    });
    expect(value.inputs).toEqual(inputs);

    expect(() =>
      identifyCanonicalMeasurementValueV1({
        organizationId: "org-a",
        definition: { ...definition, name: "forged after identity" },
        outputContentDigest: HEX("opaque-msv-output"),
        inputs,
      }),
    ).toThrow("CANONICAL_MEASUREMENT_INVALID:definitionIdentity");
  });
});
