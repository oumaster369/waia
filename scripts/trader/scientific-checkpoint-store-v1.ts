import { createHash, createHmac, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { PackageBuildInputV1, ScientificCheckpointStoreV1 } from
  "../../lib/trader/historical-simulation-v2/scientific-checkpoint-context-v1";
import { hydratePredictivePackageV1, streamEncodePredictivePackageV1,
  type PredictivePackageManifestV1 } from
  "../../lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import type { PredictivePackageV1 } from
  "../../lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

const FORMAT = "waia-scientific-checkpoint/v1";
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
function fail(reason: string): never { throw new Error(`SCIENTIFIC_CHECKPOINT_REFUSED:${reason}`); }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeNew(path: string, bytes: Buffer | string) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function privatePath(path: string, directory: boolean) {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile()) ||
      (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) fail("PRIVATE_PATH");
  return st;
}
function readBounded(path: string, max: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0 ||
        (process.getuid && st.uid !== process.getuid())) fail("PRIVATE_PATH");
    if (st.size > max) fail("SIZE");
    const result = readFileSync(fd);
    if (result.length > max) fail("SIZE");
    return result;
  } finally { closeSync(fd); }
}

/** Hash the actual input, not only a claimed dataset digest. No whole-corpus stringify. */
function inputDigest(value: unknown): string {
  const h = createHash("sha256");
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      h.update(`array:${v.length}[`); for (const item of v) visit(item); h.update("]"); return;
    }
    if (v !== null && typeof v === "object" && !Buffer.isBuffer(v)) {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail("INPUT_TYPE");
      const keys = Object.keys(v).sort(); h.update(`object:${keys.length}{`);
      for (const key of keys) { visit(key); visit((v as Record<string, unknown>)[key]); }
      h.update("}"); return;
    }
    // V8's internal SMI/heap-number representation can change after hydration.
    // Canonical IEEE-754 bytes preserve values (including -0), not VM internals.
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail("INPUT_NUMBER");
      const bytes = Buffer.alloc(8); bytes.writeDoubleBE(v); h.update("number:").update(bytes); return;
    }
    if (Buffer.isBuffer(v)) { h.update(`buffer:${v.length}:`).update(v); return; }
    if (typeof v === "string") { const bytes = Buffer.from(v); h.update(`string:${bytes.length}:`).update(bytes); return; }
    if (v === null || v === undefined || typeof v === "boolean") { h.update(`${typeof v}:${String(v)};`); return; }
    fail("INPUT_TYPE");
  };
  visit(value); return h.digest("hex");
}
type Seal = { format: typeof FORMAT; key: string; kind: "package" | "evidence";
  payloadDigest: string; manifestFileDigest?: string;
  packageIdentity?: { organizationId: string; generationDigestHex: string; contentDigestHex: string } };

/** Private execution-host cache. HMAC protects seals from payload/manifest edits.
 * The local signing key is NOT an exchange credential, and is never logged/exported.
 * Completed directory is published only after every payload + seal was fsynced.
 * Incomplete .partial directories are retained as evidence, never admitted as hits.
 * Cache files are computation artifacts only; all final SQL admission checks still run.
 */
