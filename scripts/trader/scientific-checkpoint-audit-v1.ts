import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync,
  realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { deserialize } from "node:v8";
import { isDeepStrictEqual, types } from "node:util";
import { hydratePredictivePackageV1, validatePredictivePackageManifestV1, PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES,
  type PredictivePackageManifestV1 } from "../../lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "./scientific-checkpoint-key-v1";
import { projectScientificPackageHeaderV1 } from "./scientific-package-header-v1";
import { decodeScientificRecordV1 } from "./scientific-record-v1";
import { terminalRhFromOutcome13dV1 } from "../../lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import { computeReplicaRootFamilyIdentityDigest, computePredictivePackageGenerationIdentityDigest,
  computeRuntimeContractDigest, type ReplicaRootFamilyInput } from "../../lib/trader/intelligence/forecast-v2/identity-digests";

export type SavedForecastDiagnosticRowV1 = { anchorId: string; observedReturn: number; challengerProbabilities: number[] };

const FORMAT = "waia-scientific-checkpoint/v1";
const MAX_SEAL = 16 * 1024;
const MAX_BINARY = 64 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const isDigest = (value: unknown): value is string => typeof value === "string" && HEX.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

class AuditRefusal extends Error {
  constructor(reason: string) { super(`SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:${reason}`); }
}
function fail(reason: string): never { throw new AuditRefusal(reason); }
function privateStat(st: Stats, directory: boolean): Stats {
  if ((directory ? !st.isDirectory() : !st.isFile()) || (st.mode & 0o077) !== 0 ||
      (process.getuid && st.uid !== process.getuid())) fail("PRIVATE_PATH");
  return st;
}
function privatePath(path: string, directory: boolean): Stats {
  const st = lstatSync(path);
  if (st.isSymbolicLink() || realpathSync(path) !== resolve(path)) fail("SYMLINK");
  return privateStat(st, directory);
}
function unchanged(before: Stats, after: Stats): void {
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      before.mode !== after.mode || before.uid !== after.uid) fail("CHANGED_DURING_AUDIT");
}
function withFile<T>(path: string, max: number, read: (fd: number, size: number) => T): T {
  const before = privatePath(path, false);
  // NONBLOCK also prevents a substituted FIFO from blocking before fstat rejects it.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = privateStat(fstatSync(fd), false);
    unchanged(before, st);
    if (!Number.isSafeInteger(st.size) || st.size < 0 || st.size > max) fail("SIZE");
    const result = read(fd, st.size);
    unchanged(st, fstatSync(fd));
    unchanged(st, privatePath(path, false));
    return result;
  } finally { closeSync(fd); }
}
function readBounded(path: string, max: number): Buffer {
  return withFile(path, max, (fd, size) => {
    const bytes = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const count = readSync(fd, bytes, position, size - position, position);
      if (!count) fail("TRUNCATED");
      position += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, size)) fail("CHANGED_DURING_AUDIT");
    return bytes;
  });
}
function hashFile(path: string, expected: string): number {
  return withFile(path, MAX_BINARY, (fd, size) => {
    const buffer = Buffer.alloc(PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES), hash = createHash("sha256");
    let position = 0;
    while (position < size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!count) fail("TRUNCATED");
      hash.update(buffer.subarray(0, count)); position += count;
    }
    if (readSync(fd, buffer, 0, 1, size)) fail("CHANGED_DURING_AUDIT");
    if (hash.digest("hex") !== expected) fail("PAYLOAD");
    return size;
  });
}
function* names(path: string): Generator<string> {
  const before = privatePath(path, true), dir = opendirSync(path);
  try {
    for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) yield entry.name;
    unchanged(before, privatePath(path, true));
  } finally { dir.closeSync(); }
}
type Seal = { key: string; kind: "evidence" | "package"; payloadDigest: string;
  manifestFileDigest?: string;
  packageIdentity?: { organizationId: string; generationDigestHex: string; contentDigestHex: string } };
