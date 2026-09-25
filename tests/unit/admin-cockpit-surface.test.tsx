import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminCockpitFacts } from "@/components/trader/admin/admin-cockpit-facts";
import {
  resetCockpitStreamBudget,
  useAdminCockpitStream,
} from "@/components/trader/admin/use-admin-cockpit-stream";
import AdminDashboardPage from "@/app/(trader)/admin/page";
import {
  adminScopedHref,
  formatCockpitAge,
  parseCockpitSnapshot,
} from "@/lib/trader/admin/cockpit-client";

const search = vi.hoisted(() => ({
  organizationId: "11111111-1111-4111-8111-111111111111",
}));
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL = "33333333-3333-4333-8333-333333333333";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(search.organizationId ? `organization_id=${search.organizationId}` : ""),
}));

type Source = {
  listeners: Map<string, (event: MessageEvent<string>) => void>;
  close: ReturnType<typeof vi.fn>;
  onerror: (() => void) | null;
  addEventListener: (name: string, cb: (event: MessageEvent<string>) => void) => void;
};

function installSources() {
  const sources: Source[] = [];
  vi.stubGlobal(
    "EventSource",
    vi.fn(() => {
      const listeners = new Map<string, (event: MessageEvent<string>) => void>();
      const source: Source = {
        listeners,
        close: vi.fn(),
        onerror: null,
        addEventListener: (name, cb) => listeners.set(name, cb),
      };
      sources.push(source);
      return source;
    }),
  );
  return sources;
}

function snapshot(organizationId: string, posture = "HALT") {
  return {
    organizationId,
    releaseIdentity: {
      state: "unavailable",
      source: "missing:admin-release-identity-read-model",
      asOf: { state: "unknown" },
    },
    runtimeAuthority: {
      state: "value",
      source: "runtime-authority-read-model-v2",
      asOf: { state: "known", at: "2026-09-23T10:00:00.000Z" },
      value: { availability: "READ", posture },
    },
    observationFreshness: {
      state: "unavailable",
      source: "account-observation.readLatest",
      asOf: { state: "unknown" },
    },
    c3: {
      state: "unavailable",
      source: "missing:operator-selected-campaign-run-id",
      asOf: { state: "unknown" },
      operatorCampaignRunId: undefined,
    },
  };
}

function emit(source: Source, name: string, body: unknown) {
  act(() => {
    source.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(body) }));
  });
}

afterEach(() => {
  cleanup();
  search.organizationId = ORG;
  resetCockpitStreamBudget();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cockpit client", () => {
  it("keeps an organization id on a section link and omits an empty one", () => {
    expect(adminScopedHref("/admin/kill-switches", ORG)).toBe(
      `/admin/kill-switches?organization_id=${ORG}`,
    );
    expect(adminScopedHref("/admin/audit", "  ")).toBe("/admin/audit");
  });

  it("rejects another organization and an unknown age never becomes a clock time", () => {
    expect(parseCockpitSnapshot(JSON.stringify(snapshot(OTHER)), ORG)).toBeNull();
    expect(formatCockpitAge({ state: "unknown" }, Date.now() + 60_000)).toBe("Age unknown");
    expect(
      formatCockpitAge(
        { state: "known", at: "2026-09-23T10:00:00.000Z" },
        Date.parse("2026-09-23T10:00:05.000Z"),
      ),
    ).toBe("5s ago");
  });
});

