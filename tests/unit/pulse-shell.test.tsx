import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PulseShell } from "@/components/trader/admin/pulse-shell";
import { resetCockpitStreamBudget } from "@/components/trader/admin/use-admin-cockpit-stream";

const ORG = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`organization_id=${ORG}`),
  usePathname: () => "/admin/runtime-authority",
  useRouter: () => ({ replace: vi.fn() }),
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
});
