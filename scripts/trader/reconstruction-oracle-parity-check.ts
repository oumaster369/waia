import {
  assertReconstructionParityHarness,
  runDeterministicRestartCheck,
  runReconstructionParityHarness,
  writeReconstructionParityBaseline,
} from "@/lib/trader/market-data/canvas/canvas-reconstruction-parity-harness";

const harness = runReconstructionParityHarness();
assertReconstructionParityHarness(harness);
const restart = runDeterministicRestartCheck();
if (!restart.ok) {
  throw new Error("Deterministic restart check failed");
}
writeReconstructionParityBaseline(harness);
console.log(harness.terminalState);
