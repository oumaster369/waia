/**
 * DEE-250 — Order reconciliation Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { createPostgresReconciliationService } from "@/lib/trader/execution";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000025001";

describe.skipIf(!integrationEnabled || !url)(
  "postgres order reconciliation parity (DEE-250)",
  () => {
    let orgA: string;
    let service: ReturnType<typeof createPostgresReconciliationService>;
    let connector: MockExchangeConnector;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      await verifyHtrPostgresConnectionIdentity();
      await cleanup();
      orgA = await seedHtrPostgresUser(url!, USER_A, "Order Recon Postgres Parity");

    const db = getPostgresDrizzle();

      connector = new MockExchangeConnector();
      await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

      service = createPostgresReconciliationService(db, {
        connectorForMode: () => connector,
      });
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("reconciles open scan through postgres stack", async () => {
      const context = requireOrgContext(orgA);
      const report = await service.reconcile(context, { kind: "open", executionMode: "mock" });
      expect(report.organizationId).toBe(orgA);
      expect(report.outcomes).toBeDefined();
    });
  },
);
