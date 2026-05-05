/**
 * DEE-54: Diary tab — unlock via readiness, save entry, survives reload.
 */
import { expect, test } from "@playwright/test";

import type { IndicatorVector } from "@/lib/readiness/types";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { patchReadinessByUserEmail } from "./helpers/dashboard-sqlite";

function asVector(v: readonly [number, number, number, number, number, number]): IndicatorVector {
  return v as unknown as IndicatorVector;
}

test("Diary unlock saves entry and shows it after reload", async ({ page }) => {
  const email = `e2e-diary-flow-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);

  const indicators = asVector([67, 67, 67, 67, 67, 67]);
  patchReadinessByUserEmail(email, {
    indicators,
    socializationCompleted: false,
    finalStateMessageShown: false,
  });
  await page.reload();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });

  await page.getByTestId("mode-tab-diary").click();
  await expect(page.getByTestId("dashboard-diary-workspace")).toBeVisible({ timeout: 15_000 });

  const line = `e2e diary persistence ${Date.now()}`;
  await page.getByTestId("dashboard-diary-textarea").fill(line);
  await page.getByTestId("dashboard-diary-submit").click();

  await expect(page.getByTestId("dashboard-diary-success-message")).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await page.getByTestId("mode-tab-diary").click();
  await expect(page.getByText(line)).toBeVisible({ timeout: 20_000 });
});
