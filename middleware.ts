import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isTraderHostRoutingEnabled, resolveModuleHost } from "@/lib/hosts/resolve";
import { refreshAdminSession } from "@/lib/supabase/admin-session-refresh";

/** Cross-host isolation stays in next.config; admin cookie renewal grants no permission. */
export async function middleware(request: NextRequest) {
  if (!isTraderHostRoutingEnabled()) {
    return NextResponse.next();
  }

  const moduleHost = resolveModuleHost(request);
  const response =
    moduleHost.module === "trader" ? await refreshAdminSession(request) : NextResponse.next();
  response.headers.set("x-waia-module", moduleHost.module);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
