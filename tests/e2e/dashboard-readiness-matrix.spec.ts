/**
 * DEE-49: Readiness + unlock E2E matrix (placeholder tab semantics until SSR pipes `twinGrowth`).
 * Full DEE-44 unlock for Predictions/Personality requires future RSC wiring.
 */
import { expect, test, type Page } from "@playwright/test";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/components/dashboard/twin-dialogue-workspace";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import type { IndicatorVector, ReadinessInput } from "@/lib/readiness/types";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { patchReadinessByUserEmail } from "./helpers/dashboard-sqlite";
import {
  expectedTabPresentationsForReadiness,
} from "./helpers/dashboard-tab-expectations";
import {
  expectDashboardForbiddenPhrasesAbsent,
  expectDashboardTabsMatchPresentations,
} from "./helpers/dashboard-visible-assertions";

test.describe.configure({ mode: "serial" });

function asVector(v: readonly [number, number, number, number, number, number]): IndicatorVector {
  return v as unknown as IndicatorVector;
}

async function assertDashboardMatrix(
  page: Page,
  readinessInput: ReadinessInput,
  twinSignals: { hasMeaningfulExchange: boolean },
): Promise<void> {
  const pres = expectedTabPresentationsForReadiness(readinessInput, twinSignals);
  await expectDashboardForbiddenPhrasesAbsent(page);
  await expectDashboardTabsMatchPresentations(page, pres);
}

test.describe("Dashboard readiness + unlock matrix", () => {
  test("empty / low readiness (default after sign-up)", async ({ page }) => {
    const email = `e2e-matrix-empty-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const readinessInput: ReadinessInput = {
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    };
    await assertDashboardMatrix(page, readinessInput, { hasMeaningfulExchange: false });
  });

  test("base-model skew: diary stays locked when total completion is below 60%", async ({ page }) => {
    const email = `e2e-matrix-base-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const indicators = asVector([100, 100, 33, 33, 33, 33]);
    const readinessInput: ReadinessInput = {
      indicators,
      socializationCompleted: false,
      finalStateMessageShown: false,
    };
    patchReadinessByUserEmail(email, readinessInput);
    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await assertDashboardMatrix(page, readinessInput, { hasMeaningfulExchange: false });
    await expect(page.getByTestId("mode-tab-diary")).toHaveAttribute("data-state", "locked");
  });

  test("legacy diary threshold: Diary unlocks at >=60% total completion", async ({ page }) => {
    const email = `e2e-matrix-diary-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const indicators = asVector([67, 67, 67, 67, 67, 67]);
    const readinessInput: ReadinessInput = {
      indicators,
      socializationCompleted: false,
      finalStateMessageShown: false,
    };
    patchReadinessByUserEmail(email, readinessInput);
    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await assertDashboardMatrix(page, readinessInput, { hasMeaningfulExchange: false });
    await page.getByTestId("mode-tab-diary").click();
    await expect(page.getByTestId("dashboard-diary-placeholder")).toBeVisible();

    await expect(page.getByTestId("mode-tab-predictions")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-personality_insights")).toBeDisabled();
  });

  test("meaningful Twin exchange keeps tab matrix stable (predictions remain placeholder-locked)", async ({
    page,
  }) => {
    const email = `e2e-matrix-memory-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const readinessInput: ReadinessInput = {
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: false,
      finalStateMessageShown: false,
    };

    await page.getByTestId("dashboard-twin-message-input").fill("e2e matrix twin hello");
    await page.getByTestId("dashboard-twin-send").click();
    await expect(page.getByText("e2e matrix twin hello")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await expect(page.getByTestId("dashboard-twin-invitation-placeholder")).not.toBeVisible();
    await expect(page.getByTestId("dashboard-twin-dialogue-workspace")).toBeVisible();

    await assertDashboardMatrix(page, readinessInput, {
      hasMeaningfulExchange: true,
    });
  });

  test("max indicators before socialization: Predictions + Personality stay locked (placeholder vs DEE-44)", async ({
    page,
  }) => {
    const email = `e2e-matrix-max-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const indicators = asVector([100, 100, 100, 100, 100, 100]);
    const readinessInput: ReadinessInput = {
      indicators,
      socializationCompleted: false,
      finalStateMessageShown: false,
    };
    patchReadinessByUserEmail(email, readinessInput);
    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const pres = expectedTabPresentationsForReadiness(readinessInput, {
      hasMeaningfulExchange: false,
    });
    await assertDashboardMatrix(page, readinessInput, { hasMeaningfulExchange: false });

    await expect(page.getByTestId("mode-tab-predictions")).toHaveAttribute("data-state", "locked");
    await expect(page.getByTestId("mode-tab-personality_insights")).toHaveAttribute(
      "data-state",
      "locked",
    );
    await expect(page.getByTestId("mode-tab-predictions")).toHaveAttribute(
      "data-journey-line",
      pres.predictions.journeyLine,
    );
    await expect(page.getByTestId("mode-tab-personality_insights")).toHaveAttribute(
      "data-journey-line",
      pres.personality_insights.journeyLine,
    );
  });

  test("society tab unlocks after socialization flag is persisted", async ({ page }) => {
    const email = `e2e-matrix-soc-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const indicators = asVector([100, 100, 100, 100, 100, 100]);
    const readinessInput: ReadinessInput = {
      indicators,
      socializationCompleted: true,
      finalStateMessageShown: false,
    };
    patchReadinessByUserEmail(email, readinessInput);
    await page.reload();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await assertDashboardMatrix(page, readinessInput, { hasMeaningfulExchange: false });
    await expect(page.getByTestId("mode-tab-society")).not.toBeDisabled();
    await page.getByTestId("mode-tab-society").click();
    await expect(page.getByTestId("dashboard-society-placeholder")).toBeVisible();
  });
});
