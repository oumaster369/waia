import { expect, test, type Browser, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const port = process.env.PLAYWRIGHT_PORT ?? "3199";
const traderBaseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`);
traderBaseUrl.hostname = "trader.localhost";
test.use({ baseURL: traderBaseUrl.origin });
const ENDPOINT = "**/api/trader/admin/org0-readonly-connect";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_CREDENTIAL = {
  id: "22222222-2222-4222-8222-222222222222",
  venue: "htx",
  exchangeAccountId: "73737331",
  apiKeyMasked: "test…key",
  status: "active",
  permissionMetadata: { scopes: ["read"] },
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  revokedAt: null,
};
const target = {
  organizationId: ORGANIZATION_ID,
  venue: "htx",
  exchangeAccountId: "73737331",
  marketType: "spot",
  requiredPermission: "read",
};

async function signInOrg0Admin(page: Page, browser: Browser, baseURL: string | undefined) {
  const email = `org0-connect-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
  } finally {
    await primary.close();
  }
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  await signInOnLanding(page, email, TRADER_PASSWORD);
  await page.waitForURL("**/trader");
  return email;
}

// Browser transport fixture only. Backend authorization and HTX admission are tested separately.
test("Org0 Admin connect submits only fresh key material and the observed replacement ID", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInOrg0Admin(page, browser, baseURL);
  let submitted: Record<string, unknown> | null = null;
  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { target, credential: CURRENT_CREDENTIAL } });
      return;
    }
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        target,
        credential: {
          ...CURRENT_CREDENTIAL,
          id: "33333333-3333-4333-8333-333333333333",
          apiKeyMasked: "synt…key",
        },
      },
    });
  });

  const observationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("account-observation")) observationRequests.push(request.url());
  });
  await page.goto("/admin/org0-connect");

  await expect(page.getByRole("heading", { name: "Подключение HTX к Org0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Счёт HTX 73737331" })).toBeVisible();
  await expect(page.getByText("test…key")).toBeVisible();
  await expect(page.getByLabel("Охват: клиент")).toHaveCount(0);
  await expect(page.getByLabel("Охват: счёт")).toHaveCount(0);
  await expect(page.getByLabel("HTX Secret Key")).toHaveAttribute("type", "password");
  await expect(page.getByText(/не запускает сбор наблюдений и не включает торговлю/)).toBeVisible();

  await page.getByLabel("HTX Access Key").fill("synthetic-access-key");
  await page.getByLabel("HTX Secret Key").fill("synthetic-secret-key");
  await page.getByRole("button", { name: "Проверить и заменить ключ" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Ключ сохранён для Org0" })).toBeVisible();
  await expect(page.getByLabel("HTX Access Key")).toHaveValue("");
  await expect(page.getByLabel("HTX Secret Key")).toHaveValue("");
  expect(submitted).toEqual({
    apiKey: "synthetic-access-key",
    apiSecret: "synthetic-secret-key",
    expectedActiveCredentialId: CURRENT_CREDENTIAL.id,
  });
  expect(observationRequests).toEqual([]);
  expect(page.url()).not.toContain(ORGANIZATION_ID);
});


test("Org0 connect refuses a malformed metadata response before displaying the form", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInOrg0Admin(page, browser, baseURL);
  await page.route(ENDPOINT, (route) =>
    route.fulfill({
      json: {
        target,
        credential: {
          ...CURRENT_CREDENTIAL,
          apiSecret: "synthetic-secret-must-not-render",
        },
      },
    }),
  );
  await page.goto("/admin/org0-connect");
  await expect(page.locator("p[role=alert]")).toContainText("Настройки подключения");
  await expect(page.getByLabel("HTX Access Key")).toHaveCount(0);
  await expect(page.getByText("synthetic-secret-must-not-render")).toHaveCount(0);
});

