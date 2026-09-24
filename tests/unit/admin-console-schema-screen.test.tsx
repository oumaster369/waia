import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async () =>
    Response.json({
      data: { state: "unavailable", reasons: ["ADMIN_CONSOLE_SCHEMA_NOT_APPLIED"] },
    }),
  ),
);

const PHRASE = "Появится после применения схемы консоли";

describe("console screens when the schema is not applied", () => {
  it("shows the schema phrase and keeps the list unmounted", async () => {
    const { default: OrdersPage } = await import("@/app/(trader)/admin/orders/page");
    const { default: ErrorsPage } = await import("@/app/(trader)/admin/errors/page");
    const { default: AccountsPage } = await import("@/app/(trader)/admin/accounts/page");
    const { OverviewPanel, overviewFromEnvelope } =
      await import("@/components/trader/admin-console/sections/overview/overview-panel");

    const overview = render(
      <OverviewPanel
        view={overviewFromEnvelope({
          data: { state: "unavailable", reasons: ["ADMIN_CONSOLE_SCHEMA_NOT_APPLIED"] },
        })}
      />,
    );
    expect(screen.getByText(new RegExp(PHRASE))).toBeInTheDocument();
    overview.unmount();

    for (const Page of [OrdersPage, ErrorsPage, AccountsPage]) {
      const view = render(<Page />);
      await waitFor(() => {
        expect(screen.getByText(new RegExp(PHRASE))).toBeInTheDocument();
      });
      expect(screen.queryByRole("list")).toBeNull();
      view.unmount();
    }
  });
});
