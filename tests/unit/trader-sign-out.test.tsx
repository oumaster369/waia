import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TraderSignOut } from "@/components/trader/trader-sign-out";
import { AdminShell } from "@/components/trader/admin/admin-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Trader sign out", () => {
  it("aborts on unmount and ignores an acknowledgement arriving after navigation", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const redirect = vi.fn();
    const { unmount } = render(<TraderSignOut onSignedOut={redirect} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    unmount();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => finish(Response.json({ ok: true })));
    expect(redirect).not.toHaveBeenCalled();
  });
  it("exposes sign out in AdminShell", () => {
    render(<AdminShell><p>Protected view fixture</p></AdminShell>);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  it("aborts a stalled request and exposes an explicit retryable failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const redirect = vi.fn();
    render(<TraderSignOut onSignedOut={redirect} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it("blocks duplicate requests while pending and redirects only after acknowledgement", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const redirect = vi.fn();
    render(<TraderSignOut onSignedOut={redirect} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const pending = screen.getByRole("button", { name: "Signing out…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(redirect).not.toHaveBeenCalled();
    await act(async () => finish(Response.json({ ok: true })));
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(pending).toBeDisabled();
  });

  it.each([
    ["HTTP rejection", () => Promise.resolve(Response.json({ ok: true }, { status: 500 }))],
    ["negative acknowledgement", () => Promise.resolve(Response.json({ ok: false }))],
    ["invalid JSON", () => Promise.resolve(new Response("not-json"))],
    ["network failure", () => Promise.reject(new Error("offline"))],
  ])("reports %s without claiming logout, and supports retry", async (_name, response) => {
    const fetchMock = vi.fn().mockImplementationOnce(response).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const redirect = vi.fn();
    render(<TraderSignOut onSignedOut={redirect} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed"));
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
