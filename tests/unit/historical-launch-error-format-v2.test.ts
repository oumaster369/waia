import { describe, expect, it } from "vitest";
import { formatHistoricalLaunchErrorV2 } from
  "@/lib/trader/historical-simulation-v2/launch-error-format-v2";

describe("Bounded redacted Historical launch diagnostics", () => {
  it("retains the original stack and cleanup errors in a causal chain", () => {
    const primary = new RangeError("Invalid string length");
    primary.stack = "RangeError: Invalid string length\n    at prepare (bootstrap.ts:42:7)";
    const rendered = formatHistoricalLaunchErrorV2(new AggregateError(
      [primary, new Error("RESET_ROLE_FAILED")], "LAUNCH_FAILED", { cause: primary },
    ));
    expect(rendered).toContain(primary.stack);
    expect(rendered).toContain("RESET_ROLE_FAILED");
    expect(rendered).toContain("ERROR_ALREADY_REPORTED");
  });

  it("redacts URLs, authorization headers and short or long credential values", () => {
    const error = new Error('postgresql://runner:pw@host/db?ssl=true https://api.test/?token=pw ' +
      'Bearer abc Authorization: Basic c2hvcnQ6cHc= WAIA_TOKEN=short HTX_SECRET_KEY="tiny" password: "hidden" ' +
      'apiKey=abc&other=value ' + "a".repeat(40));
    const rendered = formatHistoricalLaunchErrorV2(error);
    for (const secret of ["runner:pw", "ssl=true", "token=pw", "Bearer abc", "short",
      "c2hvcnQ6cHc=", "tiny", "hidden", "apiKey=abc", "a".repeat(40)]) {
      expect(rendered).not.toContain(secret);
    }
    expect(rendered).toContain("REDACTED");
  });

  it("contains throwing stack getters and avoids cause/aggregate accessors while preserving primary messages", () => {
    let getterCalls = 0;
    const unreadable = () => { getterCalls += 1; throw new Error("GETTER_FAILURE"); };
    const primary = new Error("PRIMARY_FAILURE");
    Object.defineProperty(primary, "stack", { get: unreadable });
    Object.defineProperty(primary, "cause", { get: unreadable });
    expect(formatHistoricalLaunchErrorV2(primary)).toContain("PRIMARY_FAILURE");
    const aggregate = new AggregateError([], "PRIMARY_AGGREGATE", { cause: primary });
    Object.defineProperty(aggregate, "errors", { get: unreadable });
    expect(formatHistoricalLaunchErrorV2(aggregate)).toContain("PRIMARY_FAILURE");
    const children = [primary];
    Object.defineProperty(children, "0", { get: unreadable });
    const nested = new AggregateError([], "PRIMARY_NESTED");
    Object.defineProperty(nested, "errors", { value: children });
    expect(formatHistoricalLaunchErrorV2(nested)).toContain("PRIMARY_NESTED");
    const proxy = new Proxy({}, { getPrototypeOf: unreadable });
    expect(() => formatHistoricalLaunchErrorV2(proxy)).not.toThrow();
    // Stack is read twice (direct and aggregate cause); both failures and the
    // proxy trap are caught. Cause, aggregate and array accessors never execute.
    expect(getterCalls).toBe(3);
  });

  it("bounds cycles, depth, aggregate width and output, without serializing arbitrary objects", () => {
    const loop = new Error("CYCLE");
    Object.defineProperty(loop, "cause", { value: loop });
    expect(formatHistoricalLaunchErrorV2(loop)).toContain("ERROR_ALREADY_REPORTED");
    let chain: Error = new Error("BOTTOM");
    for (let i = 0; i < 10; i += 1) chain = new Error(`LEVEL_${i}`, { cause: chain });
    expect(formatHistoricalLaunchErrorV2(chain)).toContain("ERROR_CHAIN_TRUNCATED");
    const large = formatHistoricalLaunchErrorV2(new AggregateError(
      Array.from({ length: 50 }, () => new Error("a_".repeat(20_000))), "WIDE",
    ));
    expect(large.length).toBeLessThanOrEqual(32_768);
    expect(large).toContain("TRUNCATED");
    expect(formatHistoricalLaunchErrorV2({ environment: "do-not-print", body: "private" }))
      .not.toMatch(/do-not-print|private/);
  });
});