function readSeal(path: string, key: string, secret: Buffer): Seal {
  let envelope: unknown;
  try { envelope = JSON.parse(readBounded(path, MAX_SEAL).toString("utf8")); }
  catch (error) { if (error instanceof AuditRefusal) throw error; fail("SEAL"); }
  if (!object(envelope) || typeof envelope.body !== "string" || !isDigest(envelope.signature)) fail("SEAL");
  const expected = createHmac("sha256", secret).update(envelope.body).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, "hex"))) fail("SEAL");
  let seal: unknown;
  try { seal = JSON.parse(envelope.body); } catch { fail("SEAL"); }
  if (!object(seal) || seal.format !== FORMAT || seal.key !== key ||
      (seal.kind !== "evidence" && seal.kind !== "package") || !isDigest(seal.payloadDigest)) fail("IDENTITY");
  if (seal.kind === "package") {
    const identity = seal.packageIdentity;
    if (!isDigest(seal.manifestFileDigest) || !object(identity) ||
        typeof identity.organizationId !== "string" || !identity.organizationId.length ||
        !isDigest(identity.generationDigestHex) || !isDigest(identity.contentDigestHex)) fail("PACKAGE_IDENTITY");
  }
  return seal as Seal;
}

export type ScientificCheckpointAuditV1 = {
  integrity: "VERIFIED_COMPLETED_ENTRIES" | "NO_COMPLETED_ENTRIES";
  applicability: "NOT_ASSESSED";
  scientificValidity: "NOT_ASSESSED";
  computationCompleteness: "NOT_ASSESSED";
  completedEntries: number;
  evidenceEntries: number;
  packageEntries: number;
  partialEntries: number;
  chunks: number;
  payloadBytes: number;
};

/** Authorized diagnostic payload read, NOT cache admission. Source-prefix chunks
 * and each evidence payload authenticate BEFORE decoding. No replica hydration,
 * builders, forecast generation, bootstrap, writes or automatic recovery.
 * Returned data stays in-process; the scoring CLI only emits a sanitized summary.
 */
