import { expect, test } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";

test("phone opens on the conversation, not a screenful of workspace details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpenDashboard(page, `e2e-twin-phone-${Date.now()}@example.com`);
  await expect(page.getByRole("button", { name: "Using WAIA", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Start creating your AI-Twin" })).toBeInViewport();
});

for (const width of [320, 390, 768, 1440]) {
  test(`workspace details are accessible and do not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signUpAndOpenDashboard(page, `e2e-twin-details-${width}-${Date.now()}@example.com`);
    const menu = page.getByRole("button", { name: "WAIA menu", exact: true });
    const progress = page.getByRole("button", { name: "Twin progress", exact: true });
    const sidebar = page.getByTestId("dashboard-sidebar");
    const top = page.getByTestId("dashboard-top-block");
    if (width < 768) {
      await expect(sidebar).not.toBeVisible();
      await expect(top).not.toBeVisible();
      await menu.focus();
      await page.keyboard.press("Tab");
      await expect(progress).toBeFocused();
      await page.keyboard.press("Space");
      await expect(progress).toHaveAttribute("aria-expanded", "true");
      await expect(top).toBeVisible();
      await progress.press("Escape");
      await expect(progress).toBeFocused();
      await menu.click();
      await expect(sidebar).toBeVisible();
      await page.getByTestId("dashboard-sidebar-sign-out").focus();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(sidebar).not.toBeVisible();
      await menu.click();
      await progress.click();
    } else {
      await expect(menu).not.toBeVisible();
      await expect(progress).not.toBeVisible();
      await expect(sidebar).toBeVisible();
      await expect(top).toBeVisible();
    }
    await expect(page.getByTestId("mode-tab-diary")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-society")).toBeDisabled();
    await expect(page.getByTestId("dashboard-sidebar-trader-link")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-sidebar-twin-link")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    for (const scale of [100, 200]) {
      await page.addStyleTag({ content: `html { font-size: ${scale}% !important; }` });
      // A long signed-in label is a presentation fixture, not a persisted profile edit.
      await page.getByTestId("dashboard-sidebar-identity").evaluate((element) => {
        element.textContent = "A-very-long-synthetic-display-name-without-spaces-for-wrapping";
      });
      const sizes = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      const overflow = await page
        .locator("body *")
        .evaluateAll((elements) =>
          elements
            .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth)
            .map((e) => ({ tag: e.tagName, id: e.getAttribute("data-testid"), cls: e.className })),
        );
      expect(sizes.content, `${scale}%: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
        sizes.viewport,
      );
      for (const label of ["values", "behavior", "thinking", "emotions", "interests", "goals"]) {
        await expect(page.getByTestId(`dashboard-indicator-${label}`)).toBeVisible();
      }
      if (width < 768) {
        for (const control of [menu, progress]) {
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
      }
    }
  });
}

test("details and resizing preserve conversation, draft and keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndOpenDashboard(page, `e2e-twin-resize-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Start creating your AI-Twin" }).click();
  const input = page.getByRole("textbox", { name: "Message to Twin" });
  await input.fill("A synthetic persisted thought.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("log")).toContainText("A synthetic persisted thought.");
  await input.fill("Keep this draft while I look around.");
  const history = await page.getByRole("log").innerText();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  const menu = page.getByRole("button", { name: "WAIA menu", exact: true });
  const progress = page.getByRole("button", { name: "Twin progress", exact: true });
  for (const control of [menu, progress]) {
    await control.click();
    await control.press("Escape");
    await expect(control).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("dashboard-sidebar")).toBeVisible();
  const link = page.getByTestId("dashboard-sidebar-twin-link");
  await link.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(link).toBeFocused();
  await link.press("Escape");
  await expect(menu).toBeFocused();
  const menuPanelId = await menu.getAttribute("aria-controls");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(`[id="${menuPanelId}"]`)).toBeFocused();
  await link.focus();
  await link.press("Escape");
  await expect(link).toBeFocused();
  await input.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(progress).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue("Keep this draft while I look around.");
  expect(await page.getByRole("log").innerText()).toBe(history);
  expect(requests).toEqual([]);
});
