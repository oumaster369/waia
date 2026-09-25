import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@/components/trader/admin-console/data/read-context", () => ({
  useAdminReadContext: () => ({
    pathname: "/admin/accounts",
    query: "organization_id=org-a&currency=USD&mode=live",
    params: new URLSearchParams("tab=attention"),
    href: (path: string) => path,
    update: vi.fn(),
  }),
}));
import { SavedViews } from "@/components/trader/admin-console/shell/saved-views";
afterEach(() => vi.unstubAllGlobals());
describe("saved views use explicit collection revisions", () => {
  it("never writes before reading and requires another deliberate click after conflict", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: "r1", views: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "STALE_REVISION" } }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: "r2", views: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: "r3", views: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: "r3", views: [] })));
    vi.stubGlobal("fetch", fetcher);
    render(<SavedViews />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Представления" }));
    fireEvent.change(screen.getByLabelText("Название представления"), {
      target: { value: "Деньги А" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Сохранить текущий вид" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить текущий вид" }));
    await screen.findByText(/Список изменился/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const first = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(first).toMatchObject({
      expectedRevision: "r1",
      section: "accounts",
      state: { query: "organization_id=org-a&currency=USD&mode=live&tab=attention" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить текущий вид" }));
    await screen.findByText("Представление сохранено.");
    expect(JSON.parse(fetcher.mock.calls[3][1].body).expectedRevision).toBe("r2");
  });
});
