import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoricalRatificationCeremonyV2 } from
  "@/components/trader/admin/historical-ratification-ceremony-v2";

const organizationId = "11111111-1111-4111-8111-111111111111";
const runId = "partner-observed-wf";
const releaseSha = "a".repeat(40);
const proposalDigest = "b".repeat(64);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function json(body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status: 200,
    headers: { "content-type": "application/json", ...headers } });
}

describe("Historical V2 authenticated Admin launch ceremony", () => {
  it("obtains bound CSRF and requests preparation without accepting a CLI actor", async () => {
    let recorded = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(init.headers).toMatchObject({ "x-fhv-csrf-token": "csrf-token" });
        expect(JSON.parse(String(init.body))).toEqual({
          action: "REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL",
          initial_record_index: 525600,
          cycle_count: 35,
        });
        recorded = true;
        return json({ id: "request-1", contentDigestHex: "c".repeat(64) });
      }
      return json({ proposalAvailable: false,
        preparationState: recorded ? "REQUEST_RECORDED" : "NOT_REQUESTED",
        ...(recorded ? { requestId: "request-1",
          requestedExtent: { initialRecordIndex: 525600, cycleCount: 35 } } : {}) },
      { "x-fhv-csrf-token": "csrf-token" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    const button = await screen.findByRole("button", { name: /request exact technical proposal/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/initial record index/i), {
      target: { value: "525600" },
    });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method === "POST")).toBe(true));
    expect(await screen.findByRole("status")).toHaveTextContent("Preparation request recorded");
    expect(screen.getByRole("status")).toHaveTextContent("does not confirm that computation is running");
    expect(screen.queryByRole("button", { name: /request exact technical proposal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /ratify this exact proposal/i })).toBeNull();
    view.unmount();
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    expect(await screen.findByRole("status")).toHaveTextContent("request-1");
    expect(screen.getByRole("status")).toHaveTextContent("35 cycles");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("never claims recorded intent after a failed authenticated request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => init?.method === "POST"
      ? new Response(JSON.stringify({ error: { message: "Request refused" } }), { status: 409 })
      : json({ preparationState: "NOT_REQUESTED", proposalAvailable: false },
        { "x-fhv-csrf-token": "csrf-token" })));
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    const button = screen.getByRole("button", { name: /request exact technical proposal/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Request refused");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not display a late recorded-request response from the previous scope", async () => {
    let finishOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { finishOld = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("run_id=old-run") ? oldResponse : json({
        preparationState: "NOT_REQUESTED", proposalAvailable: false },
      { "x-fhv-csrf-token": "new-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<HistoricalRatificationCeremonyV2 organizationId={organizationId}
      runId="old-run" initialReleaseSha={releaseSha}/>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    view.rerender(<HistoricalRatificationCeremonyV2 organizationId={organizationId}
      runId="new-run" initialReleaseSha={releaseSha}/>);
    await waitFor(() => expect(screen.getByRole("button", {
      name: /request exact technical proposal/i })).toBeEnabled());
    await act(async () => { finishOld(json({ preparationState: "REQUEST_RECORDED",
      proposalAvailable: false, requestId: "OLD-REQUEST-MUST-NOT-APPEAR" },
    { "x-fhv-csrf-token": "old-token" })); await oldResponse; });
    expect(screen.queryByText(/OLD-REQUEST-MUST-NOT-APPEAR/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /request exact technical proposal/i })).toBeEnabled();
  });

  it("shows exact identity and sends only the displayed proposal id and digest", async () => {
    const proposal = { contentDigestHex: proposalDigest,
      technicalCandidateContentDigestHex: "c".repeat(64),
      requestContentDigestHex: "d".repeat(64),
      technicalCandidate: {
        qualificationReceiptDigestHex: "e".repeat(64),
        firstEconomicRecordIndex: 525600,
        economicRecordCount: 129600,
        surfaces: ["BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60"].map(
          (surfaceKey) => ({ surfaceKey, familyIdentityDigestHex: "1".repeat(64),
            predictivePackageGenerationIdentityDigestHex: "2".repeat(64),
            predictivePackageContentDigestHex: "3".repeat(64),
            kmGlobalAnchorSetDigestHex: "4".repeat(64),
            volumeQualificationReceiptDigestHex: "5".repeat(64) }),
        ),
      },
      launchPlan: { accountId: "historical-observer", symbol: "BTCUSDT",
        primaryHorizonMinutes: 30, startingCashUsdt: "10000", defaultQuantity: "0.001",
        initialRecordIndex: 525600, cycleCount: 35 },
      authorityBoundary: { capitalAuthority: "NONE", liveTradingAuthority: "NONE",
        blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED" } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          action: "RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY",
          proposal_id: "33333333-3333-4333-8333-333333333333",
          proposal_content_digest_hex: proposalDigest,
        });
      }
      return json({ proposalAvailable: true,
        proposalId: "33333333-3333-4333-8333-333333333333", proposal, ratified: false },
      { "x-fhv-csrf-token": "csrf-token" });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    expect(await screen.findByText(proposalDigest)).toBeInTheDocument();
    expect(screen.getByText(/Qualified economic boundary:/)).toHaveTextContent("525600");
    expect(screen.getByText("ETHUSDT:60")).toBeInTheDocument();
    expect(screen.getByText(/Blind holdout:/)).toHaveTextContent("FORBIDDEN_NOT_PRESENT_NOT_ACCESSED");
    fireEvent.click(screen.getByRole("button", { name: /ratify this exact proposal/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method === "POST")).toBe(true));
  });
});
