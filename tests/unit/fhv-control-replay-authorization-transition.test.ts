// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  beforeOpen: undefined as ((path: string, flags: string | number) => void) | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: (...args: Parameters<typeof real.openSync>) => {
      io.beforeOpen?.(String(args[0]), args[1]);
      return real.openSync(...args);
    },
  };
});
import {
  setupFhvBoundedLaunchArtifacts,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import {
  executeFhvControlReplayLaunch,
  resumeFhvControlReplayLaunch,
} from "@/lib/trader/observability/fhv-control-replay-execution";
import {
  consumeFhvFullHistoricalAuthorizationReceipt,
  consumeFhvControlReplayAuthorizationWithHistoryV1,
  readFhvFullHistoricalAuthorizationReceipt,
  readFhvControlReplayAuthorizationTransitionV1,
  resolveFhvControlReplayHistoryDirectory,
  type FhvControlReplayTransitionInput,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  assertFhvControlReplayInitializedTransitionV1,
  readFhvControlReplayTerminalLinkV1,
  resolveFhvControlReplayRunDirectory,
  expectedFhvControlReplayClaimIdentity,
} from "@/lib/trader/observability/fhv-control-replay-authorization-transition";
import {
  buildFhvTerminalResult,
  completeFhvAuthorizationClaim,
  readFhvAuthorizationClaim,
  resolveFhvAuthorizationClaimPath,
  resolveFhvTerminalResultPath,
  writeFhvTerminalResultAtomic,
  takeoverFhvAuthorizationRunning,
  commitFhvAuthorizationEpoch,
} from "@/lib/trader/observability/fhv-authorization-claim";

import { runFhvControlReplay } from "@/scripts/trader/fhv-control-replay-cli";
import {
  prepareFhvOfficialLaunchExecution,
  createFhvEpochBoundaryController,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  writeFhvControlReplayReceiptAtomic,
  readFhvControlReplayReceipt,
} from "@/lib/trader/observability/fhv-control-replay-receipt";
const profile = { metadataReadProfile: "CONTROL_REPLAY_TRANSITION_V1" as const };
const cap = 1_048_576;
const roots: string[] = [];
afterEach(() => {
  io.beforeOpen = undefined;
  vi.useRealTimers();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "fhv-transition-"));
  roots.push(root);
  const setup = setupFhvBoundedLaunchArtifacts({
    artifactRoot: root,
    runId: "transition-fixture",
    executionPurpose: "CONTROL_REPLAY",
  });
  const input = {
    artifactRoot: root,
    runId: "transition-fixture",
    releaseSha: FHV_TEST_RELEASE_SHA,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId: FHV_TEST_ORG_ID,
    operatorId: FHV_TEST_OPERATOR_ID,
    configurationFreezePath: setup.configurationFreezePath,
    authorizationReceiptPath: setup.authorizationReceiptPath,
    authorizationReceiptDigest: setup.authorizationReceiptDigest,
    datasetQualificationReceiptPath: setup.qualificationReceiptPath,
    checkoutIdentityProofPath: setup.checkoutIdentityProofPath,
    boundedFixture: true,
    maxCycles: 1,
    executionPurpose: "CONTROL_REPLAY" as const,
  };
  const ai = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);
  const identity: FhvControlReplayTransitionInput = {
    artifactRoot: root,
    runId: input.runId,
    authorizationReceiptPath: input.authorizationReceiptPath,
    expectedIdentity: {
      runId: ai.runId,
      organizationId: ai.organizationId,
      operatorId: ai.operatorId,
      releaseSha: ai.releaseSha,
      releaseTag: ai.releaseTag,
      datasetQualificationReceiptDigest: ai.datasetQualificationReceiptDigest,
      datasetDigest: ai.datasetDigest,
      manifestDigest: ai.manifestDigest,
      configurationFreezeDigest: ai.configurationFreezeDigest,
    },
  };
  return {
    root,
    input,
    identity,
    ai,
    aiBytes: readFileSync(input.authorizationReceiptPath),
    runDir: resolveFhvControlReplayRunDirectory(input),
  };
}
async function initialize(f: ReturnType<typeof fixture>) {
  // Real owner reaches its unchanged missing TEST_ONLY capability gate. This is a failed
  // campaign and a successful native initialization protocol fixture, never scientific PASS.
  await expect(executeFhvControlReplayLaunch(f.input)).rejects.toThrow(
    "TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED",
  );
  return assertFhvControlReplayInitializedTransitionV1(f.identity);
}

