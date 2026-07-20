import { describe, expect, it } from "vitest";

import {
  assertHtrPostgresFixtureUserId,
  htrPostgresFixtureEmail,
  HTR_PG_USER_A,
} from "@/tests/integration/htr-postgres-fixture-prelude";

describe("htr-postgres-fixture-prelude", () => {
  it("accepts deterministic RFC 4122 UUID v4 fixture identities", () => {
    expect(() => assertHtrPostgresFixtureUserId(HTR_PG_USER_A)).not.toThrow();
    expect(() =>
      assertHtrPostgresFixtureUserId("00000000-0000-4000-8022-000000030701"),
    ).not.toThrow();
  });

  it("rejects non-RFC4122 fixture identities", () => {
    expect(() => assertHtrPostgresFixtureUserId("00000000-0000-4000-8022-00000003cb001")).toThrow(
      "HTR_POSTGRES_FIXTURE:INVALID_RFC4122_USER_ID",
    );
  });

  it("builds deterministic fixture emails", () => {
    expect(htrPostgresFixtureEmail(HTR_PG_USER_A)).toBe(`${HTR_PG_USER_A}@waia.invalid`);
  });
});
