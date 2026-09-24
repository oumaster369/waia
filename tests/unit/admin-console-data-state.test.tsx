import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";

describe("admin console data state", () => {
  it("names every state in Russian and keeps the reason next to an unavailable value", () => {
    for (const [state, label] of Object.entries(RU.states)) {
      const { unmount } = render(<DataState state={state as keyof typeof RU.states} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
    render(<DataState state="unavailable" reason="POSTGRES_REQUIRED" />);
    expect(screen.getByText(/Нужен Postgres/)).toBeInTheDocument();
    const { unmount } = render(
      <DataState state="unavailable" reason="ADMIN_CONSOLE_SCHEMA_NOT_APPLIED" />,
    );
    expect(screen.getByText(/Появится после применения схемы консоли/)).toBeInTheDocument();
    unmount();
  });
});