export function readScientificDiagnosticInputsV1(root: string, packageKey: string) {
  let secret: Buffer | undefined;
  try {
    if (process.env.WAIA_TRADER_CLI !== "1" || !isAbsolute(root) || resolve(root) === "/" || !HEX.test(packageKey)) fail("CONFIG");
    privatePath(root, true);
    secret = readBounded(join(root, ".seal-key"), 32);
    if (secret.length !== 32) fail("SEAL_KEY");
    const path = join(root, packageKey);
    privatePath(path, true);
    const seal = readSeal(join(path, "seal.json"), packageKey, secret);
    if (seal.kind !== "package") fail("PACKAGE_REQUIRED");
    const bytes = readBounded(join(path, "manifest.bin"), MAX_BINARY);
    if (createHash("sha256").update(bytes).digest("hex") !== seal.manifestFileDigest) fail("MANIFEST_PAYLOAD");
    const manifest = deserialize(bytes) as PredictivePackageManifestV1;
    validatePredictivePackageManifestV1(manifest, { ...seal.packageIdentity!, manifestDigestHex: seal.payloadDigest });
    if (manifest.sourceCount < 2 || manifest.sourceCount > 2_000_000) fail("SOURCE_LIMIT");
    let header: ReturnType<typeof projectScientificPackageHeaderV1> | undefined;
    const developmentReturns: number[] = [], historyMinuteOpenTimesMs: number[] = [];
    let sourceChunksRead = 0;
    for (const descriptor of manifest.chunks) {
      const chunk = readBounded(join(path, `${descriptor.ordinal}.chunk`), PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES);
      if (chunk.length !== descriptor.byteLength || chunk.length > manifest.chunkByteLimit ||
          createHash("sha256").update(chunk).digest("hex") !== descriptor.sha256) fail("CHUNK");
      const text = chunk.toString("utf8"), lines = text.split("\n");
      if (!Buffer.from(text).equals(chunk) || lines.pop() !== "" || lines.length !== descriptor.recordCount) fail("CHUNK_ENCODING");
      sourceChunksRead++;
      for (const line of lines) {
        if (!header) {
          header = projectScientificPackageHeaderV1(line);
          if (header.organizationId !== manifest.organizationId || header.contentDigestHex !== manifest.contentDigestHex ||
              header.generationDigestHex !== manifest.generationDigestHex || header.k !== manifest.replicaCount) fail("HEADER_IDENTITY");
          continue;
        }
        if (developmentReturns.length === manifest.sourceCount) break;
        const row = decodeScientificRecordV1(line);
        if (!Array.isArray(row) || row.length !== 2 || row[0] !== "anchor" || !object(row[1])) fail("SOURCE_RECORD");
        const a = row[1] as Record<string, unknown>, epoch = a.closedBarEpochMs;
        if (a.symbol !== header.symbol || a.venue !== "htx" || a.market !== "spot" || !isDigest(a.barContentDigest) ||
            typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0 ||
            (historyMinuteOpenTimesMs.length > 0 && epoch <= historyMinuteOpenTimesMs[historyMinuteOpenTimesMs.length - 1]!) ||
            !Array.isArray(a.outcome13d) || a.outcome13d.length !== 13 ||
            Array.from(a.outcome13d).some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))) fail("SOURCE_RECORD");
        developmentReturns.push(terminalRhFromOutcome13dV1(a.outcome13d));
        historyMinuteOpenTimesMs.push(epoch);
      }
      if (developmentReturns.length === manifest.sourceCount) break;
    }
    if (!header || developmentReturns.length !== manifest.sourceCount) fail("SOURCE_INCOMPLETE");
    const forecasts: SavedForecastDiagnosticRowV1[] = [], seen = new Set<string>();
    let forecastEntries = 0, otherEvidenceEntries = 0;
    const evidenceInventoryHash = createHash("sha256");
    // Sorted keys give a stable aggregate fingerprint independent of readdir order.
    for (const name of [...names(root)].sort()) {
      if (name === ".seal-key") continue;
      if (!HEX.test(name)) fail("UNEXPECTED_ENTRY");
      const entry = join(root, name), s = readSeal(join(entry, "seal.json"), name, secret);
      if (s.kind !== "evidence") continue;
      const payload = readBounded(join(entry, "evidence.bin"), MAX_BINARY);
      if (createHash("sha256").update(payload).digest("hex") !== s.payloadDigest) fail("PAYLOAD");
      const data: unknown = deserialize(payload);
      if (!Array.isArray(data) || !data.some(x => object(x) &&
          (Object.hasOwn(x, "anchorId") || Object.hasOwn(x, "challengerProbabilities") || Object.hasOwn(x, "observedReturn")))) {
        otherEvidenceEntries++; continue;
      }
      if (!data.length || data.length > 32) fail("FORECAST_BATCH");
      for (const row of data) {
        if (!object(row) || Object.keys(row).sort().join(",") !== "anchorId,challengerProbabilities,observedReturn" ||
            !isDigest(row.anchorId) || seen.has(row.anchorId) || typeof row.observedReturn !== "number" || !Number.isFinite(row.observedReturn) ||
            !Array.isArray(row.challengerProbabilities) || row.challengerProbabilities.length !== 7 ||
            Array.from(row.challengerProbabilities).some((p: unknown) => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)) fail("FORECAST_ROW");
        const sum = row.challengerProbabilities.reduce((a: number, b: number) => a + b, 0);
        if (Math.abs(sum - 1) > 1e-12 || forecasts.length >= 1_000_000) fail("FORECAST_PROBABILITIES");
        seen.add(row.anchorId); forecasts.push(row as SavedForecastDiagnosticRowV1);
      }
      evidenceInventoryHash.update(`${name}:${s.payloadDigest}\n`); forecastEntries++;
    }
    if (!forecasts.length) fail("NO_FORECAST_EVIDENCE");
    return { header, developmentReturns, historyMinuteOpenTimesMs, forecasts,
      sourceChunksRead, forecastEntries, otherEvidenceEntries,
      evidenceInventoryDigestHex: evidenceInventoryHash.digest("hex") };
  } catch (error) {
    if (error instanceof AuditRefusal) throw error;
    return fail("DIAGNOSTIC_INPUTS");
  } finally { secret?.fill(0); }
}

/** Authenticated metadata discovery only. Reads seals, package manifests and first
 * chunks; never evidence payloads, remaining replica chunks, builders or factories.
 * Observed metadata is NOT an independent expected inventory or reuse admission.
 */
