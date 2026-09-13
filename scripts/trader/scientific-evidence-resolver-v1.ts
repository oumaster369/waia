import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { deserialize } from "node:v8";
import { isDeepStrictEqual } from "node:util";
import {
  hydratePredictivePackageV1,
  type PredictivePackageManifestV1,
} from "../../lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import type { PredictivePackageV1 } from "../../lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { PackageBuildInputV1 } from "../../lib/trader/historical-simulation-v2/scientific-checkpoint-context-v1";
import {
  STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1,
  isEvaluatorDurableBootstrapStageV1,
  scientificNamespaceIdentityKeyV1,
  type ScientificEvidenceNamespaceV1,
  type ScientificNamespaceIdentityV1,
  type StrictScientificEvidenceResolverV1,
} from "../../lib/trader/historical-simulation-v2/scientific-evidence-resolver-v1";
import { deriveScientificCheckpointKeyV1 } from "./scientific-checkpoint-key-v1";

const FORMAT = "waia-scientific-checkpoint/v1";
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const RELEASE = /^[a-f0-9]{40}$/;
const NODE = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const TOKEN = /^[a-z0-9_]+$/;
const STAGE = /^[a-z0-9-]+$/;

function refuse(reason: string): never {
  throw new Error(`STRICT_SCIENTIFIC_EVIDENCE_REFUSED:${reason}`);
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function privatePath(path: string, directory: boolean) {
  const st = lstatSync(path);
  if (
    st.isSymbolicLink() ||
    (directory ? !st.isDirectory() : !st.isFile()) ||
    (st.mode & 0o077) !== 0 ||
    (process.getuid && st.uid !== process.getuid())
  ) {
    refuse("PRIVATE_PATH");
  }
  return st;
}

function readBounded(path: string, max: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid()))
      refuse("PRIVATE_PATH");
    if (st.size > max) refuse("SIZE");
    const result = readFileSync(fd);
    if (result.length > max) refuse("SIZE");
    return result;
  } finally {
    closeSync(fd);
  }
}

function assertIdentity(identity: ScientificNamespaceIdentityV1): ScientificNamespaceIdentityV1 {
  if (
    !RELEASE.test(identity.releaseSha) ||
    !NODE.test(identity.runtime.node) ||
    !TOKEN.test(identity.runtime.os) ||
    !TOKEN.test(identity.runtime.arch)
  ) {
    refuse("IDENTITY");
  }
  return identity;
}

export type ScientificNamespaceBindingV1 = Readonly<{
  root: string;
  identity: ScientificNamespaceIdentityV1;
}>;
export type StrictScientificEvidenceGraphV1 = Readonly<{
  origin: ScientificNamespaceBindingV1;
  producer?: ScientificNamespaceBindingV1;
  evaluator: ScientificNamespaceBindingV1;
}>;

type Seal = {
  format: typeof FORMAT;
  key: string;
  kind: "package" | "evidence";
  payloadDigest: string;
  manifestFileDigest?: string;
  packageIdentity?: {
    organizationId: string;
    generationDigestHex: string;
    contentDigestHex: string;
  };
};

function bindRoot(root: string): string {
  if (!isAbsolute(root) || resolve(root) === "/") refuse("CONFIG");
  if (!existsSync(root)) refuse("MISSING_ROOT");
  privatePath(root, true);
  if (realpathSync(root) !== resolve(root)) refuse("ROOT_SYMLINK");
  return root;
}

function openNamespace(binding: ScientificNamespaceBindingV1) {
  const root = bindRoot(binding.root);
  const identity = assertIdentity(binding.identity);
  const secret = readBounded(join(root, ".seal-key"), 32);
  if (secret.length !== 32) refuse("SEAL_KEY");
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest();
  const readSeal = (dir: string, key: string, kind: Seal["kind"]): Seal => {
    privatePath(dir, true);
    const envelope = JSON.parse(
      readBounded(join(dir, "seal.json"), MAX_METADATA_BYTES).toString("utf8"),
    ) as { body?: unknown; signature?: unknown };
    if (
      typeof envelope.body !== "string" ||
      typeof envelope.signature !== "string" ||
      !HEX.test(envelope.signature)
    ) {
      refuse("CORRUPT");
    }
    const expected = sign(envelope.body);
    const actual = Buffer.from(envelope.signature, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) refuse("CORRUPT");
    let seal: Seal;
    try {
      seal = JSON.parse(envelope.body) as Seal;
    } catch {
      refuse("CORRUPT");
    }
    if (
      seal.format !== FORMAT ||
      seal.key !== key ||
      seal.kind !== kind ||
      !HEX.test(seal.payloadDigest)
    ) {
      refuse("CROSS_ORIGIN");
    }
    return seal;
  };
  return { root, identity, readSeal };
}

function checkpointKey(
  identity: ScientificNamespaceIdentityV1,
  stage: string,
  kind: "evidence" | "package",
  input: unknown,
): string {
  return deriveScientificCheckpointKeyV1({
    releaseSha: identity.releaseSha,
    runtime: { node: identity.runtime.node, os: identity.runtime.os, arch: identity.runtime.arch },
    stage,
    kind,
    input,
  });
}

