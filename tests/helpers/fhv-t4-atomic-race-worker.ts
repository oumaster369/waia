/**
 * DEE-436 F-01 — child process for concurrent exclusive publish race tests.
 */

import {
  AtomicFileWriteError,
  prepareAtomicExclusiveTemp,
  publishAtomicExclusiveTemp,
} from "../../lib/trader/backtest/streaming-evidence/atomic-file-write";

const finalPath = process.argv[2];
const label = process.argv[3];
const payload = process.argv[4];

if (!finalPath || !label || payload === undefined) {
  process.exit(2);
}

const tempPath = prepareAtomicExclusiveTemp(finalPath, payload);

process.on("message", (message: unknown) => {
  if (message !== "go") {
    return;
  }
  try {
    publishAtomicExclusiveTemp(tempPath, finalPath);
    process.send?.({ ok: true, label, payload });
  } catch (error) {
    const err = error as AtomicFileWriteError;
    process.send?.({ ok: false, label, code: err.code, payload });
  }
});

process.send?.("ready");
