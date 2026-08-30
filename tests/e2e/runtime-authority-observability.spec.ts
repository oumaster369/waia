import { expect, test } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

test("tenant posture is own-org, explicitly unavailable, and has no mutation controls", async ({ page }) => {
  const email = `e2e-runtime-authority-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  await page.goto("/trader/runtime-authority");
  await expect(page.getByRole("heading", { name: "Runtime Authority" })).toBeVisible();
  await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("RUNTIME_AUTHORITY_UNAVAILABLE")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  const rejected = await page.request.get("/api/trader/runtime-authority?organization_id=attacker-org");
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error.code).toBe("ORG_SCOPE_FORBIDDEN");
});

test("tenant posture route requires authentication", async ({ request }) => {
  const response = await request.get("/api/trader/runtime-authority");
  expect(response.status()).toBe(401);
});

test("Admin drill-down remains separately authorized and renders HALT read-only", async ({ page }) => {
  const email = `e2e-runtime-admin-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  await page.route("**/api/trader/admin/organizations", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ organizations: [{ id: "org-a", name: "Org A" }] }) }));
  await page.route("**/api/trader/admin/runtime-authority?organization_id=org-a", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ runtimeAuthority: { availability: "AVAILABLE",
      organizationId: "org-a", runtimeInstanceId: "runtime-a", posture: "HALT",
      reasonCodes: ["RUNTIME_REALITY_REBUILD_INCOMPLETE", "RUNTIME_CONTROL_LEASE_INVALID"],
      assessmentId: "assessment", adjudicatedAtUtc: "2026-08-30T03:00:00.000Z" } }) }));
  await page.goto("/admin/runtime-authority");
  await expect(page.getByText("HALT", { exact: true })).toBeVisible();
  await expect(page.getByText("RUNTIME_CONTROL_LEASE_INVALID")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});
