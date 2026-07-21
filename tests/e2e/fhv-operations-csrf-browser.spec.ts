import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FHV_ADMIN_CSRF_COOKIE } from "@/lib/trader/fhv-admin-csrf";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantPlatformAdminByUserEmail } from "./helpers/fhv-e2e-sqlite";

const RUN_ID = "dee-416-e2e-csrf-run";
const ORG_PLACEHOLDER = "__ORG_ID__";
const STATUS_PATH =
  process.env.FHV_OPERATOR_STATUS_PATH ?? join(process.cwd(), ".data/fhv-csrf-e2e-status.json");

test.describe("DEE-416 FHV browser CSRF lifecycle", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.FHV_CSRF_DATABASE_URL ?? "file:./.data/fhv-csrf-e2e.sqlite";
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

  test("stores CSRF cookie in browser jar and posts without CSRF_INVALID", async ({
    page,
    context,
  }) => {
    const email = `fhv-csrf-browser-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email, 60_000);
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

    const statusResult = await page.evaluate(
      async ({ organizationId: orgId, runId }) => {
        const statusUrl = `/api/trader/admin/fhv-operations/status?organization_id=${encodeURIComponent(orgId)}&campaign_run_id=${encodeURIComponent(runId)}`;
        const statusRes = await fetch(statusUrl, { credentials: "include" });
        return {
          status: statusRes.status,
          csrfHeader: statusRes.headers.get("x-fhv-csrf-token"),
        };
      },
      { organizationId, runId: RUN_ID },
    );

    expect(statusResult.status).toBe(200);
    expect(statusResult.csrfHeader).toBeTruthy();

    const cookies = await context.cookies();
    const csrfCookie = cookies.find((cookie) => cookie.name === FHV_ADMIN_CSRF_COOKIE);
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie?.value).toBeTruthy();

    const commandResult = await page.evaluate(
      async ({ organizationId: orgId, runId, csrfHeader }) => {
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
        const body = (await commandRes.json()) as { error?: { code?: string; message?: string } };
        return {
          status: commandRes.status,
          errorCode: body.error?.code ?? null,
          errorMessage: body.error?.message ?? null,
        };
      },
      {
        organizationId,
        runId: RUN_ID,
        csrfHeader: statusResult.csrfHeader,
      },
    );

    expect(commandResult.errorCode).not.toBe("CSRF_INVALID");
    expect(commandResult.status).toBe(503);
    expect(commandResult.errorCode).toBe("FHV_OBSERVER_UNAVAILABLE");
  });
});
