import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { countTreasuryOverview } from "@/lib/waia-core/treasury/transaction-list-query";
import { ctxA, ctxB } from "@/tests/unit/helpers/treasury-wp2";
import {
  ORG_A,
  ORG_B,
  openWp8Postgres,
  openWp8Services,
  resetWp8Tenants,
  seedWp8Identity,
  verifiedManualTx,
  wp8IsolationEnabled,
  type Wp8PostgresHandle,
  type Wp8Services,
} from "@/tests/integration/treasury-wp8-harness";

const describeWp8 = describe.skipIf(!wp8IsolationEnabled);

describeWp8("DEE-615 WP-2/WP-3 Postgres filter and count parity", () => {
  let handle: Wp8PostgresHandle;
  let services: Wp8Services;

  beforeAll(async () => {
    handle = openWp8Postgres();
    services = openWp8Services(handle.db);
    await seedWp8Identity(handle.sql);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetWp8Tenants(handle.sql);
  });

  it("matches canonical network/token filters and overview counts without pagination", async () => {
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: "11111111-1111-4111-8111-111111111111",
        organizationId: ORG_A,
        status: "RECONCILIATION_REQUIRED",
        direction: "INFLOW",
        kind: "CONTRIBUTION",
        provenance: "WATCHER",
        canonicalNetwork: "TRC-20",
        canonicalTokenContract: "TUSDT",
        nativeContract: "OTHER",
      }),
    );
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: "22222222-2222-4222-8222-222222222222",
        organizationId: ORG_A,
        status: "VERIFIED",
        direction: "INFLOW",
        kind: "CONTRIBUTION",
        provenance: "MANUAL",
        canonicalNetwork: null,
        canonicalTokenContract: null,
        nativeContract: "TUSDT",
        detailPublication: "PRIVATE",
      }),
    );
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: "33333333-3333-4333-8333-333333333333",
        organizationId: ORG_B,
        status: "DETECTED",
        direction: "INFLOW",
        kind: "CONTRIBUTION",
      }),
    );

    const filtered = await services.domain.repository.listTransactions(ctxA, {
      canonicalNetwork: "TRC-20",
      canonicalTokenContract: "TUSDT",
      limit: 100,
      offset: 0,
    });
    expect(filtered.map((row) => row.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);

    const recon = await services.domain.repository.listTransactions(ctxA, {
      status: "RECONCILIATION_REQUIRED",
      limit: 100,
      offset: 0,
    });
    expect(recon).toHaveLength(1);

    const completeA = await services.domain.repository.listTransactions(ctxA);
    const paged = await services.domain.repository.listTransactions(ctxA, { limit: 1, offset: 0 });
    expect(paged).toHaveLength(1);
    expect(countTreasuryOverview(completeA)).toEqual({
      reviewRequiredCount: 1,
      publicationPendingCount: 1,
    });
    const completeB = await services.domain.repository.listTransactions(ctxB);
    expect(countTreasuryOverview(completeB)).toEqual({
      reviewRequiredCount: 1,
      publicationPendingCount: 0,
    });
  });
});
