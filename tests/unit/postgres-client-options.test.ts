import { afterEach, describe, expect, it } from "vitest";

import { waiaPostgresJsDriverOptions } from "@/db/postgres-client";

describe("waiaPostgresJsDriverOptions", () => {
  afterEach(() => {
    delete process.env.WAIA_POSTGRES_PREPARE_STATEMENTS;
  });

  it("defaults prepare=false for transaction pooler safety (Workers)", () => {
    delete process.env.WAIA_POSTGRES_PREPARE_STATEMENTS;
    expect(waiaPostgresJsDriverOptions()).toEqual({ max: 1, prepare: false });
  });

  it("sets prepare=true only when WAIA_POSTGRES_PREPARE_STATEMENTS is literally true", () => {
    process.env.WAIA_POSTGRES_PREPARE_STATEMENTS = "true";
    expect(waiaPostgresJsDriverOptions()).toEqual({ max: 1, prepare: true });
  });
});
