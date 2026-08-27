import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { HrApplicationError, mutateHrApplication } from "@/lib/waia-core/hr/service";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { assertAdminPermission } from "@/lib/waia-core/permissions/admin-http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: { code: "ORIGIN_MISMATCH" } }, { status: 403 });
  }
  const userId = await getOptionalSessionUserId();
  if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 });
  }
  const { id } = await context.params;
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
      "admin.hr.mutate",
    );
    if (!access.allowed)
      return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    return NextResponse.json(
      await mutateHrApplication({ db: runtime.db, actorUserId: userId, applicationId: id, body }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    if (caught instanceof HrApplicationError) {
      return NextResponse.json(
        { error: { code: caught.code, message: caught.message } },
        { status: caught.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    return NextResponse.json({ error: { code: "HR_MUTATION_FAILED" } }, { status: 500 });
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
