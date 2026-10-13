import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EmergencyWorkflow } from "@/components/trader/admin-console/primitives/emergency-workflow";
import { OrdersPanel } from "@/components/trader/admin-console/sections/orders/orders-panel";

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
afterEach(() => vi.unstubAllGlobals());
function snapshot(revision = "read-4", state = "INACTIVE") {
  return {
    schemaVersion: "admin-console/v1",
    revision,
    scope: { kind: "fleet" },
    data: {
      target: { scope: "platform", switch_type: "PAUSE" },
      expectedStateVersion: state === "ACTIVE" ? 5 : 4,
      state,
      enforcementMode: state === "ACTIVE" ? "CLOSE_ONLY" : null,
      updatedAt: "2026-09-24T20:00:00.000Z",
    },
  };
}
async function confirm() {
  render(<EmergencyWorkflow open onClose={() => undefined} catalogue={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  expect(screen.getByText(/The command does not place or cancel orders/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("button", { name: "Submit command" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "Нарушение сверки" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "I confirm the command scope and effect" }));
}
describe("admin console emergency workflow", () => {
  it("requires a read revision and verifies persisted state before showing success", async () => {
    let resolveReadBack!: (response: Response) => void;
    let posted: Record<string, unknown> | null = null;
    let reads = 0;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return Response.json(snapshot("written-5", "ACTIVE"));
      }
      if (++reads === 1) return Response.json(snapshot());
      return new Promise<Response>((resolve) => {
        resolveReadBack = resolve;
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await confirm();
    fireEvent.click(screen.getByRole("button", { name: "Submit command" }));
    await waitFor(() =>
      expect(posted).toMatchObject({
        target: { scope: "platform", switch_type: "PAUSE" },
        expectedRevision: "read-4",
        expectedStateVersion: 4,
        confirmed: true,
        reason: "Нарушение сверки",
      }),
    );
    expect(screen.queryByText("State confirmed by reread")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting for reread…" })).toBeDisabled();
    resolveReadBack(Response.json(snapshot("written-5", "ACTIVE")));
    await screen.findByText("State confirmed by reread");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("keeps submission unavailable without a state read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "READ_FAILED" } }, { status: 503 })),
    );
    render(<EmergencyWorkflow open onClose={() => undefined} catalogue={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      (await screen.findByText(/Data could not be read/)).closest("[data-reason]"),
    ).toHaveAttribute("data-reason", "READ_FAILED");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit command" })).not.toBeInTheDocument();
  });
  it("returns to fresh review on conflict and never retries the command", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ error: { code: "STALE_REVISION" } }, { status: 409 })
        : Response.json(snapshot()),
    );
    vi.stubGlobal("fetch", fetcher);
    await confirm();
    fireEvent.click(screen.getByRole("button", { name: "Submit command" }));
    await screen.findByText(/State changed/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("blocks repeat when the write acknowledgement cannot be verified", async () => {
    let written = false;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        written = true;
        return Response.json(snapshot("written-5", "ACTIVE"));
      }
      return Response.json(snapshot(written ? "other-revision" : "read-4"));
    });
    vi.stubGlobal("fetch", fetcher);
    await confirm();
    fireEvent.click(screen.getByRole("button", { name: "Submit command" }));
    await screen.findByText(/The command may have applied/);
    expect(screen.queryByRole("button", { name: "Submit command" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("acks the first painted order version once", async () => {
    const row = {
      id: "order-1",
      symbol: "btcusdt",
      state: "OPEN",
      label: "Открыт",
      entityVersion: "7",
    };
    const view = render(<OrdersPanel rows={[row]} />);
    await waitFor(() =>
      expect(view.container.querySelector("[data-render-ack]")).toHaveAttribute(
        "data-render-ack",
        "1",
      ),
    );
    view.rerender(<OrdersPanel rows={[row]} />);
    expect(view.container.querySelector("[data-render-ack]")).toHaveAttribute(
      "data-render-ack",
      "1",
    );
  });
});
