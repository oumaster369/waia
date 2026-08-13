import { describe, expect, it } from "vitest";
import type postgres from "postgres";

import {
  ORGANIZATION_SCOPE_COLUMN,
  OrgScopeError,
  orgScopedPostgresPredicate,
} from "@/lib/waia-core/scope/org-context";

/**
 * Structural regression for the mandatory shared org-scoping predicate (ADR-0007).
 *
 * These DEE-518 Postgres services build raw `postgres.js` template queries, so the shared
 * helper is proven here to be impossible to call without an organization identity and to
 * always emit an `organization_id = <uuid>` predicate — there is no unscoped mode.
 *
 * The `sql` tagged-template + identifier interface is faithfully stubbed so the test stays
 * hermetic (no database connection, no open handles) while still capturing exactly what SQL
 * fragment structure the helper produces.
 */

type CapturedIdentifier = { readonly __identifier: string };
type CapturedFragment = {
  readonly __fragment: true;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
};

function makeStubSql(): { sql: postgres.Sql; identifiers: string[] } {
  const identifiers: string[] = [];
  const sqlFn = (first: unknown, ...rest: unknown[]): unknown => {
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
      return {
        __fragment: true,
        strings: [...(first as unknown as string[])],
        values: rest,
      } satisfies CapturedFragment;
    }
    // identifier helper: sql("organization_id")
    identifiers.push(String(first));
    return { __identifier: String(first) } satisfies CapturedIdentifier;
  };
  return { sql: sqlFn as unknown as postgres.Sql, identifiers };
}

const ORG = "00000000-0000-4000-8000-0000000000a1";

describe("orgScopedPostgresPredicate — mandatory shared org scoping (ADR-0007)", () => {
  it("fails closed when organizationId is undefined", () => {
    const { sql } = makeStubSql();
    expect(() => orgScopedPostgresPredicate(sql, undefined)).toThrow(OrgScopeError);
  });

  it("fails closed when organizationId is null", () => {
    const { sql } = makeStubSql();
    expect(() => orgScopedPostgresPredicate(sql, null)).toThrow(OrgScopeError);
  });

  it("fails closed when organizationId is empty / whitespace", () => {
    const { sql } = makeStubSql();
    expect(() => orgScopedPostgresPredicate(sql, "")).toThrow(OrgScopeError);
    expect(() => orgScopedPostgresPredicate(sql, "   ")).toThrow(OrgScopeError);
  });

  it("default predicate structurally contains organization_id scoping", () => {
    const { sql, identifiers } = makeStubSql();
    const fragment = orgScopedPostgresPredicate(sql, ORG) as unknown as CapturedFragment;

    // Column identifier is the canonical organization scope column.
    expect(identifiers).toEqual([ORGANIZATION_SCOPE_COLUMN]);
    expect(ORGANIZATION_SCOPE_COLUMN).toBe("organization_id");

    // Fragment shape: `<identifier> = <value>::uuid`.
    expect(fragment.__fragment).toBe(true);
    const rendered = fragment.strings.join("?");
    expect(rendered).toContain(" = ");
    expect(rendered).toContain("::uuid");

    // The scoped column identifier and the org value are both bound into the fragment.
    const identValue = fragment.values[0] as CapturedIdentifier;
    expect(identValue.__identifier).toBe("organization_id");
    expect(fragment.values[1]).toBe(ORG);
  });

  it("trims the organization identity before binding", () => {
    const { sql } = makeStubSql();
    const fragment = orgScopedPostgresPredicate(sql, `  ${ORG}  `) as unknown as CapturedFragment;
    expect(fragment.values[1]).toBe(ORG);
  });

  it("honors an explicit column override but still binds the organization identity", () => {
    const { sql, identifiers } = makeStubSql();
    const fragment = orgScopedPostgresPredicate(sql, ORG, {
      column: "b.organization_id",
    }) as unknown as CapturedFragment;
    expect(identifiers).toEqual(["b.organization_id"]);
    expect(fragment.values[1]).toBe(ORG);
  });

  it("exposes no unscoped mode — every call binds an org identity and a scope column", () => {
    const { sql, identifiers } = makeStubSql();
    // Two independent calls each produce exactly one scope-column identifier + org value.
    orgScopedPostgresPredicate(sql, ORG);
    orgScopedPostgresPredicate(sql, ORG);
    expect(identifiers).toEqual([ORGANIZATION_SCOPE_COLUMN, ORGANIZATION_SCOPE_COLUMN]);
  });
});
