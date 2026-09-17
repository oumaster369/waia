/**
 * DEE-1018: pinned identity + Human evidence model for the ordered post-H2 migration lane.
 *
 * The Human Architect rejected sparse application: the production journal advances strictly
 * `0205 -> 0206 -> 0207 -> 0208 -> 0209 -> 0210`. H2 owns `0205..0208` and is frozen; this lane
 * owns exactly `0209` and `0210`, one Human-authorized step per invocation.
 *
 * Only the pure, already-exported helpers of the H2 manifest are reused (`sha256`,
 * `canonicalJson`, `semanticDigest`, the pinned `0000..0208` closure). Nothing in the H2 lane is
 * modified, and this lane carries its own attestation schema, trust-policy path and refusal
 * vocabulary, so an H2 ceremony packet can never authorize a post-H2 step and vice versa.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  canonicalJson,
  H2_MIGRATION_MANIFEST,
  loadH2CanonicalSource,
  semanticDigest,
  sha256,
  type H2AppliedMigration,
} from "./postgres-h2-migration-manifest-v1";

export { canonicalJson, semanticDigest, sha256 };

export const POST_H2_MIGRATION_RECEIPT_SCHEMA =
  "waia.trader.post-h2.migration-operation-receipt.v1" as const;
export const POST_H2_HUMAN_ATTESTATION_SCHEMA = "waia.trader.post-h2.human-attestation.v1" as const;

/** Exactly the additive range after the frozen H2 ladder. No future step is implicit. */
export const POST_H2_STEPS = ["0209", "0210"] as const;
export type PostH2Step = (typeof POST_H2_STEPS)[number];
export type PostH2AttestationKind =
  | "RESTORE_POINT"
  | "WRITER_QUIESCENCE"
  | "TARGET_IDENTITY"
  | "CEREMONY_AUTHORIZATION";

/** The exact journal tip H2 leaves behind; this lane's only lawful entry state. */
export const POST_H2_H2_TERMINAL_STEP = "0208" as const;

export type PostH2MigrationIdentity = Readonly<{
  step: PostH2Step;
  idx: number;
  when: number;
  tag: string;
  path: string;
  sourceCommit: string;
  sourceBlob: string;
  sha256: string;
  predecessor: "0208" | "0209";
  lockRelations: readonly string[];
  ownerRelations: readonly string[];
}>;

export type PostH2AppliedMigration = H2AppliedMigration;

export type PostH2HumanAttestation = Readonly<{
  schemaVersion: typeof POST_H2_HUMAN_ATTESTATION_SCHEMA;
  kind: PostH2AttestationKind;
  assertion:
    | "APPROVED_RESTORE_POINT_AVAILABLE"
    | "WRITERS_QUIESCED"
    | "TARGET_IDENTITY_APPROVED"
    | "AUTHORIZE_EXACT_POST_H2_STEP";
  ceremonyId: string;
  requestId: string;
  selectedStep: PostH2Step;
  targetFingerprint: string;
  expectedDatabaseName: string;
  expectedMigrationAuthority: string;
  operatorIdentity: string;
  humanApproverIdentity: string;
  evidenceDigestHex: string;
  signingKeySha256: string;
  issuedAt: string;
  contentDigestHex: string;
  signatureBase64: string;
}>;

export type PostH2CeremonyEvidence = Readonly<{
  restorePoint: PostH2HumanAttestation;
  writerQuiescence: PostH2HumanAttestation;
  targetIdentity: PostH2HumanAttestation;
  ceremonyAuthorization: PostH2HumanAttestation;
}>;

export type PostH2CanonicalSource = Readonly<{
  selected: PostH2MigrationIdentity;
  sql: Buffer;
  expectedPredecessorPrefix: readonly PostH2AppliedMigration[];
  expectedAppliedPrefix: readonly PostH2AppliedMigration[];
}>;

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_ATTESTATION_BYTES = 16 * 1024;
const MAX_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const GIT_EXECUTABLE = "/usr/bin/git";

/**
 * Separate from the H2 policy file on purpose: authorizing the frozen historical ladder must not
 * implicitly authorize the AI-TWIN/Trader additive lane.
 */
export const POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH =
  "/etc/waia/post-h2-approved-human-key.sha256" as const;

export class PostH2MigrationOperatorError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`POST_H2_MIGRATION_REFUSED:${code}:${detail}`);
    this.name = "PostH2MigrationOperatorError";
  }
}

