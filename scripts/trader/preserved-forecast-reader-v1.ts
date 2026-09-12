import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "./scientific-checkpoint-key-v1";

const refuse = (reason: string): never => { throw new Error(`PRESERVED_FORECAST_READ_REFUSED:${reason}`); };
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function privateDirectory(path: string): void {
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 ||
      (process.getuid && st.uid !== process.getuid())) refuse("PRIVATE_DIRECTORY");
  if (realpathSync(path) !== resolve(path)) refuse("SYMLINK");
}
function readPrivate(path: string, limit: number): Buffer {
  // A FIFO must not block open before fstat can refuse the non-regular file.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0 ||
        (process.getuid && before.uid !== process.getuid())) refuse("PRIVATE_FILE");
    if (before.size > limit) refuse("SIZE");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(fd);
    if (length !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) refuse("CHANGED_DURING_READ");
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

/** Existing-store read ONLY. No store factory, mkdir, key creation, deserialize,
 * builder or fallback; no production caller. Missing is not scientific failure.
 * Caller must independently reconstruct expected original input/provenance.
 */
export function readPreservedForecastEvidenceV1(root: string, expected: ExpectedScientificCheckpointV1) {
  if (!isAbsolute(root) || resolve(root) === "/") refuse("ROOT");
  const key = deriveScientificCheckpointKeyV1(expected);
  if (expected.kind !== "evidence" || expected.stage !== "wf-forecast-batch-v1") refuse("STAGE");
  privateDirectory(root);
  const secret = readPrivate(join(root, ".seal-key"), 32);
  try {
    if (secret.length !== 32) refuse("SEAL_KEY");
    const directory = join(root, key);
    try { privateDirectory(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { status: "MISSING" as const, key, authorityGranted: false as const, generationPermitted: false as const };
      throw error;
    }
    let envelope: {body?: unknown; signature?: unknown};
    try { envelope = JSON.parse(readPrivate(join(directory, "seal.json"), 16384).toString("utf8")); }
    catch { return refuse("SEAL_ENVELOPE"); }
    if (!envelope || typeof envelope.body !== "string" || !hex(envelope.signature)) return refuse("SEAL_ENVELOPE");
    const signature = createHmac("sha256", secret).update(envelope.body).digest();
    if (!timingSafeEqual(signature, Buffer.from(envelope.signature, "hex"))) refuse("SEAL_AUTHENTICATION");
    let seal: {format?: unknown; kind?: unknown; key?: unknown; payloadDigest?: unknown};
    try { seal = JSON.parse(envelope.body); } catch { return refuse("SEAL_BODY"); }
    if (!seal || seal.format !== "waia-scientific-checkpoint/v1" || seal.kind !== "evidence" ||
        seal.key !== key || !hex(seal.payloadDigest)) return refuse("SEAL_IDENTITY");
    const payload = readPrivate(join(directory, "evidence.bin"), 65536);
    if (createHash("sha256").update(payload).digest("hex") !== seal.payloadDigest) refuse("PAYLOAD");
    return { status: "AUTHENTICATED_BYTES_NOT_ADMISSION" as const, key, payload,
      payloadDigestHex: seal.payloadDigest, authorityGranted: false as const, generationPermitted: false as const };
  } finally { secret.fill(0); }
}
