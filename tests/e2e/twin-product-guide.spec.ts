import { expect, test } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";

for (const width of [1280, 390]) {
  test(`optional guide preserves the conversation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signUpAndOpenDashboard(page, `e2e-guide-${width}-${Date.now()}@example.com`);
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) {
        mutations.push(request.url());
      }
    });
    const trigger = page.getByRole("button", { name: "Using WAIA", exact: true });
    const guide = page.getByRole("region", { name: "Using WAIA", exact: true });
    const input = page.getByRole("textbox", { name: "Message to Twin" });
    await trigger.click();
    await expect(guide.getByRole("heading", { name: "Using WAIA", exact: true })).toBeFocused();
    await expect(input).toBeDisabled();
    await expect(page.getByRole("log")).not.toContainText("Begin with one thought");
    await page.keyboard.press("Tab");
    await expect(guide.getByRole("button", { name: "Close guide" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(guide.getByRole("button", { name: "Your first conversation" })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(guide.getByRole("button", { name: "Messages and retries" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(trigger).toBeFocused();
    expect(mutations).toEqual([]);

    await page.getByRole("button", { name: "Start creating your AI-Twin" }).click();
    await input.fill("A synthetic local conversation.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("log")).toContainText("A synthetic local conversation.");
    await input.fill("Keep this unsent thought.");
    const messages = await page.getByRole("log").innerText();
    const mutationCount = mutations.length;
    await trigger.click();
    await guide.getByRole("button", { name: "Messages and retries" }).click();
    await expect(
      guide.getByRole("heading", { name: "When a message does not send" }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Other features" }).click();
    await expect(guide).toContainText("The Society preview is not a live social network.");
    await expect(guide.locator("a")).toHaveCount(0);
    await guide.getByRole("button", { name: "Costs and subscription" }).click();
    await expect(guide).toContainText("explicit confirmation before billing begins");
    // Text resize is intentionally local to this synthetic test page.
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const box = await guide.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    for (const button of await guide.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await guide.getByRole("button", { name: "Costs and subscription" }).press("Escape");
    await expect(guide).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue("Keep this unsent thought.");
    expect(await page.getByRole("log").innerText()).toBe(messages);
    expect(mutations.length).toBe(mutationCount);
  });
}

test("reading retry help neither retries nor discards a failed message", async ({ page }) => {
  await signUpAndOpenDashboard(page, `e2e-guide-retry-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Start creating your AI-Twin" }).click();
  let attempts = 0;
  await page.route("**/api/dashboard/twin-dialogue/turn", async (route) => {
    attempts += 1;
    await route.abort("failed");
  });
  await page
    .getByRole("textbox", { name: "Message to Twin" })
    .fill("A recoverable local test message.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Not sent");
  const error = await page.getByTestId("dashboard-twin-dialogue-error").innerText();
  await page.getByRole("button", { name: "Using WAIA", exact: true }).click();
  const guide = page.getByRole("region", { name: "Using WAIA", exact: true });
  await guide.getByRole("button", { name: "Messages and retries" }).click();
  await guide.getByRole("button", { name: "Close guide" }).click();
  await expect(page.getByTestId("dashboard-twin-dialogue-error")).toHaveText(error);
  await expect(page.getByRole("log")).toContainText("A recoverable local test message.");
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Not sent");
  expect(attempts).toBe(2);
});
