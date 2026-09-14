import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { requireTwinPersonalScope } from "@/lib/ai-twin/model/scope-postgres";

const sql = readFileSync(
  join(process.cwd(), "db/migrations_postgres/0209_ai_twin_epistemic_persistence_v1.sql"),
  "utf8",
);
const schema = readFileSync(join(process.cwd(), "db/schema.postgres.ts"), "utf8");

const TABLE_RE = /CREATE TABLE public\.(ai_twin_[a-z_]+) \(([\s\S]*?)\);/g;

describe("AI-TWIN epistemic tenant isolation (DEE-871 / ADR-0007)", () => {
  it("requires both organization and subject on every 0209 table", () => {
    const tables: string[] = [];
    for (const match of sql.matchAll(TABLE_RE)) {
      const name = match[1];
      const body = match[2];
      tables.push(name);
      expect(body, name).toContain("organization_id uuid NOT NULL");
      expect(body, name).toContain("subject_user_id uuid NOT NULL");
      expect(body, name).toMatch(
        /FOREIGN KEY \(organization_id, subject_user_id\)[\s\S]*organization_members/,
      );
    }
    expect(tables.length).toBeGreaterThanOrEqual(15);
    expect(tables.some((name) => name.includes("private_"))).toBe(false);
  });

  it("leads operational indexes with both tenant dimensions", () => {
    const indexes = [
      ...sql.matchAll(/CREATE(?: UNIQUE)? INDEX (\S+)\s+ON public\.(ai_twin_\S+)\s+\(([^)]+)\)/g),
    ];
    expect(indexes.length).toBeGreaterThan(0);
    for (const [, , , columns] of indexes) {
      const leading = columns.split(",").map((part) => part.trim());
      expect(leading[0]).toBe("organization_id");
      expect(leading[1]).toBe("subject_user_id");
    }
  });

  it("does not expand AI-TWIN RLS and keeps application scoping as the isolation gate", () => {
    expect(sql).not.toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toContain("FORCE ROW LEVEL SECURITY");
    expect(schema).toContain("aiTwinObjectVersions");
    expect(schema).toContain('subjectUserId: uuid("subject_user_id")');
  });

  it("rejects missing or cross-shaped personal scope before SQL is produced", () => {
    expect(() => requireTwinPersonalScope(null)).toThrow(OrgScopeError);
    expect(() => requireTwinPersonalScope({ organizationId: "", subjectId: "x" })).toThrow(
      OrgScopeError,
    );
    expect(() =>
      requireTwinPersonalScope({
        organizationId: "22222222-2222-4222-8222-222222222222",
        subjectId: "",
      }),
    ).toThrow(OrgScopeError);
    expect(() =>
      requireTwinPersonalScope({
        organizationId: "22222222-2222-4222-8222-222222222222",
        subjectId: "not-a-uuid",
      }),
    ).toThrow(OrgScopeError);
    expect(
      requireTwinPersonalScope({
        organizationId: "22222222-2222-4222-8222-222222222222",
        subjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      organizationId: "22222222-2222-4222-8222-222222222222",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
