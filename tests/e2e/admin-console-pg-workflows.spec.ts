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
    const incidentTitle =
      "Illegal invocation: function called with incorrect this reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details.";
    await sql`INSERT INTO trader_admin_incident(id,environment,service,fingerprint,title,severity,status,first_seen_at,last_seen_at) VALUES (${incidentId}::uuid,'local','browser-acceptance',${incidentId},${incidentTitle},'error','new',now(),now())`;
    await sql`INSERT INTO trader_admin_diagnostic_event(id,occurred_at,received_at,environment,service,severity,error_class,message_redacted,fingerprint,organization_id,exchange_account_id) VALUES (${crypto.randomUUID()}::uuid,now(),now(),'local','browser-acceptance','error','Fixture','Сохранённое событие проверки',${incidentId},${clients[0].id}::uuid,${accounts[0]})`;
    const invoiceId = crypto.randomUUID();
    await sql`INSERT INTO trader_invoices (id, organization_id, exchange_account_id, reporting_period_id, fee_artifact_digest, status, currency, period_realized_strategy_profit, cumulative_realized_strategy_profit, previous_high_water_mark, new_profit_above_hwm, fee_rate, performance_fee, proposed_new_high_water_mark, billable, realized_fill_finality, starting_equity, ending_equity, net_deposits, net_withdrawals, period_start, period_end, valuation_source, fee_computed_at, schema_version, record_content_digest)
      VALUES (${invoiceId}::uuid, ${clients[0].id}::uuid, ${accounts[0]}, ${crypto.randomUUID()}, 'browser-fixture', 'DRAFT', 'USDT', '100', '100', '0', '100', '0.3', '30.00000001', '100', true, false, '1000', '1100', '0', '0', now()-interval '1 day', now(), 'synthetic', now(), 'test', ${invoiceId})`;
    const paperOrder = crypto.randomUUID();
    await sql`INSERT INTO trader_orders(id,organization_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${paperOrder}::uuid,${clients[0].id}::uuid,'htx','paper','PAPERBTCUSDT','buy','market','0.001','CREATED',${paperOrder},${paperOrder},'fixture')`;
    await signInOnLanding(page, email, "password123!");
    await page.waitForURL("**/trader");
    const context = `organization_id=${clients[0].id}&mode=live&currency=USDT&period=7d`;
    await page.goto(`/admin?${context}`);
    await expect(page.locator("main")).toContainText("12 540,125");
    await expect(
      page.getByRole("heading", { name: "Equity and result history" }),
    ).toBeVisible();
    await page.getByText("Trader result breakdown", { exact: true }).click();
    await expect(page.getByText("Opening fees", { exact: true })).toBeVisible();
    await page
      .getByRole("group", { name: "Chart metric" })
      .getByRole("button", { name: "Trader result", exact: true })
      .click();
    await expect(page.getByRole("img", { name: /Trader result, USDT/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent fills", exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("overview-real-postgres.png"),
      fullPage: true,
    });
    await verifySizes("overview");
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const assistant = page.locator("#admin-assistant");
    await expect(
      assistant.getByText("The assistant is disabled. Quick answers work without a language model.", {
        exact: true,
      }),
    ).toBeVisible();
    await assistant.getByRole("button", { name: "Summary", exact: true }).click();
    await expect(assistant.getByRole("region", { name: "Quick answer" })).toContainText(
      /12\s540,125\s*USDT/,
    );
    await expect(
      assistant.getByRole("link", { name: "Source", exact: true }).first(),
    ).toHaveAttribute("href", new RegExp(`organization_id=${clients[0].id}`));
    await page.getByLabel("Scope: client").selectOption(clients[1].id);
    await expect(page).toHaveURL(new RegExp(`organization_id=${clients[1].id}`));
    await expect(page.getByLabel("Scope: client")).toHaveValue(clients[1].id);
    await expect(assistant).not.toContainText(/12\s540,125/);
    await assistant.getByRole("button", { name: "Summary", exact: true }).click();
    await expect(assistant.getByRole("region", { name: "Quick answer" })).toContainText(
      /890,5\s*USDT/,
    );
    await expect(assistant).not.toContainText(accounts[0]);
    await assistant.getByRole("button", { name: "System and release", exact: true }).click();
    const systemAnswer = assistant.getByRole("region", { name: "Quick answer" });
    await expect(systemAnswer).toContainText("Payment observation · last run");
    await expect(systemAnswer).toContainText("Manual invoice issuance · last run");
    await expect(systemAnswer).toContainText("Scope: 13/13");
    await expect(systemAnswer).toContainText("Manual operation, without a schedule");
    await expect(systemAnswer.locator('a[href*="tab=jobs"]').first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include("#admin-assistant").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("assistant-real-postgres.png"),
      fullPage: true,
    });
    await assistant.getByRole("button", { name: "Close assistant", exact: true }).click();
    await page.getByLabel("Scope: client").selectOption(clients[0].id);
    await page.getByRole("tab", { name: "Market and news", exact: true }).click();
    await expect(page).toHaveURL(/tab=market/);
    await expect(page.getByRole("heading", { name: "Market and news", exact: true })).toBeVisible();
    await page.goto(`/admin?organization_id=${clients[0].id}&mode=all&tab=algorithm`);
    await expect(page.getByText("QA-CYCLE · undetermined", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Cycle evidence →", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Cycle evidence" })).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Forecast", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").locator('[data-reason="NOT_PERSISTED_FOR_CYCLE"]'),
    ).toHaveCount(23);
    await page.keyboard.press("Escape");
    await page.goto(`/admin?${context}`);
    await page
      .getByRole("navigation", { name: "AI-TRADER admin console" })
      .getByRole("link", { name: "Accounts", exact: true })
      .click();
    await expect(page.locator("main")).toContainText(accounts[0]);
    await expect(page.locator("main")).not.toContainText(accounts[1]);
    await page.getByRole("button", { name: `HTX · ${accounts[0]}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const accountDialog = page.getByRole("dialog");
    await expect(
      accountDialog.getByRole("table", { name: "Account assets", exact: true }),
    ).toBeVisible();
    await expect(accountDialog.getByText("Connecting", { exact: true })).toBeVisible();
    for (const [tabLabel, evidence] of [
      ["Orders and trades", "All orders in the period"],
      ["Strategies", "Strategies and versions"],
      ["Risk and Guardian", "Saved Risk state"],
      ["Billing", "Invoices"],
      ["Events", "Connection keys"],
    ]) {
      await accountDialog.getByRole("button", { name: tabLabel, exact: true }).click();
      await expect(
        accountDialog.getByRole("heading", { name: evidence, exact: true }),
      ).toBeVisible();
      await expect(accountDialog.locator('[data-reason="ADMIN_SCOPE_MISMATCH"]')).toHaveCount(0);
      await expect(accountDialog.locator('[data-reason="ADMIN_HTTP_500"]')).toHaveCount(0);
    }
    await accountDialog.getByRole("button", { name: "Orders and trades", exact: true }).click();
    await accountDialog.getByRole("button", { name: "QA0BTC0", exact: true }).click();
    const orderDialog = page.getByRole("dialog", { name: "Order · QA0BTC0", exact: true });
    await expect(orderDialog).toBeVisible();
    await expect(orderDialog.locator('[data-reason="LEGACY_ORDER_NO_V2_BINDING"]')).toBeVisible();
    await expect(
      orderDialog.getByRole("heading", { name: "Fills", exact: true }),
    ).toBeVisible();
    await expect(orderDialog.getByRole("button")).toHaveCount(1);
    await orderDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(orderDialog).not.toBeVisible();
    await accountDialog.getByRole("button", { name: "Portfolio", exact: true }).click();
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.screenshot({
      path: testInfo.outputPath("account-details-real-postgres.png"),
      fullPage: true,
    });
    await accountDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page).not.toHaveURL(/sel=/);
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByLabel("Scope: client").selectOption(clients[1].id);
    await expect(page.locator("main")).toContainText(accounts[1]);
    await expect(page.locator("main")).not.toContainText(accounts[0]);
    await page.getByLabel("Scope: client").selectOption(clients[0].id);
    await expect(page.locator("main")).toContainText(accounts[0]);
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await page.getByLabel("View name", { exact: true }).fill("Контрольный охват А");
    await page.getByRole("button", { name: "Save current view", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Контрольный охват А", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await page.getByLabel("Scope: client").selectOption(clients[1].id);
    await expect(page.locator("main")).toContainText(accounts[1]);
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await page.getByRole("link", { name: "Контрольный охват А", exact: true }).click();
    await expect(page.getByLabel("Scope: client")).toHaveValue(clients[0].id);
    await expect(page.locator("main")).toContainText(accounts[0]);
    await expect(page.locator("main")).not.toContainText(accounts[1]);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const exportFile = await downloaded;
    expect(exportFile.suggestedFilename()).toBe("accounts.csv");
    const stream = await exportFile.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain(accounts[0]);
    expect(csv).not.toContain(accounts[1]);
    expect(csv).toContain("12540.125");
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete view Контрольный охват А", exact: true })
      .click();
    await expect(page.getByRole("link", { name: "Контрольный охват А", exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Views", exact: true }).click();
    await verifySizes("accounts");
    for (const [path, title] of [
      ["orders", "Orders"],
      ["clients", "Clients"],
      ["strategies", "Strategies"],
      ["research", "Research"],
      ["errors", "Errors"],
      ["system", "System"],
    ]) {
      const entityPath =
        path === "research" ? "research/catalog" : path === "errors" ? "incidents" : path;
      const pendingRead = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/trader/admin/console/${entityPath}` &&
          response.request().method() === "GET",
      );
      await page
        .getByRole("navigation", { name: "AI-TRADER admin console" })
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
      if (path === "research") {
        await expect(
          page.getByRole("row").filter({ hasText: "Контрольная кампания" }),
        ).toContainText("Draft");
      }
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
          ["Exchange accounts", "Client exchange accounts"],
          ["Results", "Equity and result history"],
          ["Invoices", "Invoices"],
          ["Payments", "AI-TRADER payments"],
          ["Reporting periods", "Reporting periods"],
          ["History", "Saved client history"],
        ]) {
          await clientDialog.getByRole("button", { name: label, exact: true }).click();
          await expect(
            clientDialog.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible();
          await expect(clientDialog).not.toContainText(accounts[1]);
        }
        await expect(clientDialog).toContainText("Connection key added");
        await clientDialog.getByRole("button", { name: "Summary", exact: true }).click();
        await expect(clientDialog).toContainText("12 540,125");
        expect(
          (await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations,
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath("client-details-real-postgres.png"),
          fullPage: true,
        });
        await clientDialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.goto(`/admin/clients?${context}&tab=invoices&sel=${invoiceId}`);
        const invoiceDialog = page.getByRole("dialog", { name: "Invoice", exact: true });
        await expect(
          invoiceDialog.getByRole("heading", { name: "Saved calculation", exact: true }),
        ).toBeVisible();
        await expect(invoiceDialog).toContainText("30,00000001");
        await expect(invoiceDialog.locator('[data-reason="ADMIN_MODE_MISMATCH"]')).toHaveCount(0);
        await expect(invoiceDialog.getByRole("checkbox")).toHaveCount(6);
        await expect(invoiceDialog.locator('input[type="checkbox"]:checked')).toHaveCount(0);
        await expect(
          invoiceDialog.getByRole("button", { name: "Confirm issuance", exact: true }),
        ).toBeDisabled();
        await expect(
          invoiceDialog.getByRole("heading", { name: "Document history", exact: true }),
        ).toBeVisible();
        expect(
          (await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations,
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath("invoice-detail-real-postgres.png"),
          fullPage: true,
        });
        const invoiceDownload = page.waitForEvent("download");
        await invoiceDialog.getByRole("button", { name: "Download JSON", exact: true }).click();
        const invoiceFile = await invoiceDownload;
        const invoiceStream = await invoiceFile.createReadStream();
        const invoiceChunks: Buffer[] = [];
        for await (const chunk of invoiceStream!) invoiceChunks.push(Buffer.from(chunk));
        const savedInvoice = JSON.parse(Buffer.concat(invoiceChunks).toString("utf8"));
        expect(savedInvoice.mode).toBe("live");
        expect(savedInvoice.data.stored.performanceFee).toBe("30.00000001");
        expect(savedInvoice.data.approvedAt).toBe(null);
        await invoiceDialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.goto(`/admin/clients?${context}`);
        await expect(
          page.getByRole("button", { name: clients[0].name, exact: true }),
        ).toBeVisible();
      }
      if (path === "errors") {
        await page.getByRole("button", { name: incidentTitle, exact: true }).click();
        const incidentDialog = page.getByRole("dialog", {
          name: incidentTitle,
          exact: true,
        });
        await expect(incidentDialog).toContainText("Сохранённое событие проверки");
        for (const width of [1280, 720, 360]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await incidentDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
          const close = incidentDialog.getByRole("button", { name: "Close", exact: true });
          const dialogBox = await incidentDialog.boundingBox();
          const closeBox = await close.boundingBox();
          expect(dialogBox).not.toBeNull();
          expect(closeBox).not.toBeNull();
          expect(closeBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
          expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(
            dialogBox!.x + dialogBox!.width,
          );
          await page.screenshot({
            path: testInfo.outputPath(`incident-long-title-${width}.png`),
            fullPage: false,
          });
          await close.click();
          await expect(incidentDialog).not.toBeVisible();
          await expect(page).not.toHaveURL(/sel=/);
          await page.getByRole("button", { name: incidentTitle, exact: true }).click();
          await expect(incidentDialog).toContainText("Сохранённое событие проверки");
        }
        await page.setViewportSize({ width: 1280, height: 900 });

        const mute = incidentDialog.getByRole("button", {
          name: "Mute notifications for one hour",
          exact: true,
        });
        await expect(mute).toBeDisabled();
        await incidentDialog
          .getByLabel("Reason", { exact: true })
          .fill("Локальная проверка уведомлений");
        await incidentDialog
          .getByLabel("Evidence or link", { exact: true })
          .fill("Синтетическая запись в тестовой БД");
        await mute.click();
        await expect(incidentDialog).toContainText("Version 2");
        await expect(incidentDialog).toContainText("MUTE: Локальная проверка уведомлений");
        expect(
          (await sql`SELECT status FROM trader_admin_incident WHERE id=${incidentId}::uuid`)[0]
            .status,
        ).toBe("new");
        await expect(
          incidentDialog.getByRole("button", { name: "Restore notifications", exact: true }),
        ).toBeDisabled();
        await incidentDialog.getByRole("button", { name: "Close", exact: true }).click();
      }
      await verifySizes(path);
    }
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Go to section" });
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder("Section name…")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).not.toBeVisible();
    await page.goto(`/admin/accounts?${context.replace("mode=live", "mode=paper")}`);
    await expect(
      page.getByRole("heading", { name: "Virtual Paper portfolios", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("Initial virtual cash was not persisted");
    await page.goto(`/admin/orders?${context}`);
    await expect(page.locator("main")).toContainText("QA0BTC0");
    await expect(page.locator("main")).toContainText("QA0BTC29");
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(700);
    const fillsTab = page.getByRole("tab", { name: "Fills", exact: true });
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
    await expect(page.getByRole("tab", { name: "Working", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - previousScroll))
      .toBeLessThan(2);
    await page.getByRole("button", { name: "Emergency stop", exact: true }).click();
    await expect(page.getByLabel("Stop scope")).toHaveValue("organization");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Submit command", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Локальная синтетическая проверка");
    await page.getByRole("checkbox", { name: "I confirm the command scope and effect" }).check();
    const commandResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/console/kill-switch") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Submit command", exact: true }).click();
    const commandResult = await commandResponse;
    expect(commandResult.status(), await commandResult.text()).toBe(200);
    await expect(page.getByText("State confirmed by reread")).toBeVisible();
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
    const dialog = page.getByRole("dialog", { name: "Run evidence" });
    await expect(dialog).toContainText("12,12345678");
    await expect(dialog).not.toContainText("SEALED_MUST_NOT_APPEAR");
    for (const label of [
      "Cycles and reasons",
      "Data",
      "Artifacts",
      "Log",
      "Trades and results",
    ]) {
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await expect(dialog).toBeVisible();
    }
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.screenshot({ path: testInfo.outputPath("research-detail.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    for (const run of runs)
      await page.getByRole("checkbox", { name: `Compare run ${run}`, exact: true }).check();
    await page.getByRole("button", { name: "Compare (2)", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "Run comparison" });
    await expect(comparison).toContainText("Differences or unconfirmed conditions");
    await expect(
      comparison.getByRole("heading", { name: "Comparison conditions first" }),
    ).toBeVisible();
    await expect(comparison).toContainText("v1");
    await expect(comparison).toContainText("v2");
    await comparison.getByRole("button", { name: "Close", exact: true }).click();
    await page.goBack();
    await expect(comparison).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(
      `/admin/strategies?${query}&tab=testing&sel=${encodeURIComponent(`${strategy}:v1`)}`,
    );
    const strategyDialog = page.getByRole("dialog", { name: `${strategy} · v1`, exact: true });
    await expect(strategyDialog).toBeVisible();
    for (const label of ["Accounts and trades", "Decisions", "Checks", "Versions", "Results"]) {
      await strategyDialog.getByRole("button", { name: label, exact: true }).click();
      await expect(strategyDialog).toBeVisible();
    }
    await expect(strategyDialog).toContainText("History · replay");
    expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual(
      [],
    );
    await page.goto(`/admin/strategy-promotions?${query}&strategy_id=${strategy}`);
    await expect(
      page.getByRole("button", { name: "Make effective", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Make effective", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Make effective", exact: true });
    await expect(confirmation).toContainText("state version 7");
    await confirmation.getByLabel("Action reason").fill("Синтетическая проверка интерфейса");
    const ack = confirmation.getByRole("checkbox");
    await expect(ack).not.toBeChecked();
    await expect(
      confirmation.getByRole("button", { name: "Confirm action", exact: true }),
    ).toBeDisabled();
    await ack.check();
    await expect(
      confirmation.getByRole("button", { name: "Confirm action", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("promotion-manual-review.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Make effective", exact: true }).click();
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
