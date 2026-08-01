/**
 * DEE-436 — child process worker for concurrent authorization consume race tests.
 */

import { consumeFhvFullHistoricalAuthorizationReceipt } from "../../lib/trader/observability/fhv-full-historical-auth";

const receiptPath = process.argv[2];
const label = process.argv[3];

if (!receiptPath || !label) {
  process.exit(2);
}

process.on("message", (message: unknown) => {
  if (message !== "go") {
    return;
  }
  try {
    consumeFhvFullHistoricalAuthorizationReceipt(receiptPath);
    process.send?.({ ok: true, label });
  } catch (error) {
    process.send?.({
      ok: false,
      label,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

process.send?.("ready");
