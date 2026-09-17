import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  H2_HUMAN_ATTESTATION_SCHEMA,
  H2_MIGRATION_MANIFEST,
  H2_STEPS,
  loadH2CanonicalSource,
} from "@/scripts/ops/postgres-h2-migration-manifest-v1";
import {
  POST_H2_HUMAN_ATTESTATION_SCHEMA,
  POST_H2_MIGRATION_MANIFEST,
  POST_H2_STEPS,
  assertExactPostH2Journal,
  classifyPostH2VerifyOnlyJournal,
  loadPostH2CanonicalSource,
  loadPostH2CeremonyEvidence,
  parsePostH2Step,
  semanticDigest,
  sha256,
  type PostH2AppliedMigration,
  type PostH2AttestationKind,
  type PostH2Step,
} from "@/scripts/ops/postgres-post-h2-migration-manifest-v1";
import {
  parsePostH2CliArguments,
  runPostH2MigrationOperation,
  type PostH2OperationInput,
} from "@/scripts/ops/postgres-post-h2-migration-operator-v1";

const repoRoot = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "waia-post-h2-unit-")));
const humanKeys = generateKeyPairSync("ed25519");
const humanPublicKey = Buffer.from(humanKeys.publicKey.export({ format: "pem", type: "spki" }));
const humanPublicKeySha256 = sha256(humanPublicKey);
const humanPublicKeyPath = join(scratch, "human-public-key.pem");
writeFileSync(humanPublicKeyPath, humanPublicKey, { mode: 0o600 });
const targetFingerprint = "1".repeat(64);
const operatorSource = readFileSync(
  "scripts/ops/postgres-post-h2-migration-operator-v1.ts",
  "utf8",
);

type Journal = Readonly<{
  entries: readonly Readonly<{ idx: number; when: number; tag: string }>[];
}>;

const journal = JSON.parse(
  readFileSync("db/migrations_postgres/meta/_journal.json", "utf8"),
) as Journal;

