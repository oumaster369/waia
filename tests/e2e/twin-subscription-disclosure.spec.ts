import { expect, test, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { patchReadinessByUserEmail } from "./helpers/dashboard-sqlite";

const DISCLOSURE =
  "Creating and training your AI Twin is currently free. A monthly subscription will begin only after your Twin is fully formed and you choose to connect it to the future social network of AI Twins. We will show you the current price and ask for your explicit confirmation before billing begins.";

async function assertDisclosure(page: Page) {
  const note = page.getByRole("note", { name: "AI Twin subscription terms" });
  await expect(note).toHaveText(DISCLOSURE);
  await expect(note).toHaveAttribute("lang", "en");
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeVisible();
  await expect(note.locator("a, button, input")).toHaveCount(0);
  await expect(page.getByRole("log")).not.toContainText(DISCLOSURE);
  const composer = await page
    .getByRole("form", { name: "Send a message in Twin dialogue" })
    .boundingBox();
  const box = await note.boundingBox();
  expect(composer).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(composer!.y + composer!.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`subscription disclosure remains truthful through legacy Twin states at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const email = `e2e-twin-disclosure-${viewport.width}-${Date.now()}@example.com`;
    const paymentRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/.*(?:billing|payment|subscription|society)/i.test(request.url())) {
        paymentRequests.push(request.url());
      }
    });
    await signUpAndOpenDashboard(page, email);
    await assertDisclosure(page);
    await page.getByRole("button", { name: "Start creating your AI-Twin" }).click();
    await expect(page.getByRole("textbox", { name: "Message to Twin" })).toBeFocused();
    await assertDisclosure(page);

    await page.getByRole("textbox", { name: "Message to Twin" }).fill("A local test observation.");
    const submitted = page.waitForRequest((request) =>
      request.url().includes("/api/dashboard/twin-dialogue/turn"),
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await submitted).postDataJSON().message).toBe("A local test observation.");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await assertDisclosure(page);
    await page.reload();
    await assertDisclosure(page);
    await expect(page.getByRole("log")).toContainText("A local test observation.");

    // Legacy fixture flags are not a canonical Formation Contract or billing consent.
    for (const state of [
      { socializationCompleted: false, finalStateMessageShown: false },
      { socializationCompleted: true, finalStateMessageShown: false },
      { socializationCompleted: true, finalStateMessageShown: true },
    ]) {
      patchReadinessByUserEmail(email, { indicators: [100, 100, 100, 100, 100, 100], ...state });
      await page.reload();
      await assertDisclosure(page);
    }
    expect(paymentRequests).toEqual([]);
  });
}
