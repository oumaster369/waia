/**
 * DEE-436 — explicit remote filesystem operations (bound Python, privilege locus).
 */

export type FhvT4aRemoteFsPrivilegeLocus = "SSH_USER" | "REMOTE_ROOT" | "SERVICE_USER";

export type FhvT4aRemoteFsReadOperation = Readonly<{
  remotePath: string;
  approvedRoots: readonly string[];
  locus: FhvT4aRemoteFsPrivilegeLocus;
  pythonBin: string;
  byteCap: number;
}>;

export type FhvT4aRemoteFsSha256Operation = Readonly<{
  remotePath: string;
  approvedRoots: readonly string[];
  locus: FhvT4aRemoteFsPrivilegeLocus;
  pythonBin: string;
}>;

export type FhvT4aRemoteFsExistsOperation = Readonly<{
  remotePath: string;
  approvedRoots: readonly string[];
  locus: FhvT4aRemoteFsPrivilegeLocus;
  pythonBin: string;
}>;

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

function buildRemoteFsPythonPayload(
  mode: "read" | "sha256" | "exists",
  op: { remotePath: string; approvedRoots: readonly string[]; byteCap?: number },
): string {
  return `${JSON.stringify({
    mode,
    remotePath: op.remotePath,
    approvedRoots: op.approvedRoots,
    byteCap: op.byteCap ?? 0,
  })}`;
}

export function buildRemoteFsPythonCommand(pythonBin: string, payloadJson: string): string {
  assertAbsoluteExecutable("pythonBin", pythonBin);
  return `${shellQuote(pythonBin)} -c ${shellQuote(`import hashlib,json,os,sys
payload=json.loads(${JSON.stringify(payloadJson)})
path=payload["remotePath"]
roots=payload["approvedRoots"]
cap=int(payload.get("byteCap") or 0)
mode=payload["mode"]
def approved(p):
    for root in roots:
        if p==root or p.startswith(root.rstrip("/")+"/"):
            return True
    return False
if not approved(path):
    print(json.dumps({"error":"PATH_OUTSIDE_APPROVED_ROOT","path":path}), file=sys.stderr)
    sys.exit(3)
if not os.path.lexists(path):
    print(json.dumps({"error":"PATH_MISSING","path":path}), file=sys.stderr)
    sys.exit(4)
if os.path.islink(path):
    print(json.dumps({"error":"SYMLINK_ESCAPE","path":path}), file=sys.stderr)
    sys.exit(5)
if not os.path.isfile(path):
    print(json.dumps({"error":"NOT_REGULAR_FILE","path":path}), file=sys.stderr)
    sys.exit(6)
if mode=="exists":
    print(json.dumps({"exists":True}))
    sys.exit(0)
data=open(path,"rb").read() if mode=="read" else open(path,"rb").read()
if mode=="read" and len(data)>cap:
    print(json.dumps({"error":"BYTE_CAP_EXCEEDED","size":len(data),"cap":cap}), file=sys.stderr)
    sys.exit(7)
digest=hashlib.sha256(data).hexdigest()
if mode=="sha256":
    print(json.dumps({"sha256":digest,"size":len(data)}))
else:
    print(json.dumps({"bytes":data.decode("utf-8","replace"),"sha256":digest,"size":len(data)}))
`)}`;
}

export function buildRemoteFsReadCommand(op: FhvT4aRemoteFsReadOperation): string {
  assertAbsoluteExecutable("pythonBin", op.pythonBin);
  const payload = buildRemoteFsPythonPayload("read", op);
  return buildRemoteFsPythonCommand(op.pythonBin, payload);
}

export function buildRemoteFsSha256Command(op: FhvT4aRemoteFsSha256Operation): string {
  assertAbsoluteExecutable("pythonBin", op.pythonBin);
  const payload = buildRemoteFsPythonPayload("sha256", op);
  return buildRemoteFsPythonCommand(op.pythonBin, payload);
}

export function buildRemoteFsExistsCommand(op: FhvT4aRemoteFsExistsOperation): string {
  assertAbsoluteExecutable("pythonBin", op.pythonBin);
  const payload = buildRemoteFsPythonPayload("exists", op);
  return buildRemoteFsPythonCommand(op.pythonBin, payload);
}

export function parseRemoteFsReadStdout(stdout: string, byteCap: number): FhvT4aRemoteFsReadResult {
  const parsed = JSON.parse(stdout.trim()) as {
    bytes?: string;
    sha256?: string;
    size?: number;
    error?: string;
  };
  if (parsed.error) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_READ_FAILED", parsed.error);
  }
  if (typeof parsed.bytes !== "string" || typeof parsed.sha256 !== "string") {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_RESPONSE", "read response malformed.");
  }
  if (!SHA256_HEX_PATTERN.test(parsed.sha256)) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_MALFORMED_DIGEST", "digest malformed.");
  }
  if (parsed.bytes.length >= byteCap) {
    throw new FhvT4aRemoteFsOpsError("REMOTE_FS_BYTE_CAP_EXCEEDED", "byte cap exceeded.");
  }
  return { bytes: parsed.bytes, sha256: parsed.sha256, size: parsed.size ?? parsed.bytes.length };
}

export function parseRemoteFsSha256Stdout(stdout: string): string {
  const parsed = JSON.parse(stdout.trim()) as { sha256?: string; error?: string };
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
  const parsed = JSON.parse(stdout.trim()) as { exists?: boolean; error?: string };
  if (parsed.error) {
    return false;
  }
  return parsed.exists === true;
}
