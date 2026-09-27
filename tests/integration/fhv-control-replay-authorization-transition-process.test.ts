import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupFhvBoundedLaunchArtifacts,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import {
  readFhvFullHistoricalAuthorizationReceipt,
  resolveFhvControlReplayHistoryDirectory,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import { resolveFhvControlReplayRunDirectory } from "@/lib/trader/observability/fhv-control-replay-authorization-transition";
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((done) => child.once("exit", () => done()));
    }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(runId = "process-fixture") {
  const root = mkdtempSync(join(tmpdir(), "fhv-transition-process-"));
  roots.push(root);
  const prep = setupFhvBoundedLaunchArtifacts({
    artifactRoot: root,
    runId,
    executionPurpose: "CONTROL_REPLAY",
  });
  const input = {
    artifactRoot: root,
    runId,
    releaseSha: FHV_TEST_RELEASE_SHA,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId: FHV_TEST_ORG_ID,
    operatorId: FHV_TEST_OPERATOR_ID,
    configurationFreezePath: prep.configurationFreezePath,
    authorizationReceiptPath: prep.authorizationReceiptPath,
    authorizationReceiptDigest: prep.authorizationReceiptDigest,
    datasetQualificationReceiptPath: prep.qualificationReceiptPath,
    checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
    boundedFixture: true,
    maxCycles: 1,
    executionPurpose: "CONTROL_REPLAY" as const,
  };
  const ai = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);
  const identity = {
    artifactRoot: root,
    runId,
    authorizationReceiptPath: input.authorizationReceiptPath,
    expectedIdentity: {
      runId,
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
  return { root, input, identity, runDir: resolveFhvControlReplayRunDirectory(input) };
}
type Message = {
  event: string;
  phase?: string;
  ok?: boolean;
  code?: string;
  message?: string;
  boundary?: string;
};
async function worker(f: ReturnType<typeof fixture>, action: string, pausePhase?: string) {
  const path = join(f.root, `worker-${children.length}.json`);
  writeFileSync(path, JSON.stringify({ input: f.input, identity: f.identity, action, pausePhase }));
  const child = fork(
    resolve("tests/helpers/fhv-control-replay-authorization-transition-worker.ts"),
    [path],
    {
      execArgv: [
        "--import",
        "tsx",
        "--require",
        resolve("scripts/trader/trader-cli-server-only-prelude.cjs"),
        "--conditions=react-server",
      ],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        WAIA_TRADER_CLI: "1",
      },
    },
  );
  children.push(child);
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  let text = "";
  let stderr = "";
  child.stdout!.on("data", (data: Buffer) => {
    text += data.toString();
    let nl;
    while ((nl = text.indexOf("\n")) >= 0) {
      const line = text.slice(0, nl);
      text = text.slice(nl + 1);
      try {
        messages.push(JSON.parse(line));
      } catch {
        /* unrelated module diagnostic */
      }
      for (const fn of listeners) fn();
    }
  });
  child.stderr!.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  function wait(event: string): Promise<Message> {
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Child ${event} deadline: ${stderr}`));
      }, 10000);
      const check = () => {
        const message = messages.find((m) => m.event === event);
        if (message) {
          clearTimeout(timer);
          listeners.delete(check);
          done(message);
        }
      };
      listeners.add(check);
      check();
    });
  }
  await wait("ready");
  return { child, wait, go: () => child.send("go"), messages };
}
function expectInitialized(f: ReturnType<typeof fixture>) {
  expect(
    existsSync(
      join(resolveFhvControlReplayHistoryDirectory(f.root, f.input.runId), "initialized.v1.json"),
    ),
  ).toBe(true);
}

describe("real local process ownership and Control Replay entry", () => {
  it("a competing public initializer refuses while the owner holds the phase lock", async () => {
    const f = fixture();
    const a = await worker(f, "launch", "initialization-lock");
    a.go();
    await a.wait("phase");
    const b = await worker(f, "launch");
    b.go();
    expect(await b.wait("result")).toMatchObject({
      ok: false,
      code: "INITIALIZATION_OWNERSHIP_UNRESOLVED",
    });
    expect(
      readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath).consumed,
    ).toBe(false);
    a.child.kill("SIGKILL");
    await new Promise<void>((done) => a.child.once("exit", () => done()));
    expect(existsSync(join(f.runDir, "control", ".authorization-initialization.lock"))).toBe(true);
  }, 20000);
  it("two unpaused public launches initialize once and retain one native consumption", async () => {
    const f = fixture();
    const a = await worker(f, "launch");
    const b = await worker(f, "launch");
    a.go();
    b.go();
    const results = await Promise.all([a.wait("result"), b.wait("result")]);
    expect(
      results.filter((x) => x.message === "TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED"),
    ).toHaveLength(1);
    expect(
      results.filter((x) => x.message !== "TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED"),
    ).toHaveLength(1);
    expectInitialized(f);
    const history = resolveFhvControlReplayHistoryDirectory(f.root, f.input.runId);
    const consumed = readFileSync(join(history, "consumed.v1.json"));
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(consumed);
    expect(
      JSON.parse(readFileSync(join(history, "initialized.v1.json"), "utf8")).initialClaim
        .fencingGeneration,
    ).toBe(1);
  }, 20000);
  it("the legacy and retained consumer compete on the same actual consume lock", async () => {
    const f = fixture();
    const a = await worker(f, "consume-retained");
    const b = await worker(f, "consume-legacy");
    a.go();
    b.go();
    const results = await Promise.all([a.wait("result"), b.wait("result")]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok)).toHaveLength(1);
    expect(
      readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath).consumed,
    ).toBe(true);
  }, 20000);
  for (const phase of [
    "issued-history",
    "native-consumed",
    "consumed-history",
    "pair-history",
    "claim-ISSUED",
    "claim-CLAIMED",
    "claim-RUNNING",
    "initialized-history",
  ]) {
    it(`SIGKILL after ${phase} preserves native boundary and refuses abandoned ownership`, async () => {
      const f = fixture();
      const a = await worker(f, "launch", phase);
      a.go();
      expect(await a.wait("phase")).toMatchObject({
        phase,
        boundary: "AFTER_NATIVE_PUBLICATION_DIRECTORY_FSYNC",
      });
      if (phase === "initialized-history") expectInitialized(f);
      a.child.kill("SIGKILL");
      await new Promise<void>((done) => a.child.once("exit", () => done()));
      const snapshot = readFileSync(f.input.authorizationReceiptPath);
      const current = readFhvFullHistoricalAuthorizationReceipt(f.input.authorizationReceiptPath);
      f.input.authorizationReceiptDigest = current.authorizationReceiptDigest;
      const b = await worker(f, current.consumed ? "resume" : "launch");
      b.go();
      expect(await b.wait("result")).toMatchObject({
        ok: false,
        code: "INITIALIZATION_OWNERSHIP_UNRESOLVED",
      });
      expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(snapshot);
      expect(existsSync(join(f.runDir, "control", ".authorization-initialization.lock"))).toBe(
        true,
      );
    }, 20000);
  }
  it("a different run can initialize while another run's owner is paused", async () => {
    const f = fixture("held-run");
    const other = fixture("other-run");
    const a = await worker(f, "launch", "initialization-lock");
    a.go();
    await a.wait("phase");
    const b = await worker(other, "launch");
    b.go();
    expect(await b.wait("result")).toMatchObject({
      ok: false,
      message: "TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED",
    });
    expectInitialized(other);
  }, 20000);
  it("the real CLI initializes then resumes with unchanged missing-capability refusal and one consumption", () => {
    const f = fixture();
    const args = [
      "--import",
      "tsx",
      "--require",
      resolve("scripts/trader/trader-cli-server-only-prelude.cjs"),
      "--conditions=react-server",
      resolve("scripts/trader/fhv-control-replay-cli.ts"),
      "--release-sha",
      f.input.releaseSha,
      "--release-tag",
      f.input.releaseTag,
      "--organization-id",
      f.input.organizationId,
      "--operator-id",
      f.input.operatorId,
      "--run-one-id",
      f.input.runId,
      "--run-two-id",
      "unused-second",
      "--configuration-freeze-path",
      f.input.configurationFreezePath,
      "--authorization-receipt-path",
      f.input.authorizationReceiptPath,
      "--dataset-qualification-receipt-path",
      f.input.datasetQualificationReceiptPath,
      "--checkout-identity-proof-path-run-one",
      f.input.checkoutIdentityProofPath,
      "--artifact-root",
      f.root,
      "--bounded-fixture",
      "--max-cycles",
      "1",
    ];
    const run = (extra: string[] = []) =>
      spawnSync(process.execPath, [...args, ...extra], {
        cwd: process.cwd(),
        timeout: 10000,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: "test",
          WAIA_TRADER_CLI: "1",
        },
      });
    const first = run();
    expect(first.error).toBeUndefined();
    expect(first.stdout + first.stderr).toContain("TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED");
    expectInitialized(f);
    const ac = readFileSync(f.input.authorizationReceiptPath);
    const second = run(["--resume"]);
    expect(second.error).toBeUndefined();
    expect(second.stdout + second.stderr).toContain("TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED");
    expect(readFileSync(f.input.authorizationReceiptPath)).toEqual(ac);
  }, 25000);
});
