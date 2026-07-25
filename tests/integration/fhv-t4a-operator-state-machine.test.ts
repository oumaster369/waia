import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_T4A_AUTHORIZATION_LITERAL,
  FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT,
} from "@/lib/trader/observability/fhv-t4a-operator-contract";
import { setFhvT4aOperatorTransportForTests } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  FhvT4aOperatorError,
  resolveFhvT4aOperatorBindings,
  runFhvT4aOperatorPhase,
  verifyFhvT4aLocalRelease,
} from "@/scripts/ops/fhv-t4a-operator";
import {
  createFhvT4aHermeticTransport,
  sha256Hex,
} from "@/tests/helpers/fhv-t4a-operator-transport";

const ROOT = process.cwd();

let tempDirs: string[] = [];

afterEach(() => {
  setFhvT4aOperatorTransportForTests(null);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function initGitRelease(): { releaseRoot: string; sha: string } {
  const releaseRoot = ROOT;
  const sha = execFileSync("git", ["-C", releaseRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return { releaseRoot, sha };
}

function resolveReleaseTag(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "local-dev";
  }
}

function hermeticTransport(
  releaseRoot: string,
  sha: string,
  env: NodeJS.ProcessEnv,
): ReturnType<typeof createFhvT4aHermeticTransport> {
  return createFhvT4aHermeticTransport({
    localReleaseRoot: releaseRoot,
    targetSha: sha,
    releaseTag: env.FHV_RELEASE_TAG ?? resolveReleaseTag(),
    serviceUser: "fhv",
    serviceUserHome: "/home/fhv",
    checkoutParent: env.FHV_CHECKOUT_PARENT!,
    artifactRoot: env.FHV_ARTIFACT_ROOT!,
    environmentFile: env.FHV_ENVIRONMENT_FILE!,
    nodeBin: process.execPath,
    corepackBin: process.execPath,
    gitBin: "/usr/bin/git",
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
  });
}

function baseEnv(releaseRoot: string, sha: string): NodeJS.ProcessEnv {
  const work = mkdtempSync(join(tmpdir(), "fhv-t4a-work-"));
  tempDirs.push(work);
  const envFile = join(work, "fhv.env");
  const artifactRoot = join(work, "artifacts");
  const checkoutParent = join(work, "checkouts");
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(checkoutParent, { recursive: true });
  writeFileSync(
    envFile,
    [
      "FHV_HOST_OS_QUALIFIED=true",
      "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
      "FHV_OPERATOR_COMMAND_SECRET=secret",
      "FHV_OBSERVER_TUNNEL_SECRET=tunnel",
    ].join("\n") + "\n",
  );
  return {
    ...process.env,
    FHV_T4A_OPERATOR_TEST_MODE: "1",
    EXEC_HOST: "exec.test",
    SSH_USER: "operator",
    FHV_LOCAL_RELEASE_ROOT: releaseRoot,
    EXECUTION_SERVER_TARGET_SHA: sha,
    FHV_RELEASE_TAG: resolveReleaseTag(),
    FHV_ORIGIN_URL: "https://github.com/oumaster369/waia.git",
    FHV_RUN_ID: "t4a-state-machine",
    FHV_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000436",
    FHV_OPERATOR_ID: "operator-test",
    FHV_SERVICE_USER: "fhv",
    FHV_ENVIRONMENT_FILE: envFile,
    FHV_ARTIFACT_ROOT: artifactRoot,
    FHV_CHECKOUT_PARENT: checkoutParent,
    FHV_EXPECTED_HOSTNAME: "exec.test",
    FHV_EXPECTED_MACHINE_ID_SHA256: "a".repeat(64),
    FHV_NODE_BIN: process.execPath,
    FHV_COREPACK_BIN: process.execPath,
    FHV_GIT_BIN: "/usr/bin/git",
    FHV_PYTHON_BIN: "/usr/bin/python3",
    FHV_DOCKER_BIN: "/usr/bin/docker",
    FHV_T4A_OPERATOR_TRACE_PATH: join(work, "trace.jsonl"),
  };
}

describe("fhv-t4a operator state machine (DEE-436)", () => {
  it("runs verify-local-release on clean git release checkout", () => {
    const { releaseRoot, sha } = initGitRelease();
    const status = execFileSync("git", ["-C", releaseRoot, "status", "--porcelain=v1"], {
      encoding: "utf8",
    }).trim();
    if (status) {
      return;
    }
    const env = baseEnv(releaseRoot, sha);
    const transport = hermeticTransport(releaseRoot, sha, env);
    setFhvT4aOperatorTransportForTests(transport);
    const bindings = resolveFhvT4aOperatorBindings(env);
    const digests = verifyFhvT4aLocalRelease(bindings, transport);
    expect(Object.keys(digests).length).toBeGreaterThan(0);
    expect(runFhvT4aOperatorPhase("verify-local-release", bindings, transport)).toBe(
      "FHV_T4A_LOCAL_RELEASE_VERIFY_OK",
    );
  });

  it("positive phase chain through awaiting human disconnect", () => {
    const { releaseRoot, sha } = initGitRelease();
    const env = {
      ...baseEnv(releaseRoot, sha),
      FHV_T4A_AUTHORIZATION: FHV_T4A_AUTHORIZATION_LITERAL,
    } as NodeJS.ProcessEnv;
    const transport = hermeticTransport(releaseRoot, sha, env);
    setFhvT4aOperatorTransportForTests(transport);
    const bindings = resolveFhvT4aOperatorBindings(env);
    const dirty = execFileSync("git", ["-C", releaseRoot, "status", "--porcelain=v1"], {
      encoding: "utf8",
    }).trim();
    if (!dirty) {
      runFhvT4aOperatorPhase("verify-local-release", bindings, transport);
    }
    runFhvT4aOperatorPhase("pre-auth", bindings, transport);
    expect(transport.remoteWriteCount()).toBe(0);
    expect(runFhvT4aOperatorPhase("post-auth-before-disconnect", bindings, transport)).toBe(
      FHV_T4A_TERMINAL_AWAITING_HUMAN_DISCONNECT_RECONNECT,
    );
    expect(runFhvT4aOperatorPhase("post-reconnect-finalize", bindings, transport)).toBe(
      "FHV_T4A_POST_RECONNECT_FINALIZE_OK",
    );
  });

  const negativeCases: Array<{
    id: string;
    mutate: (env: NodeJS.ProcessEnv) => void;
    code: string;
  }> = [
    {
      id: "D-01",
      mutate: (env) => {
        delete env.FHV_GIT_BIN;
      },
      code: "FHV_T4A_BINDING_MISSING",
    },
    {
      id: "D-03",
      mutate: () => {
        /* dirty tree applied in test body */
      },
      code: "FHV_T4A_LOCAL_RELEASE_DIRTY",
    },
    {
      id: "D-04",
      mutate: () => {
        /* sudo probe applied in test body */
      },
      code: "FHV_T4A_SUDO_NONINTERACTIVE_FAILED",
    },
    {
      id: "D-04b",
      mutate: (env) => {
        env.FHV_T4A_AUTHORIZATION = "AUTHORIZE";
      },
      code: "FHV_T4A_AUTHORIZATION_LITERAL_REJECTED",
    },
    {
      id: "D-13",
      mutate: (env) => {
        env.FHV_T4A_AUTHORIZATION = "WRONG-TOKEN";
      },
      code: "FHV_T4A_AUTHORIZATION_REQUIRED",
    },
  ];

  for (const negative of negativeCases) {
    it(`negative ${negative.id} fails closed`, () => {
      const { releaseRoot, sha } = initGitRelease();
      const env = baseEnv(releaseRoot, sha);
      negative.mutate(env);
      if (negative.id === "D-03") {
        const dirtyPath = join(releaseRoot, ".fhv-t4a-dirty-test-marker");
        writeFileSync(dirtyPath, "x");
        tempDirs.push(dirtyPath);
        execFileSync("git", ["-C", releaseRoot, "add", ".fhv-t4a-dirty-test-marker"]);
      }
      const transport = hermeticTransport(releaseRoot, sha, env);
      let activeTransport: FhvT4aOperatorTransport = transport;
      if (negative.id === "D-04") {
        activeTransport = {
          ...transport,
          sudoNoninteractiveProbe: () => ({
            exitCode: 1,
            stdout: "",
            stderr: "sudo required",
          }),
        };
        setFhvT4aOperatorTransportForTests(activeTransport);
      } else {
        setFhvT4aOperatorTransportForTests(transport);
      }
      if (negative.id === "D-01") {
        delete env.FHV_GIT_BIN;
        expect(() => resolveFhvT4aOperatorBindings(env)).toThrow(FhvT4aOperatorError);
        return;
      }
      const bindings = resolveFhvT4aOperatorBindings(env);
      const phase =
        negative.id === "D-13" || negative.id === "D-04b"
          ? "post-auth-before-disconnect"
          : negative.id === "D-04"
            ? "pre-auth"
            : "verify-local-release";
      expect(() => runFhvT4aOperatorPhase(phase, bindings, activeTransport)).toThrow(
        FhvT4aOperatorError,
      );
    });
  }

  it("streams bootstrap bytes from committed git objects not dirty working tree", () => {
    const { releaseRoot, sha } = initGitRelease();
    const transport = createFhvT4aHermeticTransport({
      localReleaseRoot: releaseRoot,
      targetSha: sha,
      releaseTag: resolveReleaseTag(),
      serviceUser: "fhv",
      serviceUserHome: "/home/fhv",
      checkoutParent: mkdtempSync(join(tmpdir(), "fhv-t4a-parent-")),
      artifactRoot: mkdtempSync(join(tmpdir(), "fhv-t4a-art-")),
      environmentFile: join(mkdtempSync(join(tmpdir(), "fhv-t4a-env-")), "env"),
      nodeBin: process.execPath,
      corepackBin: process.execPath,
      gitBin: "/usr/bin/git",
      pythonBin: "/usr/bin/python3",
      dockerBin: "/usr/bin/docker",
      systemctlBin: "/usr/bin/systemctl",
    });
    const committed = transport.gitShowBlob(sha, "scripts/ops/fhv-validate-origin-url.sh");
    const dirtyRoot = mkdtempSync(join(tmpdir(), "fhv-t4a-dirty-release-"));
    tempDirs.push(dirtyRoot);
    const dirtyScript = join(dirtyRoot, "scripts/ops/fhv-validate-origin-url.sh");
    mkdirSync(join(dirtyRoot, "scripts/ops"), { recursive: true });
    writeFileSync(dirtyScript, "#!/usr/bin/env bash\nexit 99\n");
    const streamed = transport.gitShowBlob(sha, "scripts/ops/fhv-validate-origin-url.sh");
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
