import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FhvOperationsAdminPage from "@/app/(trader)/admin/fhv-operations/page";
import { FHV_ADMIN_CSRF_HEADER } from "@/lib/trader/fhv-admin-csrf";
import {
  buildFhvAdminCommandPath,
  buildFhvAdminStatusPath,
} from "@/lib/trader/fhv-campaign-run-id";
import { buildRequiredConfirmationPhrase } from "@/lib/trader/observability/fhv-command-confirmation";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";

const ORG_ID = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "dee-416-ui-run";
const CSRF_TOKEN = "csrf-token-ui-416";

const { mockSearchParams } = vi.hoisted(() => ({
  mockSearchParams: new URLSearchParams("campaign_run_id=dee-416-ui-run"),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/components/trader/admin/admin-org-selector", () => ({
  AdminOrgSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select
      data-testid="admin-org-selector"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={ORG_ID}>{ORG_ID}</option>
    </select>
  ),
  AdminLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  AdminErrorState: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  useAdminOrganizations: () => ({
    organizations: [{ id: ORG_ID, name: "Test Org" }],
    loading: false,
    error: null,
  }),
}));

describe("DEE-416 FHV campaign run selection UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates selected campaign_run_id in status and command URLs and bodies", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/status")) {
        expect(url).toBe(buildFhvAdminStatusPath(ORG_ID, RUN_ID));
        return new Response(
          JSON.stringify({
            status: buildFhvOperatorStatusV1({
              organizationId: ORG_ID,
              runId: RUN_ID,
              phase: "validation",
              codeSha: "sha",
              artifactDigest: "artifact",
              datasetSeal: "seal",
              datasetDigest: "digest",
              configurationDigest: "config",
            }),
            capabilities: {
              commandContractFailClosed: true,
              commandsActuallyEnforced: false,
              supervisorExecutorImplemented: false,
              supervisorQualificationRequired: true,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              [FHV_ADMIN_CSRF_HEADER]: CSRF_TOKEN,
            },
          },
        );
      }
      if (url.includes("/commands")) {
        expect(url).toBe(buildFhvAdminCommandPath(ORG_ID, RUN_ID));
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.campaign_run_id).toBe(RUN_ID);
        expect(body.organization_id).toBe(ORG_ID);
        expect(body.confirmation_phrase).toBe(
          buildRequiredConfirmationPhrase(RUN_ID, "PAUSE_AT_CHECKPOINT"),
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FhvOperationsAdminPage />);
    expect(screen.getByTestId("fhv-campaign-run-id")).toHaveValue(RUN_ID);

    fireEvent.click(screen.getByTestId("fhv-refresh-status"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("fhv-executor-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("fhv-submit-command")).toBeDisabled();
  });

  it("blocks status refresh when campaign run id is empty", async () => {
    mockSearchParams.delete("campaign_run_id");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<FhvOperationsAdminPage />);
    fireEvent.change(screen.getByTestId("fhv-campaign-run-id"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("fhv-refresh-status"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Campaign run ID is required.");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
