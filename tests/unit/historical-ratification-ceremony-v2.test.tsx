import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoricalRatificationCeremonyV2 } from
  "@/components/trader/admin/historical-ratification-ceremony-v2";

const organizationId = "11111111-1111-4111-8111-111111111111";
const runId = "partner-observed-wf";
const releaseSha = "a".repeat(40);
const proposalDigest = "b".repeat(64);

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function json(body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status: 200,
    headers: { "content-type": "application/json", ...headers } });
}

describe("Historical V2 authenticated Admin launch ceremony", () => {
  it.each(["STARTED", "PROGRESS", "FAILED", "PROPOSAL_AVAILABLE", "UNKNOWN"])(
    "renders bounded %s diagnostics without granting request or approval authority", async phase => {
      const fetchMock = vi.fn(async () => json({ preparationState: "REQUEST_RECORDED",
        proposalAvailable: false, requestId: "request-1", preparationAttempt: {
          phase, authorityGranted: false, progressPhase: "VALIDATION_RESAMPLES",
          completed: "12", total: "100", surfaceKey: "BTCUSDT:30",
          trialIdentityDigestHex: "f".repeat(64), observedAt: "2026-09-07T07:00:00.000Z",
          errorCode: "CONNECTION_LOST", rawError: "PRIVATE-DETAIL-MUST-NOT-RENDER" } }));
      vi.stubGlobal("fetch", fetchMock);
      render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
        initialReleaseSha={releaseSha}/>);
      const panel = await screen.findByRole("region", { name: "Preparation attempt diagnostics" });
      expect(panel).toHaveTextContent("2026-09-07T07:00:00.000Z");
      expect(panel).toHaveTextContent("Diagnostics do not grant launch or retry authority");
      if (phase === "FAILED") expect(screen.getByRole("alert")).toHaveTextContent("lost its database connection");
      else if (phase === "STARTED" || phase === "PROGRESS") {
        expect(panel).toHaveTextContent("Current execution is unconfirmed");
      } else expect(panel).toHaveTextContent("Preparation status unconfirmed");
      if (phase === "PROGRESS") {
        expect(panel).toHaveTextContent("12 / 100");
        expect(panel).toHaveTextContent("Surface: BTCUSDT:30");
        expect(panel).toHaveTextContent("Trial: " + "f".repeat(64));
        expect(panel).toHaveTextContent("not overall preparation progress");
      } else expect(panel).not.toHaveTextContent("12 / 100");
      expect(screen.queryByText(/PRIVATE-DETAIL-MUST-NOT-RENDER/)).toBeNull();
      expect(screen.queryByRole("button", { name: /request exact|ratify/i })).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

  it("does not echo unknown diagnostic text or invalid counters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ preparationState: "REQUEST_RECORDED", proposalAvailable: false,
      preparationAttempt: { authorityGranted: false, phase: "FAILED", errorCode: "SECRET-CODE",
        progressPhase: "SECRET-STAGE", observedAt: "SECRET-TIME", completed: -1, total: 0,
        surfaceKey: "SECRET-SURFACE", trialIdentityDigestHex: "SECRET-TRIAL" } })));
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("failure reason is unavailable");
    expect(screen.queryByText(/SECRET-/)).toBeNull();
    expect(screen.getByRole("region", { name: "Preparation attempt diagnostics" })).toHaveTextContent("timestamp unavailable");
  });

  it("automatically refreshes recorded progress to failure without another POST", async () => {
    let phase = "STARTED";
    const interval = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input; void init; return json({
      preparationState: "REQUEST_RECORDED", proposalAvailable: false,
      preparationAttempt: { phase, authorityGranted: false, errorCode: "PREPARATION_FAILED",
        observedAt: "2026-09-07T07:00:00.000Z" } }); });
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    expect(await screen.findByRole("region", { name: "Preparation attempt diagnostics" })).toHaveTextContent("Preparation progress recorded");
    phase = "FAILED";
    const tick = interval.mock.calls[0]![0] as () => void;
    await act(async () => { tick(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Preparation failed");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("does not let an older overlapping poll replace a newer durable failure", async () => {
    let finishOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>(resolve => { finishOld = resolve; });
    const interval = vi.spyOn(window, "setInterval");
    const response = (phase: string) => json({ preparationState: "REQUEST_RECORDED",
      proposalAvailable: false, preparationAttempt: { phase, authorityGranted: false,
        errorCode: "CANCELLED", observedAt: "2026-09-07T07:00:00.000Z" } });
    const fetchMock = vi.fn().mockResolvedValue(response("STARTED"))
      .mockResolvedValueOnce(response("STARTED")).mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(response("FAILED"));
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    await screen.findByRole("region", { name: "Preparation attempt diagnostics" });
    const tick = interval.mock.calls[0]![0] as () => void;
    await act(async () => { tick(); tick(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("cancelled");
    await act(async () => { finishOld(response("STARTED")); await oldResponse; });
    expect(screen.getByRole("alert")).toHaveTextContent("cancelled");
    expect(screen.queryByText("Preparation progress recorded")).toBeNull();
  });

  it("accepts successful six-second responses when the polling interval is five seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      setTimeout(() => resolve(json({ preparationState: "REQUEST_RECORDED", proposalAvailable: false,
        preparationAttempt: { phase: "STARTED", authorityGranted: false } })), 6_000);
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "Preparation attempt diagnostics" })).toHaveTextContent("Preparation progress recorded");
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent("Preparation request recorded");
  });

  it.each(["401", "500", "network"])("ignores an older %s failure after a newer successful poll", async kind => {
    let finishOld!: (response: Response) => void, rejectOld!: (error: Error) => void;
    const oldResponse = new Promise<Response>((resolve, reject) => { finishOld = resolve; rejectOld = reject; });
    const interval = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValue(json({
      preparationState: "REQUEST_RECORDED", proposalAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    const tick = interval.mock.calls[0]![0] as () => void;
    await act(async () => { tick(); });
    expect(await screen.findByRole("status")).toHaveTextContent("Preparation request recorded");
    await act(async () => {
      if (kind !== "network") finishOld(new Response(JSON.stringify({ error: { message: "STALE-FAILURE" } }), { status: Number(kind) }));
      else rejectOld(new Error("STALE-FAILURE"));
      await oldResponse.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/STALE-FAILURE/)).toBeNull();
  });

  it.each(["401", "500", "network"])("preserves a newer %s failure when an older success arrives later", async kind => {
    let finishOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>(resolve => { finishOld = resolve; });
    const interval = vi.spyOn(window, "setInterval");
    const fetchMock = vi.fn().mockReturnValueOnce(oldResponse);
    if (kind === "network") fetchMock.mockRejectedValueOnce(new Error("CURRENT-FAILURE"));
    else fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "CURRENT-FAILURE" } }), { status: Number(kind) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId}
      initialReleaseSha={releaseSha}/>);
    const tick = interval.mock.calls[0]![0] as () => void;
    await act(async () => { tick(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("CURRENT-FAILURE");
    await act(async () => { finishOld(json({ preparationState: "REQUEST_RECORDED", proposalAvailable: false })); await oldResponse; });
    expect(screen.getByRole("alert")).toHaveTextContent("CURRENT-FAILURE");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /request exact technical proposal/i })).toBeDisabled();
  });
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
