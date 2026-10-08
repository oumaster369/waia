import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dockerfilePath = path.join(repoRoot, "services/account-observation-projection/Dockerfile");

function dockerCopies(dockerfile: string): Array<{ source: string; destination: string; stage: number }> {
  const copies: Array<{ source: string; destination: string; stage: number }> = [];
  let stage = 0;
  for (const rawLine of dockerfile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^FROM\s/i.test(line)) {
      stage++;
      continue;
    }
    if (!/^COPY\s/i.test(line)) continue;
    const fields = line.split(/\s+/).slice(1);
    if (fields[0]?.startsWith("--from=")) continue;
    const destination = fields.at(-1);
    if (!destination) throw new Error(`invalid build-stage COPY: ${line}`);
    for (const source of fields.slice(0, -1)) copies.push({ source, destination, stage });
  }
  return copies;
}

function requiredContextPaths(copies: Array<{ source: string }>): string[] {
  const paths = new Set<string>();
  for (const { source } of copies) {
    if (source.startsWith("/") || source.includes("*") || source.split("/").includes("..")) {
      throw new Error(`unsupported Docker COPY source: ${source}`);
    }
    let current = "";
    for (const part of source.split("/")) {
      current = current ? `${current}/${part}` : part;
      paths.add(`!${current}`);
    }
  }
  return [...paths].sort();
}

function dockerIgnoreAllowlist(dockerignore: string): string[] {
  const lines = dockerignore.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines[0] !== "**") throw new Error("Docker ignore must begin with the deny-all rule");
  const allowlist = lines.slice(1);
  if (allowlist.some((line) => !line.startsWith("!") || /[*?\[\]{}]/.test(line))) {
    throw new Error("unsupported Docker ignore pattern");
  }
  return allowlist.sort();
}

async function packageRootFor(requireFromRoot: NodeRequire, packageName: string): Promise<string> {
  let current = path.dirname(await realpath(requireFromRoot.resolve(packageName)));
  while (current !== path.dirname(current)) {
    try {
      const metadata = JSON.parse(await readFile(path.join(current, "package.json"), "utf8")) as {
        name?: string;
      };
      if (metadata.name === packageName) return current;
    } catch {
      // Continue walking until the package boundary is found.
    }
    current = path.dirname(current);
  }
  throw new Error(`package root not found: ${packageName}`);
}

describe("projection image Docker source closure", () => {
  it("bundles runtime imports from the exact first-stage COPY context", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const dockerignore = await readFile(`${dockerfilePath}.dockerignore`, "utf8");
    const allCopies = dockerCopies(dockerfile);
    const copies = allCopies.filter((copy) => copy.stage === 1);
    const expectedDockerIgnore = [
      ...requiredContextPaths(allCopies),
      "!services/account-observation-projection/Dockerfile",
    ].sort();
    expect(dockerIgnoreAllowlist(dockerignore)).toEqual(expectedDockerIgnore);
    const required = [
      "lib/trader/account-observation/coverage.ts",
      "lib/trader/account-observation/derivatives/htx-v5-bill-groups.ts",
    ];

    for (const source of required) {
      expect(copies.some((copy) => copy.source === source)).toBe(true);
    }

    const context = await mkdtemp(path.join(os.tmpdir(), "waia-projection-docker-context-"));
    try {
      for (const { source, destination } of copies) {
        const sourcePath = path.join(repoRoot, source);
        const destinationPath = destination === "." || destination === "./"
          ? path.join(context, path.basename(source))
          : path.join(context, destination);
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await cp(sourcePath, destinationPath, { recursive: true });
      }

      // Mirror the packages consumed by this bundle from the existing locked
      // install. Resolve esbuild from the real tsx package just as the builder
      // does, including its platform-specific optional binary package.
      const stagedNodeModules = path.join(context, "node_modules");
      await mkdir(stagedNodeModules);
      const rootRequire = createRequire(path.join(repoRoot, "package.json"));
      const tsxPackage = await realpath(rootRequire.resolve("tsx/package.json"));
      const fromTsx = createRequire(tsxPackage);
      const esbuildPackage = await realpath(fromTsx.resolve("esbuild/package.json"));
      const fromEsbuild = createRequire(esbuildPackage);
      const nativeBinaryPackage = await realpath(
        fromEsbuild.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`),
      );
      const packages = [
        { source: path.dirname(tsxPackage), destination: "tsx" },
        { source: path.dirname(esbuildPackage), destination: "esbuild" },
        {
          source: path.dirname(nativeBinaryPackage),
          destination: `@esbuild/${process.platform}-${process.arch}`,
        },
        ...await Promise.all(["postgres", "server-only", "zod"].map(async (name) => ({
          source: await packageRootFor(rootRequire, name),
          destination: name,
        }))),
      ];
      for (const { source, destination } of packages) {
        const target = path.join(stagedNodeModules, destination);
        await mkdir(path.dirname(target), { recursive: true });
        await cp(source, target, { recursive: true, dereference: true });
      }
      const output = path.join(context, "projection-output");
      execFileSync(process.execPath, [
        path.join(context, "scripts/trader/build-account-observation-projection.mjs"),
        output,
      ], { cwd: context, stdio: "pipe", timeout: 120_000 });

      const manifest = JSON.parse(
        await readFile(path.join(output, "dependency-manifest.json"), "utf8"),
      ) as { repositoryInputs: string[] };
      expect(manifest.repositoryInputs).toContain(required[0]);
      expect(manifest.repositoryInputs).toContain(required[1]);
    } finally {
      await rm(context, { recursive: true, force: true });
    }
  }, 150_000);
});