export function inspectScientificPackageHeadersV1(root: string) {
  let secret: Buffer | undefined;
  try {
    if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1" ||
        !isAbsolute(root) || resolve(root) === "/") fail("CONFIG");
    privatePath(root, true);
    secret = readBounded(join(root, ".seal-key"), 32);
    if (secret.length !== 32) fail("SEAL_KEY");
    const packages = [];
    let evidenceSeals = 0, partialDirectories = 0;
    for (const name of names(root)) {
      if (name === ".seal-key") continue;
      const path = join(root, name);
      if (/^[a-f0-9]{64}\.partial-[a-zA-Z0-9]+$/.test(name)) {
        privatePath(path, true); partialDirectories++; continue;
      }
      if (!HEX.test(name)) fail("UNEXPECTED_ENTRY");
      privatePath(path, true);
      const seal = readSeal(join(path, "seal.json"), name, secret);
      if (seal.kind === "evidence") { evidenceSeals++; continue; }
      if (packages.length >= 64) fail("PACKAGE_LIMIT");
      const bytes = readBounded(join(path, "manifest.bin"), MAX_BINARY);
      if (createHash("sha256").update(bytes).digest("hex") !== seal.manifestFileDigest) fail("MANIFEST_PAYLOAD");
      const decoded: unknown = deserialize(bytes);
      if (!object(decoded)) fail("MANIFEST");
      const manifest = decoded as PredictivePackageManifestV1;
      validatePredictivePackageManifestV1(manifest, { ...seal.packageIdentity!, manifestDigestHex: seal.payloadDigest });
      const descriptor = manifest.chunks[0];
      if (!descriptor || descriptor.ordinal !== 0) fail("HEADER_CHUNK");
      const chunk = readBounded(join(path, "0.chunk"), PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES);
      if (chunk.length !== descriptor.byteLength || chunk.length > manifest.chunkByteLimit ||
          createHash("sha256").update(chunk).digest("hex") !== descriptor.sha256) fail("CHUNK");
      const text = chunk.toString("utf8");
      if (!Buffer.from(text).equals(chunk) || !text.endsWith("\n") ||
          text.split("\n").length - 1 !== descriptor.recordCount) fail("CHUNK_ENCODING");
      const header = projectScientificPackageHeaderV1(text.slice(0, text.indexOf("\n")));
      if (header.organizationId !== manifest.organizationId ||
          header.generationDigestHex !== manifest.generationDigestHex ||
          header.contentDigestHex !== manifest.contentDigestHex || header.k !== manifest.replicaCount) fail("HEADER_IDENTITY");
      const { organizationId: _organizationId, ...projection } = header;
      void _organizationId; // Organization is checked internally, never exported.
      packages.push(Object.freeze({ key: name, ...projection, sourceCount: manifest.sourceCount,
        chunkCount: manifest.chunks.length }));
    }
    return Object.freeze({ authorityGranted: false as const,
      metadataIntegrity: "AUTHENTICATED_SEALS_MANIFESTS_FIRST_CHUNKS" as const,
      payloadIntegrity: "NOT_RECHECKED" as const,
      provenance: "OBSERVED_ARTIFACTS_NOT_INDEPENDENT_EXPECTATIONS" as const,
      applicability: "NOT_ASSESSED" as const, scientificValidity: "NOT_ASSESSED" as const,
      computationCompleteness: "NOT_ASSESSED" as const,
      evidenceSeals, partialDirectories, packages: Object.freeze(packages) });
  } catch (error) {
    if (error instanceof AuditRefusal) throw error;
    return fail("PACKAGE_HEADERS");
  } finally { secret?.fill(0); }
}

/** Match independently supplied ORIGINAL inputs, never discover expected inputs
 * from observed directory names. This authenticates key binding, not payloads or
 * caller provenance. It never falls back to a builder when an entry is missing.
 * No evidence deserialization, package hydration or full-corpus scan occurs here.
 */
