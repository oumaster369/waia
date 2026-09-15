import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
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

export const H2_MIGRATION_RECEIPT_SCHEMA =
  "waia.trader.h2.migration-operation-receipt.v1" as const;
export const H2_HUMAN_ATTESTATION_SCHEMA =
  "waia.trader.h2.human-attestation.v1" as const;

export const H2_STEPS = ["0205", "0206", "0207", "0208"] as const;
export type H2Step = (typeof H2_STEPS)[number];
export type H2AttestationKind = "RESTORE_POINT" | "WRITER_QUIESCENCE" | "TARGET_IDENTITY" |
  "CEREMONY_AUTHORIZATION";

export type H2MigrationIdentity = Readonly<{
  step: "0204" | H2Step;
  idx: number;
  when: number;
  tag: string;
  path: string;
  sourceCommit: string;
  sourceBlob: string;
  sha256: string;
  predecessor: "0203" | "0204" | "0205" | "0206" | "0207";
  lockRelations: readonly string[];
  ownerRelations: readonly string[];
}>;

export type H2AppliedMigration = Readonly<{
  hash: string;
  createdAt: string;
}>;

export type H2HumanAttestation = Readonly<{
  schemaVersion: typeof H2_HUMAN_ATTESTATION_SCHEMA;
  kind: H2AttestationKind;
  assertion: "APPROVED_RESTORE_POINT_AVAILABLE" | "WRITERS_QUIESCED" |
    "TARGET_IDENTITY_APPROVED" | "AUTHORIZE_EXACT_H2_STEP";
  ceremonyId: string;
  requestId: string;
  selectedStep: H2Step;
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

export type H2CeremonyEvidence = Readonly<{
  restorePoint: H2HumanAttestation;
  writerQuiescence: H2HumanAttestation;
  targetIdentity: H2HumanAttestation;
  ceremonyAuthorization: H2HumanAttestation;
}>;

export type H2CanonicalSource = Readonly<{
  selected: H2MigrationIdentity;
  sql: Buffer;
  expectedPredecessorPrefix: readonly H2AppliedMigration[];
  expectedAppliedPrefix: readonly H2AppliedMigration[];
}>;

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_ATTESTATION_BYTES = 16 * 1024;
const MAX_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const GIT_EXECUTABLE = "/usr/bin/git";
const H2_BASELINE_JOURNAL_BLOB = "28d6d401ac963eddef71d2585077a6385f43acbb";
const H2_BASELINE_JOURNAL_SHA256 =
  "520ef703b39e9227bbf2158176bbfaada7b10ff9e4a5cd400709b083809b7447";
const H2_BASELINE_CLOSURE_DIGEST =
  "4a17cc98c61708b3fc31122a08989988d8382d319061dad37695f76b8d30822e";
export const H2_APPROVED_HUMAN_KEY_POLICY_PATH =
  "/etc/waia/h2-approved-human-key.sha256" as const;

export class H2MigrationOperatorError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`H2_MIGRATION_REFUSED:${code}:${detail}`);
    this.name = "H2MigrationOperatorError";
  }
}

export function refuseH2(code: string, detail: string): never {
  throw new H2MigrationOperatorError(code, detail);
}

export const H2_BASELINE_0204: H2MigrationIdentity = Object.freeze({
  step: "0204",
  idx: 204,
  when: 1780000000204,
  tag: "0204_historical_preparation_events_v2",
  path: "db/migrations_postgres/0204_historical_preparation_events_v2.sql",
  sourceCommit: "8023bb1980d9f02e61db4024f725aa16161c32dd",
  sourceBlob: "59ea9dd882ecd1f29787366f46889aaa560fa843",
  sha256: "3d276ce097da14451e3114e112d1adef3fae5a63b719380244bb8e82ebb05a98",
  predecessor: "0203",
  lockRelations: [],
  ownerRelations: [],
});

