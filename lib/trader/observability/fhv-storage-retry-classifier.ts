import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

/** WP-FHV-STORAGE retry taxonomy — semantic failures never auto-retry; ENOSPC is fail-closed. */
export const FHV_STORAGE_RETRY_CLASSIFICATIONS = [
  "RETRY_TRANSIENT",
  "NO_RETRY_SEMANTIC",
  "ENOSPC_FAIL_CLOSED",
  "NATIVE_CLONE_UNAVAILABLE",
] as const;

export type FhvStorageRetryClassification = (typeof FHV_STORAGE_RETRY_CLASSIFICATIONS)[number];

export type FhvStorageRetryDecisionV1 = Readonly<{
  classification: FhvStorageRetryClassification;
  retryAllowed: boolean;
  failClosed: boolean;
  code: string;
  detail: string;
}>;

const TRANSIENT_ERRNO_CODES = new Set(["EAGAIN", "EBUSY", "ETIMEDOUT", "ECONNRESET", "EINTR"]);

const SEMANTIC_ERRNO_CODES = new Set([
  "EEXIST",
  "EISDIR",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EINVAL",
  "EBADF",
  "ENOENT",
]);

function resolveErrnoCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : null;
}

function resolveErrnoMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyFhvStorageIoError(error: unknown): FhvStorageRetryDecisionV1 {
  const code = resolveErrnoCode(error);
  const detail = resolveErrnoMessage(error);

  if (code === "ENOSPC") {
    return {
      classification: "ENOSPC_FAIL_CLOSED",
      retryAllowed: false,
      failClosed: true,
      code: "ENOSPC_FAIL_CLOSED",
      detail,
    };
  }

  if (code && TRANSIENT_ERRNO_CODES.has(code)) {
    return {
      classification: "RETRY_TRANSIENT",
      retryAllowed: true,
      failClosed: false,
      code,
      detail,
    };
  }

  if (code && SEMANTIC_ERRNO_CODES.has(code)) {
    return {
      classification: "NO_RETRY_SEMANTIC",
      retryAllowed: false,
      failClosed: true,
      code,
      detail,
    };
  }

  if (/digest mismatch|claim digest|semantic|integrity|invalid/i.test(detail)) {
    return {
      classification: "NO_RETRY_SEMANTIC",
      retryAllowed: false,
      failClosed: true,
      code: code ?? "NO_RETRY_SEMANTIC",
      detail,
    };
  }

  return {
    classification: "NO_RETRY_SEMANTIC",
    retryAllowed: false,
    failClosed: true,
    code: code ?? "NO_RETRY_SEMANTIC",
    detail,
  };
}

export function classifyFhvNativeCloneUnavailable(detail: string): FhvStorageRetryDecisionV1 {
  return {
    classification: "NATIVE_CLONE_UNAVAILABLE",
    retryAllowed: false,
    failClosed: false,
    code: "NATIVE_CLONE_UNAVAILABLE",
    detail,
  };
}

export function assertFhvStorageNotFailClosed(decision: FhvStorageRetryDecisionV1): void {
  if (decision.failClosed) {
    throw new Error(`${decision.code}: ${decision.detail}`);
  }
}