export function inspectExpectedScientificCheckpointKeysV1(
  root: string, expected: readonly ExpectedScientificCheckpointV1[],
) {
  let secret: Buffer | undefined;
  try {
    if (!Array.isArray(expected) || types.isProxy(expected) || Object.getPrototypeOf(expected) !== Array.prototype ||
        Object.getOwnPropertySymbols(expected).length ||
        Object.getOwnPropertyNames(expected).some(key => key !== "length" &&
          (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= expected.length))) fail("EXPECTED_LIST");
    const inputs: ExpectedScientificCheckpointV1[] = [];
    for (let i = 0; i < expected.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(expected, String(i));
      if (!descriptor || !("value" in descriptor)) return fail("EXPECTED_LIST");
      inputs.push(descriptor.value);
    }
    if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1" ||
        !isAbsolute(root) || resolve(root) === "/" || expected.length === 0) fail("CONFIG");
    privatePath(root, true);
    secret = readBounded(join(root, ".seal-key"), 32);
    if (secret.length !== 32) fail("SEAL_KEY");
    const seen = new Set<string>();
    const entries = inputs.map((item) => {
      const key = deriveScientificCheckpointKeyV1(item);
      if (seen.has(key)) fail("DUPLICATE_EXPECTATION");
      seen.add(key);
      const path = join(root, key);
      let lookup: "SEALED_KEY_MATCH" | "MISSING_COMPLETED_ENTRY";
      try { privatePath(path, true); lookup = "SEALED_KEY_MATCH"; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        lookup = "MISSING_COMPLETED_ENTRY";
      }
      if (lookup === "SEALED_KEY_MATCH" && readSeal(join(path, "seal.json"), key, secret!).kind !== item.kind)
        fail("KIND_MISMATCH");
      return Object.freeze({ key, stage: item.stage, kind: item.kind, lookup });
    });
    return Object.freeze({ authorityGranted: false as const,
      provenance: "CALLER_INPUT_NOT_INDEPENDENTLY_VERIFIED" as const,
      contentIntegrity: "NOT_RECHECKED" as const,
      scientificValidity: "NOT_ASSESSED" as const,
      computationCompleteness: "NOT_ASSESSED" as const,
      entries: Object.freeze(entries) });
  } catch (error) {
    if (error instanceof AuditRefusal) throw error;
    return fail("EXPECTED_KEY_LOOKUP");
  } finally { secret?.fill(0); }
}

/** Read existing v1 artifacts from a quiescent private tree. No factory, builders,
 * writes, callbacks, evidence deserialization or full package hydration. Reading may
 * update filesystem access times. There is no lock/snapshot against concurrent writers.
 * Memory: one <=64 MiB authenticated manifest plus its decoded inventory, and one
 * <=64 KiB chunk/hash buffer; no corpus or cross-entry payload collection.
 * VERIFIED_COMPLETED_ENTRIES authenticates completed bytes only, never partials,
 * scientific correctness, completeness of
 * an interrupted run, or applicability to another release/runtime/stage/input.
 * Errors intentionally omit paths, metadata and underlying parser/I/O messages.
 */
export function auditScientificCheckpointsV1(root: string): ScientificCheckpointAuditV1 {
  let secret: Buffer | undefined;
  try {
    if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") fail("NODE_CLI");
    if (!isAbsolute(root) || resolve(root) === "/") fail("CONFIG");
    privatePath(root, true);
    secret = readBounded(join(root, ".seal-key"), 32);
    if (secret.length !== 32) fail("SEAL_KEY");
    const report: ScientificCheckpointAuditV1 = { integrity: "NO_COMPLETED_ENTRIES",
      applicability: "NOT_ASSESSED", scientificValidity: "NOT_ASSESSED", computationCompleteness: "NOT_ASSESSED",
      completedEntries: 0, evidenceEntries: 0, packageEntries: 0, partialEntries: 0, chunks: 0, payloadBytes: 0 };
    for (const name of names(root)) {
      if (name === ".seal-key") continue;
      const path = join(root, name);
      if (/^[a-f0-9]{64}\.partial-[a-zA-Z0-9]+$/.test(name)) {
        privatePath(path, true); report.partialEntries++; continue;
      }
      if (!HEX.test(name)) fail("UNEXPECTED_ENTRY");
      privatePath(path, true);
      const seal = readSeal(join(path, "seal.json"), name, secret);
      if (seal.kind === "evidence") {
        for (const child of names(path))
          if (child !== "seal.json" && child !== "evidence.bin") fail("UNEXPECTED_ENTRY");
        report.payloadBytes += hashFile(join(path, "evidence.bin"), seal.payloadDigest);
        report.evidenceEntries++;
      } else {
        const bytes = readBounded(join(path, "manifest.bin"), MAX_BINARY);
        if (createHash("sha256").update(bytes).digest("hex") !== seal.manifestFileDigest) fail("MANIFEST_PAYLOAD");
        let manifest: PredictivePackageManifestV1;
        try {
          const decoded: unknown = deserialize(bytes);
          if (!object(decoded)) fail("MANIFEST");
          manifest = decoded as PredictivePackageManifestV1;
          validatePredictivePackageManifestV1(manifest, { ...seal.packageIdentity!, manifestDigestHex: seal.payloadDigest });
        } catch { fail("MANIFEST"); }
        for (const child of names(path)) {
          if (child === "seal.json" || child === "manifest.bin") continue;
          const match = /^(0|[1-9][0-9]*)\.chunk$/.exec(child);
          if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= manifest.chunks.length)
            fail("UNEXPECTED_ENTRY");
        }
        for (const descriptor of manifest.chunks) {
          const chunk = readBounded(join(path, `${descriptor.ordinal}.chunk`), PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES);
          if (chunk.length !== descriptor.byteLength || chunk.length > manifest.chunkByteLimit ||
              createHash("sha256").update(chunk).digest("hex") !== descriptor.sha256) fail("CHUNK");
          const text = chunk.toString("utf8");
          if (!Buffer.from(text).equals(chunk) || !text.endsWith("\n")) fail("CHUNK_ENCODING");
          let records = 0;
          for (const byte of chunk) if (byte === 10) records++;
          if (records !== descriptor.recordCount) fail("CHUNK_RECORD_COUNT");
          report.chunks++; report.payloadBytes += chunk.length;
        }
        report.payloadBytes += bytes.length; report.packageEntries++;
      }
      report.completedEntries++;
      if (!Number.isSafeInteger(report.payloadBytes) || !Number.isSafeInteger(report.chunks)) fail("COUNT_LIMIT");
    }
    if (report.completedEntries) report.integrity = "VERIFIED_COMPLETED_ENTRIES";
    return report;
  } catch (error) {
    if (error instanceof AuditRefusal) throw error;
    return fail("IO");
  } finally { secret?.fill(0); }
}

