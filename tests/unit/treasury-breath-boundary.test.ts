import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as treasury from "@/lib/waia-core/treasury";
import { getBreathPublicSnapshot } from "@/lib/waia-core/treasury";
import { WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED } from "@/lib/waia-core/treasury/admin/breath-port";
import { WP6_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED } from "@/lib/waia-core/treasury/breath";
import { handleTreasuryBreathPreviewGet } from "@/lib/waia-core/treasury/admin/handlers";
import { resolveTreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/resolve";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import { createWp4Deps, getRequest } from "@/tests/unit/helpers/treasury-wp4";
import {
  createWp6Bundle,
  ctxA,
  seedPublishableControl,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

describe("DEE-606 WP-6 server/public boundary", () => {
  it("105-115 admin preview, DEE-617 public GET, no R2, watcher DARK, WP-7 untouched", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedTx(services, {
      id: "cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 1_000_000n,
      accountingAmountMicros: 1_000_000n,
    });
    const denied = createWp4Deps({ services, permissions: "none" });
    const readDenied = await handleTreasuryBreathPreviewGet(
      getRequest(`/api/admin/treasury/breath-preview?organization_id=${ctxA.organizationId}`),
      denied,
    );
    expect(readDenied.status).toBe(403);

    const allowed = createWp4Deps({
      services,
      permissions: ["admin.treasury.read"],
    });
    const preview = await handleTreasuryBreathPreviewGet(
      getRequest(`/api/admin/treasury/breath-preview?organization_id=${ctxA.organizationId}`),
      allowed,
    );
    expect(preview.status).toBe(200);
    const body = preview.body as {
      preview: { status: string; resources: { entered: string } | null };
    };
    expect(body.preview.status).toBe("published");
    expect(body.preview.resources?.entered).toBe("1000000");

    expect(WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED).toBe(false);
    expect(WP6_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED).toBe(true);
    expect("getBreathPublicSnapshot" in treasury).toBe(true);
    const snap = await getBreathPublicSnapshot(ctxA, services.breath);
    expect(snap.status).toBe("published");
    expect(snap.resources?.entered).toBe("1000000");

    const failing = createWp6Bundle();
    const pending = await getBreathPublicSnapshot(ctxA, failing.services.breath);
    expect(pending.status).toBe("pending");
    expect(pending.resources).toBeNull();
    expect(JSON.stringify(pending)).not.toContain("42000");
    expect(JSON.stringify(pending)).not.toContain("100000");

    const root = process.cwd();
    expect(existsSync(path.join(root, "app/api/treasury"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/public/treasury"))).toBe(true);
    expect(existsSync(path.join(root, "app/api/breath"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/admin/treasury/breath-preview"))).toBe(true);

    const publicRoute = readFileSync(
      path.join(root, "app/api/public/treasury/route.ts"),
      "utf8",
    );
    expect(publicRoute).toContain("export async function GET()");
    expect(publicRoute).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);

    const breathDir = path.join(root, "lib/waia-core/treasury/breath");
    const breathFiles = [
      "accounting.ts",
      "publication-gates.ts",
      "read-model.ts",
      "public-snapshot.ts",
      "runway.ts",
      "postgres-repository.ts",
      "memory-repository.ts",
    ].map((name) => readFileSync(path.join(breathDir, name), "utf8"));
    expect(breathFiles.join("\n")).not.toContain("contribution-share");
    expect(breathFiles.join("\n")).not.toContain("TREASURY_EVIDENCE_R2");
    expect(breathFiles.join("\n")).not.toContain("r2-adapter");
    const postgresSrc = readFileSync(path.join(breathDir, "postgres-repository.ts"), "utf8");
    expect(postgresSrc).not.toContain("limit ?? 50");
    expect(postgresSrc).not.toMatch(/listTransactions\(/);
    expect(postgresSrc).toContain("orgScopedWhere");

    expect(resolveTreasuryEvidenceStorage()).toBeNull();
    const wrangler = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
    expect(wrangler).not.toContain("r2_buckets");
    expect(wrangler).not.toContain("TREASURY_EVIDENCE_R2");
    expect(wrangler).not.toContain("TREASURY_WATCHER_ENABLED");
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);

    const contributionShare = readFileSync(
      path.join(root, "lib/waia-core/treasury/contribution-share.ts"),
      "utf8",
    );
    expect(contributionShare).toContain("WP-7 owns the contribution share engine");
  });
});
