import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TraderProfileSettings } from "@/components/trader/trader-profile-settings";

const profile = { displayName: "Ada", locale: "en" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("trader profile settings", () => {
  it("loads the current display name and locale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: true, profile })),
    );
    render(<TraderProfileSettings />);
    await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveValue("Ada"));
    expect(screen.getByLabelText("Locale")).toHaveValue("en");
    expect(screen.getByText(/does not change capital/)).toBeInTheDocument();
  });

  it("saves a valid profile", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json({ ok: true, profile: { displayName: "Ada Lovelace", locale: "en-US" } });
      }
      return json({ ok: true, profile });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<TraderProfileSettings />);
    await screen.findByLabelText("Display name");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText("Locale"), { target: { value: "en-US" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save profile" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
    const patch = fetcher.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/profile");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      displayName: "Ada Lovelace",
      locale: "en-US",
    });
  });

  it("shows the server error and restores the previous values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return json({ error: { message: "locale format is invalid." } }, 400);
        }
        return json({ ok: true, profile });
      }),
    );
    render(<TraderProfileSettings />);
    await screen.findByLabelText("Locale");
    fireEvent.change(screen.getByLabelText("Locale"), { target: { value: "english" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save profile" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("locale format is invalid.")).toBeInTheDocument());
    expect(screen.getByLabelText("Locale")).toHaveValue("en");
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada");
  });

  it("stays quiet when the profile API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({})),
    );
    render(<TraderProfileSettings />);
    await waitFor(() =>
      expect(screen.getByText("Profile settings are unavailable.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