export function refusePostH2(code: string, detail: string): never {
  throw new PostH2MigrationOperatorError(code, detail);
}

export const POST_H2_MIGRATION_MANIFEST: Readonly<Record<PostH2Step, PostH2MigrationIdentity>> =
  Object.freeze({
    // DEE-871 / PR #593. Creates only additive public.ai_twin_* objects; it grants nothing,
    // enables no RLS and touches no Trader relation, so there is nothing pre-existing to own.
    "0209": Object.freeze({
      step: "0209",
      idx: 209,
      when: 1780000000209,
      tag: "0209_ai_twin_epistemic_persistence_v1",
      path: "db/migrations_postgres/0209_ai_twin_epistemic_persistence_v1.sql",
      sourceCommit: "b10f7edcb2187253355399ca5dfb82bac0177c12",
      sourceBlob: "baa60df04b1d8e2efa128ec645c44d7c956ae620",
      sha256: "abed7b094260866d33f82aa420481bf910e70c0e331f470ef4999e66e6c6f397",
      predecessor: "0208",
      lockRelations: [],
      ownerRelations: [],
    }),
    // DEE-1015 / PR #599. Grants narrow column SELECT and creates assignment-bound policies on
    // two relations established at or before 0205, so both must be owned by this authority.
    "0210": Object.freeze({
      step: "0210",
      idx: 210,
      when: 1780000000210,
      tag: "0210_trader_account_observation_credential_v1",
      path: "db/migrations_postgres/0210_trader_account_observation_credential_v1.sql",
      sourceCommit: "4b6081342702e0322d0bda4c64f00cbf04704b4e",
      sourceBlob: "302d215e41ff9f3e2409473479b81d1611ca919e",
      sha256: "1ab9f641f02cdf51f7fbefcc910163e3834c20aacbe7ea12a71163f547983efb",
      predecessor: "0209",
      lockRelations: ["public.exchange_credentials", "public.trader_account_collection_state"],
      ownerRelations: ["public.exchange_credentials", "public.trader_account_collection_state"],
    }),
  });

const ATTESTATION_ASSERTIONS: Readonly<
  Record<PostH2AttestationKind, PostH2HumanAttestation["assertion"]>
> = Object.freeze({
  RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
  WRITER_QUIESCENCE: "WRITERS_QUIESCED",
  TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
  CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_POST_H2_STEP",
});

export function parsePostH2Step(value: string): PostH2Step {
  if (value === "0205" || value === "0206" || value === "0207" || value === "0208") {
    refusePostH2("H2_LANE_STEP", `${value} belongs to the frozen H2 operator`);
  }
  if (!POST_H2_STEPS.includes(value as PostH2Step)) {
    refusePostH2("UNSUPPORTED_STEP", `expected one of ${POST_H2_STEPS.join(",")}`);
  }
  return value as PostH2Step;
}

