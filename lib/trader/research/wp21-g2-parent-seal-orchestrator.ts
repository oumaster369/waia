import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  withTemporaryWorktree,
  WP21_FLAG_OFF_PARENT_SHA,
} from "@/lib/trader/intelligence/epistemic/wp21-proof-harness";
import { canonicalJsonString } from "@/lib/trader/research/digest";

export const WP21_PARENT_GIT_SHA = WP21_FLAG_OFF_PARENT_SHA;

export const WP21_PARENT_PATCH_RELATIVE_PATH =
  "tests/fixtures/trader/wp21-parent-5e9fb106-cost-vector-oracle-v2.patch" as const;

export const WP21_PARENT_PATCH_SHA256 =
  "4d707c39cf1856bb999a92db1a2715e217c64effca78fdface03940dd9cd7126" as const;

export const WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH =
  "tests/fixtures/trader/wp21-g2-cost-vectors-v1.json" as const;

export const WP21_BOUND_VECTOR_FIXTURE_SHA256 =
  "8e89180c23ed93fb9dc2703c5133ff627aa330aeb9d69920e97f50b06cc7eefc" as const;

export const WP21_BOUND_ZERO_FILL_FIXTURE_RELATIVE_PATH =
  "tests/fixtures/trader/btcusdt-1m-mean-reversion.json" as const;

export const WP21_BOUND_ZERO_FILL_FIXTURE_SHA256 =
  "aca9b95b6962ee57215daa19f14f820d74df2efcabb2343f4bfe33ac07d49a6f" as const;

export const WP21_ZERO_FILL_SEMANTIC_DIGEST =
  "2073f646997d445e05189942d4fb81c16e3130a499fedee7b206c3d892173f11" as const;

export const WP21_PARENT_ORACLE_SEMANTIC_DIGEST =
  "7c6cad83becb96aa4d534edb51c32aab17102652521a552d9c3a122ade69b6c7" as const;

export const WP21_ZERO_FILL_CYCLE_COUNT = 6 as const;
export const WP21_PARENT_ORACLE_VECTOR_COUNT = 9 as const;

export type Wp21ParentSealProvenance = {
  parentGitSha: typeof WP21_PARENT_GIT_SHA;
  parentPatchPath: typeof WP21_PARENT_PATCH_RELATIVE_PATH;
  parentPatchSha256: typeof WP21_PARENT_PATCH_SHA256;
  vectorFixturePath: typeof WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH;
  vectorFixtureSha256: typeof WP21_BOUND_VECTOR_FIXTURE_SHA256;
  zeroFillFixturePath: typeof WP21_BOUND_ZERO_FILL_FIXTURE_RELATIVE_PATH;
  zeroFillFixtureSha256: typeof WP21_BOUND_ZERO_FILL_FIXTURE_SHA256;
};

