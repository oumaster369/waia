import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialHistorySection } from "@/components/trader/account-observation/financial-history-section";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import { binding, cursor, historyPage, observation } from "../helpers/financial-history-ui-fixture";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const uid = "9988776655";
const endpoint = "/api/trader/account-observation" as const;
const target = { credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId };
const noop = () => {};
const section = (fetcher: typeof fetch, extra = {}) => (
  <FinancialHistorySection
    binding={binding}
    uid={uid}
    endpoint={endpoint}
    fetcher={fetcher}
    onRevoked={noop}
    {...extra}
  />
);
async function settle() {
  await act(async () => {
    for (let i = 0; i < 80; i++) await Promise.resolve();
  });
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function connectedFetcher(history: typeof fetch, getObservation = () => observation()) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.includes("/financial-history?")) return history(input, init);
    if (url.includes("/binding?")) return json(binding);
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(
            new TextEncoder().encode(
              `event: observation\ndata: ${JSON.stringify(getObservation())}\n\n`,
            ),
          );
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
}
describe("DEE-1249 persisted history", () => {
  it("preserves raw signed decimals, older provenance and history when currently NOT_CONFIGURED", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(historyPage()));
    render(section(fetcher));
    await settle();
    expect(screen.getByText("-0.750000000000000001 USDT")).toBeVisible();
    expect(screen.getByText(/Collection is currently not configured/)).toBeVisible();
    expect(screen.getByText(/End of this persisted snapshot/)).toBeVisible();
    fireEvent.click(screen.getByText("Collection provenance"));
    expect(screen.getByText(/Credential revision: 1; configuration revision: 1/)).toBeVisible();
    expect(fetcher.mock.calls[0][0]).toContain("pageSize=20");
    expect(fetcher.mock.calls[0][0]).not.toMatch(/Revision|organizationId|htxUid/);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
  });
  it("loads explicit pages, deduplicates exact repeats and refreshes a new snapshot", async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(historyPage(["10001"], cursor(1))))
      .mockResolvedValueOnce(
        json({ ...historyPage(["10001", "10002"]), coverage: historyPage().coverage }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    render(section(fetcher));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
    await settle();
    expect(
      within(screen.getByRole("list", { name: "Persisted financial records" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Load more history" })).toBeDisabled();
    expect(fetcher.mock.calls[1][0]).toContain(`cursor=${cursor(1)}`);
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    expect(screen.queryByText("10001")).not.toBeInTheDocument();
    resolve(json(historyPage([])));
    await settle();
    expect(screen.getByText(/No persisted records were returned/)).toBeVisible();
    expect(screen.getByText(/0 records in one page/)).toBeVisible();
    expect(fetcher.mock.calls[2][0]).not.toContain("cursor=");
  });
  it.each([204, 503, 500])(
    "distinguishes unavailable/error %s from observed empty",
    async (status) => {
      render(section(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))));
      await settle();
      expect(screen.queryByText(/No persisted records were returned/)).not.toBeInTheDocument();
      expect(
        screen.getByText(
          status === 500
            ? /Financial history could not be verified/
            : /Persisted history is unavailable/,
        ),
      ).toBeVisible();
    },
  );
  it.each([401, 403])("history %s revokes the whole connected account view", async (status) => {
    const history = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(historyPage()))
      .mockResolvedValueOnce(new Response(null, { status }));
    render(
      <ConnectedAccountObservationPanel target={target} fetcher={connectedFetcher(history)} />,
    );
    await settle();
    expect(screen.getByText("-0.750000000000000001 USDT")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await settle();
    expect(screen.getByText("Access revoked; account data cleared.")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Persisted financial history" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(observation().observationId)).not.toBeInTheDocument();
  });
  it.each(["target", "session", "logout"])(
    "synchronously hides rows on %s change and ignores abort-resistant old replies",
    async (change) => {
      let resolve!: (r: Response) => void;
      const history = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(historyPage(["10001"], cursor(1))))
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        )
        .mockResolvedValue(json(historyPage([])));
      const fetcher = connectedFetcher(history);
      const { rerender } = render(
        <ConnectedAccountObservationPanel target={target} fetcher={fetcher} sessionKey="one" />,
      );
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
      await settle();
      rerender(
        <ConnectedAccountObservationPanel
          target={
            change === "logout"
              ? null
              : change === "target"
                ? { ...target, exchangeAccountId: "account-b" }
                : target
          }
          fetcher={fetcher}
          sessionKey={change === "session" ? "two" : "one"}
        />,
      );
      expect(screen.queryByText("10001")).not.toBeInTheDocument();
      expect(history.mock.calls[1][1]?.signal?.aborted).toBe(true);
      resolve(json(historyPage(["10002"])));
      await settle();
      expect(screen.queryByText("10002")).not.toBeInTheDocument();
    },
  );
  it.each(["binding", "uid", "lineage", "extra", "size"])(
    "rejects mismatched or malformed %s pages",
    async (variant) => {
      const body = historyPage();
      if (variant === "binding") body.binding = { ...binding, configurationRevision: "new" };
      if (variant === "uid") {
        body.htxUid = "99";
        body.records = [];
        body.coverage = [];
      }
      if (variant === "lineage")
        body.records[0].provenance.binding.credentialId = "55555555-5555-4555-8555-555555555555";
      if (variant === "extra") Object.assign(body, { private: "never-render-me" });
      if (variant === "size")
        body.records = historyPage(Array.from({ length: 21 }, (_, n) => String(10000 + n))).records;
      render(section(vi.fn<typeof fetch>().mockResolvedValue(json(body))));
      await settle();
      expect(screen.getByRole("alert")).toBeVisible();
      expect(screen.queryByText("never-render-me")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("list", { name: "Persisted financial records" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["cursor", "conflict"])("clears history on %s inconsistency", async (kind) => {
    const second = historyPage(["10001"], kind === "cursor" ? cursor(1) : null);
    if (kind === "conflict") second.records[0].bill.amount = "-9";
    render(
      section(
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(json(historyPage(["10001"], cursor(1))))
          .mockResolvedValueOnce(json(second)),
      ),
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
    await settle();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("10001")).not.toBeInTheDocument();
  });
  it("bounds pages and accumulated rows, including repeated coverage", async () => {
    let page = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      const ids = Array.from({ length: 20 }, (_, n) => String(10000 + page * 20 + n));
      page++;
      const body = historyPage(ids, cursor(page));
      body.coverage = [];
      return json(body);
    });
    render(section(fetcher));
    await settle();
    for (let i = 1; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
      await settle();
    }
    expect(
      within(screen.getByRole("list", { name: "Persisted financial records" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(200);
    expect(screen.getByRole("button", { name: "Load more history" })).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
  it("times out and never overlaps an abort-ignoring request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    render(section(fetcher));
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(7000));
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Persisted history is unavailable/)).toBeVisible();
  });
  it("resets on a new streamed UID and immediately clears on streamed revocation", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let resolve!: (r: Response) => void;
    const history = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(historyPage()))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes("/financial-history?")) return history(input, init);
      if (String(input).includes("/binding?")) return json(binding);
      return new Response(
        new ReadableStream({
          start(c) {
            stream = c;
            c.enqueue(
              new TextEncoder().encode(
                `event: observation\ndata: ${JSON.stringify(observation())}\n\n`,
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
    await settle();
    expect(screen.getByText("10001", { exact: true })).toBeVisible();
    const next = {
      ...observation(binding, "999"),
      collectionCompletedAtMs: observation().collectionCompletedAtMs + 1,
    };
    await act(async () =>
      stream.enqueue(
        new TextEncoder().encode(`event: observation\ndata: ${JSON.stringify(next)}\n\n`),
      ),
    );
    await settle();
    expect(screen.queryByText("10001", { exact: true })).not.toBeInTheDocument();
    expect(history).toHaveBeenCalledTimes(2);
    await act(async () =>
      stream.enqueue(new TextEncoder().encode("event: revoked\ndata: null\n\n")),
    );
    await settle();
    expect(history.mock.calls[1][1]?.signal?.aborted).toBe(true);
    resolve(json(historyPage(["10002"], null, binding, "999")));
    await settle();
    expect(screen.getByText("Access revoked; account data cleared.")).toBeVisible();
    expect(screen.queryByText("10002", { exact: true })).not.toBeInTheDocument();
  });
  it("resets old rows and cursor when the selected current revision changes", async () => {
    const first = connectedFetcher(
      vi.fn<typeof fetch>().mockResolvedValue(json(historyPage(["10001"], cursor(1)))),
    );
    const { rerender } = render(
      <ConnectedAccountObservationPanel target={target} fetcher={first} />,
    );
    await settle();
    const nextBinding = { ...binding, credentialRevision: "3", configurationRevision: "3" };
    const calls: string[] = [];
    const nextFetcher = vi.fn<typeof fetch>(async (input) => {
      calls.push(String(input));
      if (String(input).includes("/binding?")) return json(nextBinding);
      if (String(input).includes("/financial-history?"))
        return json(historyPage([], null, nextBinding));
      return new Response(
        `event: observation\ndata: ${JSON.stringify(observation(nextBinding))}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    rerender(<ConnectedAccountObservationPanel target={target} fetcher={nextFetcher} />);
    expect(screen.queryByText("10001", { exact: true })).not.toBeInTheDocument();
    await settle();
    expect(screen.getByText(/No persisted records were returned/)).toBeVisible();
    expect(calls.find((url) => url.includes("/financial-history?"))).not.toContain("cursor=");
  });
  it("uses the admin route with organization and no caller-supplied revisions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(historyPage()));
    render(section(fetcher, { endpoint: "/api/trader/admin/account-observation" }));
    await settle();
    expect(fetcher.mock.calls[0][0]).toContain(`/admin/account-observation/financial-history?`);
    expect(fetcher.mock.calls[0][0]).toContain(`organizationId=${binding.organizationId}`);
  });
});
