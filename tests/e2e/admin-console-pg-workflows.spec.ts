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
  const verifySizes = async (path: string) => {
    for (const width of [1280, 1440, 1920, 720]) {
      // 720 CSS pixels is the reflow viewport of a 1440px display at 200% zoom.
      await page.setViewportSize({ width, height: width === 720 ? 450 : 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} width ${width}`,
      ).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
        `${path} width ${width}`,
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`${path}-${width}-real-postgres.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
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
    const incidentId = crypto.randomUUID();
    await sql`INSERT INTO trader_admin_incident(id,environment,service,fingerprint,title,severity,status,first_seen_at,last_seen_at) VALUES (${incidentId}::uuid,'local','browser-acceptance',${incidentId},'Проверка уведомлений','error','new',now(),now())`;
    await sql`INSERT INTO trader_admin_diagnostic_event(id,occurred_at,received_at,environment,service,severity,error_class,message_redacted,fingerprint,organization_id,exchange_account_id) VALUES (${crypto.randomUUID()}::uuid,now(),now(),'local','browser-acceptance','error','Fixture','Сохранённое событие проверки',${incidentId},${clients[0].id}::uuid,${accounts[0]})`;
    const paperOrder = crypto.randomUUID();
    await sql`INSERT INTO trader_orders(id,organization_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${paperOrder}::uuid,${clients[0].id}::uuid,'htx','paper','PAPERBTCUSDT','buy','market','0.001','CREATED',${paperOrder},${paperOrder},'fixture')`;
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
    await verifySizes("overview");
    await page.getByRole("button", { name: "Помощник", exact: true }).click();
    const assistant = page.locator("#admin-assistant");
    await expect(
      assistant.getByText("Помощник выключен. Быстрые ответы работают без языковой модели.", {
        exact: true,
      }),
    ).toBeVisible();
    await assistant.getByRole("button", { name: "Сводка", exact: true }).click();
    await expect(assistant.getByRole("region", { name: "Быстрый ответ" })).toContainText(
      /12\s540,125\s*USDT/,
    );
    await expect(
      assistant.getByRole("link", { name: "Источник", exact: true }).first(),
    ).toHaveAttribute("href", new RegExp(`organization_id=${clients[0].id}`));
    await page.getByLabel("Охват: клиент").selectOption(clients[1].id);
    await expect(page).toHaveURL(new RegExp(`organization_id=${clients[1].id}`));
    await expect(page.getByLabel("Охват: клиент")).toHaveValue(clients[1].id);
    await expect(assistant).not.toContainText(/12\s540,125/);
    await assistant.getByRole("button", { name: "Сводка", exact: true }).click();
    await expect(assistant.getByRole("region", { name: "Быстрый ответ" })).toContainText(
      /890,5\s*USDT/,
    );
    await expect(assistant).not.toContainText(accounts[0]);
    expect(
      (await new AxeBuilder({ page }).include("#admin-assistant").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("assistant-real-postgres.png"),
      fullPage: true,
    });
    await assistant.getByRole("button", { name: "Закрыть помощника", exact: true }).click();
    await page.getByLabel("Охват: клиент").selectOption(clients[0].id);
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
    await verifySizes("accounts");
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
      if (path === "errors") {
        await page.getByRole("button", { name: "Проверка уведомлений", exact: true }).click();
        const incidentDialog = page.getByRole("dialog", {
          name: "Проверка уведомлений",
          exact: true,
        });
        await expect(incidentDialog).toContainText("Сохранённое событие проверки");
        const mute = incidentDialog.getByRole("button", {
          name: "Скрыть уведомления на час",
          exact: true,
        });
        await expect(mute).toBeDisabled();
        await incidentDialog
          .getByLabel("Причина", { exact: true })
          .fill("Локальная проверка уведомлений");
        await incidentDialog
          .getByLabel("Доказательство или ссылка", { exact: true })
          .fill("Синтетическая запись в тестовой БД");
        await mute.click();
        await expect(incidentDialog).toContainText("Версия 2");
        await expect(incidentDialog).toContainText("MUTE: Локальная проверка уведомлений");
        expect(
          (await sql`SELECT status FROM trader_admin_incident WHERE id=${incidentId}::uuid`)[0]
            .status,
        ).toBe("new");
        await expect(
          incidentDialog.getByRole("button", { name: "Вернуть уведомления", exact: true }),
        ).toBeDisabled();
        await incidentDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
      }
      await verifySizes(path);
    }
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Перейти к разделу" });
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("Название раздела…")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).not.toBeVisible();
    await page.goto(`/admin/accounts?${context.replace("mode=live", "mode=paper")}`);
    await expect(
      page.getByRole("heading", { name: "Виртуальные портфели Paper", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("Начальный виртуальный остаток не сохранён");
    await page.goto(`/admin/orders?${context}`);
    await expect(page.locator("main")).toContainText("QA0BTC0");
    await expect(page.locator("main")).toContainText("QA0BTC29");
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(700);
    const fillsTab = page.getByRole("tab", { name: "Исполнения", exact: true });
    await fillsTab.evaluate((element) =>
      element.addEventListener(
        "click",
        () => {
          document.documentElement.dataset.consoleBeforeNavigationScroll = String(window.scrollY);
        },
        { once: true, capture: true },
      ),
    );
    await fillsTab.click();
    const previousScroll = Number(
      await page.evaluate(() => document.documentElement.dataset.consoleBeforeNavigationScroll),
    );
    expect(previousScroll).toBeGreaterThan(700);
    await expect(page).toHaveURL(/tab=fills/);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Рабочие", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - previousScroll))
      .toBeLessThan(2);
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

test("research details, comparison, version tabs and manual promotion acknowledgement", async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const sql = postgres(url, { max: 2, prepare: false });
  const email = `research-ui-${crypto.randomUUID()}@waia.local`,
    primary = await browser.newContext({
      baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
    });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
    grantTraderEntitlementByUserEmail(email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await mirrorPlatformAdminInPostgres(sql, userId, email);
    const org = crypto.randomUUID(),
      dataset = crypto.randomUUID(),
      runs = [crypto.randomUUID(), crypto.randomUUID()],
      promotion = crypto.randomUUID(),
      strategy = `Research-QA-${crypto.randomUUID().slice(0, 6)}`;
    await sql`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES (${org}::uuid,${userId}::uuid,'personal','Исследовательская проверка')`;
    // A credential makes this synthetic organization discoverable in the console context selector.
    await sql`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${crypto.randomUUID()}::uuid,${org}::uuid,'htx',${crypto.randomUUID()},'synthetic-no-secret')`;
    await sql`INSERT INTO research_dataset(id,organization_id,name,symbol,interval,train_bar_count,validation_bar_count,blind_bar_count,train_digest,validation_digest,blind_digest,sealed_at,metadata_json) VALUES (${dataset}::uuid,${org}::uuid,'Данные проверки','BTCUSDT','1m',10,5,5,${"a".repeat(64)},${"b".repeat(64)},${"c".repeat(64)},now(),'SEALED_MUST_NOT_APPEAR')`;
    for (const [i, run] of runs.entries()) {
      await sql`INSERT INTO trader_backtest_runs(id,organization_id,dataset_id,strategy_id,strategy_version,cost_model_version,split,status,completed_at) VALUES (${run}::uuid,${org}::uuid,${dataset}::uuid,${strategy},${`v${i + 1}`},'cost-v1','validation','completed',now())`;
      await sql`INSERT INTO trader_backtest_results(id,organization_id,run_id,regime_label,metrics_json) VALUES (${crypto.randomUUID()}::uuid,${org}::uuid,${run}::uuid,'RANGE',${JSON.stringify([{ strategySignalId: "signal", periodRealizedPnl: "12.12345678", periodTotalFees: "0.00000001", closedTradeCount: 1, evidenceContentDigest: "digest" }])})`;
    }
    await sql`INSERT INTO trader_strategy_promotion_records(id,organization_id,strategy_id,strategy_version,git_commit_sha,target_deployment_state,hypothesis,intended_regime,cost_model_json,failure_modes_json,reason_code_distribution_json,paper_trading_evidence_json,research_evidence_json,evidence_content_digest,confidence_attestation_json,record_content_digest,schema_version,state,requested_at,cooling_off_ends_at,state_version) VALUES (${promotion}::uuid,${org}::uuid,${strategy},'v1',${"a".repeat(40)},'LIVE_LIMITED','Synthetic review','RANGE','{}','[]','{}','{}','{}','fixture','{}','fixture','fixture','COOLING_OFF',now(),now()-interval '1 minute',7)`;
    await signInOnLanding(page, email, "password123!");
    await page.waitForURL("**/trader");
    const query = `organization_id=${org}&mode=history&period=7d`;
    await page.goto(`/admin/research?${query}&tab=runs`);
    await expect(page.getByRole("button", { name: new RegExp(runs[0]) })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(runs[0]) }).click();
    const dialog = page.getByRole("dialog", { name: "Доказательства запуска" });
    await expect(dialog).toContainText("12,12345678");
    await expect(dialog).not.toContainText("SEALED_MUST_NOT_APPEAR");
    for (const label of [
      "Циклы и причины",
      "Данные",
      "Артефакты",
      "Журнал",
      "Сделки и результаты",
    ]) {
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await expect(dialog).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.screenshot({ path: testInfo.outputPath("research-detail.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    for (const run of runs)
      await page.getByRole("checkbox", { name: `Сравнить запуск ${run}`, exact: true }).check();
    await page.getByRole("button", { name: "Сравнить (2)", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "Сравнение запусков" });
    await expect(comparison).toContainText("Есть различия или неподтверждённые условия");
    await expect(
      comparison.getByRole("heading", { name: "Сначала — условия сравнения" }),
    ).toBeVisible();
    await expect(comparison).toContainText("v1");
    await expect(comparison).toContainText("v2");
    await comparison.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.goBack();
    await expect(comparison).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(
      `/admin/strategies?${query}&tab=testing&sel=${encodeURIComponent(`${strategy}:v1`)}`,
    );
    const strategyDialog = page.getByRole("dialog", { name: `${strategy} · v1`, exact: true });
    await expect(strategyDialog).toBeVisible();
    for (const label of ["Счета и сделки", "Решения", "Проверки", "Версии", "Результаты"]) {
      await strategyDialog.getByRole("button", { name: label, exact: true }).click();
      await expect(strategyDialog).toBeVisible();
    }
    await expect(strategyDialog).toContainText("History — воспроизведение");
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.goto(`/admin/strategy-promotions?${query}&strategy_id=${strategy}`);
    await expect(
      page.getByRole("button", { name: "Ввести в действие", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ввести в действие", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Ввести в действие", exact: true });
    await expect(confirmation).toContainText("версия состояния 7");
    await confirmation.getByLabel("Причина действия").fill("Синтетическая проверка интерфейса");
    const ack = confirmation.getByRole("checkbox");
    await expect(ack).not.toBeChecked();
    await expect(
      confirmation.getByRole("button", { name: "Подтвердить действие", exact: true }),
    ).toBeDisabled();
    await ack.check();
    await expect(
      confirmation.getByRole("button", { name: "Подтвердить действие", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("promotion-manual-review.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ввести в действие", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox")).not.toBeChecked();
    await page.keyboard.press("Escape");
    const saved =
      await sql`SELECT state,state_version FROM trader_strategy_promotion_records WHERE id=${promotion}::uuid`;
    expect(saved[0]).toMatchObject({ state: "COOLING_OFF", state_version: 7 });
  } finally {
    await primary.close();
    await sql.end();
  }
});
