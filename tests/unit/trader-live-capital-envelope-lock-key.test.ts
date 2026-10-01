import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { liveCapitalEnvelopeAdvisoryLockKeyV1 } from "@/lib/trader/risk/v2/live-capital-envelope-postgres";

describe("live capital envelope advisory lock", () => {
  it("widens the lock id and keeps the account row predicate", () => {
    expect(
      liveCapitalEnvelopeAdvisoryLockKeyV1(
        "00000000-0000-4000-8000-000000114501",
        "synthetic-envelope-account",
      ),
    ).toBe(
      "live-capital-envelope:1145:00000000-0000-4000-8000-000000114501:synthetic-envelope-account",
    );
    const source = readFileSync("lib/trader/risk/v2/live-capital-envelope-postgres.ts", "utf8");
    expect(source).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(source).not.toContain("hashtext(");
    expect(source).toContain(
      "where organization_id = ${organizationId}::uuid and account_id = ${accountId}",
    );
    expect(source).toContain("for update");
  });
});
