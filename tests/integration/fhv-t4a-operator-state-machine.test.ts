import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FHV_T4A_AUTHORIZATION_LITERAL,
  FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { FHV_T4A_CEREMONY_REQUIRED_RESULTS } from "@/lib/trader/observability/fhv-t4a-ceremony-results";
import { sha256Hex } from "@/tests/helpers/fhv-t4a-operator-transport";

const ROOT = process.cwd();
const OPERATOR_SH = join(ROOT, "scripts/ops/fhv-t4a-operator.sh");
const LOCAL_NODE = process.execPath;
const LOCAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const LOCAL_SSH = execFileSync("which", ["ssh"], { encoding: "utf8" }).trim();

let tempDirs: string[] = [];
let statusAtTestStart = "";

function trackDir(path: string): string {
  tempDirs.push(path);
  return path;
}

function assertSourceCheckoutClean(): void {
  const status = execFileSync("git", ["-C", ROOT, "status", "--porcelain=v1"], {
    encoding: "utf8",
  }).trim();
  expect(status).toBe(statusAtTestStart);
}

function createTempReleaseCheckout(): { releaseRoot: string; sha: string; tag: string } {
  const releaseRoot = trackDir(mkdtempSync(join(tmpdir(), "fhv-t4a-release-")));
  execFileSync("git", ["-C", ROOT, "worktree", "add", "--detach", releaseRoot, "HEAD"], {
    stdio: "pipe",
  });
  const sha = execFileSync("git", ["-C", releaseRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const tag = "local-dev";
  return { releaseRoot, sha, tag };
}

function buildEnv(
  releaseRoot: string,
  sha: string,
  tag: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const work = trackDir(mkdtempSync(join(tmpdir(), "fhv-t4a-work-")));
  const localStateDir = join(work, "state");
  const envFile = join(work, "fhv.env");
  const artifactRoot = join(work, "artifacts");
  const checkoutParent = join(work, "checkouts");
  mkdirSync(localStateDir, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(checkoutParent, { recursive: true });
  return {
    ...process.env,
    FHV_T4A_HERMETIC_INTEGRATION: "1",
    EXEC_HOST: "exec.test",
    SSH_USER: "operator",
    FHV_LOCAL_RELEASE_ROOT: releaseRoot,
    FHV_T4A_LOCAL_STATE_DIR: localStateDir,
    FHV_LOCAL_NODE_BIN: LOCAL_NODE,
    FHV_LOCAL_GIT_BIN: LOCAL_GIT,
    FHV_LOCAL_SSH_BIN: LOCAL_SSH,
    EXECUTION_SERVER_TARGET_SHA: sha,
    FHV_RELEASE_TAG: tag,
    FHV_ORIGIN_URL: "https://github.com/oumaster369/waia.git",
    FHV_RUN_ID: "t4a-state-machine",
    FHV_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000436",
    FHV_OPERATOR_ID: "operator-test",
    FHV_SERVICE_USER: "fhv",
    FHV_SERVICE_USER_HOME: "/home/fhv",
    FHV_ENVIRONMENT_FILE: envFile,
    FHV_ARTIFACT_ROOT: artifactRoot,
    FHV_CHECKOUT_PARENT: checkoutParent,
    FHV_EXPECTED_HOSTNAME: "exec.test",
    FHV_EXPECTED_MACHINE_ID_SHA256: "a".repeat(64),
    FHV_NODE_BIN: LOCAL_NODE,
    FHV_COREPACK_BIN: LOCAL_NODE,
    FHV_GIT_BIN: "/usr/bin/git",
    FHV_PYTHON_BIN: "/usr/bin/python3",
    FHV_DOCKER_BIN: "/usr/bin/docker",
    FHV_SYSTEMCTL_BIN: "/usr/bin/systemctl",
    FHV_SYSTEMD_ANALYZE_BIN: "/usr/bin/systemd-analyze",
    FHV_T4A_WORKSTATION_TRACE_PATH: join(localStateDir, "fhv-t4a-operator-trace.jsonl"),
    ...extra,
  };
}

function runOperatorShell(phase: string, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync("bash", [OPERATOR_SH, phase], {
    env,
    encoding: "utf8",
    cwd: ROOT,
  });
}

beforeEach(() => {
  statusAtTestStart = execFileSync("git", ["-C", ROOT, "status", "--porcelain=v1"], {
    encoding: "utf8",
  }).trim();
});

afterEach(() => {
  for (const dir of [...tempDirs].reverse()) {
    try {
      execFileSync("git", ["-C", ROOT, "worktree", "remove", "--force", dir], { stdio: "pipe" });
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs = [];
  assertSourceCheckoutClean();
});

describe("fhv-t4a operator state machine (DEE-436)", () => {
  it("runs verify-local-release via public shell entrypoint", () => {
    const { releaseRoot, sha, tag } = createTempReleaseCheckout();
    const env = buildEnv(releaseRoot, sha, tag);
    const result = runOperatorShell("verify-local-release", env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("FHV_T4A_LOCAL_RELEASE_VERIFY_OK");
    expect(
      existsSync(join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-local-release-receipt.v1.json")),
    ).toBe(true);
  });

  it("positive subprocess chain through ceremony via public shell entrypoint", () => {
    const { releaseRoot, sha, tag } = createTempReleaseCheckout();
    const env = buildEnv(releaseRoot, sha, tag, {
      FHV_T4A_AUTHORIZATION: FHV_T4A_AUTHORIZATION_LITERAL,
    });
    expect(runOperatorShell("verify-local-release", env).status).toBe(0);
    expect(runOperatorShell("pre-auth", env).status).toBe(0);
    const postBefore = runOperatorShell("post-auth-before-disconnect", env);
    expect(postBefore.status).toBe(0);
    expect(postBefore.stdout).toContain(FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT);
    const continuityBefore = join(
      env.FHV_ARTIFACT_ROOT!,
      "RI-P7/fhv-ops-rehearsal/t4a-state-machine/control/fhv-t4-continuity-before.v1.json",
    );
    expect(existsSync(continuityBefore)).toBe(true);
    expect(readFileSync(continuityBefore, "utf8")).not.toContain('"step":26');
    // Hermetic simulation scrubs FHV_SYSTEMCTL_BIN / FHV_PYTHON_BIN from service-user
    // child env (production env -i equivalent). Bindings remain on the workstation env
    // for operator binding reconstruction; Step 31 must not rely on that inheritance.
    expect(env.FHV_SYSTEMCTL_BIN).toBeTruthy();
    expect(env.FHV_PYTHON_BIN).toBeTruthy();

    const postFinalize = runOperatorShell("post-reconnect-finalize", env);
    expect(postFinalize.status).toBe(0);
    expect(postFinalize.stdout).toContain("FHV_T4A_POST_RECONNECT_FINALIZE_OK");
    const finalizeReceipt = JSON.parse(
      readFileSync(
        join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-post-finalize-receipt.v1.json"),
        "utf8",
      ),
    ) as {
      schemaVersion: string;
      contentDigest: string;
      stepProofDigests: Record<string, string>;
      continuityVerificationProofPath?: string;
      continuityVerificationProofDigest?: string;
      evidenceSealRootDigest?: string;
      evidenceSealManifestDigest?: string;
      evidenceSealVerifyClassification?: string;
      ceremonyClassifications: Record<string, string>;
    };
    expect(finalizeReceipt.schemaVersion).toBe("fhv-t4a-post-finalize-receipt/v1");
    expect(finalizeReceipt.stepProofDigests["28"]).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.stepProofDigests["29"]).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.stepProofDigests["30"]).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.stepProofDigests["31"]).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.stepProofDigests["32"]).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.continuityVerificationProofPath).toBeTruthy();
    expect(finalizeReceipt.continuityVerificationProofDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.evidenceSealRootDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.evidenceSealManifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(finalizeReceipt.evidenceSealVerifyClassification).toBe(
      "FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS",
    );
    for (const [key, value] of Object.entries(FHV_T4A_CEREMONY_REQUIRED_RESULTS)) {
      expect(finalizeReceipt.ceremonyClassifications[key]).toBe(value);
    }
    expect(finalizeReceipt.ceremonyClassifications.T4_RESULT).toBeUndefined();
    expect(finalizeReceipt.ceremonyClassifications.T4_AGGREGATE_RESULT).toBeUndefined();
    expect(finalizeReceipt.ceremonyClassifications.DASHBOARD_RESULT).toBeUndefined();
    const tracePath = join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-operator-trace.jsonl");
    expect(existsSync(tracePath)).toBe(true);
    const traceLines = readFileSync(tracePath, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            semanticStep: number | string;
            exitStatus: number;
            terminalClassification?: string;
          },
      );
    expect(traceLines.some((line) => line.semanticStep === 15 && line.exitStatus === 0)).toBe(true);
    expect(traceLines.some((line) => line.semanticStep === 26 && line.exitStatus === 0)).toBe(true);
    for (const step of [28, 29, 30, 31, 32] as const) {
      expect(
        traceLines.some(
          (line) =>
            line.semanticStep === step &&
            line.exitStatus === 0 &&
            line.terminalClassification === `FHV_T4A_STEP_${step}_OK`,
        ),
      ).toBe(true);
    }
  }, 300_000);

  const negativeCases: Array<{
    id: string;
    phase: string;
    mutate: (ctx: { env: NodeJS.ProcessEnv; releaseRoot: string }) => void;
    code: string;
  }> = [
    {
      id: "D-01",
      phase: "verify-local-release",
      mutate: ({ env }) => {
        delete env.FHV_SYSTEMCTL_BIN;
      },
      code: "FHV_T4A_BINDING_MISSING",
    },
    {
      id: "D-03",
      phase: "verify-local-release",
      mutate: ({ releaseRoot }) => {
        writeFileSync(join(releaseRoot, ".fhv-dirty-marker"), "x\n");
      },
      code: "FHV_T4A_LOCAL_RELEASE_DIRTY",
    },
    {
      id: "D-04",
      phase: "pre-auth",
      mutate: ({ env }) => {
        env.FHV_T4A_HERMETIC_INTEGRATION = "0";
        env.FHV_T4A_OPERATOR_TEST_MODE = "1";
      },
      code: "FHV_T4A_TEST_TRANSPORT_MISSING",
    },
    {
      id: "D-04b",
      phase: "post-auth-before-disconnect",
      mutate: ({ env }) => {
        env.FHV_T4A_AUTHORIZATION = "AUTHORIZE";
      },
      code: "FHV_T4A_AUTHORIZATION_LITERAL_REJECTED",
    },
    {
      id: "D-13",
      phase: "post-auth-before-disconnect",
      mutate: ({ env }) => {
        env.FHV_T4A_AUTHORIZATION = "WRONG-TOKEN";
      },
      code: "FHV_T4A_AUTHORIZATION_REQUIRED",
    },
    {
      id: "D-14",
      phase: "post-reconnect-finalize",
      mutate: () => {
        /* skip post-before receipt */
      },
      code: "FHV_T4A_POST_BEFORE_RECEIPT_MISSING",
    },
  ];

  for (const negative of negativeCases) {
    it(`negative ${negative.id} fails closed via shell entrypoint`, () => {
      const { releaseRoot, sha, tag } = createTempReleaseCheckout();
      const env = buildEnv(releaseRoot, sha, tag, {
        FHV_T4A_AUTHORIZATION: FHV_T4A_AUTHORIZATION_LITERAL,
      });
      negative.mutate({ env, releaseRoot });
      if (negative.id !== "D-14" && negative.id !== "D-04b" && negative.id !== "D-13") {
        runOperatorShell("verify-local-release", env);
      }
      if (
        negative.phase === "post-auth-before-disconnect" ||
        negative.phase === "post-reconnect-finalize"
      ) {
        if (negative.id !== "D-04b" && negative.id !== "D-13" && negative.id !== "D-14") {
          runOperatorShell("pre-auth", env);
        }
        if (negative.id !== "D-14") {
          runOperatorShell("verify-local-release", env);
          runOperatorShell("pre-auth", env);
        }
      }
      if (negative.phase === "post-reconnect-finalize" && negative.id !== "D-14") {
        runOperatorShell("post-auth-before-disconnect", env);
      }
      const result = runOperatorShell(negative.phase, env);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(new RegExp(negative.code));
    });
  }

  it("streams bootstrap bytes from committed git objects not dirty working tree", () => {
    const { releaseRoot, sha } = createTempReleaseCheckout();
    const committed = execFileSync(
      "git",
      ["-C", releaseRoot, "show", `${sha}:scripts/ops/fhv-validate-origin-url.sh`],
      { encoding: "utf8" },
    );
    const dirtyRoot = trackDir(mkdtempSync(join(tmpdir(), "fhv-t4a-dirty-release-")));
    cpSync(releaseRoot, dirtyRoot, { recursive: true });
    const dirtyScript = join(dirtyRoot, "scripts/ops/fhv-validate-origin-url.sh");
    writeFileSync(dirtyScript, "#!/usr/bin/env bash\nexit 99\n");
    const streamed = execFileSync(
      "git",
      ["-C", releaseRoot, "show", `${sha}:scripts/ops/fhv-validate-origin-url.sh`],
      { encoding: "utf8" },
    );
    expect(sha256Hex(streamed)).toBe(sha256Hex(committed));
    expect(streamed).not.toContain("exit 99");
    expect(readFileSync(dirtyScript, "utf8")).toContain("exit 99");
  });

  it("bootstrap scripts execute from stdin without sibling privilege source", () => {
    for (const script of [
      "scripts/ops/fhv-t4-host-preflight.sh",
      "scripts/ops/fhv-service-user-checkout.sh",
      "scripts/ops/fhv-service-user-install-deps.sh",
    ]) {
      const content = readFileSync(join(ROOT, script), "utf8");
      expect(content).toContain("fhv_t4_require_effective_root");
      expect(content).not.toContain("_fhv-t4-privilege-common.sh");
    }
  });
});
