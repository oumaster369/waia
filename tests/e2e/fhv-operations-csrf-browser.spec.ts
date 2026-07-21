import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { buildRequiredConfirmationPhrase } from "@/lib/trader/observability/fhv-command-confirmation";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantPlatformAdminByUserEmail } from "./helpers/fhv-e2e-sqlite";

const RUN_ID = "dee-416-e2e-csrf-run";
const ORG_PLACEHOLDER = "__ORG_ID__";
const STATUS_PATH = join(process.cwd(), ".data/fhv-e2e-status.json");

test.describe("DEE-416 FHV browser CSRF lifecycle", () => {
  test.beforeAll(() => {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(
      STATUS_PATH,
      `${JSON.stringify(
        buildFhvOperatorStatusV1({
          organizationId: ORG_PLACEHOLDER,
          runId: RUN_ID,
          phase: "validation",
          codeSha: "sha",
          artifactDigest: "artifact",
          datasetSeal: "seal",
          datasetDigest: "digest",
          configurationDigest: "config",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
  });

  test("stores Set-Cookie naturally and posts with credentials include", async ({ page }) => {
    const email = `fhv-csrf-browser-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    const organizationId = grantPlatformAdminByUserEmail(email);

    const statusTemplate = JSON.parse(readFileSync(STATUS_PATH, "utf8")) as ReturnType<
      typeof buildFhvOperatorStatusV1
    >;
    writeFileSync(
      STATUS_PATH,
      `${JSON.stringify(
        {
          ...statusTemplate,
          campaign: { ...statusTemplate.campaign, organizationId },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await page.evaluate(
      async ({ organizationId: orgId, runId }) => {
        const statusUrl = `/api/trader/admin/fhv-operations/status?organization_id=${encodeURIComponent(orgId)}&campaign_run_id=${encodeURIComponent(runId)}`;
        const statusRes = await fetch(statusUrl, { credentials: "include" });
        const csrfHeader = statusRes.headers.get("x-fhv-csrf-token");
        const setCookie = statusRes.headers.get("set-cookie");
        const statusOk = statusRes.ok;

        const commandUrl = `/api/trader/admin/fhv-operations/commands?organization_id=${encodeURIComponent(orgId)}&campaign_run_id=${encodeURIComponent(runId)}`;
        const commandRes = await fetch(commandUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-fhv-csrf-token": csrfHeader ?? "",
          },
          body: JSON.stringify({
            organization_id: orgId,
            campaign_run_id: runId,
            action: "GRACEFUL_STOP",
            reason: "browser CSRF lifecycle test",
            confirmation_phrase: `STOP ${runId}`,
            expected_phase: "validation",
          }),
        });

        return {
          statusOk,
          setCookiePresent: Boolean(setCookie),
          csrfHeaderPresent: Boolean(csrfHeader),
          commandStatus: commandRes.status,
          commandBody: (await commandRes.json()) as { error?: { code?: string } },
        };
      },
      { organizationId, runId: RUN_ID },
    );

    expect(result.statusOk).toBe(true);
    expect(result.setCookiePresent).toBe(true);
    expect(result.csrfHeaderPresent).toBe(true);
    expect(result.commandBody.error?.code).not.toBe("CSRF_INVALID");
    expect(buildRequiredConfirmationPhrase(RUN_ID, "GRACEFUL_STOP")).toBe(`STOP ${RUN_ID}`);
  });
});
