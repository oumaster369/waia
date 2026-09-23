import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { eq } from "drizzle-orm";
import {
  handleAccountObservationGet,
  type ObservationReadDependencies,
} from "@/lib/trader/account-observation/read-handler";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import {
  ADMIN_COCKPIT_SOURCES,
  cockpitC3Fact,
  cockpitFreshnessFact,
  cockpitReleaseFact,
  cockpitRuntimeFact,
  freshnessFromObservationBody,
  handleAdminCockpitRead,
  readStoredObservationFreshness,
  type AdminCockpitReadDeps,
  type C3ChannelReading,
  type ObservationFreshnessReading,
} from "@/lib/trader/admin/cockpit-read";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import type { RuntimeAuthorityReadModelV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-read-model-v2";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d901";
const ADMIN_ID = "00000000-0000-4000-8000-00000000d902";
const LEAKED_RUNTIME = "leaked-runtime";
const LEAKED_FRESHNESS_MS = 424242424242;
const LEAKED_C3 = "LEAKED_C3";
const LEAKED_BALANCE = "OTHER_ORG_BALANCE";

const binding: ObservationBinding = {
  organizationId: "00000000-0000-4000-8000-0000000000c1",
  credentialId: "00000000-0000-4000-8000-0000000000c2",
  exchangeAccountId: "account",
  credentialRevision: "1",
  configurationRevision: "config-1",
};

function createDeps(getUserId: () => Promise<string | null>): AdminRouteHandlerDeps {
  return {
    getUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

function runtimeModel(
  organizationId: string,
  runtimeInstanceId: string,
): RuntimeAuthorityReadModelV2 {
  return {
    availability: "AVAILABLE",
    organizationId,
    runtimeInstanceId,
    posture: "HALT",
    reasonCodes: [],
    assessmentId: "assessment-1",
    adjudicatedAtUtc: "2026-09-23T00:00:00.000Z",
  };
}

describe("admin cockpit fact selectors", () => {
  it("names the missing release source and does not echo a release SHA", () => {
    const previous = process.env.WAIA_RELEASE_SHA;
    process.env.WAIA_RELEASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    try {
      const fact = cockpitReleaseFact();
      expect(fact).toEqual({
        state: "unavailable",
        source: ADMIN_COCKPIT_SOURCES.releaseIdentityMissing,
      });
      expect(JSON.stringify(fact)).not.toContain(process.env.WAIA_RELEASE_SHA);
    } finally {
      if (previous === undefined) {
        delete process.env.WAIA_RELEASE_SHA;
      } else {
        process.env.WAIA_RELEASE_SHA = previous;
      }
    }
  });

  it("drops a runtime model that belongs to another organization", () => {
    const fact = cockpitRuntimeFact(
      binding.organizationId,
      runtimeModel("00000000-0000-4000-8000-000000000099", LEAKED_RUNTIME),
    );
    expect(fact).toEqual({
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.runtimeAuthority,
    });
    expect(JSON.stringify(fact)).not.toContain(LEAKED_RUNTIME);
  });

  it("keeps a runtime model for the requested organization", () => {
    const fact = cockpitRuntimeFact(
      binding.organizationId,
      runtimeModel(binding.organizationId, "local-runtime"),
    );
    expect(fact).toMatchObject({
      state: "value",
      source: ADMIN_COCKPIT_SOURCES.runtimeAuthority,
      value: { organizationId: binding.organizationId, runtimeInstanceId: "local-runtime" },
    });
  });

  it("drops observation freshness and balances from another organization", () => {
    const reading = freshnessFromObservationBody(binding.organizationId, {
      binding: { organizationId: "00000000-0000-4000-8000-000000000099" },
      collectionCompletedAtMs: LEAKED_FRESHNESS_MS,
      balances: { marker: LEAKED_BALANCE },
    });
    expect(reading).toBeNull();
    const fact = cockpitFreshnessFact(binding.organizationId, reading);
    expect(fact.state).toBe("unavailable");
    expect(JSON.stringify(fact)).not.toContain(String(LEAKED_FRESHNESS_MS));
    expect(JSON.stringify(fact)).not.toContain(LEAKED_BALANCE);
  });

  it("keeps freshness only as the collection timestamp for the same organization", () => {
    const reading = freshnessFromObservationBody(binding.organizationId, {
      binding: { organizationId: binding.organizationId },
      collectionCompletedAtMs: 1_700_000_000_000,
      balances: { marker: LEAKED_BALANCE },
    });
    expect(reading).toEqual({
      organizationId: binding.organizationId,
      collectionCompletedAtMs: 1_700_000_000_000,
    });
    const fact = cockpitFreshnessFact(binding.organizationId, reading);
    expect(fact).toEqual({
      state: "value",
      source: ADMIN_COCKPIT_SOURCES.observationFreshness,
      value: { collectionCompletedAtMs: 1_700_000_000_000 },
    });
    expect(JSON.stringify(fact)).not.toContain(LEAKED_BALANCE);
  });

  it("does not invent C3 progress when no run is selected", () => {
    const fact = cockpitC3Fact(binding.organizationId, null, {
      organizationId: binding.organizationId,
      campaignRunId: "run-1",
      progress: { marker: LEAKED_C3 },
    });
    expect(fact).toEqual({
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.c3MissingRun,
    });
    expect(JSON.stringify(fact)).not.toContain(LEAKED_C3);
  });

  it("names an operator-typed run when the channel does not supply that organization", () => {
    const fact = cockpitC3Fact(binding.organizationId, "run-typed", {
      organizationId: "00000000-0000-4000-8000-000000000099",
      campaignRunId: "run-typed",
      progress: { marker: LEAKED_C3, organizationId: "00000000-0000-4000-8000-000000000099" },
    });
    expect(fact).toEqual({
      state: "unavailable",
      source: ADMIN_COCKPIT_SOURCES.c3TypedRunOnly,
      operatorCampaignRunId: "run-typed",
    });
    expect(JSON.stringify(fact)).not.toContain(LEAKED_C3);
  });

  it("drops channel progress whose payload names another organization", () => {
    const fact = cockpitC3Fact(binding.organizationId, "run-typed", {
      organizationId: binding.organizationId,
      campaignRunId: "run-typed",
      progress: { marker: LEAKED_C3, organizationId: "00000000-0000-4000-8000-000000000099" },
    });
    expect(fact.state).toBe("unavailable");
    expect(JSON.stringify(fact)).not.toContain(LEAKED_C3);
  });

  it("passes channel progress only for the same organization and run", () => {
    const fact = cockpitC3Fact(binding.organizationId, "run-typed", {
      organizationId: binding.organizationId,
      campaignRunId: "run-typed",
      progress: { phase: "observed", organizationId: binding.organizationId },
    });
    expect(fact).toEqual({
      state: "value",
      source: ADMIN_COCKPIT_SOURCES.c3Channel,
      value: { phase: "observed", organizationId: binding.organizationId },
    });
  });
});

describe("stored observation freshness", () => {
  it("does not invent a timestamp when the stored observation is missing", async () => {
    const observationDeps: ObservationReadDependencies = {
      getUserId: vi.fn(async () => "user"),
      hasTraderAccess: vi.fn(async () => true),
      hasOrgMembership: vi.fn(async () => true),
      hasOperatorAccess: vi.fn(async () => true),
      isAdminListedOrganization: vi.fn(async () => true),
      resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(async () => null),
    };
    const request = new Request(
      "http://localhost/api/trader/admin/cockpit?" + new URLSearchParams(binding),
    );
    await expect(
      readStoredObservationFreshness(request, binding.organizationId, observationDeps),
    ).resolves.toBeNull();
    expect(observationDeps.readLatest).toHaveBeenCalledOnce();
  });

  it("does not call the observation reader for an organization the cabinet list omits", async () => {
    const observationDeps: ObservationReadDependencies = {
      getUserId: vi.fn(async () => "user"),
      hasTraderAccess: vi.fn(async () => true),
      hasOrgMembership: vi.fn(async () => true),
      hasOperatorAccess: vi.fn(async () => true),
      isAdminListedOrganization: vi.fn(async () => false),
      resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(async () => null),
    };
    const request = new Request(
      "http://localhost/api/trader/admin/cockpit?" + new URLSearchParams(binding),
    );
    await expect(
      readStoredObservationFreshness(request, binding.organizationId, observationDeps),
    ).resolves.toBeNull();
    expect(observationDeps.readLatest).not.toHaveBeenCalled();
    expect((await handleAccountObservationGet(request, "admin", observationDeps)).status).toBe(403);
  });
});

describe("admin cockpit read handler", () => {
  let adminOrgId: string;
  let otherOrgId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-admin-cockpit-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "cockpit.sqlite")}`;
    migrateDatabaseFromEnv();
    const db: WaiaDb = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "cockpit-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "cockpit-admin@waia.invalid",
      password: "password123",
    });
    ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Cockpit User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Cockpit Admin" });
    otherOrgId = personalOrganizationIdFromUserId(USER_ID);
    adminOrgId = personalOrganizationIdFromUserId(ADMIN_ID);
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  function readers() {
    return {
      readRuntimeAuthority: vi.fn(async () => runtimeModel(otherOrgId, LEAKED_RUNTIME)),
      readObservationFreshness: vi.fn(
        async (): Promise<ObservationFreshnessReading> => ({
          organizationId: otherOrgId,
          collectionCompletedAtMs: LEAKED_FRESHNESS_MS,
        }),
      ),
      readC3Progress: vi.fn(
        async (): Promise<C3ChannelReading> => ({
          organizationId: otherOrgId,
          campaignRunId: "run-typed",
          progress: { marker: LEAKED_C3 },
        }),
      ),
    };
  }

  function cockpitDeps(
    getUserId: () => Promise<string | null>,
    extra: Partial<AdminCockpitReadDeps> = {},
  ): AdminCockpitReadDeps {
    return { ...createDeps(getUserId), ...extra };
  }

  it("returns 401 and does not read sources when unauthenticated", async () => {
    const extra = readers();
    const result = await handleAdminCockpitRead(
      new Request(`http://localhost/api/trader/admin/cockpit?organization_id=${adminOrgId}`),
      cockpitDeps(async () => null, extra),
    );
    expect(result.status).toBe(401);
    expect(extra.readRuntimeAuthority).not.toHaveBeenCalled();
    expect(extra.readObservationFreshness).not.toHaveBeenCalled();
    expect(extra.readC3Progress).not.toHaveBeenCalled();
  });

  it("returns 403 and does not read sources for a non-admin", async () => {
    const extra = readers();
    const result = await handleAdminCockpitRead(
      new Request(`http://localhost/api/trader/admin/cockpit?organization_id=${otherOrgId}`),
      cockpitDeps(async () => USER_ID, extra),
    );
    expect(result.status).toBe(403);
    expect(extra.readRuntimeAuthority).not.toHaveBeenCalled();
    expect(extra.readObservationFreshness).not.toHaveBeenCalled();
    expect(extra.readC3Progress).not.toHaveBeenCalled();
  });

  it("omits another organization's runtime, freshness, and C3 progress", async () => {
    const previous = process.env.WAIA_RELEASE_SHA;
    process.env.WAIA_RELEASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const extra = readers();
    try {
      const params = new URLSearchParams({
        organization_id: adminOrgId,
        credentialId: binding.credentialId,
        exchangeAccountId: binding.exchangeAccountId,
        credentialRevision: binding.credentialRevision,
        configurationRevision: binding.configurationRevision,
        campaign_run_id: "run-typed",
      });
      const result = await handleAdminCockpitRead(
        new Request(`http://localhost/api/trader/admin/cockpit?${params}`),
        cockpitDeps(async () => ADMIN_ID, extra),
      );
      expect(result.status).toBe(200);
      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain(LEAKED_RUNTIME);
      expect(serialized).not.toContain(String(LEAKED_FRESHNESS_MS));
      expect(serialized).not.toContain(LEAKED_C3);
      expect(serialized).not.toContain(process.env.WAIA_RELEASE_SHA ?? "");
      expect(serialized).not.toContain("executionHostHealthy");
      expect(result.body).toMatchObject({
        organizationId: adminOrgId,
        releaseIdentity: {
          state: "unavailable",
          source: ADMIN_COCKPIT_SOURCES.releaseIdentityMissing,
        },
        runtimeAuthority: { state: "unavailable" },
        observationFreshness: { state: "unavailable" },
        c3: {
          state: "unavailable",
          source: ADMIN_COCKPIT_SOURCES.c3TypedRunOnly,
          operatorCampaignRunId: "run-typed",
        },
      });
      expect(extra.readRuntimeAuthority).toHaveBeenCalledWith(adminOrgId, expect.anything());
      expect(extra.readC3Progress).toHaveBeenCalledWith({
        organizationId: adminOrgId,
        campaignRunId: "run-typed",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.WAIA_RELEASE_SHA;
      } else {
        process.env.WAIA_RELEASE_SHA = previous;
      }
    }
  });

  it("uses the runtime-authority read model when no override is injected", async () => {
    const result = await handleAdminCockpitRead(
      new Request(`http://localhost/api/trader/admin/cockpit?organization_id=${adminOrgId}`),
      cockpitDeps(async () => ADMIN_ID),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      runtimeAuthority: {
        state: "value",
        source: ADMIN_COCKPIT_SOURCES.runtimeAuthority,
        value: {
          availability: "UNAVAILABLE",
          organizationId: adminOrgId,
          posture: null,
          reasonCodes: ["RUNTIME_AUTHORITY_UNAVAILABLE"],
        },
      },
      observationFreshness: {
        state: "unavailable",
        source: ADMIN_COCKPIT_SOURCES.observationFreshness,
      },
      c3: { state: "unavailable", source: ADMIN_COCKPIT_SOURCES.c3MissingRun },
    });
  });

  it("returns same-organization source values and skips readers that have no target", async () => {
    const extra = {
      readRuntimeAuthority: vi.fn(async () => runtimeModel(adminOrgId, "local-runtime")),
      readObservationFreshness: vi.fn(async () => ({
        organizationId: adminOrgId,
        collectionCompletedAtMs: 1_700_000_000_000,
      })),
      readC3Progress: vi.fn(async () => ({
        organizationId: adminOrgId,
        campaignRunId: "run-local",
        progress: { phase: "observed" },
      })),
    };
    const result = await handleAdminCockpitRead(
      new Request(`http://localhost/api/trader/admin/cockpit?organization_id=${adminOrgId}`),
      cockpitDeps(async () => ADMIN_ID, extra),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      runtimeAuthority: {
        state: "value",
        value: { runtimeInstanceId: "local-runtime", organizationId: adminOrgId },
      },
      observationFreshness: { state: "unavailable" },
      c3: { state: "unavailable", source: ADMIN_COCKPIT_SOURCES.c3MissingRun },
    });
    expect(extra.readObservationFreshness).not.toHaveBeenCalled();
    expect(extra.readC3Progress).not.toHaveBeenCalled();
  });
});

describe("cockpit route source boundary", () => {
  it("does not call the execution host, HTX, or a release SHA", () => {
    const handler = fs.readFileSync(
      path.join(process.cwd(), "lib/trader/admin/cockpit-read.ts"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/trader/admin/cockpit/route.ts"),
      "utf8",
    );
    for (const source of [handler, route]) {
      expect(source).not.toContain("probeExecutionHostHealth");
      expect(source).not.toContain("WAIA_RELEASE_SHA");
      expect(source).not.toContain("WAIA_TRADER_EXECUTION_HOST");
      expect(source).not.toContain("fetchStatus");
      expect(source).not.toContain("historical-simulation");
    }
    expect(route).not.toContain("readC3Progress");
  });
});
