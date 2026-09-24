/**
 * Local-only admin console seed gate.
 * Refuses any host other than localhost or 127.0.0.1, and refuses to run
 * unless WAIA_ADMIN_CONSOLE_SEED_LOCAL=1. It does not insert balances, PnL,
 * health, or a fear-and-greed value: those would be invented figures.
 */
import { assertAdminConsoleSeedLocal } from "@/lib/trader/admin-console/collectors/seed-guard";

const url = assertAdminConsoleSeedLocal(process.env);
process.stdout.write(
  `admin console seed allowed for ${url.hostname}; no fixture balances or index values are written\n`,
);
