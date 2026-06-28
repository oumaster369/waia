import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createSqliteBillingGovernanceService } from "@/lib/trader/billing";
import { createSqliteInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-sqlite";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { insertIssuedInvoiceWithDigest } from "@/tests/helpers/billing-governance-invoice-fixture";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000003217";
const USER_B = "00000000-0000-4000-8000-00000003218";
const OPERATOR_ID = "00000000-0000-4000-8000-00000009997";
const ISSUED_AT = new Date("2026-06-15T00:00:00.000Z");

describe("billing governance tenant isolation (sqlite)", () => {
  let organizationA: string;
  let organizationB: string;
  let invoiceA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-billing-gov-tenant-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "billing-gov-tenant.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "billing-gov-a@waia.invalid",
      password: "password123",
      identityLabel: "Billing Gov A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "billing-gov-b@waia.invalid",
      password: "password123",
      identityLabel: "Billing Gov B",
    });
    organizationA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Billing Gov A",
    });
    organizationB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Billing Gov B",
    });
    invoiceA = insertIssuedInvoiceWithDigest(db, organizationA, "htx-gov-tenant-a", ISSUED_AT, {
      issuedBy: USER_A,
    });
    insertIssuedInvoiceWithDigest(db, organizationB, "htx-gov-tenant-b", ISSUED_AT, {
      issuedBy: USER_B,
    });
  });

  it("keeps disputes scoped to the owning organization", async () => {
    const db = getDb();
    const disputeRepository = createSqliteInvoiceDisputeRepository(db);
    const serviceA = createSqliteBillingGovernanceService(db);

    const dispute = await serviceA.openInvoiceDispute(requireOrgContext(organizationA), {
      invoiceId: invoiceA,
      reason: "Tenant A dispute",
      openedBy: OPERATOR_ID,
    });

    const orgBView = await disputeRepository.findOpenByInvoiceId(
      requireOrgContext(organizationB),
      invoiceA,
    );
    expect(orgBView).toBeNull();

    const orgAView = await disputeRepository.getById(requireOrgContext(organizationA), dispute.id);
    expect(orgAView?.organizationId).toBe(organizationA);
  });
});
