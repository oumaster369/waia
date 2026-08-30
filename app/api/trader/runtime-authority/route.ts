import { NextResponse } from "next/server";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { handleTenantRuntimeAuthorityGet } from "@/lib/trader/runtime-authority/v2";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const result = await handleTenantRuntimeAuthorityGet(request, {
    getUserId: getOptionalSessionUserId, hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb, disposeRuntimeDb: disposeWaiaRuntimeDb,
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
}
