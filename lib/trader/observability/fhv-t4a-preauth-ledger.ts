/**
 * DEE-436 — auditable PRE_AUTH SSH command ledger (read-only allowlist).
 */

export type FhvT4aPreauthCommandClassification = "read-only" | "mutating" | "rejected";

export type FhvT4aPreauthLedgerEntry = Readonly<{
  remoteCommand: string;
  classification: FhvT4aPreauthCommandClassification;
  reason: string;
}>;

const MUTATING_PATTERNS = [
  />\s/,
  />>/,
  /\|\s/,
  /\btee\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsystemctl (start|stop|restart|enable|disable|daemon-reload)\b/,
  /\binstall-units\.sh.*--confirm/,
];

const READ_ONLY_PATTERNS = [
  /^bash -s --/,
  /^test /,
  /^sudo -n true$/,
  /fhv-validate-origin-url/,
  /fhv-t4-host-preflight/,
  /is-active/,
  /is-enabled/,
  /cat /,
  /sha256sum/,
];

export function classifyFhvT4aPreauthRemoteCommand(
  remoteCommand: string,
  hasStdinBootstrap: boolean,
): FhvT4aPreauthLedgerEntry {
  const trimmed = remoteCommand.trim();
  for (const pattern of MUTATING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        remoteCommand: trimmed,
        classification: "rejected",
        reason: `mutating pattern: ${pattern}`,
      };
    }
  }
  if (hasStdinBootstrap && /^bash -s --/.test(trimmed)) {
    return {
      remoteCommand: trimmed,
      classification: "read-only",
      reason: "committed bootstrap stdin stream",
    };
  }
  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        remoteCommand: trimmed,
        classification: "read-only",
        reason: `read-only pattern: ${pattern}`,
      };
    }
  }
  return {
    remoteCommand: trimmed,
    classification: "rejected",
    reason: "command not on PRE_AUTH allowlist",
  };
}

export function createFhvT4aPreauthLedger(): {
  entries: () => readonly FhvT4aPreauthLedgerEntry[];
  record: (entry: FhvT4aPreauthLedgerEntry) => void;
  rejectedCount: () => number;
  measuredRemoteWriteCount: () => number;
} {
  const ledger: FhvT4aPreauthLedgerEntry[] = [];
  let measuredWrites = 0;
  return {
    entries: () => ledger,
    record: (entry) => {
      ledger.push(entry);
      if (entry.classification === "mutating") {
        measuredWrites += 1;
      }
    },
    rejectedCount: () => ledger.filter((entry) => entry.classification === "rejected").length,
    measuredRemoteWriteCount: () => measuredWrites,
  };
}
