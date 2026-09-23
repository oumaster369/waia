import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PulseShell } from "@/components/trader/admin/pulse-shell";
import { resetCockpitStreamBudget } from "@/components/trader/admin/use-admin-cockpit-stream";

const ORG = "11111111-1111-4111-8111-111111111111";
const navigation = vi.hoisted(() => ({
  pathname: "/admin/runtime-authority",
  search: "organization_id=11111111-1111-4111-8111-111111111111",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
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

function snapshot() {
  return {
    organizationId: ORG,
    releaseIdentity: {
      state: "unavailable",
      source: "missing:admin-release-identity-read-model",
      asOf: { state: "unknown" },
    },
    runtimeAuthority: {
      state: "value",
      source: "runtime-authority-read-model-v2",
      asOf: { state: "known", at: "2026-09-23T10:00:00.000Z" },
      value: {
        availability: "READ",
        posture: "HALT",
        reasonCodes: ["RUNTIME_CONTROL_LEASE_INVALID"],
      },
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
    },
  };
}

afterEach(() => {
  cleanup();
  navigation.pathname = "/admin/runtime-authority";
  navigation.search = `organization_id=${ORG}`;
  navigation.replace.mockReset();
  resetCockpitStreamBudget();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PulseShell", () => {
  it("shows a stale lamp on a legacy page without adding a mutation button", async () => {
    vi.useFakeTimers();
    const sources = installSources();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ organizations: [{ id: ORG, name: "Alpha", kind: "team" }], accounts: [] }),
      ),
    );
    render(
      <PulseShell>
        <p>Legacy page fixture</p>
      </PulseShell>,
    );
    expect(screen.getByText("Legacy page fixture")).toBeVisible();
    expect(screen.getByText("Legacy admin page")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    act(() => {
      sources[0]!.listeners.get("cockpit.snapshot")?.(
        new MessageEvent("cockpit.snapshot", { data: JSON.stringify(snapshot()) }),
      );
    });
    expect(screen.getByTestId("pulse-connection")).toHaveAttribute("data-state", "live");
    expect(screen.getByTestId("pulse-connection")).toHaveAttribute("data-transport", "live");
    expect(screen.getByRole("link", { name: "RUNTIME_CONTROL_LEASE_INVALID" })).toHaveAttribute(
      "href",
      `/admin/runtime-authority?organization_id=${ORG}`,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByTestId("pulse-connection")).toHaveAttribute("data-state", "stale");
    expect(screen.getByTestId("pulse-connection")).toHaveAttribute("data-transport", "live");
    expect(screen.getByTestId("pulse-runtime-posture")).toHaveTextContent("READ · HALT");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("saves a typed campaign run id onto the cockpit query without using FHV commands", () => {
    vi.stubGlobal(
      "EventSource",
      vi.fn(() => ({
        close: vi.fn(),
        addEventListener: vi.fn(),
        onerror: null,
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ organizations: [], accounts: [] })),
    );
    render(
      <PulseShell>
        <p>Legacy page fixture</p>
      </PulseShell>,
    );
    expect(screen.getByTestId("pulse-campaign-status")).toHaveAttribute("data-saved", "false");
    expect(screen.getByRole("link", { name: "Runtime authority" })).toHaveAttribute(
      "href",
      `/admin/runtime-authority?organization_id=${ORG}`,
    );
    expect(screen.getByRole("link", { name: "FHV operations" })).toHaveAttribute(
      "href",
      `/admin/fhv-operations?organization_id=${ORG}`,
    );
    const halt = screen.getByRole("link", { name: "HALT" });
    expect(halt).toHaveAttribute(
      "href",
      `/admin/kill-switches?organization_id=${ORG}&switch_type=EMERGENCY_STOP`,
    );
    expect(halt.getAttribute("href")).not.toContain("fhv");
    const runId = screen.getByLabelText("Campaign run id");
    fireEvent.change(runId, { target: { value: "bad id" } });
    fireEvent.keyDown(runId, { key: "Enter" });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("pulse-campaign-status")).toHaveTextContent("format is invalid");
    fireEvent.change(runId, { target: { value: "run-1" } });
    fireEvent.keyDown(runId, { key: "Enter" });
    expect(navigation.replace).toHaveBeenCalledWith(
      `/admin/runtime-authority?organization_id=${ORG}&campaign_run_id=run-1`,
      { scroll: false },
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
