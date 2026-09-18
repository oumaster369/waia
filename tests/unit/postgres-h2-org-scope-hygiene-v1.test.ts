import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  AUTHORIZED_PARTNER_ALPHA0_ORG_ID,
  EXACT_RUN_RELATIONS,
  extraInsertApplicableRunnerPolicies,
  HISTORICAL_SCIENTIFIC_ADMISSION_RUNNER_INSERT_POLICY,
  KEEP_ORG_SELECT_V2_RELATIONS,
  LEFTOVER_ORG_SCOPE_POLICY_NAME,
  LEFTOVER_ORG_SCOPE_RELATIONS,
  LEFTOVER_ORG_SCOPE_USING_EXPRESSION,
  leftoverOrgScopeInventoryIdentity,
  LIFECYCLE_EVENTS_RELATION,
} from "@/scripts/ops/postgres-h2-leftover-org-scope-policy-v1";
import {
  H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA,
  leftoverOrgScopeRelationDigest,
  loadHygieneCeremonyEvidence,
  semanticDigest,
  sha256,
  type H2OrgScopeHygieneAttestationKind,
  type H2OrgScopeHygieneHumanAttestation,
} from "@/scripts/ops/postgres-h2-org-scope-hygiene-manifest-v1";
import { parseHygieneCliArguments } from "@/scripts/ops/postgres-h2-org-scope-hygiene-operator-v1";

const targetFingerprint = "a".repeat(64);
const evidenceDigest = "b".repeat(64);
const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-h2-hygiene-unit-")));
const keys = generateKeyPairSync("ed25519");
const publicKeyBytes = Buffer.from(keys.publicKey.export({ format: "pem", type: "spki" }));
const publicKeySha256 = sha256(publicKeyBytes);
const publicKeyPath = join(root, "human-public-key.pem");
const ceremonyId = randomUUID();
const requestId = randomUUID();
writeFileSync(publicKeyPath, publicKeyBytes, { mode: 0o600 });
const leftoverDigest = leftoverOrgScopeRelationDigest();

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function attestation(kind: H2OrgScopeHygieneAttestationKind): H2OrgScopeHygieneHumanAttestation {
  const assertions = {
    RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
    WRITER_QUIESCENCE: "WRITERS_QUIESCED",
    TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_ORG_SCOPE_HYGIENE",
  } as const;
  const body = {
    schemaVersion: H2_ORG_SCOPE_HYGIENE_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertions[kind],
    ceremonyId,
    requestId,
    selectedStep: "DROP_ORG_SCOPE" as const,
    targetFingerprint,
    expectedDatabaseName: "waia-h2-owned-local",
    expectedMigrationAuthority: "waia-h2-owner",
    operatorIdentity: "operator-1022",
    humanApproverIdentity: "human-architect",
    leftoverPolicyName: LEFTOVER_ORG_SCOPE_POLICY_NAME,
    leftoverRelationDigest: leftoverDigest,
    authorizedOrganizationId: AUTHORIZED_PARTNER_ALPHA0_ORG_ID,
    evidenceDigestHex:
      kind === "TARGET_IDENTITY"
        ? targetFingerprint
        : kind === "CEREMONY_AUTHORIZATION"
          ? leftoverDigest
          : evidenceDigest,
    signingKeySha256: publicKeySha256,
    issuedAt: new Date().toISOString(),
  } as const;
  const contentDigestHex = semanticDigest(body);
  return Object.freeze({
    ...body,
    contentDigestHex,
    signatureBase64: sign(null, Buffer.from(contentDigestHex, "utf8"), keys.privateKey).toString(
      "base64",
    ),
  });
}

function writeAttestation(kind: H2OrgScopeHygieneAttestationKind): string {
  const path = join(root, `${kind.toLowerCase()}.json`);
  writeFileSync(path, JSON.stringify(attestation(kind)), { mode: 0o600 });
  return path;
}

function commonCli(step = "DROP_ORG_SCOPE"): string[] {
  return [
    "--step",
    step,
    "--expected-target-fingerprint",
    targetFingerprint,
    "--trusted-human-public-key",
    publicKeyPath,
    "--restore-point-attestation",
    "/private/restore.json",
    "--writer-quiescence-attestation",
    "/private/quiescence.json",
    "--target-identity-attestation",
    "/private/target.json",
    "--ceremony-authorization-attestation",
    "/private/ceremony.json",
  ];
}

