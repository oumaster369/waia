import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { InvoiceAttestations } from "@/components/trader/admin-console/sections/clients/invoice-attestations";

describe("admin console invoice card", () => {
  it("starts with every attestation clear and enables approval only after all six", () => {
    const onApprove = vi.fn();
    render(<InvoiceAttestations onApprove={onApprove} />);
    const button = screen.getByRole("button", { name: "Подтвердить выпуск" });
    expect(button).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledOnce();
    expect(
      Object.values(onApprove.mock.calls[0][0] as Record<string, boolean>).every(Boolean),
    ).toBe(true);
  });
});