function mismatchReason(
  namespace: ScientificEvidenceNamespaceV1,
  field: "release" | "runtime",
): string {
  if (field === "runtime") return "WRONG_RUNTIME";
  if (namespace === "origin") return "CROSS_ORIGIN";
  if (namespace === "producer") return "WRONG_PRODUCER";
  return "WRONG_EVALUATOR";
}

/**
 * Read-only dual-origin resolver. Never creates directories, never persists artifacts,
 * never calls a builder, never writes O or P (or R) namespaces. Origin root is opened read-only.
 */
export function createStrictScientificEvidenceResolverV1(
  graph: StrictScientificEvidenceGraphV1,
): StrictScientificEvidenceResolverV1 {
  if (process.release?.name !== "node" || process.env.WAIA_TRADER_CLI !== "1") refuse("NODE_CLI");
  const origin = openNamespace(graph.origin);
  const producer = graph.producer ? openNamespace(graph.producer) : undefined;
  const evaluator = openNamespace(graph.evaluator);
  const originKey = scientificNamespaceIdentityKeyV1(origin.identity);
  const evaluatorKey = scientificNamespaceIdentityKeyV1(evaluator.identity);
  if (originKey === evaluatorKey) refuse("COLLAPSED_IDENTITY");
  if (producer) {
    const producerKey = scientificNamespaceIdentityKeyV1(producer.identity);
    if (producerKey === originKey || producerKey === evaluatorKey) refuse("COLLAPSED_IDENTITY");
  }

  const namespaceOf = (namespace: ScientificEvidenceNamespaceV1) => {
    if (namespace === "origin") return origin;
    if (namespace === "evaluator") return evaluator;
    if (!producer) refuse("PRODUCER_ABSENT");
    return producer;
  };

  const loadEvidence = <T>(
    stage: string,
    input: unknown,
    namespace: ScientificEvidenceNamespaceV1,
  ): T => {
    if (!STAGE.test(stage)) refuse("STAGE");
    if (namespace === "evaluator" && stage === "wf-forecast-batch-v1") refuse("CROSS_ORIGIN");
    if (namespace !== "evaluator" && isEvaluatorDurableBootstrapStageV1(stage)) refuse("CROSS_ORIGIN");
    const bound = namespaceOf(namespace);
    const kind = stage === "predictive-package" ? ("package" as const) : ("evidence" as const);
    if (kind === "package") refuse("PACKAGE_VIA_EVIDENCE");
    let key: string;
    try {
      key = checkpointKey(bound.identity, stage, "evidence", input);
    } catch {
      refuse(mismatchReason(namespace, "runtime"));
    }
    const target = join(bound.root, key);
    if (!existsSync(target)) refuse("MISSING");
    let seal: Seal;
    try {
      seal = bound.readSeal(target, key, "evidence");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("STRICT_SCIENTIFIC_EVIDENCE_REFUSED:")) throw error;
      refuse("CORRUPT");
    }
    const bytes = readBounded(join(target, "evidence.bin"), MAX_EVIDENCE_BYTES);
    if (hash(bytes) !== seal.payloadDigest) refuse("CORRUPT");
    return deserialize(bytes) as T;
  };

  const loadPackage = (input: PackageBuildInputV1): PredictivePackageV1 => {
    const familyRelease = input.family.codeReleaseSha;
    if (familyRelease !== origin.identity.releaseSha) refuse("CROSS_ORIGIN");
    const key = checkpointKey(origin.identity, "predictive-package", "package", input);
    const target = join(origin.root, key);
    if (!existsSync(target)) refuse("MISSING");
    const seal = origin.readSeal(target, key, "package");
    const expected = seal.packageIdentity;
    if (
      !expected ||
      expected.organizationId !== input.family.organizationId ||
      !HEX.test(seal.manifestFileDigest ?? "")
    )
      refuse("PACKAGE_SCOPE");
    const manifestBytes = readBounded(join(target, "manifest.bin"), MAX_EVIDENCE_BYTES);
    if (hash(manifestBytes) !== seal.manifestFileDigest) refuse("CORRUPT");
    const m = deserialize(manifestBytes) as PredictivePackageManifestV1;
    function* chunks() {
      for (let ordinal = 0; ordinal < m.chunks.length; ordinal++)
        yield readBounded(join(target, `${ordinal}.chunk`), 64 * 1024);
    }
    const pkg = hydratePredictivePackageV1(m, chunks(), {
      ...expected,
      manifestDigestHex: seal.payloadDigest,
    });
    if (!isDeepStrictEqual(pkg.family, input.family)) refuse("FAMILY_SCOPE");
    return pkg;
  };

  return {
    contractVersion: STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1,
    identities: Object.freeze({
      origin: origin.identity,
      producer: producer?.identity,
      evaluator: evaluator.identity,
    }),
    resolvePackage(input) {
      return loadPackage(input);
    },
    resolveEvidence(stage, input, namespace) {
      return loadEvidence(stage, input, namespace);
    },
    async resolveEvidenceAsync(stage, input, namespace) {
      return loadEvidence(stage, input, namespace);
    },
  };
}
