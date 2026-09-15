import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  H2_BASELINE_0204,
  H2_HUMAN_ATTESTATION_SCHEMA,
  H2_MIGRATION_MANIFEST,
  H2_STEPS,
  assertExactJournal,
  classifyH2VerifyOnlyJournal,
  loadH2CanonicalSource,
  loadH2CeremonyEvidence,
  parseH2Step,
  readPinnedH2MigrationSql,
  semanticDigest,
  sha256,
  type H2AttestationKind,
  type H2HumanAttestation,
  type H2Step,
} from "@/scripts/ops/postgres-h2-migration-manifest-v1";
import { parseH2CliArguments } from "@/scripts/ops/postgres-h2-migration-operator-v1";

const targetFingerprint = "a".repeat(64);
const evidenceDigest = "b".repeat(64);
const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-h2-unit-")));
const keys = generateKeyPairSync("ed25519");
const publicKeyBytes = Buffer.from(keys.publicKey.export({ format: "pem", type: "spki" }));
const publicKeySha256 = sha256(publicKeyBytes);
const publicKeyPath = join(root, "human-public-key.pem");
const ceremonyId = randomUUID();
const requestId = randomUUID();
writeFileSync(publicKeyPath, publicKeyBytes, { mode: 0o600 });

function attestation(kind: H2AttestationKind, step: H2Step): H2HumanAttestation {
  const assertions = {
    RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
    WRITER_QUIESCENCE: "WRITERS_QUIESCED",
    TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_H2_STEP",
  } as const;
  const body = {
    schemaVersion: H2_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertions[kind],
    ceremonyId,
    requestId,
    selectedStep: step,
    targetFingerprint,
    expectedDatabaseName: "waia-h2-owned-local",
    expectedMigrationAuthority: "waia-h2-owner",
    operatorIdentity: "operator-1010",
    humanApproverIdentity: "human-architect",
    evidenceDigestHex: kind === "TARGET_IDENTITY" ? targetFingerprint : evidenceDigest,
    signingKeySha256: publicKeySha256,
    issuedAt: new Date().toISOString(),
  } as const;
  const contentDigestHex = semanticDigest(body);
  return Object.freeze({
    ...body,
    contentDigestHex,
    signatureBase64: sign(
      null,
      Buffer.from(contentDigestHex, "utf8"),
      keys.privateKey,
    ).toString("base64"),
  });
}

function writeAttestation(kind: H2AttestationKind, step: H2Step): string {
  const path = join(root, `${kind.toLowerCase()}.json`);
  writeFileSync(path, JSON.stringify(attestation(kind, step)), { mode: 0o600 });
  return path;
}

