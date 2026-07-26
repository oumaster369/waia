/**
 * DEE-436 — explicit remote filesystem operations (bound Python, privilege locus).
 */

import { createHash } from "node:crypto";

export type FhvT4aRemoteFsPrivilegeLocus = "SSH_USER" | "REMOTE_ROOT" | "SERVICE_USER";

export type FhvT4aRemoteFsOperationBase = Readonly<{
  remotePath: string;
  approvedRoots: readonly string[];
  locus: FhvT4aRemoteFsPrivilegeLocus;
  pythonBin: string;
  serviceUser?: string;
}>;

export type FhvT4aRemoteFsReadOperation = FhvT4aRemoteFsOperationBase &
  Readonly<{
    byteCap: number;
  }>;

export type FhvT4aRemoteFsSha256Operation = FhvT4aRemoteFsOperationBase;

export type FhvT4aRemoteFsExistsOperation = FhvT4aRemoteFsOperationBase;

export type FhvT4aRemoteFsReadResult = Readonly<{
  bytes: string;
  sha256: string;
  size: number;
}>;

export class FhvT4aRemoteFsOpsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aRemoteFsOpsError";
  }
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const REMOTE_FS_PYTHON_BODY = String.raw`import hashlib, json, os, sys
payload = json.loads(sys.argv[1])
path = payload["remotePath"]
roots = payload["approvedRoots"]
cap = int(payload.get("byteCap") or 0)
mode = payload["mode"]

def canonical_root(root):
    return os.path.realpath(root.rstrip("/") or root)

def canonical_target(p):
    return os.path.realpath(p)

def inside_root(target, root):
    root_c = canonical_root(root)
    target_c = canonical_target(target)
    if target_c == root_c:
        return True
    prefix = root_c + os.sep
    return target_c.startswith(prefix)

def resolve_regular_file(p):
    if not os.path.lexists(p):
        raise RuntimeError(json.dumps({"error": "PATH_MISSING", "path": p}))
    if os.path.islink(p):
        raise RuntimeError(json.dumps({"error": "SYMLINK_ESCAPE", "path": p}))
    for parent in [p] + [os.path.dirname(p)] * 32:
        if parent == os.path.dirname(parent):
            break
        if os.path.islink(parent):
            raise RuntimeError(json.dumps({"error": "PARENT_SYMLINK_ESCAPE", "path": parent}))
    real = os.path.realpath(p)
    if os.path.islink(real):
        raise RuntimeError(json.dumps({"error": "SYMLINK_ESCAPE", "path": real}))
    if not os.path.isfile(real):
        raise RuntimeError(json.dumps({"error": "NOT_REGULAR_FILE", "path": real}))
    approved = False
    for root in roots:
        if inside_root(real, root):
            approved = True
            break
    if not approved:
        raise RuntimeError(json.dumps({"error": "PATH_OUTSIDE_APPROVED_ROOT", "path": real}))
    return real

try:
    real_path = resolve_regular_file(path)
except RuntimeError as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(3)

if mode == "exists":
    print(json.dumps({"exists": True}))
    sys.exit(0)

if mode == "read":
    try:
        fd = os.open(real_path, os.O_RDONLY)
    except OSError as exc:
        print(json.dumps({"error": "READ_PERMISSION_FAILURE", "path": real_path, "errno": exc.errno}), file=sys.stderr)
        sys.exit(8)
    try:
        data = os.read(fd, cap + 1)
    finally:
        os.close(fd)
    if len(data) > cap:
        print(json.dumps({"error": "BYTE_CAP_EXCEEDED", "size": len(data), "cap": cap}), file=sys.stderr)
        sys.exit(7)
    digest = hashlib.sha256(data).hexdigest()
    print(json.dumps({"bytes": data.decode("utf-8", "replace"), "sha256": digest, "size": len(data)}))
    sys.exit(0)

if mode == "sha256":
    try:
        fd = os.open(real_path, os.O_RDONLY)
    except OSError as exc:
        print(json.dumps({"error": "READ_PERMISSION_FAILURE", "path": real_path, "errno": exc.errno}), file=sys.stderr)
        sys.exit(8)
    hasher = hashlib.sha256()
    total = 0
    try:
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            hasher.update(chunk)
            total += len(chunk)
    finally:
        os.close(fd)
    print(json.dumps({"sha256": hasher.hexdigest(), "size": total}))
    sys.exit(0)

print(json.dumps({"error": "MODE_INVALID", "mode": mode}), file=sys.stderr)
sys.exit(9)
`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertAbsoluteExecutable(label: string, value: string): void {
  if (!value.startsWith("/")) {
    throw new FhvT4aRemoteFsOpsError(
      "REMOTE_FS_BARE_PIPELINE_TOOL",
      `${label} must be an absolute path.`,
    );
  }
}

function assertRemoteFsOperationBase(op: FhvT4aRemoteFsOperationBase): void {
  assertAbsoluteExecutable("pythonBin", op.pythonBin);
  if (!op.remotePath.trim()) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_PATH_MISSING", "remotePath required.");
  }
  if (op.approvedRoots.length === 0) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_APPROVED_ROOTS_MISSING", "approvedRoots required.");
  }
  if (op.locus === "SERVICE_USER" && !op.serviceUser?.trim()) {
    throw new FhvT4aRemoteFsOpsError(
      "REMOTE_FS_PRIVILEGE_LOCUS_MISSING",
      "serviceUser required for SERVICE_USER locus.",
    );
  }
}

