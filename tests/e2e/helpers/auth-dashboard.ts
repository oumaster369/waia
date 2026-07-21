import type { Page } from "@playwright/test";

/**
 * Email auth sign-up then wait for dashboard (same flow as smoke spec).
 */
export async function signUpAndOpenDashboard(
  page: Page,
  email: string,
  timeoutMs = 15_000,
): Promise<void> {
  const oauthAvailability = page.waitForResponse(
    (response) => response.url().includes("/api/auth/oauth/availability"),
    { timeout: timeoutMs },
  );
  await page.goto("/");
  await page.getByTestId("landing-auth").waitFor({ state: "visible", timeout: timeoutMs });
  await oauthAvailability;
  await page.getByTestId("landing-auth-full-name").fill("E2E User");
  await page.getByTestId("landing-auth-identity").fill(email);
  await page.getByTestId("landing-auth-password").fill("password123!");
  await page.getByTestId("landing-auth-submit").click();
  await page.waitForURL("**/dashboard", { timeout: timeoutMs });
}
