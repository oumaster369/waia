import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalAdminSessionUserId } from "@/lib/auth/session-user";
import { listHrApplications } from "@/lib/waia-core/hr/service";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { assertAdminPermission } from "@/lib/waia-core/permissions/admin-http";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getOptionalAdminSessionUserId();
  if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind !== "postgres") {
      return NextResponse.json({ error: { code: "HR_BACKEND_UNAVAILABLE" } }, { status: 503 });
    }
    const access = await assertAdminPermission(
      runtime,
      userId,
      personalOrganizationIdFromUserId(userId),
      "admin.hr.read",
    );
    if (!access.allowed)
      return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    return NextResponse.json(await listHrApplications(runtime.db), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