/** All fields are independently expected caller evidence, never defaults taken
 * from the artifact being verified. The original full-input key mapping must
 * already be established separately; this bounded API does not re-read raw data.
 */
export type ExpectedPreservedScientificPackageV1 = {
  checkpointKey: string;
  family: ReplicaRootFamilyInput;
  originalRuntime: { node: string; os: string; arch: string };
  familyIdentityDigestHex: string;
  runtimeContractDigestHex: string;
  generationDigestHex: string;
  contentDigestHex: string;
  manifestDigestHex: string;
  manifestFileDigestHex: string;
  targetGridDigestHex: string;
  sourceCount: number;
  chunkCount: number;
  kConfigDec: number;
  mConfigDec: number;
  alphaEpiConfigScale8: string;
};

function snapshotExpectedPreservedPackage(expected: ExpectedPreservedScientificPackageV1) {
  const fields = ["checkpointKey", "family", "originalRuntime", "familyIdentityDigestHex",
    "runtimeContractDigestHex", "generationDigestHex", "contentDigestHex", "manifestDigestHex",
    "manifestFileDigestHex", "targetGridDigestHex", "sourceCount", "chunkCount", "kConfigDec",
    "mConfigDec", "alphaEpiConfigScale8"];
  const familyFields = ["organizationId", "venue", "market", "symbol", "primaryHorizonMinutes",
    "executionHorizonMinutes", "packageSubjectVersion", "terminalTargetDefinitionDigestHex",
    "executionOpportunityTargetDefinitionDigestHex", "modelTransformVersion", "developmentDatasetDigestHex",
    "featureVersion", "normalizationVersionDigestHex", "codeReleaseSha"];
  function data(value: unknown, keys: string[]) {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length ||
        Object.getOwnPropertyNames(value).sort().join(",") !== [...keys].sort().join(",")) fail("PACKAGE_EXPECTATION");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("PACKAGE_EXPECTATION");
    }
  }
  data(expected, fields);
  data(expected.family, familyFields);
  data(expected.originalRuntime, ["node", "os", "arch"]);
  for (const [field, value] of Object.entries(expected.family)) {
    if (field === "primaryHorizonMinutes" || field === "executionHorizonMinutes") {
      if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 1440) fail("PACKAGE_EXPECTATION");
    } else if (typeof value !== "string" || !value.length || value.length > 256) fail("PACKAGE_EXPECTATION");
  }
  for (const field of ["checkpointKey", "familyIdentityDigestHex", "runtimeContractDigestHex",
    "generationDigestHex", "contentDigestHex", "manifestDigestHex", "manifestFileDigestHex", "targetGridDigestHex"] as const)
    if (!isDigest(expected[field])) fail("PACKAGE_EXPECTATION");
  const runtime = expected.originalRuntime;
  if (typeof runtime.node !== "string" || runtime.node.length > 64 ||
      !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(runtime.node) ||
      typeof runtime.os !== "string" || !/^[a-z0-9_]{1,64}$/.test(runtime.os) ||
      typeof runtime.arch !== "string" || !/^[a-z0-9_]{1,64}$/.test(runtime.arch) ||
      typeof expected.alphaEpiConfigScale8 !== "string" || !/^(?:0|1)\.\d{8}$/.test(expected.alphaEpiConfigScale8) ||
      Number(expected.alphaEpiConfigScale8) <= 0 || Number(expected.alphaEpiConfigScale8) >= 1) fail("PACKAGE_EXPECTATION");
  for (const [value, limit] of [[expected.sourceCount, 2_000_000], [expected.chunkCount, 600_000],
    [expected.kConfigDec, 50], [expected.mConfigDec, 80]])
    if (!Number.isSafeInteger(value) || value! < 1 || value! > limit!) fail("PACKAGE_EXPECTATION");
  const copy = { ...expected, family: { ...expected.family }, originalRuntime: { ...runtime } };
  if (computeReplicaRootFamilyIdentityDigest(copy.family).toString("hex") !== copy.familyIdentityDigestHex ||
      computePredictivePackageGenerationIdentityDigest({ replicaRootFamilyIdentityDigestHex: copy.familyIdentityDigestHex,
        kConfigDec: copy.kConfigDec, mConfigDec: copy.mConfigDec, alphaEpiConfigScale8: copy.alphaEpiConfigScale8 })
        .toString("hex") !== copy.generationDigestHex ||
      computeRuntimeContractDigest({ osClass: runtime.os, arch: runtime.arch, nodeVersionExact: runtime.node,
        codeReleaseSha: copy.family.codeReleaseSha, modelTransformVersion: copy.family.modelTransformVersion })
        .toString("hex") !== copy.runtimeContractDigestHex) fail("PACKAGE_EXPECTATION_IDENTITIES");
  return copy;
}

