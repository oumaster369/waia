import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FhvOperationsAdminPage from "@/app/(trader)/admin/fhv-operations/page";
import { buildFhvAdminStatusPath } from "@/lib/trader/fhv-campaign-run-id";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";

const ORG_ID = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "dee-416-ui-run";
const { mockSearchParams } = vi.hoisted(() => ({ mockSearchParams: new URLSearchParams("campaign_run_id=dee-416-ui-run") }));

vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));
vi.mock("@/components/trader/admin/admin-org-selector", () => ({
  AdminOrgSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <select data-testid="admin-org-selector" value={value} onChange={(event) => onChange(event.target.value)}><option value={ORG_ID}>{ORG_ID}</option><option value="00000000-0000-4000-8000-0000000416b2">other-org</option></select>,
  AdminLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  AdminErrorState: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  useAdminOrganizations: () => ({ organizations: [{ id: ORG_ID, name: "Test Org" }, { id: "00000000-0000-4000-8000-0000000416b2", name: "Other Org" }], loading: false, error: null }),
}));

function statusResponse() {
  return JSON.stringify({ status: buildFhvOperatorStatusV1({ organizationId: ORG_ID, runId: RUN_ID, phase: "validation", codeSha: "sha", artifactDigest: "artifact", datasetSeal: "seal", datasetDigest: "digest", configurationDigest: "config" }) });
}

describe("DEE-785 streaming FHV Admin Console", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mockSearchParams.set("campaign_run_id", RUN_ID); });

  it("connects automatically with exact organization and campaign binding", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe(buildFhvAdminStatusPath(ORG_ID, RUN_ID));
      return new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(screen.getByTestId("fhv-streaming-console")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Sync balances")).not.toBeInTheDocument();
    expect(screen.getAllByText(RUN_ID)).toHaveLength(1);
    expect(screen.getByText(/Open positions only/i)).toBeInTheDocument();
  });

  it("does not connect until a valid campaign run ID is supplied", async () => {
    mockSearchParams.delete("campaign_run_id");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Campaign run ID is required.");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("fhv-campaign-run-id"), { target: { value: "invalid id" } });
    expect(screen.getByRole("alert")).toHaveTextContent("format is invalid");
  });

  it("keeps the last good snapshot visible while reconnecting", async () => {
    let requests = 0;
    const fetchMock = vi.fn(async () => {
      requests += 1;
      if (requests === 1) return new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: { message: "temporary outage" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(screen.getByTestId("fhv-streaming-console")).toBeInTheDocument());
    expect(screen.getByText("Historical Test Command Center")).toBeInTheDocument();
  });

  it("uses the authenticated admin SSE endpoint and subscribes to the full event contract", async () => {
    const listeners: string[] = [];
    const source = { onopen: null as (() => void) | null, onerror: null as (() => void) | null, addEventListener: vi.fn((kind: string) => listeners.push(kind)), close: vi.fn() };
    const EventSourceMock = vi.fn(() => source);
    vi.stubGlobal("EventSource", EventSourceMock);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(EventSourceMock).toHaveBeenCalledTimes(1));
    expect(EventSourceMock).toHaveBeenCalledWith(`/api/trader/admin/fhv-operations/stream?organization_id=${encodeURIComponent(ORG_ID)}&campaign_run_id=${encodeURIComponent(RUN_ID)}`, { withCredentials: true });
    expect(listeners).toEqual(expect.arrayContaining(["campaign.progress", "account.balance", "position.snapshot", "trade.snapshot", "decision.snapshot", "checkpoint", "risk", "gate", "error"]));
  });
});
