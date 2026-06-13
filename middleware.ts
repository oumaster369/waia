import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isTraderHostRoutingEnabled, resolveModuleHost } from "@/lib/hosts/resolve";

/** Topology classification only — cross-host isolation uses next.config host redirects. */
export function middleware(request: NextRequest) {
  if (!isTraderHostRoutingEnabled()) {
    return NextResponse.next();
  }

  const moduleHost = resolveModuleHost(request);
  const response = NextResponse.next();
  response.headers.set("x-waia-module", moduleHost.module);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
