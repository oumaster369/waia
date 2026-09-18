/**
 * DEE-1022: Human evidence model for leftover `org_scope` hygiene.
 *
 * Distinct schema, trust path, selected step and assertion vocabulary from H2 and post-H2 so
 * those ceremony packets cannot authorize a DROP. This lane never writes a Drizzle journal row
 * and never edits 0205–0211 SQL.
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

import { canonicalJson, semanticDigest, sha256 } from "./postgres-h2-migration-manifest-v1";
import {
  AUTHORIZED_PARTNER_ALPHA0_ORG_ID,
  LEFTOVER_ORG_SCOPE_POLICY_NAME,
  LEFTOVER_ORG_SCOPE_RELATIONS,
} from "./postgres-h2-leftover-org-scope-policy-v1";

export { canonicalJson, semanticDigest, sha256 };

export const H2_ORG_SCOPE_HYGIENE_RECEIPT_SCHEMA =
  "waia.trader.h2.org-scope-hygiene-operation-receipt.v1" as const;
export const H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA =
  "waia.trader.h2.org-scope-hygiene-human-attestation.v1" as const;

export const H2_ORG_SCOPE_HYGIENE_STEP = "DROP_ORG_SCOPE" as const;
export type H2OrgScopeHygieneStep = typeof H2_ORG_SCOPE_HYGIENE_STEP;
export type H2OrgScopeHygieneAttestationKind =
  | "RESTORE_POINT"
  | "WRITER_QUIESCENCE"
  | "TARGET_IDENTITY"
  | "CEREMONY_AUTHORIZATION";

export const H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH =
  "/etc/waia/h2-org-scope-hygiene-approved-human-key.sha256" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_ATTESTATION_BYTES = 16 * 1024;
const MAX_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;

const ATTESTATION_ASSERTIONS = Object.freeze({
  RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
  WRITER_QUIESCENCE: "WRITERS_QUIESCED",
  TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
  CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_ORG_SCOPE_HYGIENE",
} as const);

export class H2OrgScopeHygieneOperatorError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`H2_ORG_SCOPE_HYGIENE_REFUSED:${code}:${detail}`);
    this.name = "H2OrgScopeHygieneOperatorError";
  }
}

export function refuseHygiene(code: string, detail: string): never {
  throw new H2OrgScopeHygieneOperatorError(code, detail);
}

export function leftoverOrgScopeRelationDigest(): string {
  return semanticDigest([...LEFTOVER_ORG_SCOPE_RELATIONS]);
}

export type H2OrgScopeHygieneHumanAttestation = Readonly<{
  schemaVersion: typeof H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA;
  kind: H2OrgScopeHygieneAttestationKind;
  assertion: (typeof ATTESTATION_ASSERTIONS)[H2OrgScopeHygieneAttestationKind];
  ceremonyId: string;
  requestId: string;
  selectedStep: H2OrgScopeHygieneStep;
  targetFingerprint: string;
  expectedDatabaseName: string;
  expectedMigrationAuthority: string;
  operatorIdentity: string;
  humanApproverIdentity: string;
  leftoverPolicyName: typeof LEFTOVER_ORG_SCOPE_POLICY_NAME;
  leftoverRelationDigest: string;
  authorizedOrganizationId: typeof AUTHORIZED_PARTNER_ALPHA0_ORG_ID;
  evidenceDigestHex: string;
  signingKeySha256: string;
  issuedAt: string;
  contentDigestHex: string;
  signatureBase64: string;
}>;

export type H2OrgScopeHygieneCeremonyEvidence = Readonly<{
  restorePoint: H2OrgScopeHygieneHumanAttestation;
  writerQuiescence: H2OrgScopeHygieneHumanAttestation;
  targetIdentity: H2OrgScopeHygieneHumanAttestation;
  ceremonyAuthorization: H2OrgScopeHygieneHumanAttestation;
}>;

export function parseHygieneStep(value: string): H2OrgScopeHygieneStep {
  if (value !== H2_ORG_SCOPE_HYGIENE_STEP) {
    refuseHygiene("CLI_STEP", value);
  }
  return H2_ORG_SCOPE_HYGIENE_STEP;
}

function readPrivateBytes(path: string, maxBytes: number): Buffer {
  if (!isAbsolute(path)) refuseHygiene("ATTESTATION_PATH", "path must be absolute");
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    refuseHygiene("ATTESTATION_PATH", "attestation is missing");
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    realpathSync(path) !== resolve(path) ||
    stat.size > maxBytes
  ) {
    refuseHygiene("ATTESTATION_PRIVATE_PATH", path);
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
      refuseHygiene("ATTESTATION_CHANGED", path);
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
    if (error instanceof H2OrgScopeHygieneOperatorError) throw error;
    refuseHygiene("ATTESTATION_INVALID_JSON", path);
  }
}

export function readHygieneApprovedHumanKeySha256(): string {
  let stat;
  try {
    stat = lstatSync(H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH);
  } catch {
    refuseHygiene(
      "HUMAN_TRUST_POLICY_MISSING",
      H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH,
    );
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.uid !== 0 ||
    (stat.mode & 0o022) !== 0 ||
    stat.size > 128 ||
    realpathSync(H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH) !==
      H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH
  ) {
    refuseHygiene("HUMAN_TRUST_POLICY_UNSAFE", H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH);
  }
  const fd = openSync(
    H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH,
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
      refuseHygiene(
        "HUMAN_TRUST_POLICY_CHANGED",
        H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH,
      );
    }
    const fingerprint = readFileSync(fd, "utf8").trim();
    if (!SHA256.test(fingerprint)) {
      refuseHygiene(
        "HUMAN_TRUST_POLICY_INVALID",
        H2_ORG_SCOPE_HYGIENE_APPROVED_HUMAN_KEY_POLICY_PATH,
      );
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
    refuseHygiene("HUMAN_SIGNING_KEY_FINGERPRINT", "expected SHA-256");
  }
  const bytes = readPrivateBytes(path, MAX_PUBLIC_KEY_BYTES);
  if (sha256(bytes) !== expectedSha256) {
    refuseHygiene("HUMAN_SIGNING_KEY_FINGERPRINT", "public key mismatch");
  }
  try {
    const key = createPublicKey(bytes);
    if (key.asymmetricKeyType !== "ed25519") {
      refuseHygiene("HUMAN_SIGNING_KEY_TYPE", "Ed25519 required");
    }
    return Object.freeze({ key, sha256: expectedSha256 });
  } catch (error) {
    if (error instanceof H2OrgScopeHygieneOperatorError) throw error;
    refuseHygiene("HUMAN_SIGNING_KEY_INVALID", "public key parse");
  }
}

export function assertHygieneHumanAttestation(
  value: unknown,
  expectedKind: H2OrgScopeHygieneAttestationKind,
  expectedStep: H2OrgScopeHygieneStep,
  trustedKey: ReturnType<typeof loadTrustedHumanKey>,
): H2OrgScopeHygieneHumanAttestation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuseHygiene("ATTESTATION_SHAPE", expectedKind);
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
    "leftoverPolicyName",
    "leftoverRelationDigest",
    "authorizedOrganizationId",
    "evidenceDigestHex",
    "signingKeySha256",
    "issuedAt",
    "contentDigestHex",
    "signatureBase64",
  ].sort();
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(exactKeys)) {
    refuseHygiene("ATTESTATION_SHAPE", expectedKind);
  }
  const { contentDigestHex, signatureBase64, ...body } = input;
  let signature: Buffer;
  try {
    signature = Buffer.from(String(signatureBase64), "base64");
  } catch {
    refuseHygiene("ATTESTATION_SIGNATURE", expectedKind);
  }
  const leftoverDigest = leftoverOrgScopeRelationDigest();
  if (
    input.schemaVersion !== H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA ||
    input.kind !== expectedKind ||
    input.assertion !== ATTESTATION_ASSERTIONS[expectedKind] ||
    input.selectedStep !== expectedStep ||
    input.leftoverPolicyName !== LEFTOVER_ORG_SCOPE_POLICY_NAME ||
    input.leftoverRelationDigest !== leftoverDigest ||
    input.authorizedOrganizationId !== AUTHORIZED_PARTNER_ALPHA0_ORG_ID ||
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
    refuseHygiene("ATTESTATION_INVALID", expectedKind);
  }
  if (expectedKind === "TARGET_IDENTITY" && input.evidenceDigestHex !== input.targetFingerprint) {
    refuseHygiene("TARGET_ATTESTATION_MISMATCH", expectedKind);
  }
  if (expectedKind === "CEREMONY_AUTHORIZATION" && input.evidenceDigestHex !== leftoverDigest) {
    refuseHygiene("CEREMONY_INVENTORY_MISMATCH", expectedKind);
  }
  return Object.freeze(input as H2OrgScopeHygieneHumanAttestation);
}

export function loadHygieneCeremonyEvidence(
  input: Readonly<{
    step: H2OrgScopeHygieneStep;
    trustedHumanPublicKeyPath: string;
    expectedHumanSigningKeySha256: string;
    restorePointPath: string;
    writerQuiescencePath: string;
    targetIdentityPath: string;
    ceremonyAuthorizationPath: string;
  }>,
): H2OrgScopeHygieneCeremonyEvidence {
  const trustedKey = loadTrustedHumanKey(
    input.trustedHumanPublicKeyPath,
    input.expectedHumanSigningKeySha256,
  );
  const evidence = Object.freeze({
    restorePoint: assertHygieneHumanAttestation(
      readPrivateJson(input.restorePointPath),
      "RESTORE_POINT",
      input.step,
      trustedKey,
    ),
    writerQuiescence: assertHygieneHumanAttestation(
      readPrivateJson(input.writerQuiescencePath),
      "WRITER_QUIESCENCE",
      input.step,
      trustedKey,
    ),
    targetIdentity: assertHygieneHumanAttestation(
      readPrivateJson(input.targetIdentityPath),
      "TARGET_IDENTITY",
      input.step,
      trustedKey,
    ),
    ceremonyAuthorization: assertHygieneHumanAttestation(
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
      attestation.humanApproverIdentity !== first.humanApproverIdentity ||
      attestation.leftoverPolicyName !== first.leftoverPolicyName ||
      attestation.leftoverRelationDigest !== first.leftoverRelationDigest ||
      attestation.authorizedOrganizationId !== first.authorizedOrganizationId
    ) {
      refuseHygiene("ATTESTATION_BINDING_MISMATCH", attestation.kind);
    }
  }
  return evidence;
}
