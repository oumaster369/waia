import { describe, expect, it, vi } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import { deleteMockExecutionArtifactsForOrgPostgres } from "@/lib/trader/execution/repository-postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-00000002a0";

describe("deleteMockExecutionArtifactsForOrgPostgres (DEE-368)", () => {
  it("deletes only org-scoped mock orders", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn().mockReturnValue({ where: whereMock });
    const ex = { delete: deleteMock };

    await deleteMockExecutionArtifactsForOrgPostgres(ex, requireOrgContext(ORG_A));

    expect(deleteMock).toHaveBeenCalledWith(pgSchema.traderOrders);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
