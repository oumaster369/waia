import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DEE-673 public work-plan HTTP boundary", () => {
  it("is GET-only, server-owned, fixed-query and mutation-free", () => {
    const root = process.cwd();
    const route = readFileSync(path.join(root, "app/api/public/work-plan/route.ts"), "utf8");
    const files = ["config.ts", "linear-client.ts", "projection.ts", "service.ts", "types.ts"]
      .map((file) => readFileSync(path.join(root, "lib/public-work-plan", file), "utf8"))
      .join("\n");

    expect(route).toContain("export async function GET()");
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(route).not.toContain("request.url");
    expect(route).not.toContain("organization_id");
    expect(files).toContain("query PublicWorkPlanProject");
    expect(files).toContain("projects(");
    expect(files).toContain("slugId: { eq: $projectSlug }");
    expect(files).not.toContain("project(id:");
    expect(files).not.toMatch(/\bmutation\b/i);
    expect(files).not.toContain("NEXT_PUBLIC_");
    expect(files).not.toContain("iframe");
    expect(files).not.toMatch(/createIssue|updateIssue|deleteIssue|createComment|webhook/);
    expect(files).not.toContain("@linear/sdk");
  });
});