describe("DEE-1022 leftover org-scope hygiene contract", () => {
  it("freezes the Partner Alpha0 leftover inventory and lawful remainder", () => {
    expect(LEFTOVER_ORG_SCOPE_RELATIONS).toHaveLength(28);
    expect(KEEP_ORG_SELECT_V2_RELATIONS).toHaveLength(23);
    expect(EXACT_RUN_RELATIONS).toHaveLength(4);
    expect(
      new Set([...KEEP_ORG_SELECT_V2_RELATIONS, ...EXACT_RUN_RELATIONS, LIFECYCLE_EVENTS_RELATION])
        .size,
    ).toBe(28);
    expect(
      [...KEEP_ORG_SELECT_V2_RELATIONS, ...EXACT_RUN_RELATIONS, LIFECYCLE_EVENTS_RELATION]
        .sort()
        .join("\0"),
    ).toBe([...LEFTOVER_ORG_SCOPE_RELATIONS].join("\0"));
    expect(leftoverDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not journal leftover org_scope in pinned migrations", () => {
    const files = readdirSync("db/migrations_postgres").filter((name) => name.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(200);
    for (const file of files) {
      const sql = readFileSync(join("db/migrations_postgres", file), "utf8");
      expect(sql.includes(LEFTOVER_ORG_SCOPE_POLICY_NAME)).toBe(false);
    }
  });

  it("classifies leftover FOR ALL as an extra INSERT-applicable runner policy", () => {
    expect(
      extraInsertApplicableRunnerPolicies([
        {
          policyName: HISTORICAL_SCIENTIFIC_ADMISSION_RUNNER_INSERT_POLICY,
          command: "a",
          permissive: true,
          roles: ["waia_historical_runner"],
        },
        {
          policyName: LEFTOVER_ORG_SCOPE_POLICY_NAME,
          command: "*",
          permissive: true,
          roles: ["waia_historical_runner"],
        },
        {
          policyName: "waia_historical_runner_org_select_v2",
          command: "r",
          permissive: true,
          roles: ["waia_historical_runner"],
        },
      ]),
    ).toEqual([LEFTOVER_ORG_SCOPE_POLICY_NAME]);
  });

  it("accepts only the exact leftover inventory identity", () => {
    const row = (relationName: string) => ({
      relationName,
      policyName: LEFTOVER_ORG_SCOPE_POLICY_NAME,
      command: "*",
      permissive: true,
      roles: ["waia_historical_runner"],
      usingExpression: LEFTOVER_ORG_SCOPE_USING_EXPRESSION,
      checkExpression: LEFTOVER_ORG_SCOPE_USING_EXPRESSION,
    });
    expect(
      leftoverOrgScopeInventoryIdentity(LEFTOVER_ORG_SCOPE_RELATIONS.map(row))
        .matchesFrozenInventory,
    ).toBe(true);
    expect(
      leftoverOrgScopeInventoryIdentity(LEFTOVER_ORG_SCOPE_RELATIONS.slice(0, 27).map(row))
        .matchesFrozenInventory,
    ).toBe(false);
    expect(
      leftoverOrgScopeInventoryIdentity(
        LEFTOVER_ORG_SCOPE_RELATIONS.map((relation) => ({
          ...row(relation),
          command: "a",
        })),
      ).matchesFrozenInventory,
    ).toBe(false);
  });

  it("loads a bound hygiene packet and refuses H2-shaped attestations", () => {
    const paths = {
      step: "DROP_ORG_SCOPE" as const,
      trustedHumanPublicKeyPath: publicKeyPath,
      expectedHumanSigningKeySha256: publicKeySha256,
      restorePointPath: writeAttestation("RESTORE_POINT"),
      writerQuiescencePath: writeAttestation("WRITER_QUIESCENCE"),
      targetIdentityPath: writeAttestation("TARGET_IDENTITY"),
      ceremonyAuthorizationPath: writeAttestation("CEREMONY_AUTHORIZATION"),
    };
    expect(loadHygieneCeremonyEvidence(paths).ceremonyAuthorization.selectedStep).toBe(
      "DROP_ORG_SCOPE",
    );

    const h2Shaped = join(root, "h2-shaped.json");
    writeFileSync(
      h2Shaped,
      JSON.stringify({
        schemaVersion: "waia.trader.h2.human-attestation.v1",
        kind: "CEREMONY_AUTHORIZATION",
        assertion: "AUTHORIZE_EXACT_H2_STEP",
        ceremonyId,
        requestId,
        selectedStep: "0206",
        targetFingerprint,
        expectedDatabaseName: "waia-h2-owned-local",
        expectedMigrationAuthority: "waia-h2-owner",
        operatorIdentity: "operator-1022",
        humanApproverIdentity: "human-architect",
        evidenceDigestHex: evidenceDigest,
        signingKeySha256: publicKeySha256,
        issuedAt: new Date().toISOString(),
        contentDigestHex: "c".repeat(64),
        signatureBase64: "d".repeat(88),
      }),
      { mode: 0o600 },
    );
    expect(() =>
      loadHygieneCeremonyEvidence({ ...paths, ceremonyAuthorizationPath: h2Shaped }),
    ).toThrow("ATTESTATION_SHAPE");
  });

  it("exposes only DROP_ORG_SCOPE with verify-only recovery", () => {
    expect(
      parseHygieneCliArguments([...commonCli(), "--confirm-exact-step", "DROP_ORG_SCOPE"]),
    ).toMatchObject({
      step: "DROP_ORG_SCOPE",
      confirmedStep: "DROP_ORG_SCOPE",
      verifyOnly: false,
    });
    expect(parseHygieneCliArguments([...commonCli(), "--verify-only"])).toMatchObject({
      verifyOnly: true,
    });
    expect(() => parseHygieneCliArguments(["--latest"])).toThrow("CLI_OPTION");
    expect(() => parseHygieneCliArguments(commonCli("0206"))).toThrow("CLI_STEP");
    expect(() =>
      parseHygieneCliArguments([
        ...commonCli(),
        "--verify-only",
        "--confirm-exact-step",
        "DROP_ORG_SCOPE",
      ]),
    ).toThrow("VERIFY_ONLY_CONFIRMATION_FORBIDDEN");
  });
});
