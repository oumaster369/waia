import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(
  process.cwd(),
  "db/migrations_postgres/0195_historical_information_sufficiency_authority_v2.sql",
), "utf8");

describe("DEE-919 historical InformationSufficiency PostgreSQL guard", () => {
  it("keeps legacy evidence exact while requiring the historical discriminator for WFP", () => {
    expect(migration).toContain("historyScope' <> 'WALK_FORWARD_PREDICTIVE'");
    expect(migration).toContain("historyScope' = 'WALK_FORWARD_PREDICTIVE'");
    expect(migration).toContain("'historicalDatasetTrustAuthority'");
    expect(migration).toContain("waia_historical_dataset_trust_authority_v2_valid");
  });

  it("binds the nested authority to receipt/evidence and its canonical digest", () => {
    for (const field of [
      "organizationId", "symbol", "sourceId", "observationId",
      "observationContentDigestHex", "trustAsOfReceiptId", "trustRevisionId",
      "trustRevisionContentDigestHex", "trustScore", "contentDigestHex",
    ]) expect(migration).toContain(`'${field}'`);
    expect(migration).toContain("waia_canonical_jsonb_v1(authority - 'contentDigestHex')");
  });

  it("enforces market-public and local-record dual-time chronology", () => {
    expect(migration).toContain(
      "(authority ->> 'publicAvailableAt')::timestamptz <=\n      (authority ->> 'canonicalRecordAvailableAt')::timestamptz",
    );
    expect(migration).toContain(
      "(authority ->> 'canonicalRecordIngestTime')::timestamptz <=\n      (authority ->> 'epistemicRecordCutoff')::timestamptz",
    );
  });
});