function git(repoRoot: string, args: readonly string[], binary = false): Buffer | string {
  const result = spawnSync(GIT_EXECUTABLE, ["-C", repoRoot, ...args], {
    encoding: binary ? null : "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  if (result.status !== 0) {
    refusePostH2("PINNED_GIT_OBJECT_MISSING", args.join(" "));
  }
  return binary ? Buffer.from(result.stdout as Buffer) : String(result.stdout).trim();
}

/** SQL comes from the pinned Git object, never from the mutable checkout. */
export function readPinnedPostH2MigrationSql(
  repoRoot: string,
  identity: PostH2MigrationIdentity,
): Buffer {
  const commit = git(repoRoot, [
    "rev-parse",
    "--verify",
    `${identity.sourceCommit}^{commit}`,
  ]) as string;
  if (commit !== identity.sourceCommit || !GIT_SHA1.test(commit)) {
    refusePostH2("SOURCE_COMMIT_MISMATCH", identity.step);
  }
  const blob = git(repoRoot, [
    "rev-parse",
    "--verify",
    `${identity.sourceCommit}:${identity.path}`,
  ]) as string;
  if (blob !== identity.sourceBlob || !GIT_SHA1.test(blob)) {
    refusePostH2("SOURCE_BLOB_MISMATCH", identity.step);
  }
  const bytes = git(repoRoot, ["cat-file", "blob", identity.sourceBlob], true) as Buffer;
  if (sha256(bytes) !== identity.sha256) {
    refusePostH2("SOURCE_SHA256_MISMATCH", identity.step);
  }
  return bytes;
}

/**
 * The lawful entry state is exactly the journal H2 leaves at 0208, taken from H2's own pinned
 * closure so the two lanes can never disagree about what "canonical through 0208" means.
 */
export function loadPostH2CanonicalSource(
  repoRoot: string,
  step: PostH2Step,
): PostH2CanonicalSource {
  const root = resolve(repoRoot);
  const selected = POST_H2_MIGRATION_MANIFEST[step];
  const sql = readPinnedPostH2MigrationSql(root, selected);
  const throughH2 = loadH2CanonicalSource(root, POST_H2_H2_TERMINAL_STEP);
  const expectedPredecessorPrefix: PostH2AppliedMigration[] = [...throughH2.expectedAppliedPrefix];
  for (const priorStep of POST_H2_STEPS) {
    if (priorStep === step) break;
    const prior = POST_H2_MIGRATION_MANIFEST[priorStep];
    // Every earlier step in this lane is re-pinned, so 0210 cannot be prepared against an
    // unverifiable 0209 source.
    readPinnedPostH2MigrationSql(root, prior);
    expectedPredecessorPrefix.push(
      Object.freeze({ hash: prior.sha256, createdAt: String(prior.when) }),
    );
  }
  const expectedTail = String(
    selected.predecessor === "0208"
      ? H2_MIGRATION_MANIFEST[POST_H2_H2_TERMINAL_STEP].when
      : POST_H2_MIGRATION_MANIFEST[selected.predecessor].when,
  );
  if (
    expectedPredecessorPrefix.length !== selected.idx ||
    expectedPredecessorPrefix.at(-1)?.createdAt !== expectedTail
  ) {
    refusePostH2("PINNED_PREFIX_INVALID", step);
  }
  return Object.freeze({
    selected,
    sql,
    expectedPredecessorPrefix: Object.freeze([...expectedPredecessorPrefix]),
    expectedAppliedPrefix: Object.freeze([
      ...expectedPredecessorPrefix,
      Object.freeze({ hash: selected.sha256, createdAt: String(selected.when) }),
    ]),
  });
}

/**
 * Ordered, total equality against the expected journal. Unlike the H2 comparator this admits the
 * 0209 identity, because the ratified lane order requires 0209 before 0210 — it never admits a
 * gap, an extra row, a reordering or a hash/timestamp substitution.
 */
export function assertExactPostH2Journal(
  actual: readonly PostH2AppliedMigration[],
  expected: readonly PostH2AppliedMigration[],
  context: string,
): string {
  const actualCreated = new Set(actual.map((row) => row.createdAt));
  const actualHashes = new Set(actual.map((row) => row.hash));
  if (actualCreated.size !== actual.length || actualHashes.size !== actual.length) {
    refusePostH2("LIVE_JOURNAL_DUPLICATE", context);
  }
  if (actual.length !== expected.length) {
    refusePostH2(
      actual.length > expected.length ? "LIVE_JOURNAL_EXTRA" : "LIVE_JOURNAL_GAP",
      `${context}: expected ${expected.length}, observed ${actual.length}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const observed = actual[index];
    const canonical = expected[index];
    if (!observed || observed.createdAt !== canonical?.createdAt) {
      refusePostH2("LIVE_JOURNAL_CREATED_AT_MISMATCH", `${context}: index ${index}`);
    }
    if (observed.hash !== canonical.hash) {
      refusePostH2("LIVE_JOURNAL_HASH_MISMATCH", `${context}: index ${index}`);
    }
  }
  return semanticDigest(actual);
}

export function classifyPostH2VerifyOnlyJournal(
  actual: readonly PostH2AppliedMigration[],
  source: PostH2CanonicalSource,
): Readonly<{
  classification: "SELECTED_STEP_COMMITTED" | "PREDECESSOR_NOT_APPLIED";
  journalDigest: string;
}> {
  try {
    return Object.freeze({
      classification: "SELECTED_STEP_COMMITTED",
      journalDigest: assertExactPostH2Journal(
        actual,
        source.expectedAppliedPrefix,
        `${source.selected.step}:verify-applied`,
      ),
    });
  } catch (appliedError) {
    try {
      return Object.freeze({
        classification: "PREDECESSOR_NOT_APPLIED",
        journalDigest: assertExactPostH2Journal(
          actual,
          source.expectedPredecessorPrefix,
          `${source.selected.step}:verify-predecessor`,
        ),
      });
    } catch {
      // Neither lawful state holds: report the applied-state contradiction rather than guessing.
      throw appliedError;
    }
  }
}

function readPrivateBytes(path: string, maxBytes: number): Buffer {
  if (!isAbsolute(path)) refusePostH2("ATTESTATION_PATH", "path must be absolute");
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    refusePostH2("ATTESTATION_PATH", "attestation is missing");
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    realpathSync(path) !== resolve(path) ||
    stat.size > maxBytes
  ) {
    refusePostH2("ATTESTATION_PRIVATE_PATH", path);
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev ||
      opened.size > maxBytes
    ) {
      refusePostH2("ATTESTATION_CHANGED", path);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readPrivateJson(path: string): unknown {
  try {
    return JSON.parse(readPrivateBytes(path, MAX_ATTESTATION_BYTES).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof PostH2MigrationOperatorError) throw error;
    refusePostH2("ATTESTATION_INVALID_JSON", path);
  }
}

export function readPostH2ApprovedHumanKeySha256(): string {
  let stat;
  try {
    stat = lstatSync(POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  } catch {
    refusePostH2("HUMAN_TRUST_POLICY_MISSING", POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0 ||
    (stat.mode & 0o022) !== 0 ||
    stat.size > 128 ||
    realpathSync(POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH) !== POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH
  ) {
    refusePostH2("HUMAN_TRUST_POLICY_UNSAFE", POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  }
  const fd = openSync(
    POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev ||
      opened.uid !== 0 ||
      (opened.mode & 0o022) !== 0 ||
      opened.size > 128
    ) {
      refusePostH2("HUMAN_TRUST_POLICY_CHANGED", POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH);
    }
    const fingerprint = readFileSync(fd, "utf8").trim();
    if (!SHA256.test(fingerprint)) {
      refusePostH2("HUMAN_TRUST_POLICY_INVALID", POST_H2_APPROVED_HUMAN_KEY_POLICY_PATH);
    }
    return fingerprint;
  } finally {
    closeSync(fd);
  }
}

function validUtc(value: string): boolean {
  const epoch = Date.parse(value);
  return (
    Number.isFinite(epoch) &&
    new Date(epoch).toISOString() === value &&
    epoch <= Date.now() + 60_000 &&
    epoch >= Date.now() - MAX_ATTESTATION_AGE_MS
  );
}

function loadTrustedHumanKey(path: string, expectedSha256: string) {
  if (!SHA256.test(expectedSha256)) {
    refusePostH2("HUMAN_SIGNING_KEY_FINGERPRINT", "expected SHA-256");
  }
  const bytes = readPrivateBytes(path, MAX_PUBLIC_KEY_BYTES);
  if (sha256(bytes) !== expectedSha256) {
    refusePostH2("HUMAN_SIGNING_KEY_FINGERPRINT", "public key mismatch");
  }
  try {
    const key = createPublicKey(bytes);
    if (key.asymmetricKeyType !== "ed25519") {
      refusePostH2("HUMAN_SIGNING_KEY_TYPE", "Ed25519 required");
    }
    return Object.freeze({ key, sha256: expectedSha256 });
  } catch (error) {
    if (error instanceof PostH2MigrationOperatorError) throw error;
    refusePostH2("HUMAN_SIGNING_KEY_INVALID", "public key parse");
  }
}

export function assertPostH2HumanAttestation(
  value: unknown,
  expectedKind: PostH2AttestationKind,
  expectedStep: PostH2Step,
  trustedKey: ReturnType<typeof loadTrustedHumanKey>,
): PostH2HumanAttestation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refusePostH2("ATTESTATION_SHAPE", expectedKind);
  }
  const input = value as Record<string, unknown>;
  const exactKeys = [
    "schemaVersion",
    "kind",
    "assertion",
    "ceremonyId",
    "requestId",
    "selectedStep",
    "targetFingerprint",
    "expectedDatabaseName",
    "expectedMigrationAuthority",
    "operatorIdentity",
    "humanApproverIdentity",
    "evidenceDigestHex",
    "signingKeySha256",
    "issuedAt",
    "contentDigestHex",
    "signatureBase64",
  ].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(exactKeys)) {
    refusePostH2("ATTESTATION_SHAPE", expectedKind);
  }
  const { contentDigestHex, signatureBase64, ...body } = input;
  let signature: Buffer;
  try {
    signature = Buffer.from(String(signatureBase64), "base64");
  } catch {
    refusePostH2("ATTESTATION_SIGNATURE", expectedKind);
  }
  if (
    // The post-H2 schema version is inside the signed body, so an H2 packet cannot be replayed.
    input.schemaVersion !== POST_H2_HUMAN_ATTESTATION_SCHEMA ||
    input.kind !== expectedKind ||
    input.assertion !== ATTESTATION_ASSERTIONS[expectedKind] ||
    input.selectedStep !== expectedStep ||
    !SHA256.test(String(input.targetFingerprint)) ||
    !SHA256.test(String(input.evidenceDigestHex)) ||
    input.signingKeySha256 !== trustedKey.sha256 ||
    !SHA256.test(String(contentDigestHex)) ||
    typeof signatureBase64 !== "string" ||
    signature.length !== 64 ||
    signature.toString("base64") !== signatureBase64 ||
    !validUtc(String(input.issuedAt)) ||
    !UUID_V4.test(String(input.ceremonyId)) ||
    !UUID_V4.test(String(input.requestId)) ||
    ![
      input.expectedDatabaseName,
      input.expectedMigrationAuthority,
      input.operatorIdentity,
      input.humanApproverIdentity,
    ].every((item) => typeof item === "string" && SAFE_IDENTITY.test(item)) ||
    semanticDigest(body) !== contentDigestHex ||
    !verifySignature(null, Buffer.from(String(contentDigestHex), "utf8"), trustedKey.key, signature)
  ) {
    refusePostH2("ATTESTATION_INVALID", expectedKind);
  }
  if (expectedKind === "TARGET_IDENTITY" && input.evidenceDigestHex !== input.targetFingerprint) {
    refusePostH2("TARGET_ATTESTATION_MISMATCH", expectedKind);
  }
  return Object.freeze(input as PostH2HumanAttestation);
}

export function loadPostH2CeremonyEvidence(
  input: Readonly<{
    step: PostH2Step;
    trustedHumanPublicKeyPath: string;
    expectedHumanSigningKeySha256: string;
    restorePointPath: string;
    writerQuiescencePath: string;
    targetIdentityPath: string;
    ceremonyAuthorizationPath: string;
  }>,
): PostH2CeremonyEvidence {
  const trustedKey = loadTrustedHumanKey(
    input.trustedHumanPublicKeyPath,
    input.expectedHumanSigningKeySha256,
  );
  const evidence = Object.freeze({
    restorePoint: assertPostH2HumanAttestation(
      readPrivateJson(input.restorePointPath),
      "RESTORE_POINT",
      input.step,
      trustedKey,
    ),
    writerQuiescence: assertPostH2HumanAttestation(
      readPrivateJson(input.writerQuiescencePath),
      "WRITER_QUIESCENCE",
      input.step,
      trustedKey,
    ),
    targetIdentity: assertPostH2HumanAttestation(
      readPrivateJson(input.targetIdentityPath),
      "TARGET_IDENTITY",
      input.step,
      trustedKey,
    ),
    ceremonyAuthorization: assertPostH2HumanAttestation(
      readPrivateJson(input.ceremonyAuthorizationPath),
      "CEREMONY_AUTHORIZATION",
      input.step,
      trustedKey,
    ),
  });
  const first = evidence.restorePoint;
  for (const attestation of Object.values(evidence)) {
    if (
      attestation.ceremonyId !== first.ceremonyId ||
      attestation.requestId !== first.requestId ||
      attestation.selectedStep !== first.selectedStep ||
      attestation.targetFingerprint !== first.targetFingerprint ||
      attestation.expectedDatabaseName !== first.expectedDatabaseName ||
      attestation.expectedMigrationAuthority !== first.expectedMigrationAuthority ||
      attestation.operatorIdentity !== first.operatorIdentity ||
      attestation.humanApproverIdentity !== first.humanApproverIdentity
    ) {
      refusePostH2("ATTESTATION_BINDING_MISMATCH", attestation.kind);
    }
  }
  return evidence;
}
