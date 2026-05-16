import type { Page } from "@playwright/test";

/**
 * Email auth sign-up then wait for dashboard (same flow as smoke spec).
 */
export async function signUpAndOpenDashboard(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("landing-auth-full-name").fill("E2E User");
  await page.getByTestId("landing-auth-identity").fill(email);
  await page.getByTestId("landing-auth-password").fill("password123!");
  await page.getByTestId("landing-auth-submit").click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}
