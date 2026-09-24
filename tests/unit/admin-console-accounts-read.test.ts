import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("admin console accounts read", () => {
  it("does not select credential ciphertext", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/trader/admin-console/repositories/overview.postgres.ts"),
      "utf8",
    );
    expect(source).toContain("exchange_account_id");
    expect(source).not.toContain("encrypted_payload");
    expect(source).not.toContain("wrapped_dek");
    expect(source).not.toContain("api_key");
  });
});
