import { captureRecordedLoop, type RecordedLoopInput } from "./recorded-analysis-v1";
import { requireCondition as check } from "./recorded-analysis-v1";

export function parseRecordedPaperOptions(args: readonly string[]): RecordedLoopInput {
  const flags = new Map<string, string>();
  const allowed = new Set(["org-id", "account-key", "symbol", "session-id", "release-sha", "start-sequence", "max-cycles", "max-packet-bytes", "max-bars-per-interval", "lease-duration-ms"]);
  check(args.filter(arg => arg === "--durable-noncapital").length === 1, "INVALID_NONCAPITAL_FLAGS");
  for (const arg of args) {
    if (arg === "--" || arg === "--durable-noncapital") continue;
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    check(match && allowed.has(match[1]!) && !flags.has(match[1]!), "INVALID_NONCAPITAL_FLAGS");
    flags.set(match[1]!, match[2]!);
  }
  check(flags.size === allowed.size, "INVALID_NONCAPITAL_FLAGS");
  const numeric = (key: string) => { const value = flags.get(key)!; check(/^(0|[1-9][0-9]*)$/.test(value), "INVALID_NONCAPITAL_FLAGS"); return Number(value); };
  const input = { organizationId: flags.get("org-id")!, accountId: flags.get("account-key")!, symbol: flags.get("symbol")!,
    sessionId: flags.get("session-id")!, releaseSha: flags.get("release-sha")!, startSequence: numeric("start-sequence"),
    maxCycles: numeric("max-cycles"), maxPacketBytes: numeric("max-packet-bytes"), maxBarsPerInterval: numeric("max-bars-per-interval"),
    leaseDurationMs: numeric("lease-duration-ms") };
  captureRecordedLoop(input); return input;
}
