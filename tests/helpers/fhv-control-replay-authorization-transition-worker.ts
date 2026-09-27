/** Test-only child: observe real native file publication; never supplies runtime authority. */
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, dirname, basename, resolve } from "node:path";
import type { FhvControlReplayLaunchInput } from "../../lib/trader/observability/fhv-control-replay-execution";
import type { FhvControlReplayTransitionInput } from "../../lib/trader/observability/fhv-full-historical-auth";
const requireForTest = createRequire(join(process.cwd(), "package.json"));
const fs = requireForTest("node:fs") as typeof import("node:fs");
const original = {
  open: fs.openSync,
  close: fs.closeSync,
  link: fs.linkSync,
  rename: fs.renameSync,
  fsync: fs.fsyncSync,
  read: fs.readFileSync,
  write: fs.writeSync,
};
const config = JSON.parse(original.read(process.argv[2]!, "utf8")) as {
  action: "launch" | "resume" | "consume-retained" | "consume-legacy";
  input: FhvControlReplayLaunchInput;
  identity: FhvControlReplayTransitionInput;
  pausePhase?: string;
};
const descriptors = new Map<number, string>();
const pending = new Map<string, string[]>();
function emit(value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let written = 0;
  while (written < bytes.length)
    written += original.write(1, bytes, written, bytes.length - written);
}
function pause(phase: string) {
  if (phase !== config.pausePhase) return;
  emit({
    event: "phase",
    phase,
    boundary: phase.endsWith("lock")
      ? "AFTER_EXCLUSIVE_OPEN"
      : "AFTER_NATIVE_PUBLICATION_DIRECTORY_FSYNC",
  });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
function phaseFor(path: string): string | undefined {
  if (resolve(path) === resolve(config.input.authorizationReceiptPath)) return "native-consumed";
  const file = basename(path);
  if (file === "fhv-authorization-claim.v2.json") {
    const claim = JSON.parse(original.read(path, "utf8")) as { state: string };
    return `claim-${claim.state}`;
  }
  return (
    {
      "issued.v1.json": "issued-history",
      "consumed.v1.json": "consumed-history",
      "pair.v1.json": "pair-history",
      "initialized.v1.json": "initialized-history",
    } as Record<string, string>
  )[file];
}
fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
  const fd = original.open(...args);
  const path = String(args[0]);
  descriptors.set(fd, path);
  if (path.endsWith(".authorization-initialization.lock")) pause("initialization-lock");
  if (path.endsWith(".consume.lock")) pause("consume-lock");
  return fd;
}) as typeof fs.openSync;
fs.closeSync = ((fd: number) => {
  try {
    return original.close(fd);
  } finally {
    descriptors.delete(fd);
  }
}) as typeof fs.closeSync;
function record(path: string) {
  const dir = dirname(path);
  pending.set(dir, [...(pending.get(dir) ?? []), path]);
}
fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
  const result = original.link(...args);
  record(String(args[1]));
  return result;
}) as typeof fs.linkSync;
fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
  const result = original.rename(...args);
  record(String(args[1]));
  return result;
}) as typeof fs.renameSync;
fs.fsyncSync = ((fd: number) => {
  original.fsync(fd);
  const dir = descriptors.get(fd);
  if (!dir) return;
  const files = pending.get(dir);
  pending.delete(dir);
  for (const path of files ?? []) {
    const phase = phaseFor(path);
    if (phase) pause(phase);
  }
}) as typeof fs.fsyncSync;
syncBuiltinESMExports();
process.on("message", async (message: unknown) => {
  if (message !== "go") return;
  try {
    const auth = await import("../../lib/trader/observability/fhv-full-historical-auth");
    if (config.action === "consume-legacy")
      auth.consumeFhvFullHistoricalAuthorizationReceipt(config.input.authorizationReceiptPath);
    else if (config.action === "consume-retained")
      auth.consumeFhvControlReplayAuthorizationWithHistoryV1({
        ...config.identity,
        expectedIssuedReceiptDigest: config.input.authorizationReceiptDigest,
      });
    else {
      const owner = await import("../../lib/trader/observability/fhv-control-replay-execution");
      await (
        config.action === "resume"
          ? owner.resumeFhvControlReplayLaunch
          : owner.executeFhvControlReplayLaunch
      )(config.input);
    }
    emit({ event: "result", ok: true });
  } catch (error) {
    emit({
      event: "result",
      ok: false,
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
});
emit({ event: "ready" });
