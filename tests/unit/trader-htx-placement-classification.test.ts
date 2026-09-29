import { describe, expect, it } from "vitest";

import { classifyHtxPlacementHttp } from "@/lib/trader/connectors/htx/classify-htx-placement";

const UNSAFE = Number.MAX_SAFE_INTEGER + 2;

describe("HTX placement classification (DEE-1151 P0-5)", () => {
  it.each([
    ["safe integer", { status: "ok", data: 357630527817872 }, "accepted", "357630527817872"],
    ["digit string", { status: "ok", data: "9007199254740993" }, "accepted", "9007199254740993"],
  ] as const)("accepts a %s order id", (_label, body, kind, orderId) => {
    expect(classifyHtxPlacementHttp({ httpStatus: 200, body })).toEqual({ kind, orderId });
  });

  it.each([
    ["missing body", 200, null],
    ["ok without data", 200, { status: "ok" }],
    ["unsafe number", 200, { status: "ok", data: UNSAFE }],
    ["error without code", 200, { status: "error", data: null }],
    ["error with data", 200, { status: "error", "err-code": "busy", data: 1 }],
    ["timeout status", 408, { status: "error", "err-code": "timeout", data: null }],
    ["rate limit", 429, { status: "error", "err-code": "too-many", data: null }],
    ["server error", 503, { status: "error", "err-code": "busy", data: null }],
    ["unreadable text", 200, "not-json"],
  ])("leaves %s unknown", (_label, httpStatus, body) => {
    expect(classifyHtxPlacementHttp({ httpStatus, body })).toEqual({ kind: "unknown" });
  });

  it.each([200, 400])("rejects HTTP %i business errors without an order id", (httpStatus) => {
    expect(
      classifyHtxPlacementHttp({
        httpStatus,
        body: { status: "error", "err-code": "order-value-min-error", data: null },
      }),
    ).toEqual({ kind: "rejected", errCode: "order-value-min-error" });
    expect(
      classifyHtxPlacementHttp({
        httpStatus,
        body: { status: "error", "err-code": "account-frozen" },
      }),
    ).toEqual({ kind: "rejected", errCode: "account-frozen" });
  });
});
