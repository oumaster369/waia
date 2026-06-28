import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { OrgLiveEnableRequiredError } from "@/lib/trader/live/errors";
import type { OrgLiveEnableService } from "@/lib/trader/live/org-live-enable-service";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

/** Fail-closed org live-enable guard (ENABLED only). */
export async function assertOrgLiveEnabled(
  service: OrgLiveEnableService,
  context: OrgContext,
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  const state = await service.getState(scoped);
  if (!state || state.state !== "ENABLED") {
    throw new OrgLiveEnableRequiredError();
  }
}
