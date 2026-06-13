import type { Page } from "@playwright/test";

const DEFAULT_PASSWORD = "password123!";

/** Sign in on the current host landing (Create Twin → Sign in). */
export async function signInOnLanding(
  page: Page,
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<void> {
  await page.goto("/");
  await page.getByTestId("landing-auth-mode-sign-in").click();
  await page.getByTestId("landing-auth-identity").fill(email);
  await page.getByTestId("landing-auth-password").fill(password);
  await page.getByTestId("landing-auth-submit").click();
}
