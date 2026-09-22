import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraderWorkspace } from "@/components/trader/trader-workspace";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/trader/account-observation/connected-account-observation-panel", () => ({
  ConnectedAccountObservationPanel: () => <div>Separate shared observation</div>,
}));
const credential = {
  id: "test-credential",
  venue: "htx",
  exchangeAccountId: "123",
  apiKeyMasked: "test…key",
  status: "active",
  permissionMetadata: null,
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
  revokedAt: null,
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function setup(connected = true) {
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/trader/exchange-credentials"
      ? json({ credentials: connected ? [credential] : [] })
      : json({}),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("legacy workspace asynchronous safety (fake HTTP only)", () => {
  it("ends initial loading with a generic error after a rejected fetch", async () => {
    setup().mockRejectedValueOnce(new Error("secret transport details"));
    render(<TraderWorkspace />);
    await waitFor(() => expect(screen.queryByText("Loading account…")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret transport details");
  });
  it("releases connection pending state after a network rejection", async () => {
    const fetcher = setup(false);
    render(<TraderWorkspace />);
    await screen.findByLabelText("HTX Access Key");
    fireEvent.change(screen.getByLabelText("HTX Access Key"), {
      target: { value: "synthetic-key" },
    });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), {
      target: { value: "synthetic-secret" },
    });
    fetcher.mockRejectedValueOnce(new Error("secret transport details"));
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect HTX" })).toBeEnabled());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret transport details");
    expect(screen.getByRole("alert")).toHaveTextContent("Keep HTX IP restrictions empty");
  });
  it("fences a retired mount and does not start credential requests after it resolves", async () => {
    const fetcher = setup();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = render(<TraderWorkspace />);
    old.unmount();
    render(<TraderWorkspace />);
    await settle();
    const count = fetcher.mock.calls.length;
    await act(async () =>
      finish(json({ credentials: [{ ...credential, exchangeAccountId: "old-account" }] })),
    );
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(screen.queryByText("old-account")).not.toBeInTheDocument();
  });
  it("allows retry after connect failure and prevents duplicate pending connects", async () => {
    const fetcher = setup(false);
    render(<TraderWorkspace />);
    await screen.findByLabelText("HTX Access Key");
    fireEvent.change(screen.getByLabelText("HTX Access Key"), {
      target: { value: "synthetic-key" },
    });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), {
      target: { value: "synthetic-secret" },
    });
    fetcher.mockRejectedValueOnce(new Error("network"));
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await settle();
    const baseline = fetcher.mock.calls.length;
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = screen.getByRole("button", { name: "Connect HTX" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledTimes(baseline + 1);
    await act(async () => finish(json(credential)));
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows the connected cabinet after a successful connect without fetching snapshot sync APIs", async () => {
    const fetcher = setup(false);
    render(<TraderWorkspace />);
    await screen.findByLabelText("HTX Access Key");
    fetcher.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/connect")) return json(credential);
      if (url === "/api/trader/exchange-credentials") return json({ credentials: [credential] });
      return json({});
    });
    fireEvent.change(screen.getByLabelText("HTX Access Key"), {
      target: { value: "synthetic-key" },
    });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), {
      target: { value: "synthetic-secret" },
    });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await screen.findByTestId("trader-account-status");
    expect(screen.getByText("Separate shared observation")).toBeInTheDocument();
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("snapshot"))).toBe(true);
    expect(screen.queryByRole("button", { name: /sync/i })).not.toBeInTheDocument();
  });
});
