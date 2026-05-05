import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DiaryWorkspace } from "@/components/dashboard/diary-workspace";
import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import {
  FEATURE_GROWTH_CATALOG,
  buildDashboardTabPresentations,
  tabUiForbiddenPhraseRegex,
} from "@/lib/dashboard/twin-unlock-tab-ui";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";
import { DIARY_ENTRIES_API_PATH } from "@/lib/dashboard/diary-entries-client";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";

const DIARY_SUCCESS = "Saved. Your Twin has one more piece of lived memory.";
const DIARY_EMPTY = "No diary entries yet. Your first entry becomes the first thread of memory.";
const DIARY_PLACEHOLDER =
  "What happened today? What did you feel, choose, avoid, desire, or understand?";

function buildLockedDefaultModel() {
  return buildDashboardViewModel(
    {
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    },
    { hasMeaningfulExchange: false },
    "Test User",
    [],
  );
}

function fetchJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardDialogueArea Diary locked", () => {
  it("shows growth gate without composer; no forbidden wording in gate copy", () => {
    const model = buildLockedDefaultModel();
    const tabPresentations = buildDashboardTabPresentations(resolveDashboardTwinGrowth(model));

    render(
      <DashboardDialogueArea
        model={model}
        selectedMode="diary"
        tabPresentations={tabPresentations}
      />,
    );

    expect(screen.getByTestId("dashboard-workspace-growth-gate")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-workspace-growth-gate")).toHaveTextContent(
      FEATURE_GROWTH_CATALOG.diary.journeyLine,
    );
    expect(screen.queryByTestId("dashboard-diary-textarea")).not.toBeInTheDocument();
    const gateText = screen.getByTestId("dashboard-workspace-growth-gate").textContent ?? "";
    expect(gateText).not.toMatch(tabUiForbiddenPhraseRegex());
  });
});

describe("DiaryWorkspace", () => {
  it("shows composer, placeholder, disabled submit when empty, counter, prompts, and empty recent state after load", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes(DIARY_ENTRIES_API_PATH) && method === "GET") {
        return Promise.resolve(fetchJsonResponse({ entries: [] }));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });

    render(<DiaryWorkspace initialEntries={[]} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        DIARY_ENTRIES_API_PATH,
        expect.objectContaining({ method: "GET", credentials: "include" }),
      ),
    );

    expect(screen.getByTestId("dashboard-diary-workspace")).toBeInTheDocument();
    expect(screen.getByText("Diary")).toBeInTheDocument();
    expect(
      screen.getByText(/This is where your AI-Twin begins remembering your lived experience\./),
    ).toBeInTheDocument();

    const ta = screen.getByTestId("dashboard-diary-textarea");
    expect(ta).toHaveAttribute("placeholder", DIARY_PLACEHOLDER);
    expect(screen.getByTestId("dashboard-diary-submit")).toBeDisabled();
    expect(screen.getByText(/0 \/ 16384/)).toBeInTheDocument();

    const prompts = screen.getByTestId("dashboard-diary-prompts");
    expect(within(prompts).getByRole("button", { name: /What repeated today\?/ })).toBeInTheDocument();

    expect(screen.getByTestId("dashboard-diary-empty-state")).toHaveTextContent(DIARY_EMPTY);
    fetchMock.mockRestore();
  });

  it("submits trimmed entry, clears input, shows success, prepends newest entry", async () => {
    const entry = {
      id: "new-entry-1",
      body: "  My reflective line  ",
      createdAt: "2026-05-03T18:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes(DIARY_ENTRIES_API_PATH) && method === "GET") {
        return Promise.resolve(fetchJsonResponse({ entries: [] }));
      }
      if (
        url.includes(DIARY_ENTRIES_API_PATH) &&
        method === "POST" &&
        typeof init?.body === "string"
      ) {
        return Promise.resolve(
          fetchJsonResponse({
            entry: { ...entry, body: "My reflective line" },
            replayed: false,
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });

    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("idempotency-test-uuid");

    render(<DiaryWorkspace initialEntries={[]} />);

    await waitFor(() => expect(screen.getByTestId("dashboard-diary-textarea")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("dashboard-diary-textarea"), {
      target: { value: entry.body },
    });
    expect(screen.getByTestId("dashboard-diary-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("dashboard-diary-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-diary-success-message")).toHaveTextContent(DIARY_SUCCESS);
    });
    expect(screen.getByTestId("dashboard-diary-textarea")).toHaveValue("");
    expect(screen.getByTestId(`dashboard-diary-entry-${entry.id}`)).toHaveTextContent("My reflective line");
  });

  it("shows error and preserves input on failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes(DIARY_ENTRIES_API_PATH) && method === "GET") {
        return Promise.resolve(fetchJsonResponse({ entries: [] }));
      }
      if (url.includes(DIARY_ENTRIES_API_PATH) && method === "POST") {
        return Promise.resolve(
          fetchJsonResponse(
            { error: { code: "BODY_TOO_LONG", message: "Too long for Twin memory." } },
            400,
          ),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });

    render(<DiaryWorkspace initialEntries={[]} />);

    await waitFor(() => expect(screen.getByTestId("dashboard-diary-textarea")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("dashboard-diary-textarea"), {
      target: { value: "preserve me" },
    });
    fireEvent.click(screen.getByTestId("dashboard-diary-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-diary-error-message")).toHaveTextContent(
        /Too long for Twin memory/i,
      );
    });
    expect(screen.getByTestId("dashboard-diary-textarea")).toHaveValue("preserve me");
    expect(screen.queryByTestId("dashboard-diary-success-message")).not.toBeInTheDocument();
  });

  it("lists entries newest first after load (server returns ascending)", async () => {
    const serverEntries = [
      { id: "a", body: "older", createdAt: "2026-05-01T10:00:00.000Z" },
      { id: "b", body: "newer", createdAt: "2026-05-02T15:00:00.000Z" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes(DIARY_ENTRIES_API_PATH) && method === "GET") {
        return Promise.resolve(fetchJsonResponse({ entries: serverEntries }));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });

    render(<DiaryWorkspace initialEntries={[]} />);

    await waitFor(() => expect(screen.queryByTestId("dashboard-diary-empty-state")).not.toBeInTheDocument());
    const list = screen.getByTestId("dashboard-diary-entry-list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-testid", "dashboard-diary-entry-b");
    expect(items[1]).toHaveAttribute("data-testid", "dashboard-diary-entry-a");
  });

  it("does not dump raw JSON into the document for normal responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fetchJsonResponse({ entries: [] }));
    render(<DiaryWorkspace initialEntries={[]} />);
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-diary-empty-state")).toBeInTheDocument(),
    );
    expect(screen.getByRole("region", { name: "Diary" }).textContent).not.toMatch(/\{\s*"entries"/);
  });
});
