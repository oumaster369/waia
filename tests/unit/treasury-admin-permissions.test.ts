import { describe, expect, it } from "vitest";

import { permissionsForPlatformRole } from "@/lib/waia-core/permissions/resolve";
import { parseDecimalBigint, serializeDecimalBigint } from "@/lib/waia-core/treasury/admin/money";
import { serializeTransaction } from "@/lib/waia-core/treasury/admin/serialize";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  handleTreasuryTransactionsGet,
  handleTreasuryTransactionsPost,
} from "@/lib/waia-core/treasury/admin/handlers";
import {
  ADMIN_USER,
  HUGE_MICROS,
  ORG_A,
  createWp4Bundle,
  createWp4Deps,
  errorCode,
  getRequest,
  jsonRequest,
} from "@/tests/unit/helpers/treasury-wp4";

describe("DEE-606 WP-4 treasury admin permissions", () => {
  it("1-3 platform admin has read, mutate, and publish", () => {
    const perms = permissionsForPlatformRole("admin");
    expect(perms.has("admin.treasury.read")).toBe(true);
    expect(perms.has("admin.treasury.mutate")).toBe(true);
    expect(perms.has("admin.treasury.publish")).toBe(true);
  });

  it("4 ordinary user lacks all three treasury admin permissions", () => {
    const perms = permissionsForPlatformRole("user");
    expect(perms.has("admin.treasury.read")).toBe(false);
    expect(perms.has("admin.treasury.mutate")).toBe(false);
    expect(perms.has("admin.treasury.publish")).toBe(false);
  });

  it("5 agent lacks all three treasury admin permissions", () => {
    const perms = permissionsForPlatformRole("agent");
    expect(perms.has("admin.treasury.read")).toBe(false);
    expect(perms.has("admin.treasury.mutate")).toBe(false);
    expect(perms.has("admin.treasury.publish")).toBe(false);
  });

  it("6 service lacks all three treasury admin permissions", () => {
    const perms = permissionsForPlatformRole("service");
    expect(perms.has("admin.treasury.read")).toBe(false);
    expect(perms.has("admin.treasury.mutate")).toBe(false);
    expect(perms.has("admin.treasury.publish")).toBe(false);
  });

  it("7 missing session returns 401", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      createWp4Deps({ userId: null, services }),
    );
    expect(result.status).toBe(401);
    expect(errorCode(result)).toBe("UNAUTHORIZED");
  });

  it("8 authenticated unauthorized returns 403", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      createWp4Deps({ userId: ADMIN_USER, permissions: "none", services }),
    );
    expect(result.status).toBe(403);
    expect(errorCode(result)).toBe("FORBIDDEN");
  });

  it("9 target organization is required", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsGet(
      getRequest("/api/admin/treasury/transactions"),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(400);
    expect(errorCode(result)).toBe("ORGANIZATION_ID_REQUIRED");
  });

  it("10 invalid organization returns 400", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: "   ",
        direction: "INFLOW",
        native_amount_atomic: "1",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "draft",
      }),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(400);
    expect(errorCode(result)).toBe("ORGANIZATION_ID_REQUIRED");
  });

  it("11 authorization is checked against the requested Treasury org", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({
      services,
      authorizedOrgs: [ORG_A],
    });
    const allowed = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      deps,
    );
    expect(allowed.status).toBe(200);
    expect(deps.authorizedOrgsSeen).toContain(ORG_A);
  });

  it("12 sqlite production runtime fails closed with 503", async () => {
    const result = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      createWp4Deps({ runtimeKind: "sqlite" }),
    );
    expect(result.status).toBe(503);
    expect(errorCode(result)).toBe("TREASURY_BACKEND_UNAVAILABLE");
  });
});

describe("DEE-606 WP-4 money serialization", () => {
  it("13-14 bigint above MAX_SAFE_INTEGER round-trips as a decimal string", () => {
    const parsed = parseDecimalBigint(HUGE_MICROS, "amount");
    expect(parsed).toBe(9007199254740993n);
    expect(serializeDecimalBigint(parsed)).toBe(HUGE_MICROS);
  });

  it("15 JSON Number monetary authority is rejected", () => {
    expect(() => parseDecimalBigint(1000000, "amount")).toThrow(TreasuryValidationError);
  });

  it("16 floating monetary value is rejected", () => {
    expect(() => parseDecimalBigint("1.5", "amount")).toThrow(TreasuryValidationError);
    expect(() => parseDecimalBigint("1e6", "amount")).toThrow(TreasuryValidationError);
  });

  it("17 malformed decimal string is rejected", () => {
    expect(() => parseDecimalBigint(" 1 ", "amount")).toThrow(TreasuryValidationError);
    expect(() => parseDecimalBigint("12abc", "amount")).toThrow(TreasuryValidationError);
  });

  it("18-20 admin serializers keep bigint as strings and dates as ISO", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: HUGE_MICROS,
        native_decimals: 6,
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "huge",
      }),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(200);
    const body = result.body as { transaction: { nativeAmountAtomic: string; occurredAt: string } };
    expect(body.transaction.nativeAmountAtomic).toBe(HUGE_MICROS);
    expect(body.transaction.occurredAt).toBe("2026-08-01T00:00:00.000Z");
    expect(() => JSON.stringify(result.body)).not.toThrow();
    const tx = await services.domain.repository.listTransactions({ organizationId: ORG_A });
    expect(() => JSON.stringify(serializeTransaction(tx[0]))).not.toThrow();
  });

  it("rejects JSON Number authority on HTTP create", async () => {
    const { services } = createWp4Bundle();
    const result = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: 1000000,
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "number",
      }),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(400);
    expect(errorCode(result)).toBe("JSON_NUMBER_NOT_AUTHORITY");
  });
});
