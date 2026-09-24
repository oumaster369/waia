import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoiceAttestations } from "@/components/trader/admin-console/sections/clients/invoice-attestations";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import { ISSUANCE_ATTESTATION_KEYS } from "@/lib/trader/billing/invoice-issuance.types";

const search = vi.hoisted(() => ({ value: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

const invoice = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  performanceFee: "10.00",
  currency: "USDT",
  display: { status: "Черновик", payment: null },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search.value = "";
});

describe("invoice attestations", () => {
  it("keeps approve disabled until all six attestations are checked", () => {
    const onApprove = vi.fn();
    render(<InvoiceAttestations onApprove={onApprove} />);
    const button = screen.getByRole("button", { name: "Подтвердить выпуск" });
    expect(button).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.getAllByRole("checkbox")).toHaveLength(ISSUANCE_ATTESTATION_KEYS.length);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledWith({
      depositsVerified: true,
      withdrawalsVerified: true,
      balanceSnapshotsVerified: true,
      reconciliationVerified: true,
      exchangeSyncVerified: true,
      realizedFillFinalityVerified: true,
    });
  });
});

describe("invoices panel", () => {
  it("never carries six manual confirmations from invoice A to invoice B", async () => {
    const second = { ...invoice, id: "33333333-3333-4333-8333-333333333333", revision: "B" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/console/invoices")
        ? json({ data: { items: [{ ...invoice, revision: "A" }, second] } })
        : json({ data: { items: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoicesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(invoice.id) }));
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.getByRole("button", { name: "Подтвердить выпуск" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(second.id) }));
    expect(screen.getByRole("button", { name: "Подтвердить выпуск" })).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commands"))).toBe(false);
  });

  it("sends only the checked attestations and a cancel reason", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        if (url.endsWith("/console/invoices")) return json({ data: { items: [invoice] } });
        if (url.endsWith("/console/disputes")) return json({ data: { items: [] } });
        return json({ ok: true });
      }),
    );
    render(<InvoicesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Черновик/ }));
    const approve = screen.getByRole("button", { name: "Подтвердить выпуск" });
    expect(approve).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(approve);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/commands"))).toBe(true));
    const approveCall = calls.find((call) => call.body?.includes('"approve"'));
    expect(JSON.parse(approveCall?.body ?? "{}")).toEqual({
      organization_id: invoice.organizationId,
      command: "approve",
      attestations: {
        depositsVerified: true,
        withdrawalsVerified: true,
        balanceSnapshotsVerified: true,
        reconciliationVerified: true,
        exchangeSyncVerified: true,
        realizedFillFinalityVerified: true,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отменить выпуск" }));
    await waitFor(() =>
      expect(calls.some((call) => call.body?.includes("cancel-pending"))).toBe(true),
    );
    expect(
      JSON.parse(calls.find((call) => call.body?.includes("cancel-pending"))?.body ?? "{}"),
    ).toMatchObject({
      command: "cancel-pending",
      reason: "отмена в период ожидания",
      organization_id: invoice.organizationId,
    });
  });
});

describe("clients page", () => {
  it("shows clients when tab=invoices is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          data: {
            items: [
              {
                id: "client-1",
                name: "Клиент",
                ownerEmail: "a@example.com",
                access: "owner",
                connectedSince: "2026-01-01",
              },
            ],
          },
        }),
      ),
    );
    const page = await import("@/app/(trader)/admin/clients/page");
    render(<page.default />);
    expect(await screen.findByText(/Клиент — owner — 2026-01-01/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Подтвердить выпуск" })).toBeNull();
  });
});