export function applyRemoteFsPrivilegeLocus(
  innerCommand: string,
  op: Pick<FhvT4aRemoteFsOperationBase, "locus" | "serviceUser">,
): string {
  const trimmed = innerCommand.trim();
  switch (op.locus) {
    case "SSH_USER":
      return trimmed;
    case "REMOTE_ROOT":
      if (/^sudo\s+-n\b/.test(trimmed)) {
        throw new FhvT4aRemoteFsOpsError(
          "REMOTE_FS_DOUBLE_SUDO",
          "REMOTE_ROOT command must not already include sudo -n.",
        );
      }
      return `sudo -n ${trimmed}`;
    case "SERVICE_USER": {
      const serviceUser = op.serviceUser?.trim();
      if (!serviceUser) {
        throw new FhvT4aRemoteFsOpsError(
          "REMOTE_FS_PRIVILEGE_LOCUS_MISSING",
          "serviceUser required for SERVICE_USER locus.",
        );
      }
      if (/^sudo\s+-n\b/.test(trimmed)) {
        throw new FhvT4aRemoteFsOpsError(
          "REMOTE_FS_DOUBLE_SUDO",
          "SERVICE_USER inner command must not include sudo -n.",
        );
      }
      return `sudo -n runuser -u ${shellQuote(serviceUser)} -- ${trimmed}`;
    }
    default:
      throw new FhvT4aRemoteFsOpsError(
        "REMOTE_FS_PRIVILEGE_LOCUS_MISSING",
        `Unknown privilege locus: ${String(op.locus)}`,
      );
  }
}

function buildRemoteFsPythonPayload(
  mode: "read" | "sha256" | "exists",
  op: { remotePath: string; approvedRoots: readonly string[]; byteCap?: number },
): string {
  return JSON.stringify({
    mode,
    remotePath: op.remotePath,
    approvedRoots: op.approvedRoots,
    byteCap: op.byteCap ?? 0,
  });
}

export function buildRemoteFsPythonCommand(pythonBin: string, payloadJson: string): string {
  assertAbsoluteExecutable("pythonBin", pythonBin);
  return `${shellQuote(pythonBin)} -c ${shellQuote(REMOTE_FS_PYTHON_BODY)} ${shellQuote(payloadJson)}`;
}

export function buildRemoteFsReadCommand(op: FhvT4aRemoteFsReadOperation): string {
  assertRemoteFsOperationBase(op);
  const inner = buildRemoteFsPythonCommand(op.pythonBin, buildRemoteFsPythonPayload("read", op));
  return applyRemoteFsPrivilegeLocus(inner, op);
}

export function buildRemoteFsSha256Command(op: FhvT4aRemoteFsSha256Operation): string {
  assertRemoteFsOperationBase(op);
  const inner = buildRemoteFsPythonCommand(op.pythonBin, buildRemoteFsPythonPayload("sha256", op));
  return applyRemoteFsPrivilegeLocus(inner, op);
}

export function buildRemoteFsExistsCommand(op: FhvT4aRemoteFsExistsOperation): string {
  assertRemoteFsOperationBase(op);
  const inner = buildRemoteFsPythonCommand(op.pythonBin, buildRemoteFsPythonPayload("exists", op));
  return applyRemoteFsPrivilegeLocus(inner, op);
}

export function parseRemoteFsReadStdout(stdout: string, byteCap: number): FhvT4aRemoteFsReadResult {
  let parsed: { bytes?: string; sha256?: string; size?: number; error?: string };
  try {
    parsed = JSON.parse(stdout.trim()) as typeof parsed;
  } catch {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_RESPONSE", "read response not JSON.");
  }
  if (parsed.error) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_READ_FAILED", parsed.error);
  }
  if (typeof parsed.bytes !== "string" || typeof parsed.sha256 !== "string") {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_RESPONSE", "read response malformed.");
  }
  if (!SHA256_HEX_PATTERN.test(parsed.sha256)) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_DIGEST", "digest malformed.");
  }
  const byteSize = Buffer.byteLength(parsed.bytes, "utf8");
  if (byteSize > byteCap) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_BYTE_CAP_EXCEEDED", "byte cap exceeded.");
  }
  const expectedDigest = createHash("sha256").update(parsed.bytes, "utf8").digest("hex");
  if (expectedDigest !== parsed.sha256) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_DIGEST", "read digest mismatch.");
  }
  return { bytes: parsed.bytes, sha256: parsed.sha256, size: parsed.size ?? byteSize };
}

export function parseRemoteFsSha256Stdout(stdout: string): string {
  let parsed: { sha256?: string; size?: number; error?: string };
  try {
    parsed = JSON.parse(stdout.trim()) as typeof parsed;
  } catch {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_RESPONSE", "sha256 response not JSON.");
  }
  if (parsed.error) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_SHA256_FAILED", parsed.error);
  }
  const digest = parsed.sha256?.trim().toLowerCase();
  if (!digest || !SHA256_HEX_PATTERN.test(digest)) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_DIGEST", "sha256 response malformed.");
  }
  return digest;
}

export function parseRemoteFsExistsStdout(stdout: string): boolean {
  let parsed: { exists?: boolean; error?: string };
  try {
    parsed = JSON.parse(stdout.trim()) as typeof parsed;
  } catch {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_RESPONSE", "exists response not JSON.");
  }
  if (parsed.error) {
    return false;
  }
  return parsed.exists === true;
}

export function buildDefaultRemoteFsOperation<
  T extends FhvT4aRemoteFsOperationBase & { byteCap?: number },
>(input: T): T {
  return {
    ...input,
    locus: input.locus ?? "REMOTE_ROOT",
    serviceUser: input.serviceUser,
  };
}