export const H2_MIGRATION_MANIFEST: Readonly<Record<H2Step, H2MigrationIdentity>> =
  Object.freeze({
    "0205": Object.freeze({
      step: "0205",
      idx: 205,
      when: 1780000000205,
      tag: "0205_trader_account_observation_v1",
      path: "db/migrations_postgres/0205_trader_account_observation_v1.sql",
      sourceCommit: "c1d11c26a820315ca8cab0d04361223d4d94b53d",
      sourceBlob: "c75c42d2bae15beea5741161abfb18afae0b4c3b",
      sha256: "aa511acd320b653858e4b064dfeb1af744a4d7f81cffaf72fb67cd91f1fffde1",
      predecessor: "0204",
      lockRelations: ["public.exchange_credentials"],
      ownerRelations: ["public.exchange_credentials"],
    }),
    "0206": Object.freeze({
      step: "0206",
      idx: 206,
      when: 1780000000206,
      tag: "0206_historical_brier_admission_v3",
      path: "db/migrations_postgres/0206_historical_brier_admission_v3.sql",
      sourceCommit: "657914b1d6b4b897619cbfaef5d558ae1378efc9",
      sourceBlob: "22edad8bbee008f58592e263b78f01e162804543",
      sha256: "20a768b30a3b0cf833ee29058f1343da1842947d9110d162e8a513cfa6b171ab",
      predecessor: "0205",
      lockRelations: ["public.trader_scientific_admission_receipt_v1"],
      ownerRelations: ["public.trader_scientific_admission_receipt_v1"],
    }),
    "0207": Object.freeze({
      step: "0207",
      idx: 207,
      when: 1780000000207,
      tag: "0207_historical_cody_admission_v4",
      path: "db/migrations_postgres/0207_historical_cody_admission_v4.sql",
      sourceCommit: "7e0498f7a7e922d35a5c1ca6d61e1bf995e1c76d",
      sourceBlob: "d50d389d736bc2ab3a7ccbaf58eefd4a5ac168ac",
      sha256: "fcd4e14c2bcb8a3e46b7267f25c662544b9d41de1370434785fafb240eff9491",
      predecessor: "0206",
      lockRelations: ["public.trader_scientific_admission_receipt_v1"],
      ownerRelations: ["public.trader_scientific_admission_receipt_v1"],
    }),
    "0208": Object.freeze({
      step: "0208",
      idx: 208,
      when: 1780000000208,
      tag: "0208_historical_terminal_receipts_v1",
      path: "db/migrations_postgres/0208_historical_terminal_receipts_v1.sql",
      sourceCommit: "d7d5941a995b83473acb6e00c42d5252c44b2303",
      sourceBlob: "6f86bb554f4ec6a18ad3002c4b6db2d8733f7c65",
      sha256: "d85e8e34da28860073d9c2f8f9ac9d7e58c3d296e905b1b73ba65a79cfe407f0",
      predecessor: "0207",
      lockRelations: [
        "public.organizations",
        "public.trader_historical_technical_proposal_v2",
        "public.trader_historical_proposal_ratification_v2",
        "public.trader_historical_four_surface_ratified_admission_v2",
      ],
      ownerRelations: [
        "public.organizations",
        "public.trader_historical_technical_proposal_v2",
        "public.trader_historical_proposal_ratification_v2",
        "public.trader_historical_four_surface_ratified_admission_v2",
      ],
    }),
  });

const ATTESTATION_ASSERTIONS: Readonly<Record<H2AttestationKind,
  H2HumanAttestation["assertion"]>> = Object.freeze({
    RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
    WRITER_QUIESCENCE: "WRITERS_QUIESCED",
    TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_H2_STEP",
  });

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function semanticDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function parseH2Step(value: string): H2Step {
  if (value === "0209") refuseH2("0209_FORBIDDEN", "0209 is outside the Trader H2 ladder");
  if (!H2_STEPS.includes(value as H2Step)) {
    refuseH2("UNSUPPORTED_STEP", `expected one of ${H2_STEPS.join(",")}`);
  }
  return value as H2Step;
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
    refuseH2("PINNED_GIT_OBJECT_MISSING", args.join(" "));
  }
  return binary ? Buffer.from(result.stdout as Buffer) : String(result.stdout).trim();
}

export function readPinnedH2MigrationSql(
  repoRoot: string,
  identity: H2MigrationIdentity,
): Buffer {
  const commit = git(
    repoRoot,
    ["rev-parse", "--verify", `${identity.sourceCommit}^{commit}`],
  ) as string;
  if (commit !== identity.sourceCommit || !GIT_SHA1.test(commit)) {
    refuseH2("SOURCE_COMMIT_MISMATCH", identity.step);
  }
  const blob = git(
    repoRoot,
    ["rev-parse", "--verify", `${identity.sourceCommit}:${identity.path}`],
  ) as string;
  if (blob !== identity.sourceBlob || !GIT_SHA1.test(blob)) {
    refuseH2("SOURCE_BLOB_MISMATCH", identity.step);
  }
  const bytes = git(repoRoot, ["cat-file", "blob", identity.sourceBlob], true) as Buffer;
  if (sha256(bytes) !== identity.sha256) {
    refuseH2("SOURCE_SHA256_MISMATCH", identity.step);
  }
  return bytes;
}

