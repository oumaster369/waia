import { afterEach, describe, expect, it, vi } from "vitest";

import { createFinanceConfirmation } from "@/lib/waia-core/finance-assistant/confirmation";
import { FinanceAssistantError } from "@/lib/waia-core/finance-assistant/types";
import { handleFinanceAssistantExecutePost } from "@/lib/waia-core/treasury/admin/handlers";
import {
  ADMIN_USER,
  ORG_A,
  createWp4Bundle,
  createWp4Deps,
  jsonRequest,
} from "@/tests/unit/helpers/treasury-wp4";

const secret = "finance-assistant-test-secret-at-least-32";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Finance Assistant confirmed execution", () => {
  it("creates only the confirmed record through audited services", async () => {
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_WRITES_ENABLED", "true");
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_CONFIRMATION_SECRET", secret);
    const { services, audits } = createWp4Bundle();
    const consumed: string[] = [];
    const deps = {
      ...createWp4Deps({ services }),
      consumeFinanceAssistantConfirmation: async (
        _runtime: unknown,
        payload: { nonce: string },
      ) => {
        consumed.push(payload.nonce);
      },
    };
    const token = await createFinanceConfirmation({
      userId: ADMIN_USER,
      organizationId: ORG_A,
      intent: "CREATE_PROJECT",
      fields: {
        name: "Breath of WAIA",
        description: "Public Treasury transparency",
        startsOn: "2026-08-24",
        endsOn: null,
      },
      secret,
    });

    const response = await handleFinanceAssistantExecutePost(
      jsonRequest("/api/admin/treasury/assistant/execute", {
        organization_id: ORG_A,
        confirmation_token: token,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect((response.body as { mode: string }).mode).toBe("write_result");
    expect(consumed).toHaveLength(1);
    expect(audits.some((row) => row.action === "treasury.project.create")).toBe(true);
    const listed = await services.ledgerCatalog.listProjects({ organizationId: ORG_A }, {});
    expect(listed.items.map((row) => row.name)).toContain("Breath of WAIA");
  });

  it("fails closed when the single-use receipt reports a replay", async () => {
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_WRITES_ENABLED", "true");
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_CONFIRMATION_SECRET", secret);
    const { services } = createWp4Bundle();
    const deps = {
      ...createWp4Deps({ services }),
      consumeFinanceAssistantConfirmation: async () => {
        throw new FinanceAssistantError(
          "ASSISTANT_CONFIRMATION_ALREADY_USED",
          "This confirmation was already used.",
        );
      },
    };
    const token = await createFinanceConfirmation({
      userId: ADMIN_USER,
      organizationId: ORG_A,
      intent: "CREATE_PROJECT",
      fields: { name: "Duplicate attempt" },
      secret,
    });
    const response = await handleFinanceAssistantExecutePost(
      jsonRequest("/api/admin/treasury/assistant/execute", {
        organization_id: ORG_A,
        confirmation_token: token,
      }),
      deps,
    );
    expect(response.status).toBe(409);
    const listed = await services.ledgerCatalog.listProjects({ organizationId: ORG_A }, {});
    expect(listed.items).toHaveLength(0);
  });

  it("does not execute while the Human activation flag is dark", async () => {
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_WRITES_ENABLED", "false");
    const response = await handleFinanceAssistantExecutePost(
      jsonRequest("/api/admin/treasury/assistant/execute", {
        organization_id: ORG_A,
        confirmation_token: "unused",
      }),
      createWp4Deps({ services: createWp4Bundle().services }),
    );
    expect(response.status).toBe(503);
  });
});
