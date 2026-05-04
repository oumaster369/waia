/**
 * DEE-42: Core WAIA MVP journey — sign-up, dashboard chrome, Twin dialogue, workspace tab states, reload.
 */
import { expect, test } from "@playwright/test";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/components/dashboard/twin-dialogue-workspace";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import type { ReadinessInput } from "@/lib/readiness/types";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { expectedTabPresentationsForReadiness } from "./helpers/dashboard-tab-expectations";
import {
  expectDashboardForbiddenPhrasesAbsent,
  expectDashboardTabsMatchPresentations,
  expectWorkspaceTabsInCanonicalOrder,
} from "./helpers/dashboard-visible-assertions";

test.describe("WAIA MVP core journey", () => {
  test("sign-up through Twin exchange, tab states, and reload stability", async ({ page }) => {
    const email = `e2e-mvp-flow-${Date.now()}@example.com`;
    const userLine = `e2e mvp twin ${Date.now()}`;

    const readinessInput: ReadinessInput = {
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    };

    await signUpAndOpenDashboard(page, email);
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await expect(page.getByTestId("dashboard-twin-dialogue-error")).not.toBeVisible();
    await expect(page.getByTestId("dashboard-shell-main")).toBeVisible();
    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-top-block")).toBeVisible();
    await expect(page.getByTestId("dashboard-mode-tabs")).toBeVisible();
    await expect(page.getByTestId("dashboard-dialogue-area")).toBeVisible();

    await expectWorkspaceTabsInCanonicalOrder(page);
    await expectDashboardForbiddenPhrasesAbsent(page);

    await expect(page.getByTestId("mode-tab-twin")).toHaveAttribute("aria-selected", "true");

    const presBefore = expectedTabPresentationsForReadiness(readinessInput, {
      hasMeaningfulExchange: false,
    });
    await expectDashboardTabsMatchPresentations(page, presBefore);

    await page.getByTestId("dashboard-twin-message-input").fill(userLine);
    await page.getByTestId("dashboard-twin-send").click();

    await expect(page.getByText(userLine)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("dashboard-twin-dialogue-error")).not.toBeVisible();

    const presAfter = expectedTabPresentationsForReadiness(readinessInput, {
      hasMeaningfulExchange: true,
    });
    await expectDashboardTabsMatchPresentations(page, presAfter);

    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await expect(page.getByTestId("dashboard-twin-dialogue-error")).not.toBeVisible();
    await expect(page.getByTestId("dashboard-shell-main")).toBeVisible();
    await expectWorkspaceTabsInCanonicalOrder(page);

    await expect(page.getByTestId("dashboard-twin-invitation-placeholder")).not.toBeVisible();
    await expect(page.getByTestId("dashboard-twin-dialogue-workspace")).toBeVisible();

    await expect(page.getByText(userLine)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeVisible({
      timeout: 20_000,
    });

    await expectDashboardForbiddenPhrasesAbsent(page);
    await expectDashboardTabsMatchPresentations(page, presAfter);
  });
});
