import { describe, expect, it, vi } from "vitest";

import {
  PUBLIC_WORK_PLAN_MAX_PROJECTS,
  resolvePublicWorkPlanConfig,
} from "@/lib/public-work-plan/config";
import { PUBLIC_WORK_PLAN_LINEAR_QUERY } from "@/lib/public-work-plan/linear-client";
import { PublicWorkPlanReader } from "@/lib/public-work-plan/service";

const ENV = {
  WAIA_PUBLIC_LINEAR_API_KEY: "server-secret",
  WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "project-b,project-a",
  WAIA_PUBLIC_LINEAR_DATE_ALLOWLIST: "project-a",
};

function linearResponse(
  projectName: string,
  issues: Array<Record<string, unknown>>,
  extras: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      data: {
        projects: {
          nodes: [
            {
              name: projectName,
              issues: { nodes: issues },
              ...extras,
            },
          ],
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function issue(
  identifier: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    identifier,
    title: `Public ${identifier}`,
    url: `https://linear.app/deepsense/issue/${identifier}/public-title`,
    priority: 3,
    dueDate: "2026-09-30",
    state: { name: "Todo", type: "unstarted" },
    ...overrides,
  };
}

describe("DEE-673 public work-plan contract", () => {
  it("requires a secret and an explicit bounded allowlist without a fallback", () => {
    expect(() => resolvePublicWorkPlanConfig({})).toThrowError(
      "Public work plan is not configured.",
    );
    expect(() =>
      resolvePublicWorkPlanConfig({ WAIA_PUBLIC_LINEAR_API_KEY: "secret" }),
    ).toThrowError("Public work plan is not configured.");
    expect(() =>
      resolvePublicWorkPlanConfig({
        WAIA_PUBLIC_LINEAR_API_KEY: "secret",
        WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha,ALPHA",
      }),
    ).toThrowError("Public work plan is not configured.");
    expect(() =>
      resolvePublicWorkPlanConfig({
        WAIA_PUBLIC_LINEAR_API_KEY: "secret",
        WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: Array.from(
          { length: PUBLIC_WORK_PLAN_MAX_PROJECTS + 1 },
          (_, index) => `project-${index}`,
        ).join(","),
      }),
    ).toThrowError("Public work plan is not configured.");
    expect(() =>
      resolvePublicWorkPlanConfig({
        WAIA_PUBLIC_LINEAR_API_KEY: "secret",
        WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
        WAIA_PUBLIC_LINEAR_DATE_ALLOWLIST: "not-public",
      }),
    ).toThrowError("Public work plan is not configured.");
  });

  it("uses only a fixed read query and projects allowlisted safe fields in deterministic groups", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { projectId: string; projectSlug: string; issueLimit: number };
      };
      expect(body.query).toBe(PUBLIC_WORK_PLAN_LINEAR_QUERY);
      expect(body.query.trimStart()).toMatch(/^query\s/);
      expect(body.query).not.toMatch(/\bmutation\b/i);
      expect(body.query).not.toContain("description");
      expect(body.query).not.toContain("assignee");
      expect(body.query).not.toContain("comments");
      expect(body.query).not.toContain("attachments");
      expect(body.query).not.toContain("labels");
      expect(body.query).not.toContain("estimate");
      expect(body.query).not.toContain("relations");
      expect(body.query).toContain("{ id: { eq: $projectId } }");
      expect(body.query).toContain("{ slugId: { eq: $projectSlug } }");
      expect(body.variables.issueLimit).toBe(48);
      expect(init?.headers).toMatchObject({ Authorization: "server-secret" });

      expect(body.variables.projectId).toBe(body.variables.projectSlug);
      if (body.variables.projectId === "project-a") {
        return linearResponse(
          "Alpha",
          [
            issue("DEE-20", {
              priority: 2,
              state: { name: "In Progress", type: "started" },
              description: "PRIVATE DESCRIPTION",
              assignee: { email: "private@example.com" },
              labels: [{ name: "private" }],
              estimate: 13,
            }),
            issue("DEE-3", { priority: 1 }),
          ],
          { workspace: { name: "PRIVATE WORKSPACE" } },
        );
      }
      return linearResponse("Beta", [
        issue("DEE-11"),
        issue("DEE-2", { priority: 2 }),
        issue("DEE-30", { state: { name: "Triage", type: "triage" } }),
      ]);
    });
    const reader = new PublicWorkPlanReader({ fetch: fetchMock });
    const result = await reader.read(ENV);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      schemaVersion: "waia-public-work-plan/v1",
      state: "available",
      projects: [
        {
          name: "Alpha",
          statuses: [
            {
              status: { label: "In Progress", type: "started" },
              issues: [
                {
                  identifier: "DEE-20",
                  title: "Public DEE-20",
                  url: "https://linear.app/deepsense/issue/DEE-20/public-title",
                  status: { label: "In Progress", type: "started" },
                  priorityLabel: "High",
                  dueDate: "2026-09-30",
                },
              ],
            },
            {
              status: { label: "Todo", type: "unstarted" },
              issues: [
                {
                  identifier: "DEE-3",
                  title: "Public DEE-3",
                  url: "https://linear.app/deepsense/issue/DEE-3/public-title",
                  status: { label: "Todo", type: "unstarted" },
                  priorityLabel: "Urgent",
                  dueDate: "2026-09-30",
                },
              ],
            },
          ],
        },
        {
          name: "Beta",
          statuses: [
            {
              status: { label: "Todo", type: "unstarted" },
              issues: [
                {
                  identifier: "DEE-2",
                  title: "Public DEE-2",
                  url: "https://linear.app/deepsense/issue/DEE-2/public-title",
                  status: { label: "Todo", type: "unstarted" },
                  priorityLabel: "High",
                },
                {
                  identifier: "DEE-11",
                  title: "Public DEE-11",
                  url: "https://linear.app/deepsense/issue/DEE-11/public-title",
                  status: { label: "Todo", type: "unstarted" },
                  priorityLabel: "Medium",
                },
              ],
            },
            {
              status: { label: "Triage", type: "triage" },
              issues: [
                {
                  identifier: "DEE-30",
                  title: "Public DEE-30",
                  url: "https://linear.app/deepsense/issue/DEE-30/public-title",
                  status: { label: "Triage", type: "triage" },
                  priorityLabel: "Medium",
                },
              ],
            },
          ],
        },
      ],
      lastSuccessfulSyncAt: expect.any(String),
    });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("server-secret");
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("project-a");
    expect(serialized).not.toContain("project-b");
  });

  it("serves only matching bounded stale data and becomes unavailable after stale expiry", async () => {
    let nowMs = Date.parse("2026-08-23T10:00:00.000Z");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(linearResponse("Beta", [issue("DEE-1")]))
      .mockResolvedValueOnce(linearResponse("Alpha", [issue("DEE-2")]))
      .mockRejectedValue(new Error("PRIVATE provider failure"));
    const reader = new PublicWorkPlanReader({
      fetch: fetchMock,
      now: () => new Date(nowMs),
      freshTtlMs: 100,
      maxStaleMs: 1_000,
    });

    const available = await reader.read(ENV);
    expect(available.body.state).toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    nowMs += 50;
    const cached = await reader.read(ENV);
    expect(cached.body.state).toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    nowMs += 100;
    const stale = await reader.read(ENV);
    expect(stale).toMatchObject({ status: 200, outcome: "stale" });
    expect(stale.body.state).toBe("stale");
    expect(stale.body.projects).toEqual(available.body.projects);
    expect(JSON.stringify(stale.body)).not.toContain("PRIVATE provider failure");

    const changedAllowlist = {
      ...ENV,
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "different-project",
      WAIA_PUBLIC_LINEAR_DATE_ALLOWLIST: "",
    };
    const mismatched = await reader.read(changedAllowlist);
    expect(mismatched).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(mismatched.body).toMatchObject({ state: "unavailable", projects: [] });

    nowMs += 1_000;
    const expired = await reader.read(ENV);
    expect(expired).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(expired.body).toMatchObject({ state: "unavailable", projects: [] });
  });

  it("fails closed on GraphQL partial errors, invalid URLs and missing configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { projects: { nodes: [] } }, errors: [{ message: "PRIVATE" }] }),
          { status: 200 },
        ),
      );
    const reader = new PublicWorkPlanReader({ fetch: fetchMock });
    const providerFailure = await reader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
    });
    expect(providerFailure).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(providerFailure.body).toMatchObject({ state: "unavailable", projects: [] });
    expect(JSON.stringify(providerFailure.body)).not.toContain("PRIVATE");

    const noMatchReader = new PublicWorkPlanReader({
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { projects: { nodes: [] } } }), { status: 200 }),
        ),
    });
    const noMatch = await noMatchReader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "unknown-project",
    });
    expect(noMatch).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(noMatch.body.projects).toEqual([]);

    const invalidValueReader = new PublicWorkPlanReader({
      fetch: vi.fn().mockResolvedValue(linearResponse("Alpha", [issue("not-an-identifier")])),
    });
    const invalidValue = await invalidValueReader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
    });
    expect(invalidValue).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(invalidValue.body.projects).toEqual([]);

    const invalidUrlReader = new PublicWorkPlanReader({
      fetch: vi
        .fn()
        .mockResolvedValue(
          linearResponse("Alpha", [issue("DEE-1", { url: "http://private.invalid/issue" })]),
        ),
    });
    const invalidUrl = await invalidUrlReader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
    });
    expect(invalidUrl).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(invalidUrl.body.projects).toEqual([]);

    const oversizedReader = new PublicWorkPlanReader({
      fetch: vi.fn().mockResolvedValue(
        linearResponse(
          "Alpha",
          Array.from({ length: 97 }, (_, index) => issue(`DEE-${index + 1}`)),
        ),
      ),
    });
    const oversized = await oversizedReader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
    });
    expect(oversized).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(oversized.body.projects).toEqual([]);

    const missingConfig = await reader.read({});
    expect(missingConfig).toMatchObject({ status: 503, outcome: "config_error" });
    expect(missingConfig.body).toEqual({
      schemaVersion: "waia-public-work-plan/v1",
      state: "unavailable",
      projects: [],
      lastSuccessfulSyncAt: null,
    });
  });

  it("aborts the provider read at the server timeout and returns no partial data", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new Error("PRIVATE timeout")));
      });
    });
    const reader = new PublicWorkPlanReader({ fetch: fetchMock, timeoutMs: 5 });

    const result = await reader.read({
      WAIA_PUBLIC_LINEAR_API_KEY: "secret",
      WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST: "alpha",
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: 503, outcome: "internal_error" });
    expect(result.body).toMatchObject({ state: "unavailable", projects: [] });
    expect(JSON.stringify(result.body)).not.toContain("PRIVATE timeout");
  });
});
