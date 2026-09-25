import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { InvoiceAttestations } from "@/components/trader/admin-console/sections/clients/invoice-attestations";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import { ISSUANCE_ATTESTATION_KEYS } from "@/lib/trader/billing/invoice-issuance.types";

vi.mock("@/components/trader/admin-console/data/read-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/trader/admin-console/data/read-context")>();
  return {
    ...actual,
    useAdminReadContext: function useTestContext() {
      const [query, setQuery] = React.useState("");
      return {
        query: "",
        pathname: "/admin/clients",
        params: new URLSearchParams(query),
        href: (path: string) => path,
        update: (patch: Record<string, string | null>) =>
          setQuery((old) => {
            const params = new URLSearchParams(old);
            for (const [key, value] of Object.entries(patch))
              value === null ? params.delete(key) : params.set(key, value);
            return params.toString();
          }),
      };
    },
  };
});
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "33333333-3333-4333-8333-333333333333";
const organizationId = "22222222-2222-4222-8222-222222222222";
function envelope(data: unknown) {
  return Response.json({
    schemaVersion: "admin-console/v1",
    scope: { kind: "fleet" },
    mode: "all",
    revision: "envelope",
    data,
  });
}
function mockInvoices() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let approved = false;
  const detail = (id: string) => ({
    id,
    organizationId,
    revision: `${id}:${approved ? "approved" : "draft"}`,
    status: "DRAFT",
    currency: "USDT",
    approvedAt: approved ? new Date().toISOString() : null,
    coolingOffUntil: approved ? new Date(Date.now() + 60_000).toISOString() : null,
    issuedAt: null,
    paidAt: null,
    display: { status: approved ? "Ожидает проверки" : "Черновик", payment: null, flags: [] },
    stored: {
      billable: true,
      performanceFee: "10.00",
      periodProfit: "100",
      cumulative: "100",
      previousHwm: "0",
      newProfitAboveHwm: "100",
      feeRate: "0.3",
    },
    chain: { ok: null, reasons: ["PREVIOUS_PERIOD_EVIDENCE_MISSING"] },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/commands")) {
        const body = JSON.parse(String(init?.body));
        calls.push({ url, body });
        approved = body.command === "approve";
        return Response.json({
          revision: detail(url.includes(firstId) ? firstId : secondId).revision,
        });
      }
      if (url.endsWith("/console/invoices"))
        return envelope({
          items: [firstId, secondId].map((id) => ({
            ...detail(id),
            performanceFee: "10.00",
            exchangeAccountId: "htx-test",
          })),
          aggregate: [{ currency: "USDT", amount: "20.00", count: 2 }],
          total: 2,
          truncated: false,
        });
      return envelope(detail(url.includes(firstId) ? firstId : secondId));
    }),
  );
  return calls;
}
describe("invoice attestations", () => {
  it("keeps approve disabled until all six attestations are manually checked", () => {
    const onApprove = vi.fn();
    render(<InvoiceAttestations onApprove={onApprove} />);
    const button = screen.getByRole("button", { name: "Подтвердить выпуск" });
    expect(button).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(ISSUANCE_ATTESTATION_KEYS.length);
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
      fireEvent.click(box);
    }
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledWith(
      Object.fromEntries(ISSUANCE_ATTESTATION_KEYS.map((key) => [key, true])),
    );
  });
  it("does not transfer six confirmations from invoice A to invoice B", async () => {
    const calls = mockInvoices();
    render(<InvoicesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: firstId }));
    await screen.findByRole("button", { name: "Подтвердить выпуск" });
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.getByRole("button", { name: "Подтвердить выпуск" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    fireEvent.click(screen.getByRole("button", { name: secondId }));
    expect(await screen.findByRole("button", { name: "Подтвердить выпуск" })).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(calls).toEqual([]);
  });
  it("sends the displayed document revision, resets attestations, rereads acknowledgement and requires an explicit cancellation reason", async () => {
    const calls = mockInvoices();
    render(<InvoicesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: firstId }));
    await screen.findByRole("button", { name: "Подтвердить выпуск" });
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выпуск" }));
    await screen.findByText("Команда подтверждена повторным чтением документа.");
    expect(calls[0].body).toEqual({
      organization_id: organizationId,
      expectedRevision: `${firstId}:draft`,
      command: "approve",
      attestations: Object.fromEntries(ISSUANCE_ATTESTATION_KEYS.map((key) => [key, true])),
    });
    expect(screen.getByRole("button", { name: "Подтвердить выпуск" })).toBeDisabled();
    const cancel = await screen.findByRole("button", { name: "Отменить выпуск" });
    expect(cancel).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Причина отмены подтверждения"), {
      target: { value: "Требуется повторная проверка" },
    });
    await waitFor(() => expect(cancel).toBeEnabled());
    fireEvent.click(cancel);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({
      command: "cancel-pending",
      expectedRevision: `${firstId}:approved`,
      reason: "Требуется повторная проверка",
    });
  });
});
describe("clients page", () => {
  it("shows a real client row and no invoice controls on the default tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope({
          items: [
            {
              id: "client-1",
              name: "Клиент",
              ownerEmail: "a@example.com",
              access: "Доступ включён",
              connectedSince: "2026-01-01T00:00:00.000Z",
              connectedSinceValue: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );
    const page = await import("@/app/(trader)/admin/clients/page");
    render(<page.default />);
    expect(await screen.findByRole("button", { name: "Клиент" })).toBeInTheDocument();
    expect(screen.getByText("Доступ включён")).toBeInTheDocument();
    expect(screen.getByTitle("2026-01-01T00:00:00.000Z")).toHaveAttribute(
      "datetime",
      "2026-01-01T00:00:00.000Z",
    );
    expect(screen.queryByRole("button", { name: "Подтвердить выпуск" })).toBeNull();
  });
});
