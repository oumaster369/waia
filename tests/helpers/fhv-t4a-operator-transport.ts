/**
 * DEE-436 — test re-exports for T4A hermetic transport.
 */

export type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
export {
  createFhvT4aLiveTransport,
  getFhvT4aOperatorTransportForTests,
  setFhvT4aOperatorTransportForTests,
} from "@/lib/trader/observability/fhv-t4a-operator-transport";
export {
  createFhvT4aHermeticTransport,
  type FhvT4aHermeticTransportOptions,
} from "@/lib/trader/observability/fhv-t4a-hermetic-transport";

import { createHash } from "node:crypto";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
