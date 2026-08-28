import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { createPublicHrApplication, HrApplicationError } from "@/lib/waia-core/hr/service";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";

export const dynamic = "force-dynamic";

function error(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  if (process.env.WAIA_PUBLIC_TEAM_APPLICATIONS_ENABLED === "false") {
    return error("HR_INTAKE_DISABLED", "Team applications are temporarily unavailable.", 503);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return error("ORIGIN_MISMATCH", "Cross-origin applications are not allowed.", 403);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  const userId = await getOptionalSessionUserId();
  const profile = userId ? await readProfileForSessionUser(userId) : null;
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind !== "postgres") {
      return error("HR_BACKEND_UNAVAILABLE", "Team applications are temporarily unavailable.", 503);
    }
    const application = await createPublicHrApplication({
      db: runtime.db,
      applicantUserId: userId,
      authenticatedDisplayName: profile?.displayName ?? null,
      body,
    });
    return NextResponse.json(
      { application },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    if (caught instanceof HrApplicationError) {
      const status = caught.code === "RATE_LIMITED" ? 429 : 400;
      return error(caught.code, caught.message, status);
    }
    return error("HR_APPLICATION_FAILED", "The application could not be saved.", 500);
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
