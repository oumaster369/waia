import { DEFAULT_EXIT_RUN_CONFIG } from "@/lib/trader/exits/exit-types";
import type { GuardianCycleContext } from "@/lib/trader/paper/paper-cycle.types";

export type ResearchGuardianConfig = {
  enabled: boolean;
  maxHoldBars?: number;
  barIntervalMs?: number;
  enableExitEngine?: boolean;
  /** HTR-WP20: when true on historical research path, legacy M3 guardian is skipped in favor of HTR bridge. */
  htrAuthoritative?: boolean;
};

export function buildResearchGuardianContext(
  config: ResearchGuardianConfig | undefined,
): GuardianCycleContext | undefined {
  if (config?.enabled !== true) {
    return undefined;
  }

  return {
    runConfig: {
      enabled: true,
      maxHoldBars: config.maxHoldBars ?? 0,
      barIntervalMs: config.barIntervalMs ?? 60_000,
    },
    ...(config.enableExitEngine === true
      ? {
          exitEngine: {
            runConfig: DEFAULT_EXIT_RUN_CONFIG,
            trailingStateByLotId: new Map(),
          },
        }
      : {}),
  };
}
