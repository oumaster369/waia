// Node-only local executor. No network, files, credentials or external result sources.
import { parentPort, workerData } from "node:worker_threads";
import { require as tsxRequire } from "tsx/cjs/api";

const { INTERNAL_validationBootstrapOrdinalRangeV1 } = tsxRequire(
  "../../lib/trader/research/benchmark/validation-bootstrap-v1.ts", import.meta.url,
);
const input = {
  differentials: workerData.differentials,
  trialIdentityDigest32: Buffer.from(workerData.trialIdentityDigest32),
};
parentPort.on("message", ({ start, endExclusive }) => {
  try {
    parentPort.postMessage({ ok: true,
      result: INTERNAL_validationBootstrapOrdinalRangeV1(input, start, endExclusive) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : "BOOTSTRAP_WORKER_FAILED" });
  }
});
