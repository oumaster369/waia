import { expect, it } from "vitest";

it("reports hermetic default Vitest process env", () => {
  expect(process.env.DATABASE_URL_POSTGRES).toBeUndefined();
  expect(process.env.WAIA_PG_INTEGRATION).toBeUndefined();
  expect(process.env.WAIA_DB_BACKEND).toBeUndefined();
  console.log("hermetic-ok");
});
