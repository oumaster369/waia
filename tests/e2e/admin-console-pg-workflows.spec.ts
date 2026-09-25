import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import postgres from "postgres";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { mirrorPlatformAdminInPostgres } from "./helpers/admin-console-pg";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";
import { consoleObservation } from "../helpers/admin-console-observation";

const url = process.env.DATABASE_URL_POSTGRES ?? "";
test("eight console sections use real PostgreSQL evidence, preserve context and require safe control confirmation", async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  const sql = postgres(url, { max: 2, prepare: false });
  const email = `console-workflows-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
    grantTraderEntitlementByUserEmail(email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await mirrorPlatformAdminInPostgres(sql, userId, email);
    const clients = [
      { id: crypto.randomUUID(), name: "Проверка · Клиент А", amount: "12540.125" },
      { id: crypto.randomUUID(), name: "Проверка · Клиент Б", amount: "890.50" },
    ];
    const accounts: string[] = [];
    for (const [index, client] of clients.entries()) {
      await sql`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES (${client.id}::uuid,${userId}::uuid,'personal',${client.name})`;
      const binding = {
        organizationId: client.id,
        credentialId: crypto.randomUUID(),
        exchangeAccountId: `QA-${index}-${crypto.randomUUID().slice(0, 6)}`,
        credentialRevision: "1",
        configurationRevision: "test",
      };
      accounts.push(binding.exchangeAccountId);
      await sql`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${binding.credentialId}::uuid,${client.id}::uuid,'htx',${binding.exchangeAccountId},'synthetic-not-a-key')`;
      await sql`INSERT INTO trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${client.id}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},'test','["BTCUSDT"]')`;
      const observation = consoleObservation(binding, client.amount, Date.now());
      await sql`INSERT INTO trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at)
        VALUES (${client.id}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},${observation.observationId}::uuid,1,'test',${crypto.randomUUID()}::uuid,${sql.json(JSON.parse(JSON.stringify(observation)))}::jsonb,now())`;
      await sql`UPDATE trader_account_collection_state SET last_observation_id=${observation.observationId}::uuid WHERE credential_id=${binding.credentialId}::uuid`;
      for (let i = 0; i < 30; i++) {
        const id = crypto.randomUUID();
        await sql`INSERT INTO trader_orders(id,organization_id,credential_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id)
          VALUES (${id}::uuid,${client.id}::uuid,${binding.credentialId}::uuid,'htx','live',${`QA${index}BTC${i}`},'buy','limit','0.001','CREATED',${id},${id},'synthetic-risk')`;
      }
      await sql`INSERT INTO trader_discovery_research_campaign(id,organization_id,campaign_key,name,research_program,description,symbol_scope,current_state,content_digest)
        VALUES (${crypto.randomUUID()}::uuid,${client.id}::uuid,${crypto.randomUUID()},'Контрольная кампания','browser QA','Synthetic local fixture','BTCUSDT','DRAFT',${"a".repeat(64)})`;
      for (const days of [6, 3, 1]) {
        const at = new Date(Date.now() - days * 86400000).toISOString();
        await sql`INSERT INTO trader_admin_equity_point(organization_id,exchange_account_id,bucket,equity,trader_unrealized,valuation_key,method_version,state) VALUES (${client.id}::uuid,${binding.exchangeAccountId},${at}::timestamptz,${client.amount},'0',${crypto.randomUUID()},'htx_spot_last:usdt','ok')`;
      }
      await sql`INSERT INTO trader_intelligence_cycle_envelope(id,organization_id,run_id,cycle_id,symbol,evaluated_at,historical_profile_id,historical_profile_digest,matrix_digest,terminal_reason_code,input_semantic_digest,output_semantic_digest,content_digest,schema_version) VALUES (${crypto.randomUUID()}::uuid,${client.id}::uuid,${crypto.randomUUID()},'browser-cycle','QA-CYCLE',now(),'fixture','fixture','fixture','NO_TRADE','fixture','fixture','fixture','fixture')`;
    }
    await signInOnLanding(page, email, "password123!");
    await page.waitForURL("**/trader");
    const context = `organization_id=${clients[0].id}&mode=live&currency=USDT&period=7d`;
    await page.goto(`/admin?${context}`);
    await expect(page.locator("main")).toContainText("12 540,125");
    await expect(
      page.getByRole("heading", { name: "История капитала и результата" }),
    ).toBeVisible();
    await page.getByText("Из чего складывается результат Трейдера", { exact: true }).click();
    await expect(page.getByText("Комиссии открытия", { exact: true })).toBeVisible();
    await page
      .getByRole("group", { name: "Показатель графика" })
      .getByRole("button", { name: "Результат Трейдера", exact: true })
      .click();
    await expect(page.getByRole("img", { name: /Результат Трейдера, USDT/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Последние исполнения", exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("overview-real-postgres.png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Рынок и новости", exact: true }).click();
    await expect(page).toHaveURL(/tab=market/);
    await expect(page.getByRole("heading", { name: "Рынок и новости", exact: true })).toBeVisible();
    await page.goto(`/admin?organization_id=${clients[0].id}&mode=all&tab=algorithm`);
    await expect(page.getByText("QA-CYCLE · undetermined", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Доказательства цикла →", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Доказательства цикла" })).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Прогноз", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").locator('[data-reason="NOT_PERSISTED_FOR_CYCLE"]'),
    ).toHaveCount(23);
    await page.keyboard.press("Escape");
    await page.goto(`/admin?${context}`);
    await page
      .getByRole("navigation", { name: "Консоль администратора AI-TRADER" })
      .getByRole("link", { name: "Счета", exact: true })
      .click();
    await expect(page.locator("main")).toContainText(accounts[0]);
    await expect(page.locator("main")).not.toContainText(accounts[1]);
    await page.getByRole("button", { name: `HTX · ${accounts[0]}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const accountDialog = page.getByRole("dialog");
    await expect(
      accountDialog.getByRole("table", { name: "Активы счёта", exact: true }),
    ).toBeVisible();
    await expect(accountDialog.getByText("Подключение", { exact: true })).toBeVisible();
    for (const [tabLabel, evidence] of [
      ["Ордера и сделки", "Все ордера периода"],
      ["Стратегии", "Стратегии и версии"],
      ["Риск и Guardian", "Сохранённое состояние Risk"],
      ["Биллинг", "Счета на оплату"],
      ["События", "Ключи подключения"],
    ]) {
      await accountDialog.getByRole("button", { name: tabLabel, exact: true }).click();
      await expect(
        accountDialog.getByRole("heading", { name: evidence, exact: true }),
      ).toBeVisible();
      await expect(accountDialog.locator('[data-reason="ADMIN_SCOPE_MISMATCH"]')).toHaveCount(0);
      await expect(accountDialog.locator('[data-reason="ADMIN_HTTP_500"]')).toHaveCount(0);
    }
    await accountDialog.getByRole("button", { name: "Ордера и сделки", exact: true }).click();
    await accountDialog.getByRole("button", { name: "QA0BTC0", exact: true }).click();
    const orderDialog = page.getByRole("dialog", { name: "Ордер · QA0BTC0", exact: true });
    await expect(orderDialog).toBeVisible();
    await expect(orderDialog.locator('[data-reason="LEGACY_ORDER_NO_V2_BINDING"]')).toBeVisible();
    await expect(
      orderDialog.getByRole("heading", { name: "Исполнения", exact: true }),
    ).toBeVisible();
    await expect(orderDialog.getByRole("button")).toHaveCount(1);
    await orderDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(orderDialog).not.toBeVisible();
    await accountDialog.getByRole("button", { name: "Портфель", exact: true }).click();
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.screenshot({
      path: testInfo.outputPath("account-details-real-postgres.png"),
      fullPage: true,
    });
    await accountDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(page).not.toHaveURL(/sel=/);
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByLabel("Охват: клиент").selectOption(clients[1].id);
    await expect(page.locator("main")).toContainText(accounts[1]);
    await expect(page.locator("main")).not.toContainText(accounts[0]);
    await page.getByLabel("Охват: клиент").selectOption(clients[0].id);
    await expect(page.locator("main")).toContainText(accounts[0]);
    for (const [path, title] of [
      ["orders", "Ордера"],
      ["clients", "Клиенты"],
      ["strategies", "Стратегии"],
      ["research", "Исследования"],
      ["errors", "Ошибки"],
      ["system", "Система"],
    ]) {
      const entityPath =
        path === "research" ? "research/catalog" : path === "errors" ? "incidents" : path;
      const pendingRead = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/trader/admin/console/${entityPath}` &&
          response.request().method() === "GET",
      );
      await page
        .getByRole("navigation", { name: "Консоль администратора AI-TRADER" })
        .getByRole("link", { name: title, exact: true })
        .click();
      const response = await pendingRead;
      expect(response.status(), path).toBe(200);
      expect((await response.json()).scope).toMatchObject({
        kind: "organization",
        organizationId: clients[0].id,
      });
      await expect(page).toHaveURL(new RegExp(`/admin/${path}\\?`));
      await expect(page).toHaveURL(new RegExp(`organization_id=${clients[0].id}`));
      await expect(page.locator("main").getByRole("status")).toHaveCount(0);
      // App Router streams metadata separately from the data response.
      await expect(page).toHaveTitle(/\S/);
      const result = await new AxeBuilder({ page }).analyze();
      expect(
        result.violations.filter((row) => row.impact === "critical" || row.impact === "serious"),
        path,
      ).toEqual([]);
      if (path === "clients") {
        await page.getByRole("button", { name: clients[0].name, exact: true }).click();
        const clientDialog = page.getByRole("dialog", { name: clients[0].name, exact: true });
        for (const [label, heading] of [
          ["Биржевые счета", "Биржевые счета клиента"],
          ["Результаты", "История капитала и результата"],
          ["Счета на оплату", "Счета на оплату"],
          ["Платежи", "Платежи AI-TRADER"],
          ["Отчётные периоды", "Отчётные периоды"],
          ["История", "Сохранённая история клиента"],
        ]) {
          await clientDialog.getByRole("button", { name: label, exact: true }).click();
          await expect(
            clientDialog.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible();
          await expect(clientDialog).not.toContainText(accounts[1]);
        }
        await expect(clientDialog).toContainText("Добавлен ключ подключения");
        await clientDialog.getByRole("button", { name: "Сводка", exact: true }).click();
        await expect(clientDialog).toContainText("12 540,125");
        expect(
          (await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations,
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath("client-details-real-postgres.png"),
          fullPage: true,
        });
        await clientDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
      }
      await page.screenshot({
        path: testInfo.outputPath(`${path}-real-postgres.png`),
        fullPage: true,
      });
    }
    await page.goto(`/admin/orders?${context}`);
    await expect(page.locator("main")).toContainText("QA0BTC0");
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(850);
    await page.getByRole("tab", { name: "Исполнения", exact: true }).click();
    await expect(page).toHaveURL(/tab=fills/);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Рабочие", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(850);
    await page.getByRole("button", { name: "Аварийная остановка", exact: true }).click();
    await expect(page.getByLabel("Область остановки")).toHaveValue("organization");
    await page.getByRole("button", { name: "Дальше", exact: true }).click();
    await expect(page.getByRole("button", { name: "Дальше", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Дальше", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Отправить команду", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Причина", exact: true })
      .fill("Локальная синтетическая проверка");
    await page.getByRole("checkbox", { name: "Подтверждаю область и эффект команды" }).check();
    const commandResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/console/kill-switch") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Отправить команду", exact: true }).click();
    const commandResult = await commandResponse;
    expect(commandResult.status(), await commandResult.text()).toBe(200);
    await expect(page.getByText("Состояние подтверждено повторным чтением")).toBeVisible();
    await page.keyboard.press("Escape");
    const saved =
      await sql`SELECT state,state_version FROM trader_kill_switches WHERE organization_id=${clients[0].id}::uuid AND switch_type='PAUSE'`;
    expect(saved).toHaveLength(1);
    expect(saved[0].state).toBe("ACTIVE");
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/admin/accounts?${context}`);
    await expect(page.locator("main")).toContainText(accounts[0]);
    await page.screenshot({
      path: testInfo.outputPath("accounts-compact-real-postgres.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await primary.close();
    await sql.end();
  }
  // Local append-only observations/audit are intentionally retained; no production connection.
});