type GitJournal = Readonly<{
  entries: readonly Readonly<{ idx: number; when: number; tag: string }>[];
}>;

function readBaselineJournal(repoRoot: string): GitJournal {
  const path = "db/migrations_postgres/meta/_journal.json";
  const blob = git(repoRoot, [
    "rev-parse",
    "--verify",
    `${H2_BASELINE_0204.sourceCommit}:${path}`,
  ]) as string;
  if (blob !== H2_BASELINE_JOURNAL_BLOB) {
    refuseH2("PINNED_JOURNAL_IDENTITY", "baseline journal blob mismatch");
  }
  const bytes = git(repoRoot, ["cat-file", "blob", blob], true) as Buffer;
  if (sha256(bytes) !== H2_BASELINE_JOURNAL_SHA256) {
    refuseH2("PINNED_JOURNAL_IDENTITY", "baseline journal SHA-256 mismatch");
  }
  let journal: GitJournal;
  try {
    journal = JSON.parse(bytes.toString("utf8")) as GitJournal;
  } catch {
    refuseH2("PINNED_JOURNAL_INVALID", "baseline journal is not JSON");
  }
  if (!Array.isArray(journal.entries) || journal.entries.length !== 205) {
    refuseH2("PINNED_JOURNAL_INVALID", "baseline must contain exactly 0000..0204");
  }
  const tags = new Set<string>();
  const timestamps = new Set<number>();
  journal.entries.forEach((entry, idx) => {
    if (
      entry.idx !== idx ||
      !entry.tag.startsWith(String(idx).padStart(4, "0") + "_") ||
      !Number.isSafeInteger(entry.when) ||
      tags.has(entry.tag) ||
      timestamps.has(entry.when)
    ) {
      refuseH2("PINNED_JOURNAL_INVALID", `entry ${idx}`);
    }
    tags.add(entry.tag);
    timestamps.add(entry.when);
  });
  const tip = journal.entries[204];
  if (tip?.tag !== H2_BASELINE_0204.tag || tip.when !== H2_BASELINE_0204.when) {
    refuseH2("PINNED_JOURNAL_INVALID", "0204 identity mismatch");
  }
  return journal;
}

function baselinePrefix(repoRoot: string): H2AppliedMigration[] {
  const journal = readBaselineJournal(repoRoot);
  const prefix = journal.entries.map((entry) => {
    const path = `db/migrations_postgres/${entry.tag}.sql`;
    const blob = git(repoRoot, [
      "rev-parse",
      "--verify",
      `${H2_BASELINE_0204.sourceCommit}:${path}`,
    ]) as string;
    const bytes = git(repoRoot, ["cat-file", "blob", blob], true) as Buffer;
    if (entry.idx === 204) {
      if (blob !== H2_BASELINE_0204.sourceBlob || sha256(bytes) !== H2_BASELINE_0204.sha256) {
        refuseH2("SOURCE_IDENTITY_MISMATCH", "0204");
      }
    }
    return Object.freeze({ hash: sha256(bytes), createdAt: String(entry.when) });
  });
  if (semanticDigest(prefix) !== H2_BASELINE_CLOSURE_DIGEST) {
    refuseH2("PINNED_BASELINE_CLOSURE", "0000..0204 digest mismatch");
  }
  return prefix;
}

