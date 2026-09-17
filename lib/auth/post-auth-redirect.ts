import "server-only";

import { buildModuleUrl, isModuleHost } from "@/lib/hosts/resolve";
import { ensureTraderSelfServiceAccessForUser } from "@/lib/trader/self-service-access";

/** Host-aware post-auth redirect target (sign-in / sign-up with session). */
export async function resolvePostAuthRedirect(request: Request, userId: string): Promise<string> {
  if (isModuleHost(request.headers, "trader")) {
    const entitled = await ensureTraderSelfServiceAccessForUser(userId);
    if (entitled) {
      return "/trader";
    }
    return buildModuleUrl("primary", "/dashboard");
  }
  return "/dashboard";
}

/** Host-aware redirect when trader-host sign-up has no immediate session. */
export function resolvePostSignUpRedirect(request: Request): string {
  if (isModuleHost(request.headers, "trader")) {
    return buildModuleUrl("primary", "/dashboard");
  }
  return "/dashboard";
}
