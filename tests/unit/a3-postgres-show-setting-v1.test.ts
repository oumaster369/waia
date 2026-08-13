import { describe, expect, it } from "vitest";

import { readPostgresShowSetting } from "@/lib/trader/intelligence/forecast-v2/a3-postgres-measurement-environment-v1";

describe("PostgreSQL SHOW column mapping", () => {
  it("reads setting-named columns (not v/version)", () => {
    expect(readPostgresShowSetting({ server_version: "16.14" }, "server_version")).toBe("16.14");
    expect(readPostgresShowSetting({ block_size: "8192" }, "block_size")).toBe("8192");
    expect(readPostgresShowSetting({ data_checksums: "on" }, "data_checksums")).toBe("on");
    expect(readPostgresShowSetting({ server_encoding: "UTF8" }, "server_encoding")).toBe("UTF8");
    expect(
      readPostgresShowSetting(
        { default_table_access_method: "heap" },
        "default_table_access_method",
      ),
    ).toBe("heap");
  });

  it("does not treat legacy v/version keys as authority when setting column missing", () => {
    expect(readPostgresShowSetting({ v: "16.14" }, "server_version")).toBe("unknown");
    expect(readPostgresShowSetting({ version: "16.14" }, "server_version")).toBe("unknown");
  });
});
