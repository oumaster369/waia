import { NextResponse } from "next/server";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  TREASURY_WATCHER_ORGANIZATION_ENV,
  treasuryWatcherReadiness,
} from "@/lib/waia-core/treasury/watcher/build-worker-deps";
import { TREASURY_WATCHER_CHECKPOINT_KEY } from "@/lib/waia-core/treasury/watcher/config";
import { createPostgresTreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/postgres-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = treasuryWatcherReadiness(process.env);
  if (!readiness.ready) {
    return NextResponse.json(
      {
        ok: !readiness.enabled,
        state: readiness.enabled ? "NOT_READY" : "DARK",
        ...readiness,
      },
      { status: readiness.enabled ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const organizationId = process.env[TREASURY_WATCHER_ORGANIZATION_ENV]?.trim() ?? "";
  const context = requireOrgContext(organizationId);
  const runtime = createPerRequestPostgresRuntime();
  try {
    const repository = createPostgresTreasuryWatcherRepository(runtime.db);
    const checkpoint = await repository.getCheckpoint(context, TREASURY_WATCHER_CHECKPOINT_KEY);
    return NextResponse.json(
      {
        ok: !readiness.enabled || (checkpoint !== null && checkpoint.lastError === null),
        state: readiness.enabled ? "ENABLED" : "READY_DARK",
        ...readiness,
        checkpoint: checkpoint
          ? {
              lastScannedAt: checkpoint.lastScannedAt.toISOString(),
              cycleCount: checkpoint.cycleCount,
              hasError: checkpoint.lastError !== null,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await runtime._sql.end({ timeout: 5 });
  }
}