test("Org0 connect refreshes the expected replacement ID after a conflict", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInOrg0Admin(page, browser, baseURL);
  const latestCredential = {
    ...CURRENT_CREDENTIAL,
    id: "44444444-4444-4444-8444-444444444444",
    apiKeyMasked: "new…key",
  };
  let getCount = 0;
  const submitted: Array<Record<string, unknown>> = [];
  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === "GET") {
      getCount += 1;
      await route.fulfill({
        json: { target, credential: getCount === 1 ? CURRENT_CREDENTIAL : latestCredential },
      });
      return;
    }
    submitted.push(route.request().postDataJSON() as Record<string, unknown>);
    if (submitted.length === 1) {
      await route.fulfill({ status: 409, json: { error: { code: "CREDENTIAL_CONFLICT" } } });
      return;
    }
    await route.fulfill({
      json: {
        target,
        credential: { ...latestCredential, id: "55555555-5555-4555-8555-555555555555" },
      },
    });
  });
  await page.goto("/admin/org0-connect");
  await expect(page.getByText("test…key")).toBeVisible();
  await page.getByLabel("HTX Access Key").fill("synthetic-first-key");
  await page.getByLabel("HTX Secret Key").fill("synthetic-first-secret");
  await page.getByRole("button", { name: "Проверить и заменить ключ" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Состояние ключа изменилось");
  await expect(page.getByText("new…key")).toBeVisible();
  await expect(page.getByLabel("HTX Secret Key")).toHaveValue("");

  await page.getByLabel("HTX Access Key").fill("synthetic-second-key");
  await page.getByLabel("HTX Secret Key").fill("synthetic-second-secret");
  await page.getByRole("button", { name: "Проверить и заменить ключ" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ключ сохранён для Org0" })).toBeVisible();
  expect(submitted).toEqual([
    {
      apiKey: "synthetic-first-key",
      apiSecret: "synthetic-first-secret",
      expectedActiveCredentialId: CURRENT_CREDENTIAL.id,
    },
    {
      apiKey: "synthetic-second-key",
      apiSecret: "synthetic-second-secret",
      expectedActiveCredentialId: latestCredential.id,
    },
  ]);
});

test("Org0 connect does not report a successful POST without saved credential metadata", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInOrg0Admin(page, browser, baseURL);
  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { target, credential: null } });
      return;
    }
    await route.fulfill({ status: 200, json: { target, credential: null } });
  });

  await page.goto("/admin/org0-connect");
  await expect(page.getByText("Ключ для Org0 ещё не подключён.")).toBeVisible();
  await page.getByLabel("HTX Access Key").fill("synthetic-access-key");
  await page.getByLabel("HTX Secret Key").fill("synthetic-secret-key");
  await page.getByRole("button", { name: "Проверить и сохранить" }).click();

  await expect(page.getByRole("heading", { name: "Подключение недоступно" })).toBeVisible();
  await expect(page.locator("p[role=alert]")).toHaveText("Ответ сервера не прошёл проверку.");
  await expect(page.getByRole("status").filter({ hasText: "Ключ сохранён для Org0" })).toHaveCount(0);
  await expect(page.getByLabel("HTX Access Key")).toHaveCount(0);
  await expect(page.getByLabel("HTX Secret Key")).toHaveCount(0);
});

test("Org0 connect refreshes status after a dropped POST response before another submission", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInOrg0Admin(page, browser, baseURL);
  let getCount = 0;
  let postCount = 0;
  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === "GET") {
      getCount += 1;
      await route.fulfill({ json: { target, credential: getCount === 1 ? null : CURRENT_CREDENTIAL } });
      return;
    }
    postCount += 1;
    await route.abort("failed");
  });

  await page.goto("/admin/org0-connect");
  await expect(page.getByText("Ключ для Org0 ещё не подключён.")).toBeVisible();
  await page.getByLabel("HTX Access Key").fill("synthetic-access-key");
  await page.getByLabel("HTX Secret Key").fill("synthetic-secret-key");
  await page.getByRole("button", { name: "Проверить и сохранить" }).click();

  await expect(page.locator("p[role=alert]")).toContainText("ключ мог сохраниться");
  await expect(page.getByText("test…key")).toBeVisible();
  await expect(page.getByLabel("HTX Access Key")).toHaveValue("");
  await expect(page.getByLabel("HTX Secret Key")).toHaveValue("");
  await expect.poll(() => getCount).toBe(2);
  expect(postCount).toBe(1);
});
