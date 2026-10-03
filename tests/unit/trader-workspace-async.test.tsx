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
const secondCredential = {
  ...credential,
  id: "second-credential",
  exchangeAccountId: "456",
  apiKeyMasked: "second…key",
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
    await waitFor(() => expect(screen.queryByText("Загрузка аккаунтов…")).not.toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Подключить HTX" })).toBeEnabled());
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret transport details");
    expect(screen.getByRole("alert")).toHaveTextContent("Проверьте состояние подключения перед повторной отправкой ключа");
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
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/trader/exchange-credentials")).toHaveLength(2));
    const baseline = fetcher.mock.calls.length;
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "retry-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "retry-secret" } });
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = screen.getByRole("button", { name: "Подключить HTX" });
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

  it("requires explicit selection when multiple accounts exist and sends the selected replacement identity", async () => {
    let replacementBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") return json({ credentials: [credential, secondCredential] });
      if (url.endsWith("/connect")) {
        replacementBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ ...secondCredential, id: "replacement-credential", updatedAt: "2026-10-03T00:00:00Z" });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    const selector = await screen.findByLabelText("Выберите аккаунт");
    expect(selector).toHaveValue("");
    expect(screen.getByTestId("trader-account-selection-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("trader-account-status")).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "456" } });
    expect(screen.getByTestId("trader-credential-account-id")).toHaveTextContent("456");
    expect(screen.getByText("HTX подключен в WAIA")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("trader-replace-button"));
    expect(screen.getByText(/Это заменит подключение в WAIA/)).toBeInTheDocument();
    expect(screen.getByText(/а не добавит отдельный ключ наблюдения/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "replacement-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "replacement-secret" } });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(replacementBody).toBeDefined());
    expect(replacementBody).toMatchObject({ replacementCredentialId: "second-credential" });
  });

  it("disconnects only after explicit confirmation and keeps the account visible as revoked", async () => {
    let revoked = false;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") {
        return json({ credentials: [revoked ? { ...credential, status: "revoked", revokedAt: "2026-10-03T00:00:00Z" } : credential] });
      }
      if (init?.method === "DELETE") {
        revoked = true;
        return json({ ...credential, status: "revoked", revokedAt: "2026-10-03T00:00:00Z" });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    await screen.findByTestId("trader-account-status");
    fireEvent.click(screen.getByTestId("trader-disconnect-button"));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByTestId("trader-disconnect-confirm"));
    await waitFor(() => expect(screen.getByTestId("trader-credential-status")).toHaveTextContent("Отозван в WAIA"));
    expect(screen.getByTestId("trader-account-status")).toHaveTextContent("Подключение HTX отозвано в WAIA");
    expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith("/test-credential") && init?.method === "DELETE")).toBe(true);
    expect(screen.queryByText("Separate shared observation")).not.toBeInTheDocument();
  });

  it("locks account selection while connect is pending so completion cannot switch the viewed account", async () => {
    const fetcher = setup(false);
    fetcher.mockImplementation(async (input) => String(input) === "/api/trader/exchange-credentials"
      ? json({ credentials: [credential, secondCredential] }) : json({}));
    render(<TraderWorkspace />);
    const selector = await screen.findByLabelText("Выберите аккаунт");
    fireEvent.change(selector, { target: { value: credential.exchangeAccountId } });
    fireEvent.click(screen.getByTestId("trader-replace-button"));
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "stale-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "stale-secret" } });
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    expect(selector).toBeDisabled();
    await act(async () => finish(json({ ...credential, id: "stale-connect-result" })));
    await settle();
    expect(screen.getByTestId("trader-account-select")).toHaveValue("123");
    expect(screen.getByTestId("trader-credential-account-id")).toHaveTextContent("123");
    expect(screen.queryByText("stale-connect-result")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/trader/exchange-credentials")).toHaveLength(2);
  });

  it("clears replacement key fields when the user cancels", async () => {
    const fetcher = setup();
    render(<TraderWorkspace />);
    await screen.findByTestId("trader-replace-button");
    fireEvent.click(screen.getByTestId("trader-replace-button"));
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "temporary-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "temporary-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByTestId("trader-connect-form")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("refreshes metadata after a partial enrollment error without resending secrets", async () => {
    let stored = false;
    let connectCalls = 0;
    const revokedCredential = { ...credential, status: "revoked", revokedAt: "2026-10-02T00:00:00Z" };
    const committedCredential = { ...credential, id: "committed-credential", exchangeAccountId: "456" };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") {
        return json({ credentials: stored ? [revokedCredential, committedCredential] : [revokedCredential] });
      }
      if (url.endsWith("/connect")) {
        connectCalls += 1;
        stored = true;
        return new Response(JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "HTX is stored. Observation capacity is full." },
        }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    await screen.findByText(/Предыдущая запись подключения отозвана в WAIA/);
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "one-time-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "one-time-secret" } });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(screen.getByTestId("trader-credential-status")).toHaveTextContent("Активен в WAIA"));
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось завершить запрос. Проверьте состояние подключения перед повторной отправкой ключа.");
    expect(connectCalls).toBe(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/trader/exchange-credentials")).toHaveLength(2);
    expect(screen.getByTestId("trader-account-select")).toHaveValue("456");
    expect(screen.getByTestId("trader-credential-account-id")).toHaveTextContent("456");
  });

  it("selects the account returned by reconnect instead of leaving a different revoked record selected", async () => {
    let connected = false;
    const revokedCredential = { ...credential, status: "revoked", revokedAt: "2026-10-02T00:00:00Z" };
    const newAccount = { ...credential, id: "new-account-credential", exchangeAccountId: "456" };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") {
        return json({ credentials: connected ? [revokedCredential, newAccount] : [revokedCredential] });
      }
      if (url.endsWith("/connect")) {
        connected = true;
        return json(newAccount);
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    await screen.findByText(/Предыдущая запись подключения отозвана в WAIA/);
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "another-account-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "another-account-secret" } });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(screen.getByTestId("trader-account-select")).toHaveValue("456"));
    expect(screen.getByTestId("trader-credential-account-id")).toHaveTextContent("456");
    expect(screen.getByTestId("trader-account-status")).toHaveTextContent("HTX подключен в WAIA");
  });

  it("requires a fresh account choice when partial enrollment adds multiple active accounts", async () => {
    let stored = false;
    const firstNew = { ...credential, id: "new-one", exchangeAccountId: "789" };
    const secondNew = { ...credential, id: "new-two", exchangeAccountId: "987" };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") {
        return json({ credentials: stored ? [credential, firstNew, secondNew] : [credential] });
      }
      if (url.endsWith("/connect")) {
        stored = true;
        return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "capacity" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    await screen.findByTestId("trader-replace-button");
    fireEvent.click(screen.getByTestId("trader-replace-button"));
    fireEvent.change(screen.getByLabelText("HTX Access Key"), { target: { value: "one-time-key" } });
    fireEvent.change(screen.getByLabelText("HTX Secret Key"), { target: { value: "one-time-secret" } });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));
    await waitFor(() => expect(screen.getByTestId("trader-account-selection-prompt")).toBeInTheDocument());
    expect(screen.getByTestId("trader-account-select")).toHaveValue("");
    expect(screen.queryByTestId("trader-connect-form")).not.toBeInTheDocument();
  });

  it("refreshes an ambiguous revoke result and clears confirmation when metadata shows it was revoked", async () => {
    let revoked = false;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/trader/exchange-credentials") {
        return json({ credentials: [revoked ? { ...credential, status: "revoked" } : credential] });
      }
      if (init?.method === "DELETE") {
        revoked = true;
        throw new Error("response lost after commit");
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderWorkspace />);
    await screen.findByTestId("trader-disconnect-button");
    fireEvent.click(screen.getByTestId("trader-disconnect-button"));
    fireEvent.click(screen.getByTestId("trader-disconnect-confirm"));
    await waitFor(() => expect(screen.getByTestId("trader-credential-status")).toHaveTextContent("Отозван в WAIA"));
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось подтвердить результат запроса");
    expect(screen.queryByRole("group", { name: "Подтвердить отключение" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/trader/exchange-credentials")).toHaveLength(2);
  });
});