export function createScientificCheckpointStoreV1(root: string, releaseSha: string): ScientificCheckpointStoreV1 {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") fail("NODE_CLI");
  if (!isAbsolute(root) || resolve(root) === "/" || !/^[a-f0-9]{40}$/.test(releaseSha)) fail("CONFIG");
  mkdirSync(root, { recursive: true, mode: 0o700 }); privatePath(root, true);
  if (realpathSync(root) !== resolve(root)) fail("ROOT_SYMLINK");
  const keyPath = join(root, ".seal-key");
  if (!existsSync(keyPath)) {
    try { writeNew(keyPath, randomBytes(32)); syncDirectory(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const secret = readBounded(keyPath, 32); if (secret.length !== 32) fail("SEAL_KEY");
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");
  const identity = (stage: string, input: unknown) => inputDigest({ format: FORMAT, releaseSha,
    runtime: { node: process.version, os: process.platform, arch: process.arch }, stage, input });
  const readSeal = (dir: string, key: string, kind: Seal["kind"]): Seal => {
    privatePath(dir, true);
    const envelope = JSON.parse(readBounded(join(dir, "seal.json"), MAX_METADATA_BYTES).toString("utf8")) as
      { body: string; signature: string };
    if (typeof envelope.body !== "string" || !HEX.test(envelope.signature) || sign(envelope.body) !== envelope.signature) fail("SEAL");
    const seal = JSON.parse(envelope.body) as Seal;
    if (seal.format !== FORMAT || seal.key !== key || seal.kind !== kind || !HEX.test(seal.payloadDigest)) fail("IDENTITY");
    return seal;
  };
  const publish = (partial: string, target: string, seal: Seal) => {
    const body = JSON.stringify(seal);
    if (Buffer.byteLength(body) > MAX_METADATA_BYTES / 2) fail("SEAL_SIZE");
    writeNew(join(partial, "seal.json"), JSON.stringify({ body, signature: sign(body) }));
    syncDirectory(partial);
    // Never overwrite a concurrent winner. Caller retries only by loading and validating it.
    renameSync(partial, target); syncDirectory(root);
  };
  const loadEvidence = <T>(target: string, key: string): T => {
    const seal = readSeal(target, key, "evidence");
    const bytes = readBounded(join(target, "evidence.bin"), MAX_EVIDENCE_BYTES);
    if (hash(bytes) !== seal.payloadDigest) fail("PAYLOAD");
    return deserialize(bytes) as T;
  };
  const saveEvidence = <T>(target: string, key: string, result: T): T => {
    const bytes = serialize(result);
    if (bytes.length > MAX_EVIDENCE_BYTES) fail("EVIDENCE_SIZE");
    const partial = mkdtempSync(join(root, `${key}.partial-`));
    writeNew(join(partial, "evidence.bin"), bytes);
    publish(partial, target, { format: FORMAT, kind: "evidence", key, payloadDigest: hash(bytes) });
    return result;
  };
  return {
    package(input: PackageBuildInputV1, build: () => PredictivePackageV1): PredictivePackageV1 {
      if (input.family.codeReleaseSha !== releaseSha) fail("RELEASE_SCOPE");
      const key = identity("predictive-package", input), target = join(root, key);
      if (existsSync(target)) {
        const seal = readSeal(target, key, "package"), expected = seal.packageIdentity;
        if (!expected || expected.organizationId !== input.family.organizationId ||
            !HEX.test(seal.manifestFileDigest ?? "")) fail("PACKAGE_SCOPE");
        const manifestBytes = readBounded(join(target, "manifest.bin"), MAX_EVIDENCE_BYTES);
        if (hash(manifestBytes) !== seal.manifestFileDigest) fail("MANIFEST_PAYLOAD");
        const m = deserialize(manifestBytes) as PredictivePackageManifestV1;
        function* chunks() {
          for (let ordinal = 0; ordinal < m.chunks.length; ordinal++)
            yield readBounded(join(target, `${ordinal}.chunk`), 64 * 1024);
        }
        const pkg = hydratePredictivePackageV1(m, chunks(), { ...expected,
          manifestDigestHex: seal.payloadDigest });
        if (inputDigest(pkg.family) !== inputDigest(input.family)) fail("FAMILY_SCOPE");
        return pkg;
      }
      const pkg = build();
      const partial = mkdtempSync(join(root, `${key}.partial-`));
      const stream = streamEncodePredictivePackageV1(pkg); let ordinal = 0;
      for (;;) {
        const step = stream.next();
        if (step.done) {
          // Keep a full-corpus chunk inventory out of the JSON/HMAC envelope.
          // Binary metadata avoids a second escaped whole-manifest string.
          const manifestBytes = serialize(step.value);
          if (manifestBytes.length > MAX_EVIDENCE_BYTES) fail("MANIFEST_SIZE");
          writeNew(join(partial, "manifest.bin"), manifestBytes);
          publish(partial, target, { format: FORMAT, kind: "package", key,
            payloadDigest: step.value.manifestDigestHex, manifestFileDigest: hash(manifestBytes),
            packageIdentity: { organizationId: step.value.organizationId,
              generationDigestHex: step.value.generationDigestHex, contentDigestHex: step.value.contentDigestHex } });
          return pkg;
        }
        writeNew(join(partial, `${ordinal++}.chunk`), step.value);
      }
    },
    evidence<T>(stage: string, input: unknown, build: () => T): T {
      if (!/^[a-z0-9-]+$/.test(stage)) fail("STAGE");
      const key = identity(stage, input), target = join(root, key);
      return existsSync(target) ? loadEvidence<T>(target, key) : saveEvidence(target, key, build());
    },
    async evidenceAsync<T>(stage: string, input: unknown, build: () => Promise<T>): Promise<T> {
      if (!/^[a-z0-9-]+$/.test(stage)) fail("STAGE");
      const key = identity(stage, input), target = join(root, key);
      return existsSync(target) ? loadEvidence<T>(target, key) : saveEvidence(target, key, await build());
    },
  };
}