describe("DEE-1010 immutable H2 one-step manifest", () => {
  let source0208: ReturnType<typeof loadH2CanonicalSource>;

  beforeAll(() => {
    source0208 = loadH2CanonicalSource(process.cwd(), "0208");
  }, 30_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("pins the exact Human-authorized source identities", () => {
    expect(H2_BASELINE_0204).toMatchObject({
      sourceCommit: "8023bb1980d9f02e61db4024f725aa16161c32dd",
      sourceBlob: "59ea9dd882ecd1f29787366f46889aaa560fa843",
      sha256: "3d276ce097da14451e3114e112d1adef3fae5a63b719380244bb8e82ebb05a98",
    });
    expect(H2_STEPS).toEqual(["0205", "0206", "0207", "0208"]);
    expect(H2_MIGRATION_MANIFEST).toMatchObject({
      "0205": {
        sourceCommit: "c1d11c26a820315ca8cab0d04361223d4d94b53d",
        sourceBlob: "c75c42d2bae15beea5741161abfb18afae0b4c3b",
        sha256: "aa511acd320b653858e4b064dfeb1af744a4d7f81cffaf72fb67cd91f1fffde1",
      },
      "0206": {
        sourceCommit: "657914b1d6b4b897619cbfaef5d558ae1378efc9",
        sourceBlob: "22edad8bbee008f58592e263b78f01e162804543",
        sha256: "20a768b30a3b0cf833ee29058f1343da1842947d9110d162e8a513cfa6b171ab",
      },
      "0207": {
        sourceCommit: "7e0498f7a7e922d35a5c1ca6d61e1bf995e1c76d",
        sourceBlob: "d50d389d736bc2ab3a7ccbaf58eefd4a5ac168ac",
        sha256: "fcd4e14c2bcb8a3e46b7267f25c662544b9d41de1370434785fafb240eff9491",
      },
      "0208": {
        sourceCommit: "d7d5941a995b83473acb6e00c42d5252c44b2303",
        sourceBlob: "6f86bb554f4ec6a18ad3002c4b6db2d8733f7c65",
        sha256: "d85e8e34da28860073d9c2f8f9ac9d7e58c3d296e905b1b73ba65a79cfe407f0",
      },
    });
    expect(source0208.expectedPredecessorPrefix).toHaveLength(208);
    expect(source0208.expectedAppliedPrefix).toHaveLength(209);
  });

  it("hard-refuses 0209 and every unsupported step", () => {
    expect(() => parseH2Step("0209")).toThrow("0209_FORBIDDEN");
    expect(() => parseH2Step("latest")).toThrow("UNSUPPORTED_STEP");
    expect(() => parseH2Step("0204")).toThrow("UNSUPPORTED_STEP");
  });

  it("refuses wrong commit, blob, and byte identities", () => {
    const source = H2_MIGRATION_MANIFEST["0205"];
    expect(() =>
      readPinnedH2MigrationSql(process.cwd(), {
        ...source,
        sourceCommit: "0".repeat(40),
      }),
    ).toThrow("PINNED_GIT_OBJECT_MISSING");
    expect(() =>
      readPinnedH2MigrationSql(process.cwd(), {
        ...source,
        sourceBlob: H2_BASELINE_0204.sourceBlob,
      }),
    ).toThrow("SOURCE_BLOB_MISMATCH");
    expect(() =>
      readPinnedH2MigrationSql(process.cwd(), {
        ...source,
        sha256: "f".repeat(64),
      }),
    ).toThrow("SOURCE_SHA256_MISMATCH");
  });

  it("requires the complete exact predecessor with no gap, duplicate, alteration, or later row", () => {
    const expected = source0208.expectedPredecessorPrefix;
    expect(assertExactJournal(expected, expected, "exact")).toMatch(/^[0-9a-f]{64}$/);
    expect(() => assertExactJournal(expected.slice(1), expected, "gap")).toThrow(
      "LIVE_JOURNAL_GAP",
    );
    expect(() =>
      assertExactJournal([...expected, expected.at(-1)!], expected, "duplicate"),
    ).toThrow("LIVE_JOURNAL_DUPLICATE");
    expect(() =>
      assertExactJournal(
        expected.map((row, index) => index === 204 ? { ...row, hash: "0".repeat(64) } : row),
        expected,
        "hash",
      ),
    ).toThrow("LIVE_JOURNAL_HASH_MISMATCH");
    expect(() =>
      assertExactJournal(
        [...expected, { hash: "c".repeat(64), createdAt: "1780000000209" }],
        expected,
        "0209",
      ),
    ).toThrow("0209_FORBIDDEN");
  });

  it("classifies verify-only as committed or not applied and refuses partial state", () => {
    expect(
      classifyH2VerifyOnlyJournal(source0208.expectedPredecessorPrefix, source0208)
        .classification,
    ).toBe("PREDECESSOR_NOT_APPLIED");
    expect(
      classifyH2VerifyOnlyJournal(source0208.expectedAppliedPrefix, source0208).classification,
    ).toBe("SELECTED_STEP_COMMITTED");
    expect(() =>
      classifyH2VerifyOnlyJournal(source0208.expectedPredecessorPrefix.slice(0, -1), source0208),
    ).toThrow();
  });

  it("requires four private, digest-valid, mutually bound Human attestations", () => {
    const paths = {
      step: "0205" as const,
      trustedHumanPublicKeyPath: publicKeyPath,
      expectedHumanSigningKeySha256: publicKeySha256,
      restorePointPath: writeAttestation("RESTORE_POINT", "0205"),
      writerQuiescencePath: writeAttestation("WRITER_QUIESCENCE", "0205"),
      targetIdentityPath: writeAttestation("TARGET_IDENTITY", "0205"),
      ceremonyAuthorizationPath: writeAttestation("CEREMONY_AUTHORIZATION", "0205"),
    };
    const evidence = loadH2CeremonyEvidence(paths);
    expect(evidence.targetIdentity.schemaVersion).toBe(H2_HUMAN_ATTESTATION_SCHEMA);
    expect(evidence.ceremonyAuthorization.selectedStep).toBe("0205");

    expect(() =>
      loadH2CeremonyEvidence({ ...paths, restorePointPath: join(root, "missing.json") }),
    ).toThrow("ATTESTATION_PATH");

    const mismatched = writeAttestation("CEREMONY_AUTHORIZATION", "0206");
    expect(() =>
      loadH2CeremonyEvidence({ ...paths, ceremonyAuthorizationPath: mismatched }),
    ).toThrow();
  });

  it("exposes only an explicit one-step CLI with verify-only recovery", () => {
    const common = [
      "--step", "0205",
      "--expected-target-fingerprint", targetFingerprint,
      "--trusted-human-public-key", publicKeyPath,
      "--restore-point-attestation", "/private/restore.json",
      "--writer-quiescence-attestation", "/private/quiescence.json",
      "--target-identity-attestation", "/private/target.json",
      "--ceremony-authorization-attestation", "/private/ceremony.json",
    ];
    expect(parseH2CliArguments([...common, "--confirm-exact-step", "0205"])).toMatchObject({
      step: "0205",
      confirmedStep: "0205",
      verifyOnly: false,
    });
    expect(parseH2CliArguments([...common, "--verify-only"])).toMatchObject({
      step: "0205",
      verifyOnly: true,
    });
    expect(() => parseH2CliArguments(["--latest"])).toThrow("CLI_OPTION");
    expect(() => parseH2CliArguments([...common, "--continue"])).toThrow("CLI_OPTION");
    expect(() =>
      parseH2CliArguments([...common, "--verify-only", "--confirm-exact-step", "0205"]),
    ).toThrow("VERIFY_ONLY_CONFIRMATION_FORBIDDEN");
  });
});