/** Read-only full codec validation of ONE independently selected original package.
 * Requires a quiescent private tree. No factory/build fallback, Forecast, bootstrap,
 * raw dataset read, cache writes or package export. At most one chunk Buffer is
 * pulled at a time; the complete hydrated package and codec validation indexes DO
 * remain in memory. Callers must budget full-package memory and runtime separately.
 * This establishes structural/digest consistency, not correctness of the original
 * sampling execution, convergence selection, raw-input provenance or admission.
 */
export function verifyPreservedScientificPackageHydrationV1(root: string, expected: ExpectedPreservedScientificPackageV1) {
  let secret: Buffer | undefined;
  try {
    if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1" ||
        typeof root !== "string" || !isAbsolute(root) || resolve(root) === "/") fail("CONFIG");
    const e = snapshotExpectedPreservedPackage(expected);
    const rootBefore = privatePath(root, true), path = join(root, e.checkpointKey);
    const entryBefore = privatePath(path, true), keyPath = join(root, ".seal-key");
    const keyBefore = privatePath(keyPath, false);
    secret = readBounded(keyPath, 32);
    if (secret.length !== 32) fail("SEAL_KEY");
    const sealPath = join(path, "seal.json"), sealBefore = privatePath(sealPath, false);
    const seal = readSeal(sealPath, e.checkpointKey, secret);
    if (seal.kind !== "package" || seal.payloadDigest !== e.manifestDigestHex ||
        seal.manifestFileDigest !== e.manifestFileDigestHex ||
        seal.packageIdentity?.organizationId !== e.family.organizationId ||
        seal.packageIdentity.generationDigestHex !== e.generationDigestHex ||
        seal.packageIdentity.contentDigestHex !== e.contentDigestHex) fail("PACKAGE_EXPECTED_SEAL");
    const manifestPath = join(path, "manifest.bin"), manifestBefore = privatePath(manifestPath, false);
    const bytes = readBounded(manifestPath, MAX_BINARY);
    if (createHash("sha256").update(bytes).digest("hex") !== e.manifestFileDigestHex) fail("MANIFEST_PAYLOAD");
    const decoded: unknown = deserialize(bytes);
    if (!object(decoded)) fail("MANIFEST");
    const manifest = decoded as PredictivePackageManifestV1;
    const identity = { organizationId: e.family.organizationId, generationDigestHex: e.generationDigestHex,
      contentDigestHex: e.contentDigestHex, manifestDigestHex: e.manifestDigestHex };
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length !== e.chunkCount ||
        manifest.sourceCount !== e.sourceCount || manifest.replicaCount !== e.kConfigDec) fail("PACKAGE_EXPECTED_COUNTS");
    validatePredictivePackageManifestV1(manifest, identity);
    for (const child of names(path)) {
      if (child === "seal.json" || child === "manifest.bin") continue;
      const match = /^(0|[1-9][0-9]*)\.chunk$/.exec(child);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= e.chunkCount) fail("UNEXPECTED_ENTRY");
    }
    let chunksRead = 0, payloadBytes = bytes.length;
    function* chunks(): Generator<Buffer> {
      for (const descriptor of manifest.chunks) {
        const chunk = readBounded(join(path, `${descriptor.ordinal}.chunk`), PREDICTIVE_PACKAGE_MAX_CHUNK_BYTES);
        // The unchanged codec authenticates each chunk before decoding its records.
        chunksRead++; payloadBytes += chunk.length;
        yield chunk;
      }
    }
    const pkg = hydratePredictivePackageV1(manifest, chunks(), identity);
    if (!isDeepStrictEqual(pkg.family, e.family) ||
        !Buffer.isBuffer(pkg.runtimeContractDigest) || pkg.runtimeContractDigest.toString("hex") !== e.runtimeContractDigestHex ||
        !Buffer.isBuffer(pkg.replicaRootFamilyIdentityDigest) || pkg.replicaRootFamilyIdentityDigest.toString("hex") !== e.familyIdentityDigestHex ||
        pkg.terminalTargetGridIdentityDigestHex !== e.targetGridDigestHex ||
        pkg.kConfigDec !== e.kConfigDec || pkg.mConfigDec !== e.mConfigDec || pkg.alphaEpiConfigScale8 !== e.alphaEpiConfigScale8 ||
        pkg.canonicalSourceCorpus.length !== e.sourceCount || chunksRead !== e.chunkCount) fail("PACKAGE_EXPECTED_IDENTITY");
    unchanged(rootBefore, privatePath(root, true));
    unchanged(entryBefore, privatePath(path, true));
    unchanged(keyBefore, privatePath(keyPath, false));
    unchanged(sealBefore, privatePath(sealPath, false));
    unchanged(manifestBefore, privatePath(manifestPath, false));
    return Object.freeze({ schemaVersion: "preserved-package-readonly-hydration/v1" as const,
      status: "AUTHENTICATED_FULL_CODEC_AND_EXPECTED_IDENTITIES_MATCH" as const,
      checkpointKey: e.checkpointKey, familyIdentityDigestHex: e.familyIdentityDigestHex,
      generationDigestHex: e.generationDigestHex, contentDigestHex: e.contentDigestHex,
      runtimeContractDigestHex: e.runtimeContractDigestHex, manifestDigestHex: e.manifestDigestHex,
      manifestFileDigestHex: e.manifestFileDigestHex, targetGridDigestHex: e.targetGridDigestHex,
      sourceCount: e.sourceCount, replicaCount: e.kConfigDec, chunksRead, payloadBytes,
      authorityGranted: false as const, inputKeyProvenance: "REQUIRES_SEPARATE_ORIGINAL_INPUT_MAPPING" as const,
      convergenceSelection: "NOT_ESTABLISHED" as const, originalSamplingExecution: "NOT_REPLAYED" as const,
      reuseAdmission: "NOT_GRANTED" as const, forecastGeneration: "NOT_RUN" as const,
      bootstrap: "NOT_RUN" as const, checkpointWrites: "NOT_PERMITTED" as const });
  } catch (error) {
    if (error instanceof AuditRefusal) throw error;
    return fail("PACKAGE_HYDRATION");
  } finally { secret?.fill(0); }
}
