import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { AdminConsoleShell } from "@/components/trader/admin-console/shell/admin-console-shell";

describe("admin console shell", () => {
  it("shows eight Russian sections", () => {
    render(
      <AdminConsoleShell>
        <p>content</p>
      </AdminConsoleShell>,
    );
    for (const label of Object.values(RU.sections)) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("navigation", { name: RU.navLabel })).toBeInTheDocument();
  });

  it("collapses the navigation and keeps the right slot", () => {
    render(
      <AdminConsoleShell right={<p>помощник</p>}>
        <p>content</p>
      </AdminConsoleShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Свернуть меню" }));
    expect(screen.getByRole("navigation")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("complementary", { name: "Правая панель" })).toHaveTextContent(
      "помощник",
    );
  });
});
