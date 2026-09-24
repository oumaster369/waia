import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
let query = "organization_id=org-a&mode=live";
vi.mock("@/components/trader/admin-console/data/read-context", () => ({
  useAdminReadContext: () => ({ query, href: (path: string) => `${path}?${query}` }),
}));
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
const body = (org: string, value: string, mode = "live") => ({
  schemaVersion: "admin-console/v1",
  scope: { kind: "organization", organizationId: org },
  mode,
  revision: org,
  data: { value },
});
afterEach(() => {
  vi.unstubAllGlobals();
  query = "organization_id=org-a&mode=live";
});
describe("scoped console read hook", () => {
  it("hides the old scope immediately and discards a late old response even if abort is ignored", async () => {
    let late!: (response: Response) => void;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return url.includes("org-a")
          ? new Promise<Response>((resolve) => {
              late = resolve;
            })
          : Response.json(body("org-b", "B-only"));
      }),
    );
    const hook = renderHook(() => useAdminRead<{ value: string }>("/data", { intervalMs: 0 }));
    await waitFor(() => expect(signals).toHaveLength(1));
    query = "organization_id=org-b&mode=live";
    hook.rerender();
    expect(hook.result.current.envelope).toBeNull();
    await waitFor(() => expect(hook.result.current.envelope?.data.value).toBe("B-only"));
    expect(signals[0].aborted).toBe(true);
    await act(async () => {
      late(Response.json(body("org-a", "OLD-A")));
    });
    expect(hook.result.current.envelope?.data.value).toBe("B-only");
  });
  it.each([
    ["org-b", "live", "ADMIN_SCOPE_MISMATCH"],
    ["org-a", "paper", "ADMIN_MODE_MISMATCH"],
  ])("rejects unexpected %s/%s payload", async (org, mode, reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body(org, "must-not-show", mode))),
    );
    const hook = renderHook(() => useAdminRead("/data", { intervalMs: 0 }));
    await waitFor(() => expect(hook.result.current.reason).toBe(reason));
    expect(hook.result.current.envelope).toBeNull();
  });
  it("accepts a metadata-only schema guard but not foreign content disguised as unavailable", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        schemaVersion: "admin-console/v1",
        scope: { kind: "fleet" },
        data: { state: "unavailable", reasons: ["POSTGRES_REQUIRED"] },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useAdminRead("/data", { intervalMs: 0 }));
    await waitFor(() => expect(hook.result.current.reason).toBe("POSTGRES_REQUIRED"));
    fetcher.mockImplementation(async () =>
      Response.json({
        ...body("org-b", "foreign"),
        data: { state: "unavailable", reasons: ["POSTGRES_REQUIRED"], value: "foreign" },
      }),
    );
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.reason).toBe("ADMIN_SCOPE_MISMATCH"));
    expect(JSON.stringify(hook.result.current.envelope)).not.toContain("foreign");
  });
  it("clears previously shown data when permission is revoked", async () => {
    const fetcher = vi.fn(async () => Response.json(body("org-a", "private")));
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useAdminRead("/data", { intervalMs: 0 }));
    await waitFor(() => expect(hook.result.current.envelope).not.toBeNull());
    fetcher.mockImplementation(async () =>
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.reason).toBe("FORBIDDEN"));
    expect(hook.result.current.envelope).toBeNull();
  });
});
