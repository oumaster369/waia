/** Opt-in disposable local PostgreSQL only; append-only synthetic evidence is retained. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  handleAdminConsoleKillSwitchGet,
  handleAdminConsoleKillSwitchPost,
} from "@/lib/trader/admin-console/handlers/kill-switch";
import { handleAdminConsoleIncidentsGet } from "@/lib/trader/admin-console/handlers/incidents";
import { handleAdminConsoleIncidentPost } from "@/lib/trader/admin-console/handlers/incident-commands";
import { handleAdminConsoleInvoiceCommandPost } from "@/lib/trader/admin-console/handlers/invoice-commands";
import { handleAdminConsoleInvoiceDetailGet } from "@/lib/trader/admin-console/handlers/invoices";
import {
  createPostgresDraftInvoiceService,
  createPostgresHwmLedgerService,
  createPostgresReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
const admin = randomUUID();
const ordinary = randomUUID();
function request(path: string, body?: unknown, origin = "http://localhost") {
  return new Request(
    `http://localhost/api/trader/admin/console/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
describe.skipIf(!enabled)("admin console safe workflows on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const deps = (userId = admin): AdminRouteHandlerDeps => ({
    getUserId: async () => userId,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 5, prepare: false });
    db = drizzle(client, { schema });
    for (const id of [admin, ordinary]) {
      await client`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
      await client`INSERT INTO users (id, identity_label, email) VALUES (${id}::uuid, 'Console workflow test', ${`${id}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: id, displayName: "Console workflow test" });
    }
    await client`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${admin}::uuid`;
  });
  afterAll(async () => {
    await client?.end();
  });
  it("rejects unsupported account scope, stale/missing revision and cross-origin commands without writing", async () => {
    const target = {
      scope: "organization",
      organization_id: personalOrganizationIdFromUserId(admin),
      switch_type: "PAUSE",
    };
    const body = {
      target,
      command: "trip",
      expectedRevision: "wrong",
      expectedStateVersion: 0,
      confirmed: true,
      reason: "Synthetic test only",
    };
    expect(
      (
        await handleAdminConsoleKillSwitchPost(
          request("kill-switch", {
            ...body,
            target: { ...target, account_id: "specific-account" },
          }),
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleAdminConsoleKillSwitchGet(
          request(
            `kill-switch?scope=account&organization_id=${target.organization_id}&switch_type=PAUSE`,
          ),
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleAdminConsoleKillSwitchPost(
          request("kill-switch", { ...body, expectedRevision: undefined }),
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleAdminConsoleKillSwitchPost(request("kill-switch", body), deps())).status,
    ).toBe(409);
    expect(
      (
        await handleAdminConsoleKillSwitchPost(
          request("kill-switch", body, "https://untrusted.invalid"),
          deps(),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleAdminConsoleKillSwitchPost(request("kill-switch", body), deps(ordinary))).status,
    ).toBe(403);
    const count =
      await client`SELECT count(*)::int AS n FROM trader_kill_switches WHERE organization_id = ${target.organization_id}::uuid`;
    expect(count[0].n).toBe(0);
  });
  it("serializes first trip against the exact read revision and returns the same persisted state on read-back", async () => {
    const target = {
      scope: "organization",
      organization_id: personalOrganizationIdFromUserId(admin),
      switch_type: "PAUSE",
    };
    const path = `kill-switch?${new URLSearchParams(target)}`;
    const before = await handleAdminConsoleKillSwitchGet(request(path), deps());
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ data: { state: "NOT_CREATED", expectedStateVersion: 0 } });
    const body = {
      target,
      command: "trip",
      expectedRevision: (before.body as { revision: string }).revision,
      expectedStateVersion: 0,
      confirmed: true,
      reason: "Synthetic workflow test",
    };
    const results = await Promise.all(
      [1, 2].map(() => handleAdminConsoleKillSwitchPost(request("kill-switch", body), deps())),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const success = results.find((r) => r.status === 200)!;
    const after = await handleAdminConsoleKillSwitchGet(request(path), deps());
    expect(after.body).toMatchObject({
      revision: (success.body as { revision: string }).revision,
      data: { state: "ACTIVE", enforcementMode: "CLOSE_ONLY", expectedStateVersion: 1 },
    });
    expect(success.body).toMatchObject({
      auditId: expect.any(String),
      confirmation: "READ_BACK_REQUIRED",
    });
  });
  it("atomically changes an incident once, keeps a stale second command from duplicating its audit, and rejects a skipped transition", async () => {
    const id = randomUUID();
    await client`INSERT INTO trader_admin_incident (id, environment, service, fingerprint, title, severity, status, first_seen_at, last_seen_at) VALUES (${id}::uuid, 'test', 'workflow', ${id}, 'Synthetic incident', 'error', 'new', now(), now())`;
    const before = await handleAdminConsoleIncidentsGet(
      request("incidents?tab=active&limit=200"),
      deps(),
    );
    const current = (
      before.body as { data: { items: { id: string; revision: string }[] } }
    ).data.items.find((item) => item.id === id)!;
    const body = {
      id,
      expectedRevision: current.revision,
      status: "investigating",
      reason: "Test triage",
      evidence: "Synthetic persisted incident",
    };
    const results = await Promise.all(
      [1, 2].map(() => handleAdminConsoleIncidentPost(request("incidents", body), deps())),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events =
      await client`SELECT from_status, to_status, actor_user_id::text FROM trader_admin_incident_event WHERE incident_id = ${id}::uuid`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from_status: "new",
      to_status: "investigating",
      actor_user_id: admin,
    });
    const revision = (results.find((r) => r.status === 200)!.body as { data: { revision: string } })
      .data.revision;
    expect(
      (
        await handleAdminConsoleIncidentPost(
          request("incidents", { ...body, expectedRevision: revision, status: "resolved" }),
          deps(),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handleAdminConsoleIncidentPost(
          request(`incidents?organization_id=${personalOrganizationIdFromUserId(ordinary)}`, {
            ...body,
            expectedRevision: revision,
          }),
          deps(),
        )
      ).status,
    ).toBe(404);
  });
  it("requires all six manual attestations and the saved revision, and permits only the fleet admin to approve a client's canonical draft", async () => {
    const organizationId = personalOrganizationIdFromUserId(ordinary);
    const context = { organizationId, userId: ordinary };
    const account = `console-invoice-${randomUUID()}`;
    const periodStart = new Date("2026-09-01T00:00:00Z");
    const periodEnd = new Date("2026-09-02T00:00:00Z");
    const hwm = createPostgresHwmLedgerService(db, {}, db);
    const lifecycle = createPostgresReportingPeriodLifecycleService(db, {}, db);
    const drafts = createPostgresDraftInvoiceService(db, {}, db);
    await hwm.bootstrapHwm(context, {
      exchangeAccountId: account,
      initialHwm: "0",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: periodStart,
    });
    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: account,
      periodStart,
      startingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:console-workflow",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date(periodStart.getTime() + 300_000),
    });
    const closed = await lifecycle.closeReportingPeriod(
      context,
      billingV2PeriodCloseEvidence({
        organizationId,
        accountId: account,
        periodStart,
        periodEnd,
        realizedPnl: "100.00",
        unrealizedPnl: "0",
        endingEquity: "10100.00",
        endingSnapshotAt: new Date(periodEnd.getTime() - 300_000),
      }),
    );
    const draft = await drafts.generateDraftInvoice(context, {
      periodId: closed.id,
      computedAt: periodEnd,
    });
    const path = `invoices/${draft.id}?organization_id=${organizationId}&exchange_account_id=${account}`;
    const before = await handleAdminConsoleInvoiceDetailGet(request(path), deps(), draft.id);
    expect(before.status).toBe(200);
    const revision = (before.body as { data: { revision: string } }).data.revision;
    const attestations = {
      depositsVerified: true,
      withdrawalsVerified: true,
      balanceSnapshotsVerified: true,
      reconciliationVerified: true,
      exchangeSyncVerified: true,
      realizedFillFinalityVerified: true,
    };
    const body = {
      organization_id: organizationId,
      expectedRevision: revision,
      command: "approve",
      attestations,
    };
    expect(
      (
        await handleAdminConsoleInvoiceCommandPost(
          request(path, {
            ...body,
            attestations: { ...attestations, realizedFillFinalityVerified: false },
          }),
          deps(),
          draft.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleAdminConsoleInvoiceCommandPost(request(path, body), deps(ordinary), draft.id))
        .status,
    ).toBe(403);
    expect(
      (
        await handleAdminConsoleInvoiceCommandPost(
          request(path, { ...body, expectedRevision: "old" }),
          deps(),
          draft.id,
        )
      ).status,
    ).toBe(409);
    const results = await Promise.all(
      [1, 2].map(() => handleAdminConsoleInvoiceCommandPost(request(path, body), deps(), draft.id)),
    );
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    const after = await handleAdminConsoleInvoiceDetailGet(request(path), deps(), draft.id);
    const saved = (
      after.body as {
        data: { revision: string; approvedAt: string | null; stored: { performanceFee: string } };
      }
    ).data;
    expect(saved.approvedAt).not.toBeNull();
    expect(saved.stored.performanceFee).toBe(draft.performanceFee);
    // Cooling-off is controlled by the existing service; this adapter exposes no shortening argument.
    expect(
      (
        await handleAdminConsoleInvoiceCommandPost(
          request(path, {
            organization_id: organizationId,
            expectedRevision: saved.revision,
            command: "issue",
            confirmed: true,
          }),
          deps(),
          draft.id,
        )
      ).status,
    ).toBe(400);
    const cancelled = await handleAdminConsoleInvoiceCommandPost(
      request(path, {
        organization_id: organizationId,
        expectedRevision: saved.revision,
        command: "cancel-pending",
        reason: "Synthetic test cancellation",
      }),
      deps(),
      draft.id,
    );
    expect(cancelled.status).toBe(200);
    const final = await handleAdminConsoleInvoiceDetailGet(request(path), deps(), draft.id);
    expect(final.body).toMatchObject({
      data: { approvedAt: null, status: "DRAFT", stored: { performanceFee: draft.performanceFee } },
    });
  });
});