export function loadH2CanonicalSource(repoRoot: string, step: H2Step): H2CanonicalSource {
  const root = resolve(repoRoot);
  const selected = H2_MIGRATION_MANIFEST[step];
  const sql = readPinnedH2MigrationSql(root, selected);
  const expectedPredecessorPrefix = baselinePrefix(root);
  for (const priorStep of H2_STEPS) {
    if (priorStep === step) break;
    const prior = H2_MIGRATION_MANIFEST[priorStep];
    readPinnedH2MigrationSql(root, prior);
    expectedPredecessorPrefix.push(
      Object.freeze({ hash: prior.sha256, createdAt: String(prior.when) }),
    );
  }
  if (
    expectedPredecessorPrefix.length !== selected.idx ||
    expectedPredecessorPrefix.at(-1)?.createdAt !==
      String(selected.step === "0205"
        ? H2_BASELINE_0204.when
        : H2_MIGRATION_MANIFEST[selected.predecessor as H2Step].when)
  ) {
    refuseH2("PINNED_PREFIX_INVALID", step);
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

export function assertExactJournal(
  actual: readonly H2AppliedMigration[],
  expected: readonly H2AppliedMigration[],
  context: string,
): string {
  const actualCreated = new Set(actual.map((row) => row.createdAt));
  const actualHashes = new Set(actual.map((row) => row.hash));
  if (actualCreated.size !== actual.length || actualHashes.size !== actual.length) {
    refuseH2("LIVE_JOURNAL_DUPLICATE", context);
  }
  if (actual.some((row) => row.createdAt === "1780000000209")) {
    refuseH2("0209_FORBIDDEN", "0209 journal identity observed");
  }
  if (actual.length !== expected.length) {
    refuseH2(
      actual.length > expected.length ? "LIVE_JOURNAL_EXTRA" : "LIVE_JOURNAL_GAP",
      `${context}: expected ${expected.length}, observed ${actual.length}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const observed = actual[index];
    const canonical = expected[index];
    if (!observed || observed.createdAt !== canonical?.createdAt) {
      refuseH2("LIVE_JOURNAL_CREATED_AT_MISMATCH", `${context}: index ${index}`);
    }
    if (observed.hash !== canonical.hash) {
      refuseH2("LIVE_JOURNAL_HASH_MISMATCH", `${context}: index ${index}`);
    }
  }
  return semanticDigest(actual);
}

export function classifyH2VerifyOnlyJournal(
  actual: readonly H2AppliedMigration[],
  source: H2CanonicalSource,
): Readonly<{
  classification: "SELECTED_STEP_COMMITTED" | "PREDECESSOR_NOT_APPLIED";
  journalDigest: string;
}> {
  try {
    return Object.freeze({
      classification: "SELECTED_STEP_COMMITTED",
      journalDigest: assertExactJournal(
        actual,
        source.expectedAppliedPrefix,
        `${source.selected.step}:verify-applied`,
      ),
    });
  } catch (appliedError) {
    try {
      return Object.freeze({
        classification: "PREDECESSOR_NOT_APPLIED",
        journalDigest: assertExactJournal(
          actual,
          source.expectedPredecessorPrefix,
          `${source.selected.step}:verify-predecessor`,
        ),
      });
    } catch {
      throw appliedError;
    }
  }
}

function readPrivateBytes(path: string, maxBytes: number): Buffer {
  if (!isAbsolute(path)) refuseH2("ATTESTATION_PATH", "path must be absolute");
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    refuseH2("ATTESTATION_PATH", "attestation is missing");
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    realpathSync(path) !== resolve(path) ||
    stat.size > maxBytes
  ) {
    refuseH2("ATTESTATION_PRIVATE_PATH", path);
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
      refuseH2("ATTESTATION_CHANGED", path);
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
    if (error instanceof H2MigrationOperatorError) throw error;
    refuseH2("ATTESTATION_INVALID_JSON", path);
  }
}

export function readH2ApprovedHumanKeySha256(): string {
  let stat;
  try {
    stat = lstatSync(H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  } catch {
    refuseH2("HUMAN_TRUST_POLICY_MISSING", H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0 ||
    (stat.mode & 0o022) !== 0 ||
    stat.size > 128 ||
    realpathSync(H2_APPROVED_HUMAN_KEY_POLICY_PATH) !== H2_APPROVED_HUMAN_KEY_POLICY_PATH
  ) {
    refuseH2("HUMAN_TRUST_POLICY_UNSAFE", H2_APPROVED_HUMAN_KEY_POLICY_PATH);
  }
  const fd = openSync(
    H2_APPROVED_HUMAN_KEY_POLICY_PATH,
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
      refuseH2("HUMAN_TRUST_POLICY_CHANGED", H2_APPROVED_HUMAN_KEY_POLICY_PATH);
    }
    const fingerprint = readFileSync(fd, "utf8").trim();
    if (!SHA256.test(fingerprint)) {
      refuseH2("HUMAN_TRUST_POLICY_INVALID", H2_APPROVED_HUMAN_KEY_POLICY_PATH);
    }
    return fingerprint;
  } finally {
    closeSync(fd);
  }
}

function validUtc(value: string): boolean {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value &&
    epoch <= Date.now() + 60_000 && epoch >= Date.now() - MAX_ATTESTATION_AGE_MS;
}

function loadTrustedHumanKey(path: string, expectedSha256: string) {
  if (!SHA256.test(expectedSha256)) {
    refuseH2("HUMAN_SIGNING_KEY_FINGERPRINT", "expected SHA-256");
  }
  const bytes = readPrivateBytes(path, MAX_PUBLIC_KEY_BYTES);
  if (sha256(bytes) !== expectedSha256) {
    refuseH2("HUMAN_SIGNING_KEY_FINGERPRINT", "public key mismatch");
  }
  try {
    const key = createPublicKey(bytes);
    if (key.asymmetricKeyType !== "ed25519") {
      refuseH2("HUMAN_SIGNING_KEY_TYPE", "Ed25519 required");
    }
    return Object.freeze({ key, sha256: expectedSha256 });
  } catch (error) {
    if (error instanceof H2MigrationOperatorError) throw error;
    refuseH2("HUMAN_SIGNING_KEY_INVALID", "public key parse");
  }
}

export function assertH2HumanAttestation(
  value: unknown,
  expectedKind: H2AttestationKind,
  expectedStep: H2Step,
  trustedKey: ReturnType<typeof loadTrustedHumanKey>,
): H2HumanAttestation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuseH2("ATTESTATION_SHAPE", expectedKind);
  }
  const input = value as Record<string, unknown>;
  const exactKeys = [
    "schemaVersion", "kind", "assertion", "ceremonyId", "requestId", "selectedStep",
    "targetFingerprint", "expectedDatabaseName", "expectedMigrationAuthority",
    "operatorIdentity", "humanApproverIdentity", "evidenceDigestHex", "signingKeySha256",
    "issuedAt", "contentDigestHex", "signatureBase64",
  ].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(exactKeys)) {
    refuseH2("ATTESTATION_SHAPE", expectedKind);
  }
  const { contentDigestHex, signatureBase64, ...body } = input;
  let signature: Buffer;
  try {
    signature = Buffer.from(String(signatureBase64), "base64");
  } catch {
    refuseH2("ATTESTATION_SIGNATURE", expectedKind);
  }
  if (
    input.schemaVersion !== H2_HUMAN_ATTESTATION_SCHEMA ||
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
    !verifySignature(
      null,
      Buffer.from(String(contentDigestHex), "utf8"),
      trustedKey.key,
      signature,
    )
  ) {
    refuseH2("ATTESTATION_INVALID", expectedKind);
  }
  if (
    expectedKind === "TARGET_IDENTITY" &&
    input.evidenceDigestHex !== input.targetFingerprint
  ) {
    refuseH2("TARGET_ATTESTATION_MISMATCH", expectedKind);
  }
  return Object.freeze(input as H2HumanAttestation);
}

export function loadH2CeremonyEvidence(input: Readonly<{
  step: H2Step;
  trustedHumanPublicKeyPath: string;
  expectedHumanSigningKeySha256: string;
  restorePointPath: string;
  writerQuiescencePath: string;
  targetIdentityPath: string;
  ceremonyAuthorizationPath: string;
}>): H2CeremonyEvidence {
  const trustedKey = loadTrustedHumanKey(
    input.trustedHumanPublicKeyPath,
    input.expectedHumanSigningKeySha256,
  );
  const evidence = Object.freeze({
    restorePoint: assertH2HumanAttestation(
      readPrivateJson(input.restorePointPath),
      "RESTORE_POINT",
      input.step,
      trustedKey,
    ),
    writerQuiescence: assertH2HumanAttestation(
      readPrivateJson(input.writerQuiescencePath),
      "WRITER_QUIESCENCE",
      input.step,
      trustedKey,
    ),
    targetIdentity: assertH2HumanAttestation(
      readPrivateJson(input.targetIdentityPath),
      "TARGET_IDENTITY",
      input.step,
      trustedKey,
    ),
    ceremonyAuthorization: assertH2HumanAttestation(
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
      refuseH2("ATTESTATION_BINDING_MISMATCH", attestation.kind);
    }
  }
  return evidence;
}
