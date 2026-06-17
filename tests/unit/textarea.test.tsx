import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("associates with a visible label via htmlFor", () => {
    render(
      <>
        <label htmlFor="notes-field">Notes</label>
        <Textarea id="notes-field" data-testid="notes-textarea" />
      </>,
    );
    const field = screen.getByLabelText("Notes");
    expect(field).toBe(screen.getByTestId("notes-textarea"));
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("exposes textarea role and forwards ref for focus management", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<Textarea ref={ref} aria-label="Message" data-testid="msg-textarea" />);
    const field = screen.getByRole("textbox", { name: "Message" });
    expect(field).toBe(screen.getByTestId("msg-textarea"));
    expect(ref.current).toBe(field);
  });

  it("marks invalid state via aria-invalid", () => {
    render(<Textarea aria-label="Body" aria-invalid data-testid="invalid-textarea" />);
    expect(screen.getByRole("textbox", { name: "Body" })).toHaveAttribute("aria-invalid");
  });
});
