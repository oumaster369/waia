import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders the project name", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("WAIA");
  });

  it("renders the home landmark", () => {
    render(<HomePage />);
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});
