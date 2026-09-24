import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GovernedProcessLinks } from "@/components/trader/admin-console/shell/governed-links";

describe("admin console governed process links", () => {
  it("keeps the existing operator pages reachable from the new sections", () => {
    render(<GovernedProcessLinks section="system" />);
    expect(screen.getByRole("link", { name: "Журнал аудита" })).toHaveAttribute(
      "href",
      "/admin/system?tab=audit",
    );
    expect(screen.getByRole("link", { name: "Полномочия исполнения" })).toHaveAttribute(
      "href",
      "/admin/system?tab=authority",
    );
  });
});
