import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FinanceAssistant } from "@/components/treasury/admin/finance-assistant";

const organizationId = "72d2caf2-cb21-4d8c-a036-72f2a7110cd1";

vi.mock("@/components/treasury/admin/finance-org-context", () => ({
  useFinanceOrg: () => ({ organizationId, setOrganizationId: vi.fn() }),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Finance Assistant operator dialog", () => {
  it("renders an authoritative report and sends only the scoped operator request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        mode: "report",
        summary: "Current Finance overview.",
        report: {
          kind: "overview",
          title: "Finance overview",
          generatedAt: "2026-08-24T12:00:00.000Z",
          data: { availableAmountMicros: "42000000" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinanceAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Ask Finance" }));
    expect(screen.getByText(/cannot move money/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Request"), {
      target: { value: "Show the current overview" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Finance" })[0]!);

    expect(await screen.findByText("Finance overview")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("/api/admin/treasury/assistant/plan");
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      organization_id: organizationId,
      message: "Show the current overview",
    });
  });

  it("requires an explicit second action and never renders the confirmation token", async () => {
    const token = "signed-token-that-must-not-be-rendered";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "write_preview",
          summary: "Create project WAIA Core.",
          intent: "CREATE_PROJECT",
          fields: { name: "WAIA Core" },
          confirmationAvailable: true,
          confirmationToken: token,
          notice: "Nothing has been created yet.",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "write_result",
          intent: "CREATE_PROJECT",
          entityType: "project",
          entity: { name: "WAIA Core" },
          notice: "The confirmed record was created.",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<FinanceAssistant />);

    fireEvent.click(screen.getByRole("button", { name: "Ask Finance" }));
    fireEvent.change(screen.getByLabelText("Request"), {
      target: { value: "Create project WAIA Core" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Ask Finance" })[0]!);

    const confirm = await screen.findByRole("button", { name: "Confirm and create" });
    expect(screen.getByTestId("finance-assistant")).not.toHaveTextContent(token);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Created Project")).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[1]?.[0]).toBe("/api/admin/treasury/assistant/execute");
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
      organization_id: organizationId,
      confirmation_token: token,
    });
  });
});
