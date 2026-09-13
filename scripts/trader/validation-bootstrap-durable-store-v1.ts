import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  assertDeclaredHistoricalRunTupleMatchV1,
  assertDeclaredHistoricalRunTupleV1,
  assertValidationBootstrapSealedRangeRecordV1,
  durableRangeIdentityKeyV1,
  refuseNativeBootstrapLedgerAdmissionV1,
  type DeclaredHistoricalRunTupleV1,
  type ValidationBootstrapDurableRangeIdentityV1,
  type ValidationBootstrapDurableStoreV1,
  type ValidationBootstrapSealedRangeRecordV1,
} from "../../lib/trader/research/benchmark/validation-bootstrap-durable-v1";

const FORMAT = "waia-validation-bootstrap-durable-store/v1";
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024;

function fail(reason: string): never {
  throw new Error(`VALIDATION_BOOTSTRAP_DURABLE_REFUSED:${reason}`);
}

function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeNew(path: string, bytes: Buffer | string) {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function privatePath(path: string, directory: boolean) {
  const st = lstatSync(path);
  if (
    st.isSymbolicLink() ||
    (directory ? !st.isDirectory() : !st.isFile()) ||
    (st.mode & 0o077) !== 0 ||
    (process.getuid && st.uid !== process.getuid())
  )
    fail("PRIVATE_PATH");
  return st;
}

function readBounded(path: string, max: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid()))
      fail("PRIVATE_PATH");
    if (st.size > max) fail("SIZE");
    const result = readFileSync(fd);
    if (result.length > max) fail("SIZE");
    return result;
  } finally {
    closeSync(fd);
  }
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createValidationBootstrapDurableStoreV1(
  root: string,
  declaredTuple: DeclaredHistoricalRunTupleV1,
): ValidationBootstrapDurableStoreV1 {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") fail("NODE_CLI");
  const bound = assertDeclaredHistoricalRunTupleV1(declaredTuple);
  if (!isAbsolute(root) || resolve(root) === "/") fail("CONFIG");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  privatePath(root, true);
  if (realpathSync(root) !== resolve(root)) fail("ROOT_SYMLINK");
  const keyPath = join(root, ".seal-key");
  if (!existsSync(keyPath)) {
    try {
      writeNew(keyPath, randomBytes(32));
      syncDirectory(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const secret = readBounded(keyPath, 32);
  if (secret.length !== 32) fail("SEAL_KEY");
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");
  const readEnvelope = (path: string): unknown => {
    const envelope = JSON.parse(readBounded(path, MAX_BYTES).toString("utf8")) as {
      body?: string;
      signature?: string;
    };
    if (
      typeof envelope.body !== "string" ||
      !HEX.test(envelope.signature ?? "") ||
      sign(envelope.body) !== envelope.signature
    )
      fail("SEAL");
    return JSON.parse(envelope.body);
  };
  const publish = (partial: string, target: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    writeNew(join(partial, "seal.json"), JSON.stringify({ body, signature: sign(body) }));
    syncDirectory(partial);
    renameSync(partial, target);
    syncDirectory(root);
  };
  const tuplePath = join(root, "declared-tuple");
  if (existsSync(tuplePath)) {
    const stored = readEnvelope(join(tuplePath, "seal.json")) as {
      format?: string;
      declaredTuple?: DeclaredHistoricalRunTupleV1;
    };
    if (stored.format !== FORMAT || !stored.declaredTuple) fail("TUPLE_IDENTITY");
    assertDeclaredHistoricalRunTupleMatchV1(stored.declaredTuple, bound);
  } else {
    const partial = mkdtempSync(join(root, "declared-tuple.partial-"));
    publish(partial, tuplePath, { format: FORMAT, declaredTuple: bound });
  }
  const loadRecord = (dir: string, key: string): ValidationBootstrapSealedRangeRecordV1 => {
    privatePath(dir, true);
    const payload = readEnvelope(join(dir, "seal.json")) as {
      format?: string;
      key?: string;
      payloadDigest?: string;
      record?: ValidationBootstrapSealedRangeRecordV1;
    };
    if (
      payload.format !== FORMAT ||
      payload.key !== key ||
      !HEX.test(payload.payloadDigest ?? "") ||
      !payload.record
    )
      fail("IDENTITY");
    const recordBytes = Buffer.from(JSON.stringify(payload.record));
    if (hash(recordBytes) !== payload.payloadDigest) fail("PAYLOAD");
    refuseNativeBootstrapLedgerAdmissionV1(payload.record);
    return assertValidationBootstrapSealedRangeRecordV1(payload.record);
  };
  return {
    declaredTuple: () => bound,
    bindRequestTuple(tuple) {
      assertDeclaredHistoricalRunTupleMatchV1(bound, tuple);
    },
    loadSealedRange(identity) {
      const key = durableRangeIdentityKeyV1(identity);
      const target = join(root, key);
      if (!existsSync(target)) return null;
      return loadRecord(target, key);
    },
    sealRange(record) {
      const sealed = assertValidationBootstrapSealedRangeRecordV1(record);
      assertDeclaredHistoricalRunTupleMatchV1(bound, sealed.declaredTuple);
      refuseNativeBootstrapLedgerAdmissionV1(sealed);
      const key = durableRangeIdentityKeyV1(
        {
          declaredTuple: sealed.declaredTuple,
          surface: sealed.surface,
          baseline: sealed.baseline,
          trialIdentityDigestHex: sealed.trialIdentityDigestHex,
          inputDigestHex: sealed.inputDigestHex,
          rootSeedHex: sealed.rootSeedHex,
          start: sealed.start,
          endExclusive: sealed.endExclusive,
        },
        sealed.schedulerIdentity,
      );
      const target = join(root, key);
      if (existsSync(target)) fail("DUPLICATE");
      const payloadDigest = hash(Buffer.from(JSON.stringify(sealed)));
      const partial = mkdtempSync(join(root, `${key}.partial-`));
      publish(partial, target, { format: FORMAT, key, payloadDigest, record: sealed });
    },
    listSealedRanges(
      identity: Omit<ValidationBootstrapDurableRangeIdentityV1, "start" | "endExclusive">,
    ) {
      const sealed: ValidationBootstrapSealedRangeRecordV1[] = [];
      for (const name of readdirSync(root)) {
        if (!HEX.test(name) || name.includes(".partial-")) continue;
        const dir = join(root, name);
        if (!lstatSync(dir).isDirectory()) continue;
        const record = loadRecord(dir, name);
        if (
          record.surface === identity.surface &&
          record.baseline === identity.baseline &&
          record.trialIdentityDigestHex === identity.trialIdentityDigestHex &&
          record.inputDigestHex === identity.inputDigestHex &&
          record.rootSeedHex === identity.rootSeedHex &&
          record.declaredTuple.organizationId === identity.declaredTuple.organizationId &&
          record.declaredTuple.runId === identity.declaredTuple.runId &&
          record.declaredTuple.releaseSha === identity.declaredTuple.releaseSha
        ) {
          sealed.push(record);
        }
      }
      return sealed;
    },
  };
}
