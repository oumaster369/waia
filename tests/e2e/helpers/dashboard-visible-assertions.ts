import { expect, type Page } from "@playwright/test";

import type { ModeId } from "@/components/dashboard/types";
import type { TwinTabPresentation } from "@/lib/dashboard/twin-unlock-tab-ui";

import { DASHBOARD_TAB_ORDER, dashboardE2EForbiddenPhraseRegex } from "./dashboard-tab-expectations";

/**
 * Forbidden UI copy must not appear in visible dashboard chrome (avoid full `page.content()`).
 */
export async function expectDashboardForbiddenPhrasesAbsent(page: Page): Promise<void> {
  const shellText = await page.getByTestId("dashboard-shell-main").innerText();
  const sidebarText = await page.getByTestId("dashboard-sidebar").innerText();
  expect(`${shellText}\n${sidebarText}`).not.toMatch(dashboardE2EForbiddenPhraseRegex());
}

export async function expectWorkspaceTabsInCanonicalOrder(page: Page): Promise<void> {
  const tabs = page.getByTestId("dashboard-mode-tabs").locator('[data-testid^="mode-tab-"]');
  await expect(tabs).toHaveCount(DASHBOARD_TAB_ORDER.length);
  for (let i = 0; i < DASHBOARD_TAB_ORDER.length; i += 1) {
    const id = DASHBOARD_TAB_ORDER[i];
    const tab = tabs.nth(i);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("data-testid", `mode-tab-${id}`);
  }
}

export async function expectDashboardTabsMatchPresentations(
  page: Page,
  pres: Record<ModeId, TwinTabPresentation>,
): Promise<void> {
  for (const id of DASHBOARD_TAB_ORDER) {
    const p = pres[id];
    const tab = page.getByTestId(`mode-tab-${id}`);
    await expect(tab).toHaveAttribute("data-state", p.unlocked ? "unlocked" : "locked");
    await expect(tab).toHaveAttribute("data-phase", p.phase);
    await expect(tab).toHaveAttribute("data-journey-line", p.journeyLine);
    if (p.hint != null && p.hint !== "") {
      await expect(tab).toHaveAttribute("data-hint", p.hint);
    } else {
      await expect(tab).not.toHaveAttribute("data-hint");
    }
    if (p.unlocked) {
      await expect(tab).not.toBeDisabled();
    } else {
      await expect(tab).toBeDisabled();
    }
  }
}
