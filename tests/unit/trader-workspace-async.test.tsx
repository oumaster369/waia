import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraderWorkspace } from "@/components/trader/trader-workspace";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/trader/account-observation/connected-account-observation-panel", () => ({
  ConnectedAccountObservationPanel: () => <div>Separate shared observation</div>,
}));
const credential = { id: "test-credential", venue: "htx", exchangeAccountId: "123", apiKeyMasked: "test…key",
  status: "active", permissionMetadata: null, createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z", revokedAt: null };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const snapshot = (symbol: string) => ({ snapshots: [{ id: symbol, credentialId: credential.id,
  venue: "htx", exchangeAccountId: "123", symbol, trades: [], tradeCount: 0,
  syncedAt: "2026-09-09T00:00:00Z", createdAt: "2026-09-09T00:00:00Z" }] });
function setup(connected = true) {
  const fetcher = vi.fn<typeof fetch>(async (input) => String(input) === "/api/trader/exchange-credentials"
    ? json({ credentials: connected ? [credential] : [] }) : json({ snapshots: [] }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function settle() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("legacy workspace asynchronous safety (fake HTTP only)", () => {
  it("ends initial loading with a generic error after a rejected fetch", async () => {
    setup().mockRejectedValueOnce(new Error("secret transport details"));
    render(<TraderWorkspace />);
    await waitFor(() => expect(screen.queryByText("Loading account…")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret transport details");
  });
  it("releases connection pending state after a network rejection", async () => {
    const fetcher = setup(false); render(<TraderWorkspace />);
    await screen.findByLabelText("HTX Access Key");
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "synthetic-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "synthetic-secret" } });
    fetcher.mockRejectedValueOnce(new Error("secret transport details"));
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect HTX" })).toBeEnabled());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret transport details");
  });
  it.each(["balances", "positions", "trades"])("releases %s sync pending state after a rejected fetch", async kind => {
    const fetcher = setup(); render(<TraderWorkspace />); await screen.findByRole("button", { name: "Sync balances" });
    await settle(); fetcher.mockRejectedValueOnce(new Error("secret network error"));
    fireEvent.click(screen.getByRole("button", { name: `Sync ${kind}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `Sync ${kind}` })).toBeEnabled());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret network error");
  });
  it("discards old symbol responses and blank selection", async () => {
    const fetcher = setup(); render(<TraderWorkspace />); const field = await screen.findByLabelText("Symbol (HTX spot pair)");
    await settle(); const pending: ((response: Response) => void)[] = [];
    fetcher.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    fireEvent.change(field, { target: { value: "BTC/USDT" } });
    fireEvent.change(field, { target: { value: "ETH/USDT" } });
    await act(async () => pending[1](json(snapshot("ETH/USDT"))));
    await act(async () => pending[0](json(snapshot("BTC/USDT"))));
    expect(screen.getByText("This snapshot contains no trades for ETH/USDT.")).toBeInTheDocument();
    expect(screen.queryByText("This snapshot contains no trades for BTC/USDT.")).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "BTC/USDT" } });
    fireEvent.change(field, { target: { value: "" } });
    await act(async () => pending[2](json(snapshot("BTC/USDT"))));
    expect(screen.queryByText(/This snapshot contains no trades for/)).not.toBeInTheDocument();
  });
  it("does not reset the selected symbol when an older manual sync completes", async () => {
    const fetcher = setup(); render(<TraderWorkspace />); const field = await screen.findByLabelText("Symbol (HTX spot pair)");
    await settle(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Sync trades" }));
    fireEvent.change(field, { target: { value: "BTC/USDT" } });
    await act(async () => finish(json(snapshot("ETH/USDT").snapshots[0])));
    expect(field).toHaveValue("BTC/USDT");
  });
  it("fences A→B→A replies by request generation rather than symbol alone", async () => {
    const fetcher = setup(); render(<TraderWorkspace />); const field = await screen.findByLabelText("Symbol (HTX spot pair)");
    await settle(); const pending: ((response: Response) => void)[] = [];
    fetcher.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    for (const value of ["BTC/USDT", "ETH/USDT", "BTC/USDT"]) fireEvent.change(field, { target: { value } });
    await act(async () => pending[2](json(snapshot("BTC/USDT"))));
    await act(async () => pending[0](json({ snapshots: [] })));
    await act(async () => pending[1](json(snapshot("ETH/USDT"))));
    expect(screen.getByText("This snapshot contains no trades for BTC/USDT.")).toBeInTheDocument();
  });
  it("does not publish a snapshot refresh begun before the latest symbol selection", async () => {
    const fetcher = setup(); let finish!: (response: Response) => void;
    fetcher.mockImplementation(async input => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") return json({ credentials: [credential] });
      if (url.includes("symbol=ETH")) return new Promise(resolve => { finish = resolve; });
      return json(url.includes("symbol=BTC") ? snapshot("BTC/USDT") : { snapshots: [] });
    });
    render(<TraderWorkspace />); const field = await screen.findByLabelText("Symbol (HTX spot pair)");
    fireEvent.change(field, { target: { value: "BTC/USDT" } }); await settle();
    await act(async () => finish(json(snapshot("ETH/USDT"))));
    expect(screen.getByText("This snapshot contains no trades for BTC/USDT.")).toBeInTheDocument();
  });
  it("fences a retired mount and does not start snapshot requests after it resolves", async () => {
    const fetcher = setup(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = render(<TraderWorkspace />); old.unmount(); render(<TraderWorkspace />); await settle();
    const count = fetcher.mock.calls.length;
    await act(async () => finish(json({ credentials: [{ ...credential, exchangeAccountId: "old-account" }] })));
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(screen.queryByText("old-account")).not.toBeInTheDocument();
  });
  it("allows retry after failure and prevents duplicate pending syncs", async () => {
    const fetcher = setup(); render(<TraderWorkspace />); await screen.findByRole("button", { name: "Sync balances" });
    await settle(); fetcher.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "Sync balances" })); await settle();
    const baseline = fetcher.mock.calls.length; let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const button = screen.getByRole("button", { name: "Sync balances" });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledTimes(baseline + 1);
    await act(async () => finish(json({ id: "synthetic-snapshot" }))); await settle();
    expect(screen.getByRole("button", { name: "Sync balances" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("allows new account operations while the successful connect's initial snapshots are still settling", async () => {
    const fetcher = setup(false); render(<TraderWorkspace />); await screen.findByLabelText("HTX Access Key");
    const reads: ((response: Response) => void)[] = [];
    let finishSync!: (response: Response) => void;
    fetcher.mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith("/connect")) return json(credential);
      if (url === "/api/trader/exchange-credentials") return json({ credentials: [credential] });
      if (url.endsWith("/sync-balances")) return new Promise(resolve => { finishSync = resolve; });
      return new Promise(resolve => reads.push(resolve));
    });
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "synthetic-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "synthetic-secret" } });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    const button = await screen.findByRole("button", { name: "Sync balances" });
    fireEvent.click(button); expect(button).toBeDisabled();
    await act(async () => { for (const resolve of reads.splice(0)) resolve(json({ snapshots: [] })); });
    expect(button).toBeDisabled();
    await act(async () => finishSync(json({ id: "synthetic-snapshot" })));
    await act(async () => { for (const resolve of reads.splice(0)) resolve(json({ snapshots: [] })); });
    expect(screen.getByRole("button", { name: "Sync balances" })).toBeEnabled();
  });
});