export type Wp21ParentSealResult = {
  provenance: Wp21ParentSealProvenance;
  zeroFillSemantic: {
    semanticResultDigest: string;
    cycleCount: number;
    submittedOrders: number;
    acceptedOrders: number;
    filledOrders: number;
    cycles: unknown[];
    metricsSchemaVersion: string;
  };
  parentOracleSemantic: { semanticResultDigest: string; vectorCount: number };
  provenanceDigest: string;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256File(absPath: string): string {
  return sha256Utf8(readFileSync(absPath, "utf8"));
}

export function assertBoundParentPatchBytes(repoRoot: string): void {
  const abs = path.join(repoRoot, WP21_PARENT_PATCH_RELATIVE_PATH);
  const digest = sha256File(abs);
  if (digest !== WP21_PARENT_PATCH_SHA256) {
    throw new Error("WP21_PARENT_SEAL_PATCH_DIGEST_MISMATCH");
  }
}

export function assertBoundVectorFixtureBytes(repoRoot: string): void {
  const abs = path.join(repoRoot, WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH);
  const digest = sha256File(abs);
  if (digest !== WP21_BOUND_VECTOR_FIXTURE_SHA256) {
    throw new Error("WP21_PARENT_SEAL_VECTOR_FIXTURE_DIGEST_MISMATCH");
  }
}

export function assertParentGitSha(parentGitSha: string): void {
  if (parentGitSha !== WP21_PARENT_GIT_SHA) {
    throw new Error("WP21_PARENT_SEAL_PARENT_SHA_MISMATCH");
  }
}

function runParentCli(input: {
  worktreePath: string;
  scriptRelativePath: string;
  args: string[];
}): void {
  const scriptPath = path.join(input.worktreePath, input.scriptRelativePath);
  execSync(
    `pnpm exec node --import tsx --conditions=react-server "${scriptPath}" ${input.args.join(" ")}`,
    {
      cwd: input.worktreePath,
      env: {
        ...process.env,
        WAIA_TRADER_CLI: "1",
        NODE_ENV: "test",
      },
      stdio: "pipe",
      encoding: "utf8",
    },
  );
}

function applyParentInstrumentationPatch(input: { repoRoot: string; worktreePath: string }): void {
  const patchSrc = path.join(input.repoRoot, WP21_PARENT_PATCH_RELATIVE_PATH);
  const patchDest = path.join(input.worktreePath, WP21_PARENT_PATCH_RELATIVE_PATH);
  mkdirSync(path.dirname(patchDest), { recursive: true });
  copyFileSync(patchSrc, patchDest);

  const vectorSrc = path.join(input.repoRoot, WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH);
  const vectorDest = path.join(input.worktreePath, WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH);
  mkdirSync(path.dirname(vectorDest), { recursive: true });
  copyFileSync(vectorSrc, vectorDest);

  try {
    execSync(`git apply --check "${patchDest}"`, { cwd: input.worktreePath, stdio: "pipe" });
    execSync(`git apply "${patchDest}"`, { cwd: input.worktreePath, stdio: "pipe" });
  } catch {
    throw new Error("WP21_PARENT_SEAL_PATCH_APPLY_FAILED");
  }
}

export function generateWp21G2ParentSeal(input?: {
  repoRoot?: string;
  metricsSchemaVersion?: "1.0.0" | "2.0.0";
}): Wp21ParentSealResult {
  const repoRoot = input?.repoRoot ?? process.cwd();
  const metricsSchemaVersion = input?.metricsSchemaVersion ?? "2.0.0";
  assertBoundParentPatchBytes(repoRoot);
  assertBoundVectorFixtureBytes(repoRoot);

  const provenance: Wp21ParentSealProvenance = {
    parentGitSha: WP21_PARENT_GIT_SHA,
    parentPatchPath: WP21_PARENT_PATCH_RELATIVE_PATH,
    parentPatchSha256: WP21_PARENT_PATCH_SHA256,
    vectorFixturePath: WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH,
    vectorFixtureSha256: WP21_BOUND_VECTOR_FIXTURE_SHA256,
    zeroFillFixturePath: WP21_BOUND_ZERO_FILL_FIXTURE_RELATIVE_PATH,
    zeroFillFixtureSha256: WP21_BOUND_ZERO_FILL_FIXTURE_SHA256,
  };

  return withTemporaryWorktree(WP21_PARENT_GIT_SHA, (worktreePath) => {
    applyParentInstrumentationPatch({ repoRoot, worktreePath });

    const outDir = path.join(worktreePath, ".cursor/wp21-parent-seal");
    mkdirSync(outDir, { recursive: true });
    const zeroFillOut = path.join(outDir, "zero-fill-semantic.json");
    const oracleOut = path.join(outDir, "parent-oracle-semantic.json");

    runParentCli({
      worktreePath,
      scriptRelativePath: "scripts/trader/wp21-parent-zero-fill-structural-export-v1.ts",
      args: [
        `--fixture-path=${WP21_BOUND_ZERO_FILL_FIXTURE_RELATIVE_PATH}`,
        `--fixture-sha256=${WP21_BOUND_ZERO_FILL_FIXTURE_SHA256}`,
        `--metrics-schema-version=${metricsSchemaVersion}`,
        `--out=${zeroFillOut}`,
      ],
    });

    runParentCli({
      worktreePath,
      scriptRelativePath: "scripts/trader/wp21-parent-cost-vector-oracle-v1.ts",
      args: [
        `--fixture-path=${WP21_BOUND_VECTOR_FIXTURE_RELATIVE_PATH}`,
        `--fixture-sha256=${WP21_BOUND_VECTOR_FIXTURE_SHA256}`,
        `--out=${oracleOut}`,
      ],
    });

    const zeroFillSemantic = JSON.parse(readFileSync(zeroFillOut, "utf8")) as {
      semanticResultDigest: string;
      cycleCount: number;
      submittedOrders: number;
      acceptedOrders: number;
      filledOrders: number;
      cycles: unknown[];
      metricsSchemaVersion: string;
    };
    const parentOracleSemantic = JSON.parse(readFileSync(oracleOut, "utf8")) as {
      semanticResultDigest: string;
      vectorCount: number;
    };

    const provenanceDigest = sha256Utf8(canonicalJsonString(provenance));

    return {
      provenance,
      zeroFillSemantic,
      parentOracleSemantic,
      provenanceDigest,
    };
  });
}

export function assertExpectedParentSealDigests(result: Wp21ParentSealResult): void {
  if (result.zeroFillSemantic.semanticResultDigest !== WP21_ZERO_FILL_SEMANTIC_DIGEST) {
    throw new Error("WP21_PARENT_SEAL_ZERO_FILL_DIGEST_MISMATCH");
  }
  if (result.parentOracleSemantic.semanticResultDigest !== WP21_PARENT_ORACLE_SEMANTIC_DIGEST) {
    throw new Error("WP21_PARENT_SEAL_ORACLE_DIGEST_MISMATCH");
  }
  if (result.zeroFillSemantic.cycleCount !== WP21_ZERO_FILL_CYCLE_COUNT) {
    throw new Error("WP21_PARENT_SEAL_ZERO_FILL_CYCLE_COUNT_MISMATCH");
  }
  if (result.parentOracleSemantic.vectorCount !== WP21_PARENT_ORACLE_VECTOR_COUNT) {
    throw new Error("WP21_PARENT_SEAL_ORACLE_VECTOR_COUNT_MISMATCH");
  }
}