describe("admin cockpit stream", () => {
  it("updates a tile from a pushed snapshot and marks a silent stream stale in place", async () => {
    vi.useFakeTimers();
    const sources = installSources();
    render(<AdminCockpitFacts organizationId={ORG} organizationName="Alpha" />);
    expect(screen.getByText("Waiting for the cockpit read.")).toBeInTheDocument();
    expect(screen.queryByText("UNAVAILABLE")).not.toBeInTheDocument();
    emit(sources[0]!, "cockpit.snapshot", snapshot(ORG, "HALT"));
    expect(screen.getByText("READ · HALT")).toBeInTheDocument();
    expect(screen.getByText("Source runtime-authority-read-model-v2")).toBeInTheDocument();
    expect(
      screen.getByText("Source missing:admin-release-identity-read-model"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Age unknown").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cockpit-connection")).toHaveAttribute("data-state", "live");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByText("READ · HALT")).toBeInTheDocument();
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cockpit-connection")).toHaveAttribute("data-state", "live");
    expect(screen.getByTestId("cockpit-connection")).toHaveAttribute("data-stale", "true");
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it("leaves live on a drop, reconnects, then degrades to poll with the next snapshot", async () => {
    const sources = installSources();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(snapshot(ORG, "FULL")));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminCockpitFacts organizationId={ORG} organizationName="Alpha" />);
    emit(sources[0]!, "cockpit.snapshot", snapshot(ORG, "HALT"));
    await act(async () => {
      sources[0]!.onerror?.();
    });
    expect(screen.getByTestId("cockpit-connection")).toHaveTextContent("Reconnecting");
    expect(screen.getByText("READ · HALT")).toBeInTheDocument();
    expect(sources[0]!.close).toHaveBeenCalled();
    expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(2);
    await act(async () => {
      sources[1]!.onerror?.();
    });
    expect(screen.getByTestId("cockpit-connection")).toHaveTextContent("Polling");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/trader/admin/cockpit/stream?organization_id=${ORG}&transport=poll`,
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(screen.getByText("READ · FULL")).toBeInTheDocument();
    expect(screen.queryByText("READ · HALT")).not.toBeInTheDocument();
  });

  it("drops a foreign snapshot and closes the stream when the organization changes", () => {
    const sources = installSources();
    const { rerender } = render(
      <AdminCockpitFacts organizationId={ORG} organizationName="Alpha" />,
    );
    emit(sources[0]!, "cockpit.snapshot", snapshot(OTHER, "LEAKED_POSTURE"));
    expect(screen.queryByText(/LEAKED_POSTURE/)).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the cockpit read.")).toBeInTheDocument();
    emit(sources[0]!, "cockpit.snapshot", snapshot(ORG, "HALT"));
    rerender(<AdminCockpitFacts organizationId={OTHER} organizationName="Beta" />);
    expect(screen.queryByText("READ · HALT")).not.toBeInTheDocument();
    expect(sources[0]!.close).toHaveBeenCalled();
    expect(String(vi.mocked(EventSource).mock.calls.at(-1)?.[0])).toContain(OTHER);
  });

  it("treats a heartbeat as contact and does not turn it into a fact", () => {
    vi.useFakeTimers();
    const sources = installSources();
    render(<AdminCockpitFacts organizationId={ORG} organizationName="Alpha" />);
    emit(sources[0]!, "cockpit.snapshot", snapshot(ORG, "HALT"));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);
    emit(sources[0]!, "heartbeat", { kind: "heartbeat" });
    expect(screen.getByText("READ · HALT")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.queryByText(/T\d/)).not.toBeInTheDocument();
    expect(screen.getByTestId("cockpit-connection")).toHaveAttribute("data-state", "live");
  });

  it("polls instead of opening another stream once four live streams are open", async () => {
    vi.useFakeTimers();
    installSources();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(snapshot(ORG, "HALT")));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 4; index += 1) {
      renderHook(() => useAdminCockpitStream(`00000000-0000-4000-8000-00000000000${index}`));
    }
    render(<AdminCockpitFacts organizationId={ORG} organizationName="Alpha" />);
    expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/trader/admin/cockpit/stream?organization_id=${ORG}&transport=poll`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByTestId("cockpit-connection")).toHaveAttribute("data-state", "poll");
  });

  it("closes the source on unmount", () => {
    const sources = installSources();
    const { unmount } = renderHook(() => useAdminCockpitStream(ORG));
    unmount();
    expect(sources[0]!.close).toHaveBeenCalled();
  });
});

describe("admin dashboard", () => {
  it("shows the explicit Postgres requirement from the console v1 envelope", async () => {
    installSources();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/trader/admin/organizations")) {
          return Response.json({ organizations: [{ id: ORG, name: "Alpha", kind: "team" }] });
        }
        return Response.json({
          schemaVersion: "admin-console/v1",
          data: { state: "unavailable", reasons: ["POSTGRES_REQUIRED"] },
        });
      }),
    );
    render(<AdminDashboardPage />);
    expect(screen.queryByTestId("admin-org-select")).not.toBeInTheDocument();
    expect((await screen.findAllByText(/Нужен Postgres/)).length).toBeGreaterThan(0);
  });

  it("reads the canonical console overview endpoint", async () => {
    installSources();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/trader/admin/organizations")) {
        return Response.json({ organizations: [] });
      }
      if (url.includes("/api/trader/admin/connected-accounts")) {
        return Response.json({
          accounts: [
            {
              organizationId: ORG,
              accountName: "Primary",
              credentialId: CREDENTIAL,
              exchangeAccountId: "account-a",
              venue: "htx",
              status: "active",
              updatedAt: "2026-09-23T10:00:00.000Z",
            },
          ],
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDashboardPage />);
    await act(async () => {
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/api/trader/admin/console/overview"),
        ),
      ).toBe(true);
    });
  });
});
