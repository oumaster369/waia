/**
 * Standalone, read-only O/P/R release binding for historical proposal preparation.
 * This sidecar imports no application code and never derives an expected identity
 * from its own checkout.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const HISTORICAL_OPR_RELEASE_BINDING_SCHEMA_V1 = "waia.historical_opr_release_binding.v1";
export const STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1 = "waia.strict-scientific-evidence-resolver.v1";
export const PRESERVED_ORIGIN_RELEASE_SHA_V1 = "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67";
export const PRESERVED_ORIGIN_RUNTIME_V1 = Object.freeze({
  node: "v22.23.2",
  os: "linux",
  arch: "x64",
});

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NODE_VERSION = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const TOKEN = /^[a-z0-9_]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SOURCE_ENTRIES = 8192;
const MAX_SOURCE_FILES = 4096;
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 128 * 1024 * 1024;
const REQUIRED_EVALUATOR_SOURCE_PATHS = Object.freeze([
  "db",
  "lib",
  "package.json",
  "scripts/trader/scientific-checkpoint-key-v1.ts",
  "scripts/trader/scientific-evidence-resolver-v1.ts",
  "tsconfig.json",
]);
const verifiedBindings = new WeakSet();

function refuse(code) {
  throw new Error(`HISTORICAL_OPR_BINDING_REFUSED:${code}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactObject(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    refuse(`${code}_FIELDS`);
  }
  return value;
}

function canonicalAbsolutePath(value, code) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    resolve(value) === "/" ||
    /[\u0000-\u001f]/.test(value) ||
    resolve(value) !== value
  ) {
    refuse(code);
  }
  return value;
}

function canonicalRuntime(value, code) {
  exactObject(value, ["node", "os", "arch"], code);
  if (!NODE_VERSION.test(value.node) || !TOKEN.test(value.os) || !TOKEN.test(value.arch)) {
    refuse(code);
  }
  return Object.freeze({ node: value.node, os: value.os, arch: value.arch });
}

function canonicalSource(value, code) {
  exactObject(
    value,
    ["root", "gitTreeSha", "coveredSourceDigest", "coveredSourceFileCount", "coveredSourcePaths"],
    code,
  );
  if (
    !SHA1.test(value.gitTreeSha) ||
    !SHA256.test(value.coveredSourceDigest) ||
    !Number.isSafeInteger(value.coveredSourceFileCount) ||
    value.coveredSourceFileCount < 1 ||
    !Array.isArray(value.coveredSourcePaths) ||
    value.coveredSourcePaths.length === 0
  ) {
    refuse(code);
  }
  const coveredSourcePaths = value.coveredSourcePaths.map((path) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.startsWith("/") ||
      /[\u0000-\u001f]/.test(path) ||
      path.split("/").includes("..")
    ) {
      refuse(code);
    }
    return path;
  });
  const sorted = [...coveredSourcePaths].sort();
  if (
    new Set(sorted).size !== sorted.length ||
    sorted.some((path, index) => path !== coveredSourcePaths[index]) ||
    sorted.some((path, index) =>
      sorted.some((candidate, other) => other !== index && candidate.startsWith(`${path}/`)),
    )
  ) {
    refuse(`${code}_PATHS`);
  }
  return Object.freeze({
    root: canonicalAbsolutePath(value.root, `${code}_ROOT`),
    gitTreeSha: value.gitTreeSha,
    coveredSourceDigest: value.coveredSourceDigest,
    coveredSourceFileCount: value.coveredSourceFileCount,
    coveredSourcePaths: Object.freeze(sorted),
  });
}

function canonicalEvidence(value, code) {
  exactObject(value, ["root", "sealKeyDigest"], code);
  if (!SHA256.test(value.sealKeyDigest)) refuse(code);
  return Object.freeze({
    root: canonicalAbsolutePath(value.root, `${code}_ROOT`),
    sealKeyDigest: value.sealKeyDigest,
  });
}

function canonicalNamespace(value, code) {
  exactObject(value, ["releaseSha", "runtime", "source", "evidence"], code);
  if (!SHA1.test(value.releaseSha)) refuse(code);
  return Object.freeze({
    releaseSha: value.releaseSha,
    runtime: canonicalRuntime(value.runtime, `${code}_RUNTIME`),
    source: canonicalSource(value.source, `${code}_SOURCE`),
    evidence: canonicalEvidence(value.evidence, `${code}_EVIDENCE`),
  });
}

function pathsOverlap(left, right) {
  const delta = relative(left, right);
  return delta === "" || (!delta.startsWith("..") && !isAbsolute(delta));
}

export function canonicalHistoricalOprBindingBodyV1(body) {
  exactObject(
    body,
    ["strictResolverContractVersion", "proposalIdentity", "namespaces"],
    "MANIFEST_BODY",
  );
  if (body.strictResolverContractVersion !== STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1) {
    refuse("RESOLVER_CONTRACT");
  }
  exactObject(
    body.proposalIdentity,
    ["organizationId", "runId", "releaseSha"],
    "PROPOSAL_IDENTITY",
  );
  if (
    !UUID.test(body.proposalIdentity.organizationId) ||
    !RUN_ID.test(body.proposalIdentity.runId) ||
    !SHA1.test(body.proposalIdentity.releaseSha)
  ) {
    refuse("PROPOSAL_IDENTITY");
  }
  exactObject(body.namespaces, ["origin", "producer", "evaluator"], "NAMESPACES");
  const origin = canonicalNamespace(body.namespaces.origin, "ORIGIN");
  const producer = canonicalNamespace(body.namespaces.producer, "PRODUCER");
  const evaluator = canonicalNamespace(body.namespaces.evaluator, "EVALUATOR");
  if (origin.releaseSha !== PRESERVED_ORIGIN_RELEASE_SHA_V1) refuse("ORIGIN_RELEASE");
  if (
    origin.runtime.node !== PRESERVED_ORIGIN_RUNTIME_V1.node ||
    origin.runtime.os !== PRESERVED_ORIGIN_RUNTIME_V1.os ||
    origin.runtime.arch !== PRESERVED_ORIGIN_RUNTIME_V1.arch
  ) {
    refuse("ORIGIN_RUNTIME");
  }
  if (new Set([origin.releaseSha, producer.releaseSha, evaluator.releaseSha]).size !== 3) {
    refuse("COLLAPSED_RELEASES");
  }
  if (body.proposalIdentity.releaseSha !== evaluator.releaseSha) {
    refuse("PROPOSAL_EVALUATOR_RELEASE");
  }
  for (const requiredPath of REQUIRED_EVALUATOR_SOURCE_PATHS) {
    if (!evaluator.source.coveredSourcePaths.includes(requiredPath)) {
      refuse("EVALUATOR_SOURCE_COVERAGE");
    }
  }
  const roots = [
    origin.source.root,
    origin.evidence.root,
    producer.source.root,
    producer.evidence.root,
    evaluator.source.root,
    evaluator.evidence.root,
  ];
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (pathsOverlap(roots[left], roots[right]) || pathsOverlap(roots[right], roots[left])) {
        refuse("OVERLAPPING_ROOTS");
      }
    }
  }
  return Object.freeze({
    strictResolverContractVersion: STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1,
    proposalIdentity: Object.freeze({
      organizationId: body.proposalIdentity.organizationId,
      runId: body.proposalIdentity.runId,
      releaseSha: body.proposalIdentity.releaseSha,
    }),
    namespaces: Object.freeze({ origin, producer, evaluator }),
  });
}

export function digestHistoricalOprBindingBodyV1(body) {
  return sha256(Buffer.from(JSON.stringify(canonicalHistoricalOprBindingBodyV1(body))));
}

export function serializeHistoricalOprBindingManifestV1(body) {
  const canonical = canonicalHistoricalOprBindingBodyV1(body);
  const digest = digestHistoricalOprBindingBodyV1(canonical);
  return `${JSON.stringify({
    schemaVersion: HISTORICAL_OPR_RELEASE_BINDING_SCHEMA_V1,
    body: canonical,
    digest,
  })}\n`;
}

export function parseHistoricalOprBindingManifestV1(bytes, expectedDigest) {
  if (!SHA256.test(expectedDigest ?? "")) refuse("EXPECTED_MANIFEST_DIGEST");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length === 0 || buffer.length > MAX_MANIFEST_BYTES) refuse("MANIFEST_SIZE");
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    refuse("MANIFEST_JSON");
  }
  exactObject(parsed, ["schemaVersion", "body", "digest"], "MANIFEST");
  if (parsed.schemaVersion !== HISTORICAL_OPR_RELEASE_BINDING_SCHEMA_V1) {
    refuse("MANIFEST_SCHEMA");
  }
  const body = canonicalHistoricalOprBindingBodyV1(parsed.body);
  const digest = digestHistoricalOprBindingBodyV1(body);
  if (parsed.digest !== digest || expectedDigest !== digest) refuse("MANIFEST_DIGEST");
  const canonicalBytes = serializeHistoricalOprBindingManifestV1(body);
  if (buffer.toString("utf8") !== canonicalBytes) refuse("AMBIGUOUS_MANIFEST");
  const binding = { ...body };
  Object.defineProperty(binding, "digest", {
    value: digest,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(binding);
}

function readPrivateFile(path, maximum, code) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > maximum ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      refuse(code);
    }
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size || bytes.length > maximum) refuse(code);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function readHistoricalOprBindingManifestV1(path, expectedDigest) {
  const canonicalPath = canonicalAbsolutePath(path, "MANIFEST_PATH");
  if (realpathSync(canonicalPath) !== canonicalPath) refuse("MANIFEST_PATH");
  return parseHistoricalOprBindingManifestV1(
    readPrivateFile(canonicalPath, MAX_MANIFEST_BYTES, "MANIFEST_PATH"),
    expectedDigest,
  );
}

export function fingerprintHistoricalCoveredSourceV1(root, paths) {
  const canonicalRoot = canonicalAbsolutePath(root, "SOURCE_ROOT");
  if (realpathSync(canonicalRoot) !== canonicalRoot || lstatSync(canonicalRoot).isSymbolicLink()) {
    refuse("SOURCE_ROOT");
  }
  const files = [];
  let entries = 0;
  let fileCount = 0;
  const visit = (path) => {
    entries += 1;
    if (entries > MAX_SOURCE_ENTRIES || path.split("/").length > 64) refuse("SOURCE_BOUNDS");
    const absolute = join(canonicalRoot, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) refuse("SOURCE_SYMLINK");
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(`${path}/${entry}`);
      return;
    }
    fileCount += 1;
    if (!stat.isFile() || fileCount > MAX_SOURCE_FILES || stat.size > MAX_SOURCE_FILE_BYTES) {
      refuse("SOURCE_BOUNDS");
    }
    files.push(path);
  };
  try {
    for (const path of paths) visit(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("HISTORICAL_OPR_BINDING_REFUSED:")) {
      throw error;
    }
    refuse("SOURCE_PATH");
  }
  let totalBytes = 0;
  const digest = createHash("sha256");
  for (const path of files.sort()) {
    const absolute = join(canonicalRoot, path);
    const before = lstatSync(absolute);
    totalBytes += before.size;
    if (totalBytes > MAX_SOURCE_TOTAL_BYTES) refuse("SOURCE_BOUNDS");
    const contents = readFileSync(absolute);
    const after = lstatSync(absolute);
    if (
      contents.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      refuse("SOURCE_CHANGED");
    }
    digest.update(`${JSON.stringify([path, sha256(contents)])}\n`);
  }
  return Object.freeze({ digest: digest.digest("hex"), fileCount: files.length });
}

function git(root, args, code) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    refuse(code);
  }
}

function verifySource(namespace, name) {
  const source = namespace.source;
  if (realpathSync(source.root) !== source.root) refuse(`${name}_SOURCE_ROOT`);
  const topLevel = realpathSync(git(source.root, ["rev-parse", "--show-toplevel"], `${name}_GIT`));
  if (topLevel !== source.root) refuse(`${name}_GIT_ROOT`);
  const commit = git(
    source.root,
    ["rev-parse", "--verify", `${namespace.releaseSha}^{commit}`],
    `${name}_RELEASE`,
  ).toLowerCase();
  if (commit !== namespace.releaseSha) refuse(`${name}_RELEASE`);
  const checkout = git(
    source.root,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    `${name}_CHECKOUT`,
  ).toLowerCase();
  if (checkout !== namespace.releaseSha) refuse(`${name}_CHECKOUT`);
  const tree = git(
    source.root,
    ["rev-parse", "--verify", `${namespace.releaseSha}^{tree}`],
    `${name}_TREE`,
  ).toLowerCase();
  if (tree !== source.gitTreeSha) refuse(`${name}_TREE`);
  if (
    git(source.root, ["status", "--porcelain=v1", "--untracked-files=no"], `${name}_GIT_STATUS`)
  ) {
    refuse(`${name}_DIRTY_SOURCE`);
  }
  const covered = fingerprintHistoricalCoveredSourceV1(source.root, source.coveredSourcePaths);
  if (covered.digest !== source.coveredSourceDigest) refuse(`${name}_SOURCE_DIGEST`);
  if (covered.fileCount !== source.coveredSourceFileCount) {
    refuse(`${name}_SOURCE_FILE_COUNT`);
  }
}

function verifyEvidence(namespace, name) {
  const root = namespace.evidence.root;
  const stat = lstatSync(root);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    realpathSync(root) !== root
  ) {
    refuse(`${name}_EVIDENCE_ROOT`);
  }
  const key = readPrivateFile(join(root, ".seal-key"), 32, `${name}_EVIDENCE_ROOT`);
  if (key.length !== 32 || sha256(key) !== namespace.evidence.sealKeyDigest) {
    refuse(`${name}_EVIDENCE_ROOT`);
  }
}

export function verifyHistoricalOprReleaseBindingV1(binding) {
  const canonical = canonicalHistoricalOprBindingBodyV1(binding);
  for (const [name, namespace] of Object.entries(canonical.namespaces)) {
    verifySource(namespace, name.toUpperCase());
    verifyEvidence(namespace, name.toUpperCase());
  }
  const runtime = canonical.namespaces.evaluator.runtime;
  if (
    process.version !== runtime.node ||
    process.platform !== runtime.os ||
    process.arch !== runtime.arch
  ) {
    refuse("EVALUATOR_RUNTIME");
  }
  verifiedBindings.add(binding);
  return binding;
}

export function assertVerifiedHistoricalOprReleaseBindingV1(binding) {
  if (!binding || !verifiedBindings.has(binding)) refuse("UNVERIFIED_BINDING");
  return binding;
}
