import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  traderDee659AuthorityBundleV2,
  traderDee659AuthorityPreregistrationV2,
  traderHistoricalDatasetAuthorityV2,
  traderHistoricalForecastInputPitV2,
  traderHistoricalSimulationRunStartV2,
} from "@/db/schema.postgres";

describe("Historical pre-holdout PostgreSQL schema parity", () => {
  const authorityTables = [
    traderHistoricalDatasetAuthorityV2,
    traderDee659AuthorityPreregistrationV2,
    traderHistoricalSimulationRunStartV2,
    traderDee659AuthorityBundleV2,
    traderHistoricalForecastInputPitV2,
  ];

  it("models the 0191 dataset authority digest rename on every affected table", () => {
    for (const table of authorityTables) {
      const columns = getTableColumns(table);
      expect(columns.datasetAuthorityDigestHex?.name).toBe("dataset_authority_digest_hex");
      expect(columns).not.toHaveProperty("datasetSealDigestHex");
    }
  });

  it("models the required typed authority class on the authority root", () => {
    const columns = getTableColumns(traderHistoricalDatasetAuthorityV2);
    expect(columns.datasetAuthorityClass?.name).toBe("dataset_authority_class");
    expect(columns.datasetAuthorityClass?.notNull).toBe(true);
  });
});