function attestation(
  kind: PostH2AttestationKind,
  step: PostH2Step,
  overrides: Record<string, unknown> = {},
  ceremonyId = randomUUID(),
  requestId = randomUUID(),
): string {
  const assertions = {
    RESTORE_POINT: "APPROVED_RESTORE_POINT_AVAILABLE",
    WRITER_QUIESCENCE: "WRITERS_QUIESCED",
    TARGET_IDENTITY: "TARGET_IDENTITY_APPROVED",
    CEREMONY_AUTHORIZATION: "AUTHORIZE_EXACT_POST_H2_STEP",
  } as const;
  const body = {
    schemaVersion: POST_H2_HUMAN_ATTESTATION_SCHEMA,
    kind,
    assertion: assertions[kind],
    ceremonyId,
    requestId,
    selectedStep: step,
    targetFingerprint,
    expectedDatabaseName: "waia_unit_target",
    expectedMigrationAuthority: "waia_unit_authority",
    operatorIdentity: "dee1018-unit-operator",
    humanApproverIdentity: "dee1018-unit-human",
    evidenceDigestHex: kind === "TARGET_IDENTITY" ? targetFingerprint : "2".repeat(64),
    signingKeySha256: humanPublicKeySha256,
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
  const contentDigestHex = semanticDigest(body);
  const path = join(scratch, `${randomUUID()}-${kind.toLowerCase()}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      ...body,
      contentDigestHex,
      signatureBase64: sign(
        null,
        Buffer.from(contentDigestHex, "utf8"),
        humanKeys.privateKey,
      ).toString("base64"),
    }),
    { mode: 0o600 },
  );
  return path;
}

function ceremony(step: PostH2Step, overrides: Record<string, unknown> = {}) {
  const ceremonyId = randomUUID();
  const requestId = randomUUID();
  return {
    step,
    trustedHumanPublicKeyPath: humanPublicKeyPath,
    expectedHumanSigningKeySha256: humanPublicKeySha256,
    restorePointPath: attestation("RESTORE_POINT", step, overrides, ceremonyId, requestId),
    writerQuiescencePath: attestation("WRITER_QUIESCENCE", step, overrides, ceremonyId, requestId),
    targetIdentityPath: attestation("TARGET_IDENTITY", step, overrides, ceremonyId, requestId),
    ceremonyAuthorizationPath: attestation(
      "CEREMONY_AUTHORIZATION",
      step,
      overrides,
      ceremonyId,
      requestId,
    ),
  };
}

function operationInput(step: PostH2Step, overrides: Partial<PostH2OperationInput> = {}) {
  const evidence = ceremony(step);
  return Object.freeze({
    step,
    expectedTargetFingerprint: targetFingerprint,
    databaseUrl: "postgres://authority@127.0.0.1:5432/waia_unit_target",
    repoRoot,
    verifyOnly: false,
    confirmedStep: step,
    trustedHumanPublicKeyPath: evidence.trustedHumanPublicKeyPath,
    restorePointAttestationPath: evidence.restorePointPath,
    writerQuiescenceAttestationPath: evidence.writerQuiescencePath,
    targetIdentityAttestationPath: evidence.targetIdentityPath,
    ceremonyAuthorizationAttestationPath: evidence.ceremonyAuthorizationPath,
    ...overrides,
  });
}

function run(input: PostH2OperationInput) {
  return runPostH2MigrationOperation(input, { approvedHumanKeySha256: humanPublicKeySha256 });
}

const cliBase = [
  "--expected-target-fingerprint",
  targetFingerprint,
  "--trusted-human-public-key",
  humanPublicKeyPath,
  "--restore-point-attestation",
  "/tmp/restore.json",
  "--writer-quiescence-attestation",
  "/tmp/quiescence.json",
  "--target-identity-attestation",
  "/tmp/target.json",
  "--ceremony-authorization-attestation",
  "/tmp/ceremony.json",
];

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("DEE-1018 post-H2 lane identity", () => {
  it("supports exactly 0209 and 0210 and leaves the H2 ladder to H2", () => {
    expect(POST_H2_STEPS).toEqual(["0209", "0210"]);
    expect(H2_STEPS).toEqual(["0205", "0206", "0207", "0208"]);
    expect(POST_H2_STEPS.filter((step) => (H2_STEPS as readonly string[]).includes(step))).toEqual(
      [],
    );
    for (const step of H2_STEPS) {
      expect(() => parsePostH2Step(step)).toThrow("H2_LANE_STEP");
    }
    for (const step of ["0204", "0211", "209", "0209 ", "", "latest", "all"]) {
      expect(() => parsePostH2Step(step)).toThrow("UNSUPPORTED_STEP");
    }
    expect(parsePostH2Step("0209")).toBe("0209");
    expect(parsePostH2Step("0210")).toBe("0210");
  });

  it("pins each supported migration to the canonical journal entry and Git object", () => {
    for (const step of POST_H2_STEPS) {
      const identity = POST_H2_MIGRATION_MANIFEST[step];
      const entry = journal.entries.find((item) => item.idx === identity.idx);
      expect(entry).toMatchObject({ when: identity.when, tag: identity.tag });
      expect(identity.path).toBe(`db/migrations_postgres/${identity.tag}.sql`);
      // The pinned Git blob and today's checkout must still agree byte for byte.
      expect(sha256(readFileSync(identity.path))).toBe(identity.sha256);
      const blob = execFileSync("/usr/bin/git", [
        "rev-parse",
        `${identity.sourceCommit}:${identity.path}`,
      ])
        .toString()
        .trim();
      expect(blob).toBe(identity.sourceBlob);
    }
    expect(POST_H2_MIGRATION_MANIFEST["0209"].predecessor).toBe("0208");
    expect(POST_H2_MIGRATION_MANIFEST["0210"].predecessor).toBe("0209");
  });

  it("builds the ordered predecessor prefix from H2's own pinned closure", () => {
    const throughH2 = loadH2CanonicalSource(repoRoot, "0208");
    const source0209 = loadPostH2CanonicalSource(repoRoot, "0209");
    expect(source0209.expectedPredecessorPrefix).toEqual(throughH2.expectedAppliedPrefix);
    expect(source0209.expectedPredecessorPrefix).toHaveLength(209);
    expect(source0209.expectedPredecessorPrefix.at(-1)).toEqual({
      hash: H2_MIGRATION_MANIFEST["0208"].sha256,
      createdAt: String(H2_MIGRATION_MANIFEST["0208"].when),
    });
    expect(source0209.expectedAppliedPrefix).toHaveLength(210);
    expect(sha256(source0209.sql)).toBe(POST_H2_MIGRATION_MANIFEST["0209"].sha256);

    const source0210 = loadPostH2CanonicalSource(repoRoot, "0210");
    expect(source0210.expectedPredecessorPrefix).toEqual(source0209.expectedAppliedPrefix);
    expect(source0210.expectedPredecessorPrefix.at(-1)).toEqual({
      hash: POST_H2_MIGRATION_MANIFEST["0209"].sha256,
      createdAt: String(POST_H2_MIGRATION_MANIFEST["0209"].when),
    });
    expect(source0210.expectedAppliedPrefix).toHaveLength(211);
    expect(sha256(source0210.sql)).toBe(POST_H2_MIGRATION_MANIFEST["0210"].sha256);
  });

  it("never reaches for Drizzle's generic high-water migrator or a multi-step option", () => {
    expect(operatorSource).not.toMatch(/from\s+"(drizzle-orm|drizzle-kit)[^"]*"/);
    expect(operatorSource).not.toMatch(/\bmigrate\s*\(/);
    const scripts = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(scripts.scripts["trader:post-h2:migrate"]).toBe(
      "WAIA_TRADER_CLI=1 node --import tsx scripts/ops/postgres-post-h2-migration-operator-v1.ts",
    );
  });
});

describe("DEE-1018 ordered journal state machine", () => {
  const predecessor: PostH2AppliedMigration[] = [
    { hash: "a".repeat(64), createdAt: "1780000000207" },
    { hash: H2_MIGRATION_MANIFEST["0208"].sha256, createdAt: "1780000000208" },
  ];
  const applied: PostH2AppliedMigration[] = [
    ...predecessor,
    { hash: POST_H2_MIGRATION_MANIFEST["0209"].sha256, createdAt: "1780000000209" },
  ];

  it("accepts only exact ordered equality", () => {
    expect(assertExactPostH2Journal(predecessor, predecessor, "unit")).toBe(
      semanticDigest(predecessor),
    );
    expect(() => assertExactPostH2Journal(predecessor, applied, "unit")).toThrow(
      "LIVE_JOURNAL_GAP",
    );
    expect(() => assertExactPostH2Journal(applied, predecessor, "unit")).toThrow(
      "LIVE_JOURNAL_EXTRA",
    );
    expect(() =>
      assertExactPostH2Journal(
        [predecessor[0]!, { hash: predecessor[1]!.hash, createdAt: "1780000000299" }],
        predecessor,
        "unit",
      ),
    ).toThrow("LIVE_JOURNAL_CREATED_AT_MISMATCH");
    expect(() =>
      assertExactPostH2Journal(
        [predecessor[0]!, { hash: "b".repeat(64), createdAt: "1780000000208" }],
        predecessor,
        "unit",
      ),
    ).toThrow("LIVE_JOURNAL_HASH_MISMATCH");
    expect(() =>
      assertExactPostH2Journal([predecessor[0]!, predecessor[0]!], predecessor, "unit"),
    ).toThrow("LIVE_JOURNAL_DUPLICATE");
    // Reordering the same identities is a refusal, not an accepted set.
    expect(() =>
      assertExactPostH2Journal([predecessor[1]!, predecessor[0]!], predecessor, "unit"),
    ).toThrow("LIVE_JOURNAL_CREATED_AT_MISMATCH");
  });

  it("classifies verify-only recovery and refuses a contradictory journal", () => {
    const source = {
      selected: POST_H2_MIGRATION_MANIFEST["0209"],
      sql: Buffer.alloc(0),
      expectedPredecessorPrefix: predecessor,
      expectedAppliedPrefix: applied,
    };
    expect(classifyPostH2VerifyOnlyJournal(applied, source)).toEqual({
      classification: "SELECTED_STEP_COMMITTED",
      journalDigest: semanticDigest(applied),
    });
    expect(classifyPostH2VerifyOnlyJournal(predecessor, source)).toEqual({
      classification: "PREDECESSOR_NOT_APPLIED",
      journalDigest: semanticDigest(predecessor),
    });
    expect(() =>
      classifyPostH2VerifyOnlyJournal(
        [...applied, { hash: "c".repeat(64), createdAt: "1780000000211" }],
        source,
      ),
    ).toThrow("LIVE_JOURNAL_EXTRA");
  });
});

describe("DEE-1018 Human evidence binding", () => {
  it("accepts a coherent single-step ceremony packet", () => {
    const evidence = loadPostH2CeremonyEvidence(ceremony("0209"));
    expect(evidence.ceremonyAuthorization).toMatchObject({
      schemaVersion: POST_H2_HUMAN_ATTESTATION_SCHEMA,
      assertion: "AUTHORIZE_EXACT_POST_H2_STEP",
      selectedStep: "0209",
    });
  });

  it("refuses an H2 ceremony packet replayed against the post-H2 lane", () => {
    expect(() =>
      loadPostH2CeremonyEvidence(ceremony("0209", { schemaVersion: H2_HUMAN_ATTESTATION_SCHEMA })),
    ).toThrow("ATTESTATION_INVALID");
  });

  it("refuses evidence minted for a different step, key, freshness or signature", () => {
    const packet = ceremony("0209");
    expect(() => loadPostH2CeremonyEvidence({ ...packet, step: "0210" })).toThrow(
      "ATTESTATION_INVALID",
    );
    expect(() =>
      loadPostH2CeremonyEvidence({
        ...packet,
        expectedHumanSigningKeySha256: "f".repeat(64),
      }),
    ).toThrow("HUMAN_SIGNING_KEY_FINGERPRINT");
    expect(() =>
      loadPostH2CeremonyEvidence(
        ceremony("0209", { issuedAt: new Date(Date.now() - 3_600_000).toISOString() }),
      ),
    ).toThrow("ATTESTATION_INVALID");

    const tampered = join(scratch, `${randomUUID()}-tampered.json`);
    const body = JSON.parse(readFileSync(packet.ceremonyAuthorizationPath, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(tampered, JSON.stringify({ ...body, humanApproverIdentity: "someone-else" }), {
      mode: 0o600,
    });
    expect(() =>
      loadPostH2CeremonyEvidence({ ...packet, ceremonyAuthorizationPath: tampered }),
    ).toThrow("ATTESTATION_INVALID");
  });

  it("refuses attestations bound to different ceremonies", () => {
    const first = ceremony("0209");
    const second = ceremony("0209");
    expect(() =>
      loadPostH2CeremonyEvidence({
        ...first,
        targetIdentityPath: second.targetIdentityPath,
      }),
    ).toThrow("ATTESTATION_BINDING_MISMATCH");
  });

  it("refuses a world-readable attestation", () => {
    const packet = ceremony("0209");
    const exposed = join(scratch, `${randomUUID()}-exposed.json`);
    writeFileSync(exposed, readFileSync(packet.restorePointPath), { mode: 0o644 });
    expect(() => loadPostH2CeremonyEvidence({ ...packet, restorePointPath: exposed })).toThrow(
      "ATTESTATION_PRIVATE_PATH",
    );
  });
});

describe("DEE-1018 operator admission guards", () => {
  it("requires explicit exact-step confirmation before any connection", async () => {
    await expect(run(operationInput("0209", { confirmedStep: undefined }))).rejects.toThrow(
      "EXACT_STEP_CONFIRMATION_REQUIRED",
    );
    await expect(run(operationInput("0209", { confirmedStep: "0210" }))).rejects.toThrow(
      "EXACT_STEP_CONFIRMATION_REQUIRED",
    );
  });

  it("refuses transaction poolers and malformed database URLs", async () => {
    for (const url of [
      "postgres://authority@pooler.example:6543/waia",
      "postgres://authority@pooler.example:5432/waia?pool_mode=transaction",
      "postgres://127.0.0.1:5432/waia",
      "mysql://authority@127.0.0.1:3306/waia",
      "not-a-url",
    ]) {
      await expect(run(operationInput("0209", { databaseUrl: url }))).rejects.toThrow(
        /DATABASE_URL_(UNSAFE|INVALID)/,
      );
    }
  });

  it("refuses a ceremony packet issued for a different target", async () => {
    await expect(
      run(operationInput("0209", { expectedTargetFingerprint: "9".repeat(64) })),
    ).rejects.toThrow(/ATTESTATION_INVALID|COMMAND_ATTESTATION_TARGET_MISMATCH/);
  });

  it("refuses test hooks outside a test environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        runPostH2MigrationOperation(operationInput("0209"), {
          approvedHumanKeySha256: humanPublicKeySha256,
        }),
      ).rejects.toThrow("TEST_HOOK_FORBIDDEN");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("DEE-1018 CLI surface", () => {
  it("accepts exactly one confirmed step", () => {
    expect(
      parsePostH2CliArguments(["--step", "0210", "--confirm-exact-step", "0210", ...cliBase]),
    ).toMatchObject({ step: "0210", confirmedStep: "0210", verifyOnly: false });
    expect(parsePostH2CliArguments(["--step", "0209", "--verify-only", ...cliBase])).toMatchObject({
      step: "0209",
      confirmedStep: undefined,
      verifyOnly: true,
    });
  });

  it("exposes no multi-step, auto-advance or generic-migrate option", () => {
    for (const option of ["--latest", "--all", "--continue", "--next", "--steps", "--auto"]) {
      expect(() => parsePostH2CliArguments(["--step", "0209", option, ...cliBase])).toThrow(
        "CLI_OPTION",
      );
    }
  });

  it("refuses duplicates, missing options and confirmation under verify-only", () => {
    expect(() => parsePostH2CliArguments(["--step", "0209", "--step", "0210", ...cliBase])).toThrow(
      "CLI_OPTION",
    );
    expect(() => parsePostH2CliArguments(["--verify-only", "--verify-only", ...cliBase])).toThrow(
      "CLI_DUPLICATE_OPTION",
    );
    expect(() => parsePostH2CliArguments(cliBase)).toThrow("CLI_REQUIRED_OPTION");
    expect(() => parsePostH2CliArguments(["--step"])).toThrow("CLI_OPTION_VALUE");
    expect(() =>
      parsePostH2CliArguments([
        "--step",
        "0209",
        "--verify-only",
        "--confirm-exact-step",
        "0209",
        ...cliBase,
      ]),
    ).toThrow("VERIFY_ONLY_CONFIRMATION_FORBIDDEN");
    expect(() =>
      parsePostH2CliArguments(["--step", "0208", "--confirm-exact-step", "0208", ...cliBase]),
    ).toThrow("H2_LANE_STEP");
  });
});