describe("actual Control Replay native authorization transition", () => {
  it("retains exact original Ai before native consumption and initializes claim(Ai), empty WAL and journal", async () => {
    const f = fixture();
    const product = await initialize(f);
    expect(product.transition.issuedBytes).toEqual(f.aiBytes);
    expect(product.transition.consumedBytes).toEqual(
      readFileSync(f.input.authorizationReceiptPath),
    );
    expect(product.transition.consumed.authorizationReceiptDigest).not.toBe(
      f.ai.authorizationReceiptDigest,
    );
    expect(product.claim.authorizationReceiptDigest).toBe(f.ai.authorizationReceiptDigest);
    expect(product.launch.authorizationReceiptDigest).toBe(f.ai.authorizationReceiptDigest);
    expect(product.initialized.initialWal).toMatchObject({
      relativePath: "execution.wal.ndjson",
      bytes: 0,
    });
    expect(readFileSync(join(f.runDir, "execution.wal.ndjson"))).toHaveLength(0);
    expect(existsSync(join(f.runDir, "control", ".authorization-initialization.lock"))).toBe(false);
    expect(readFhvControlReplayTerminalLinkV1(f.identity)).toMatchObject({
      status: "TERMINAL_NOT_AVAILABLE",
      checkpointEvidence: "NOT_ASSESSED",
    });
  });
  it("actual fully initialized resume validates Ac but retains Ai and consumes exactly once", async () => {
    const f = fixture();
    await initialize(f);
    const ac = readFileSync(f.input.authorizationReceiptPath);
    const launch = readFileSync(join(f.runDir, "fhv-full-launch-receipt.v1.json"));
    const current = readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath);
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: current.authorizationReceiptDigest,
      }),
    ).rejects.toThrow("TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED");
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(ac);
    expect(readFileSync(join(f.runDir, "fhv-full-launch-receipt.v1.json"))).toEqual(launch);
    expect(readFhvAuthorizationClaim(resolveFhvAuthorizationClaimPath(f.runDir))).toMatchObject({
      authorizationReceiptDigest: f.ai.authorizationReceiptDigest,
      fencingGeneration: 2,
    });
  });
  it("new native consumption body is byte-identical to generic legacy consumption at a fixed time", () => {
    const f = fixture();
    const legacy = join(f.root, "legacy.json");
    writeFileSync(legacy, f.aiBytes);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    consumeFhvFullHistoricalAuthorizationReceipt(legacy);
    consumeFhvControlReplayAuthorizationWithHistoryV1({
      ...f.identity,
      expectedIssuedReceiptDigest: f.ai.authorizationReceiptDigest,
    });
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(readFileSync(legacy));
    expect(() =>
      consumeFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_ALREADY_CONSUMED" }));
  });
  it("refuses history-less consumed resume before a recovery product exists", async () => {
    const f = fixture();
    const ac = consumeFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath);
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: ac.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "ORIGINAL_AUTHORIZATION_UNAVAILABLE" });
    expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
    expect(readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath)).toEqual(ac);
  });
  it("does not let pair-only history create or repair native initialization on resume", async () => {
    const f = fixture();
    const pair = consumeFhvControlReplayAuthorizationWithHistoryV1({
      ...f.identity,
      expectedIssuedReceiptDigest: f.ai.authorizationReceiptDigest,
    });
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: pair.consumed.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_INITIALIZATION_INCOMPLETE" });
    expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
  });
  it("joins an actual protocol-fixture native T to COMPLETED claim, with no checkpoint claim", async () => {
    const f = fixture();
    await initialize(f);
    const terminal = buildFhvTerminalResult({
      runId: f.input.runId,
      classification: "PROTOCOL_FIXTURE_ONLY",
      semanticReproDigest: "d".repeat(64),
    });
    writeFhvTerminalResultAtomic(resolveFhvTerminalResultPath(f.runDir), terminal);
    expect(readFhvControlReplayTerminalLinkV1(f.identity).status).toBe(
      "TERMINAL_PENDING_CLAIM_COMMIT",
    );
    completeFhvAuthorizationClaim({
      claimPath: resolveFhvAuthorizationClaimPath(f.runDir),
      terminalResultDigest: terminal.terminalResultDigest,
    });
    expect(readFhvControlReplayTerminalLinkV1(f.identity)).toMatchObject({
      status: "TERMINAL_LINKED",
      terminalResultDigest: terminal.terminalResultDigest,
      checkpointEvidence: "NOT_ASSESSED",
    });
    rmSync(resolveFhvTerminalResultPath(f.runDir));
    expect(() => readFhvControlReplayTerminalLinkV1(f.identity)).toThrowError(
      expect.objectContaining({ code: "TERMINAL_COMPLETION_EVIDENCE_MISMATCH" }),
    );
  });
  it("refuses retained original-byte tampering even with an otherwise complete pair", () => {
    const f = fixture();
    consumeFhvControlReplayAuthorizationWithHistoryV1({
      ...f.identity,
      expectedIssuedReceiptDigest: f.ai.authorizationReceiptDigest,
    });
    const path = join(
      resolveFhvControlReplayHistoryDirectory(f.root, f.input.runId),
      "issued.v1.json",
    );
    writeFileSync(path, Buffer.concat([f.aiBytes, Buffer.from(" ")]));
    expect(() => readFhvControlReplayAuthorizationTransitionV1(f.identity)).toThrowError(
      expect.objectContaining({ code: "AUTHORIZATION_TRANSITION_INVALID" }),
    );
  });
  for (const extra of [0, 1])
    it(`direct public owner authorization byte cap +${extra}`, async () => {
      const f = fixture();
      const json = f.aiBytes.toString();
      writeFileSync(
        f.input.authorizationReceiptPath,
        json + " ".repeat(cap + extra - Buffer.byteLength(json)),
      );
      await expect(executeFhvControlReplayLaunch(f.input)).rejects.toThrow(
        extra ? "metadata exceeds" : "TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED",
      );
      expect(
        readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath).consumed,
      ).toBe(extra === 0);
      if (extra) expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
    });
  it("nested native authorization validation does not trust the first bounded read", async () => {
    const f = fixture();
    let reads = 0;
    io.beforeOpen = (path, flags) => {
      if (path === f.input.authorizationReceiptPath && typeof flags === "number" && ++reads === 2) {
        io.beforeOpen = undefined;
        writeFileSync(path, " ".repeat(cap + 1));
      }
    };
    await expect(executeFhvControlReplayLaunch(f.input)).rejects.toMatchObject({
      code: "CONTROL_REPLAY_METADATA_TOO_LARGE",
    });
    expect(reads).toBe(2);
    expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
  });
  it("a full claim digest change during terminal read refuses despite unchanged immutable Ai", async () => {
    const f = fixture();
    await initialize(f);
    const t = buildFhvTerminalResult({
      runId: f.input.runId,
      classification: "PROTOCOL_FIXTURE_ONLY",
      semanticReproDigest: "d".repeat(64),
    });
    const terminalPath = resolveFhvTerminalResultPath(f.runDir);
    writeFhvTerminalResultAtomic(terminalPath, t);
    io.beforeOpen = (path) => {
      if (path === terminalPath) {
        io.beforeOpen = undefined;
        takeoverFhvAuthorizationRunning({
          claimPath: resolveFhvAuthorizationClaimPath(f.runDir),
          leaseOwner: "concurrent-fixture",
          ...profile,
        });
      }
    };
    expect(() => readFhvControlReplayTerminalLinkV1(f.identity)).toThrowError(
      expect.objectContaining({ code: "AUTHORIZATION_CLAIM_READ_CHANGED" }),
    );
    expect(
      readFhvAuthorizationClaim(resolveFhvAuthorizationClaimPath(f.runDir))
        .authorizationReceiptDigest,
    ).toBe(f.ai.authorizationReceiptDigest);
  });
  it("locked native takeover rejects a mismatching immutable Ai without rewriting the claim", async () => {
    const f = fixture();
    await initialize(f);
    const claimPath = resolveFhvAuthorizationClaimPath(f.runDir);
    const before = readFileSync(claimPath);
    expect(() =>
      takeoverFhvAuthorizationRunning({
        claimPath,
        leaseOwner: "fixture",
        expectedIdentity: {
          ...expectedFhvControlReplayClaimIdentity(f.ai),
          authorizationReceiptDigest: "f".repeat(64),
        },
        ...profile,
      }),
    ).toThrowError(expect.objectContaining({ code: "CLAIM_IDENTITY_MISMATCH" }));
    expect(readFileSync(claimPath)).toEqual(before);
    expect(existsSync(`${claimPath}.claim.lock`)).toBe(false);
  });
  for (const operation of ["takeover", "epoch-commit"] as const)
    it(`actual ${operation} bounds its CAS reread after locked admission`, async () => {
      const f = fixture();
      await initialize(f);
      const claimPath = resolveFhvAuthorizationClaimPath(f.runDir);
      let reads = 0;
      io.beforeOpen = (path, flags) => {
        if (path === claimPath && typeof flags === "number" && ++reads === 2) {
          io.beforeOpen = undefined;
          writeFileSync(path, " ".repeat(cap + 1));
        }
      };
      const invoke =
        operation === "takeover"
          ? () => takeoverFhvAuthorizationRunning({ claimPath, leaseOwner: "fixture", ...profile })
          : () =>
              commitFhvAuthorizationEpoch({
                claimPath,
                lastCommittedEpoch: 0,
                lastCommittedCycle: 0,
                checkpointDigest: "a".repeat(64),
                walCommitDigest: "b".repeat(64),
                ...profile,
              });
      expect(invoke).toThrowError(
        expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
      );
      expect(reads).toBe(2);
      expect(readFileSync(claimPath)).toHaveLength(cap + 1);
      expect(existsSync(`${claimPath}.claim.lock`)).toBe(false);
    });
  it("resume bounds launch receipt reread after takeover without rewriting Ac", async () => {
    const f = fixture();
    const product = await initialize(f);
    const ac = readFileSync(f.input.authorizationReceiptPath);
    io.beforeOpen = (path, flags) => {
      if (path.endsWith(".claim.lock") && flags === "wx") {
        io.beforeOpen = undefined;
        writeFileSync(product.paths.launch, " ".repeat(cap + 1));
      }
    };
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" });
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(ac);
  });
  it("resume rechecks journal before cleanup and preserves speculative files on oversized replacement", async () => {
    const f = fixture();
    const product = await initialize(f);
    const speculative = join(f.runDir, "evidence", ".speculative");
    mkdirSync(speculative, { recursive: true });
    const sentinel = join(speculative, "sentinel");
    writeFileSync(sentinel, "untouched");
    let reads = 0;
    io.beforeOpen = (path, flags) => {
      if (path === product.paths.journal && typeof flags === "number" && ++reads === 2) {
        io.beforeOpen = undefined;
        writeFileSync(path, " ".repeat(cap + 1));
      }
    };
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" });
    expect(reads).toBe(2);
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
  });
  for (const relative of [
    "issued.v1.json",
    "consumed.v1.json",
    "pair.v1.json",
    "initialized.v1.json",
  ])
    it(`resume refuses missing ${relative} without repair`, async () => {
      const f = fixture();
      const product = await initialize(f);
      const before = readFileSync(product.paths.claim);
      const path = join(product.transition.historyDir, relative);
      rmSync(path);
      await expect(
        resumeFhvControlReplayLaunch({
          ...f.input,
          authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(existsSync(path)).toBe(false);
      expect(readFileSync(product.paths.claim)).toEqual(before);
    });
  for (const relative of [
    "execution.wal.ndjson",
    "fhv-launch-journal.v1.json",
    "fhv-official-campaign-identity.v1.json",
  ])
    it(`resume refuses missing native ${relative} before takeover`, async () => {
      const f = fixture();
      const product = await initialize(f);
      const before = readFileSync(product.paths.claim);
      const path = join(f.runDir, relative);
      rmSync(path);
      await expect(
        resumeFhvControlReplayLaunch({
          ...f.input,
          authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
        }),
      ).rejects.toMatchObject({ code: "AUTHORIZATION_INITIALIZATION_INCOMPLETE" });
      expect(existsSync(path)).toBe(false);
      expect(readFileSync(product.paths.claim)).toEqual(before);
    });
  it("cannot use an alternate runDir to consume or create products", async () => {
    const f = fixture();
    await expect(
      executeFhvControlReplayLaunch({ ...f.input, runDir: join(f.root, "elsewhere") }),
    ).rejects.toMatchObject({ code: "CONTROL_REPLAY_RUN_DIRECTORY_MISMATCH" });
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(f.aiBytes);
  });
  for (const key of [
    "runId",
    "organizationId",
    "operatorId",
    "releaseSha",
    "releaseTag",
    "datasetDigest",
    "manifestDigest",
    "datasetQualificationReceiptDigest",
    "configurationFreezeDigest",
  ] as const)
    it(`retained identity rejects foreign ${key}`, () => {
      const f = fixture();
      consumeFhvControlReplayAuthorizationWithHistoryV1({
        ...f.identity,
        expectedIssuedReceiptDigest: f.ai.authorizationReceiptDigest,
      });
      expect(() =>
        readFhvControlReplayAuthorizationTransitionV1({
          ...f.identity,
          expectedIdentity: { ...f.identity.expectedIdentity, [key]: "foreign" },
        }),
      ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_IDENTITY_MISMATCH" }));
    });
  for (const which of ["one", "two"] as const)
    for (const extra of [0, 1])
      it(`actual CLI first authorization ${which} enforces byte cap +${extra}`, async () => {
        const f = fixture();
        const second = join(f.root, "second-auth.json");
        writeFileSync(second, f.aiBytes);
        const path = which === "one" ? f.input.authorizationReceiptPath : second;
        writeFileSync(path, f.aiBytes.toString() + " ".repeat(cap + extra - f.aiBytes.length));
        const result = await runFhvControlReplay({
          ...f.input,
          runOneId: f.input.runId,
          runTwoId: "unused-second",
          authorizationReceiptPathRunTwo: second,
          checkoutIdentityProofPathRunOne: f.input.checkoutIdentityProofPath,
        });
        if (extra) {
          expect(result).toMatchObject({
            classification: "CONTROL_REPLAY=FAIL",
            failureCode: "CONTROL_REPLAY_METADATA_TOO_LARGE",
          });
          expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
          expect(
            readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath).consumed,
          ).toBe(false);
        } else expect(result.failureReason).toBe("TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED");
      });
  it("actual resume validates a replacement immutable claim inside its native takeover lock", async () => {
    const f = fixture();
    const product = await initialize(f);
    io.beforeOpen = (path, flags) => {
      if (path === `${product.paths.claim}.claim.lock` && flags === "wx") {
        io.beforeOpen = undefined;
        const { authorizationClaimDigest: _digest, ...body } = readFhvAuthorizationClaim(
          product.paths.claim,
        );
        const changed = { ...body, authorizationReceiptDigest: "f".repeat(64) };
        writeFileSync(
          product.paths.claim,
          JSON.stringify({
            ...changed,
            authorizationClaimDigest: computeStableJsonDigest(changed),
          }),
        );
      }
    };
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "CLAIM_IDENTITY_MISMATCH" });
    expect(readFhvAuthorizationClaim(product.paths.claim).fencingGeneration).toBe(1);
  });
  for (const replaceCas of [false, true])
    it(`real checkpoint journal catch-up propagates bounded claim CAS: replacement=${replaceCas}`, async () => {
      const f = fixture();
      const product = await initialize(f);
      const configurationFreeze = readFhvConfigurationFreezeArtifact(
        f.input.configurationFreezePath,
      ).configurationFreeze;
      const args = {
        runDir: f.runDir,
        runId: f.input.runId,
        executionPurpose: "CONTROL_REPLAY" as const,
        authorizationReceiptDigest: f.ai.authorizationReceiptDigest,
        releaseSha: f.input.releaseSha,
        datasetContentDigest: f.ai.datasetDigest,
        manifestSemanticDigest: f.ai.manifestDigest,
        configurationFreeze,
        leaseOwner: "protocol-fixture",
        ...profile,
      };
      const prepared = prepareFhvOfficialLaunchExecution(args);
      const controller = createFhvEpochBoundaryController({
        ...prepared,
        runDir: f.runDir,
        runId: f.input.runId,
        sourceCursorDigest: "s".repeat(64),
        skipSessionBackup: true,
      });
      controller.beginInitialEpoch();
      await controller.commitFinalPartialEpoch(1);
      const { authorizationClaimDigest: _digest, ...body } = readFhvAuthorizationClaim(
        product.paths.claim,
      );
      const lagging = {
        ...body,
        lastCommittedEpoch: -1,
        lastCommittedCycle: -1,
        checkpointDigest: "0".repeat(64),
        walCommitDigest: "0".repeat(64),
      };
      writeFileSync(
        product.paths.claim,
        JSON.stringify({ ...lagging, authorizationClaimDigest: computeStableJsonDigest(lagging) }),
      );
      let reads = 0;
      if (replaceCas)
        io.beforeOpen = (path, flags) => {
          if (path === product.paths.claim && typeof flags === "number" && ++reads === 3) {
            io.beforeOpen = undefined;
            writeFileSync(path, " ".repeat(cap + 1));
          }
        };
      if (replaceCas) {
        expect(() => prepareFhvOfficialLaunchExecution(args)).toThrowError(
          expect.objectContaining({ code: "CONTROL_REPLAY_METADATA_TOO_LARGE" }),
        );
        expect(reads).toBe(3);
        expect(readFileSync(product.paths.claim)).toHaveLength(cap + 1);
        expect(existsSync(`${product.paths.claim}.claim.lock`)).toBe(false);
      } else
        expect(prepareFhvOfficialLaunchExecution(args).authorizationClaim.lastCommittedEpoch).toBe(
          0,
        );
    });
  for (const [key, value] of [
    ["executionPurpose", "FULL_HISTORICAL"],
    ["oneExecution", false],
  ] as const)
    it(`actual public owner refuses valid-digest unsupported ${key} before consumption`, async () => {
      const f = fixture();
      const { authorizationReceiptDigest: _digest, ...body } = f.ai;
      const changed = { ...body, [key]: value };
      const modified = { ...changed, authorizationReceiptDigest: computeStableJsonDigest(changed) };
      writeFileSync(f.input.authorizationReceiptPath, JSON.stringify(modified));
      const before = readFileSync(f.input.authorizationReceiptPath);
      await expect(
        executeFhvControlReplayLaunch({
          ...f.input,
          authorizationReceiptDigest: modified.authorizationReceiptDigest,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(before);
      expect(existsSync(resolveFhvAuthorizationClaimPath(f.runDir))).toBe(false);
    });
  for (const state of ["ISSUED", "CLAIMED"] as const)
    it(`clean partial native ${state} cannot be resumed or repaired`, async () => {
      const f = fixture();
      const product = await initialize(f);
      const { authorizationClaimDigest: _digest, ...body } = product.claim;
      const changed = { ...body, state };
      writeFileSync(
        product.paths.claim,
        JSON.stringify({ ...changed, authorizationClaimDigest: computeStableJsonDigest(changed) }),
      );
      const before = readFileSync(product.paths.claim);
      await expect(
        resumeFhvControlReplayLaunch({
          ...f.input,
          authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
        }),
      ).rejects.toMatchObject({ code: "CLAIM_STATE_INVALID" });
      expect(readFileSync(product.paths.claim)).toEqual(before);
    });
  it("conflicting immutable marker refuses before any takeover", async () => {
    const f = fixture();
    const product = await initialize(f);
    const marker = join(product.transition.historyDir, "initialized.v1.json");
    const changed = { ...product.initialized, runId: "foreign" };
    writeFileSync(marker, JSON.stringify(changed));
    const claim = readFileSync(product.paths.claim);
    await expect(
      resumeFhvControlReplayLaunch({
        ...f.input,
        authorizationReceiptDigest: product.transition.consumed.authorizationReceiptDigest,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_HISTORY_CONFLICT" });
    expect(readFileSync(product.paths.claim)).toEqual(claim);
    expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual(changed);
  });
  for (const kind of ["foreign-run", "corrupt-digest", "completed-pointer"] as const)
    it(`read-only actual T join refuses ${kind}`, async () => {
      const f = fixture();
      const product = await initialize(f);
      const terminal = buildFhvTerminalResult({
        runId: kind === "foreign-run" ? "foreign" : f.input.runId,
        classification: "PROTOCOL_FIXTURE_ONLY",
        semanticReproDigest: "d".repeat(64),
      });
      const path = resolveFhvTerminalResultPath(f.runDir);
      writeFhvTerminalResultAtomic(path, terminal);
      if (kind === "corrupt-digest")
        writeFileSync(path, JSON.stringify({ ...terminal, terminalResultDigest: "f".repeat(64) }));
      if (kind === "completed-pointer")
        completeFhvAuthorizationClaim({
          claimPath: product.paths.claim,
          terminalResultDigest: "f".repeat(64),
        });
      const beforeClaim = readFileSync(product.paths.claim),
        beforeT = readFileSync(path);
      expect(() => readFhvControlReplayTerminalLinkV1(f.identity)).toThrowError(
        expect.objectContaining({
          code:
            kind === "foreign-run"
              ? "TERMINAL_IDENTITY_MISMATCH"
              : kind === "corrupt-digest"
                ? "TERMINAL_DIGEST_INVALID"
                : "TERMINAL_COMPLETION_EVIDENCE_MISMATCH",
        }),
      );
      expect(readFileSync(product.paths.claim)).toEqual(beforeClaim);
      expect(readFileSync(path)).toEqual(beforeT);
    });
  it("existing immutable protocol two-run receipt with Ac cannot be rewritten as Ai", () => {
    const f = fixture();
    const transition = consumeFhvControlReplayAuthorizationWithHistoryV1({
      ...f.identity,
      expectedIssuedReceiptDigest: f.ai.authorizationReceiptDigest,
    });
    const path = join(f.root, "old-protocol-two-run.json");
    const input = {
      receiptPath: path,
      releaseSha: f.ai.releaseSha,
      releaseTag: f.ai.releaseTag,
      organizationId: f.ai.organizationId,
      operatorId: f.ai.operatorId,
      runOneId: f.input.runId,
      runTwoId: "second-protocol-fixture",
      runOneDigest: "a".repeat(64),
      runTwoDigest: "a".repeat(64),
      datasetQualificationReceiptDigest: f.ai.datasetQualificationReceiptDigest,
      datasetContentDigest: f.ai.datasetDigest,
      manifestSemanticDigest: f.ai.manifestDigest,
      runOneConfigurationFreezeDigest: f.ai.configurationFreezeDigest,
      runTwoConfigurationFreezeDigest: "b".repeat(64),
      runOneAuthorizationReceiptDigest: transition.consumed.authorizationReceiptDigest,
      runTwoAuthorizationReceiptDigest: "c".repeat(64),
      runOneCheckoutIdentityProofDigest: "d".repeat(64),
      runTwoCheckoutIdentityProofDigest: "e".repeat(64),
      runOneCycleCount: 1,
      runTwoCycleCount: 1,
    };
    writeFhvControlReplayReceiptAtomic(input);
    const before = readFileSync(path);
    expect(() =>
      writeFhvControlReplayReceiptAtomic({
        ...input,
        runOneAuthorizationReceiptDigest: f.ai.authorizationReceiptDigest,
      }),
    ).toThrowError(expect.objectContaining({ code: "IMMUTABLE_ARTIFACT_FIELD_COLLISION" }));
    expect(readFileSync(path)).toEqual(before);
    expect(readFhvControlReplayReceipt(path).runOneAuthorizationReceiptDigest).toBe(
      transition.consumed.authorizationReceiptDigest,
    );
  });
});
