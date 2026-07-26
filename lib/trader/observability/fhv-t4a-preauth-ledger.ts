/**
 * DEE-436 — auditable PRE_AUTH SSH command ledger (read-only allowlist).
 */

import { createHash } from "node:crypto";

export type FhvT4aPreauthCommandClassification = "read-only" | "mutating" | "rejected";
export type FhvT4aPreauthPrivilegeLocus = "SSH_USER" | "REMOTE_ROOT" | "SERVICE_USER";

export type FhvT4aPreauthLedgerEntry = Readonly<{
  sequence: number;
  bootstrapRepositoryPath: string | null;
  bootstrapBlobSha256: string | null;
  originalRemoteCommand: string;
  effectiveRemoteCommand: string;
  privilegeLocus: FhvT4aPreauthPrivilegeLocus;
  stdinPresent: boolean;
  classification: FhvT4aPreauthCommandClassification;
  classificationReason: string;
  exitStatus: number;
  stdoutDigest: string;
  stderrDigest: string;
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

const PREAUTH_BOOTSTRAP_ALLOWLIST = new Set([
  "scripts/ops/fhv-validate-origin-url.sh",
  "scripts/ops/fhv-t4-host-preflight.sh",
]);

const PREAUTH_FORBIDDEN_BOOTSTRAP_PATTERNS = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\btee\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /systemctl (start|stop|restart|enable|disable|daemon-reload)/,
  />\s/,
  />>/,
];

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function auditPreauthBootstrapBody(
  repositoryPath: string,
  body: string,
): { classification: FhvT4aPreauthCommandClassification; reason: string } {
  if (!PREAUTH_BOOTSTRAP_ALLOWLIST.has(repositoryPath)) {
    return {
      classification: "rejected",
      reason: `bootstrap path not allowlisted: ${repositoryPath}`,
    };
  }
  for (const pattern of PREAUTH_FORBIDDEN_BOOTSTRAP_PATTERNS) {
    if (pattern.test(body)) {
      return {
        classification: "rejected",
        reason: `forbidden bootstrap mutation surface: ${pattern}`,
      };
    }
  }
  return { classification: "read-only", reason: "audited committed bootstrap body" };
}

export function classifyFhvT4aPreauthRemoteCommand(input: {
  remoteCommand: string;
  hasStdinBootstrap: boolean;
  bootstrapRepositoryPath?: string | null;
  bootstrapBody?: string | null;
}): Omit<
  FhvT4aPreauthLedgerEntry,
  | "sequence"
  | "effectiveRemoteCommand"
  | "privilegeLocus"
  | "exitStatus"
  | "stdoutDigest"
  | "stderrDigest"
> {
  const trimmed = input.remoteCommand.trim();
  for (const pattern of MUTATING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        bootstrapRepositoryPath: input.bootstrapRepositoryPath ?? null,
        bootstrapBlobSha256: input.bootstrapBody ? sha256Hex(input.bootstrapBody) : null,
        originalRemoteCommand: trimmed,
        stdinPresent: input.hasStdinBootstrap,
        classification: "rejected",
        classificationReason: `mutating pattern: ${pattern}`,
      };
    }
  }
  if (input.hasStdinBootstrap && /^bash -s --/.test(trimmed)) {
    if (!input.bootstrapRepositoryPath || !input.bootstrapBody) {
      return {
        bootstrapRepositoryPath: input.bootstrapRepositoryPath ?? null,
        bootstrapBlobSha256: null,
        originalRemoteCommand: trimmed,
        stdinPresent: true,
        classification: "rejected",
        classificationReason: "stdin bootstrap missing repository binding",
      };
    }
    const audit = auditPreauthBootstrapBody(input.bootstrapRepositoryPath, input.bootstrapBody);
    return {
      bootstrapRepositoryPath: input.bootstrapRepositoryPath,
      bootstrapBlobSha256: sha256Hex(input.bootstrapBody),
      originalRemoteCommand: trimmed,
      stdinPresent: true,
      classification: audit.classification,
      classificationReason: audit.reason,
    };
  }
  if (/^test /.test(trimmed) || /^sudo -n test /.test(trimmed) || /^sudo -n true$/.test(trimmed)) {
    return {
      bootstrapRepositoryPath: null,
      bootstrapBlobSha256: null,
      originalRemoteCommand: trimmed,
      stdinPresent: false,
      classification: "read-only",
      classificationReason: "explicit read-only test probe",
    };
  }
  return {
    bootstrapRepositoryPath: input.bootstrapRepositoryPath ?? null,
    bootstrapBlobSha256: input.bootstrapBody ? sha256Hex(input.bootstrapBody) : null,
    originalRemoteCommand: trimmed,
    stdinPresent: input.hasStdinBootstrap,
    classification: "rejected",
    classificationReason: "command not on PRE_AUTH allowlist",
  };
}

export function createFhvT4aPreauthLedger(): {
  entries: () => readonly FhvT4aPreauthLedgerEntry[];
  record: (entry: FhvT4aPreauthLedgerEntry) => void;
  rejectedCount: () => number;
  mutatingCommandCount: () => number;
} {
  const ledger: FhvT4aPreauthLedgerEntry[] = [];
  return {
    entries: () => ledger,
    record: (entry) => {
      ledger.push(entry);
    },
    rejectedCount: () => ledger.filter((entry) => entry.classification === "rejected").length,
    mutatingCommandCount: () =>
      ledger.filter((entry) => entry.classification === "mutating").length,
  };
}

export function fhvT4aPreauthLedgerEntryDigest(entry: FhvT4aPreauthLedgerEntry): string {
  return sha256Hex(JSON.stringify(entry));
}
