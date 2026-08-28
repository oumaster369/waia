import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnonymousSupportPanel } from "@/components/public/anonymous-support-panel";

describe("AnonymousSupportPanel", () => {
  it("renders the official anonymous payment instructions from one canonical component", () => {
    render(
      <AnonymousSupportPanel
        testId="anonymous-support"
        support={{
          address: "TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
          explorerUrl: "https://tronscan.org/#/address/TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
        }}
      />,
    );

    expect(screen.getByTestId("anonymous-support")).toHaveTextContent("Anonymous support");
    expect(screen.getByTestId("anonymous-support")).toHaveTextContent("USDT · TRON (TRC-20)");
    expect(screen.getByTestId("anonymous-support-address")).toHaveTextContent(
      "TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
    );
    expect(screen.getByRole("link", { name: /Verify the official address/i })).toHaveAttribute(
      "href",
      "https://tronscan.org/#/address/TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
    );
  });

  it("fails closed when the governed address is unavailable", () => {
    render(<AnonymousSupportPanel testId="anonymous-support" support={null} />);

    expect(screen.getByTestId("anonymous-support")).toHaveTextContent(
      "Payment address not yet published",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
