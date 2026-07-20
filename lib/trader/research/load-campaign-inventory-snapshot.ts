import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  buildQuoteCurrencyBySymbol,
  loadPaperFillEvents,
} from "@/lib/trader/paper/derive-paper-pnl";
import { deriveCanonicalInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type LoadCampaignInventorySnapshotInput = {
  orderRepository: OrderRepository;
  executionMode?: "mock" | "paper";
};

export async function tryLoadCanonicalInventorySnapshot(
  _ex: PgReadExecutor,
  context: OrgContext,
  input: LoadCampaignInventorySnapshotInput,
): Promise<Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null> {
  try {
    const executionMode = input.executionMode ?? "mock";
    const { fillEvents } = await loadPaperFillEvents({
      context,
      orderRepository: input.orderRepository,
      executionMode,
    });
    const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
    const inventory = deriveCanonicalInventory(fillEvents, buildQuoteCurrencyBySymbol(symbols));
    return { openQtyBySymbol: inventory.openQtyBySymbol };
  } catch {
    return null;
  }
}
