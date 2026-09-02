import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import type { KmFourSurfaceProductionPreflightInputV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";

const SOURCE_SUFFIXES = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
] as const;
const PRODUCTION_ROOTS = [
  "app", "components", "control", "db", "drizzle", "lib", "scripts", "services",
] as const;
const PREFLIGHT =
  "lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2.ts";
const BOOTSTRAP =
  "lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2.ts";

function isSourceFile(path: string): boolean {
  return SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function productionSourceFiles(projectRoot = resolve(process.cwd())): string[] {
  function visit(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return entry.name === "tests" ? [] : visit(path);
      return entry.isFile() && isSourceFile(path) ? [path] : [];
    });
  }
  const rootFiles = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSourceFile(entry.name))
    .map((entry) => join(projectRoot, entry.name));
  return [...rootFiles, ...PRODUCTION_ROOTS.flatMap((root) => {
    const path = resolve(projectRoot, root);
    return existsSync(path) ? visit(path) : [];
  })];
}

type ModuleReference = Readonly<{
  moduleSpecifier: string;
  importedNames: readonly string[];
  namespace: boolean;
}>;

function moduleReferences(path: string): readonly ModuleReference[] {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const references: ModuleReference[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      references.push({
        moduleSpecifier: node.moduleSpecifier.text,
        importedNames: bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
          : [],
        namespace: Boolean(bindings && ts.isNamespaceImport(bindings)),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
               ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({
        moduleSpecifier: node.moduleSpecifier.text,
        importedNames: node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((element) =>
              (element.propertyName ?? element.name).text)
          : [],
        namespace: !node.exportClause || ts.isNamespaceExport(node.exportClause),
      });
    } else if (ts.isImportEqualsDeclaration(node) &&
               ts.isExternalModuleReference(node.moduleReference) &&
               node.moduleReference.expression &&
               ts.isStringLiteral(node.moduleReference.expression)) {
      references.push({
        moduleSpecifier: node.moduleReference.expression.text,
        importedNames: [],
        namespace: true,
      });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 &&
               ts.isStringLiteral(node.arguments[0]!) &&
               (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      references.push({
        moduleSpecifier: node.arguments[0]!.text,
        importedNames: [],
        namespace: true,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return references;
}

function projectRelative(path: string, projectRoot = resolve(process.cwd())): string {
  return relative(projectRoot, path).replaceAll("\\", "/");
}

function normalizedModuleSpecifier(moduleSpecifier: string): string {
  return moduleSpecifier.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/i, "");
}

function restrictedAuthorityImportOffenders(
  paths: readonly string[],
  projectRoot = resolve(process.cwd()),
): string[] {
  return paths.flatMap((path) => {
    const consumer = projectRelative(path, projectRoot);
    return moduleReferences(path).flatMap(({ moduleSpecifier }) => {
      const normalized = normalizedModuleSpecifier(moduleSpecifier);
      const importsBootstrap = normalized.endsWith(
        "km-four-surface-production-bootstrap-v2",
      );
      const importsContract = normalized.endsWith("km-four-surface-contract-v2");
      if (importsBootstrap && consumer !== PREFLIGHT) return [`${consumer} -> ${moduleSpecifier}`];
      if (importsContract && consumer !== BOOTSTRAP) return [`${consumer} -> ${moduleSpecifier}`];
      return [];
    });
  });
}

function testOnlyImportOffenders(
  paths: readonly string[],
  projectRoot = resolve(process.cwd()),
): string[] {
  return paths.flatMap((path) => {
    const consumer = projectRelative(path, projectRoot);
    return moduleReferences(path).flatMap(({ moduleSpecifier, importedNames, namespace }) => {
      const normalized = normalizedModuleSpecifier(moduleSpecifier);
      const importsTestOnly = importedNames.some((name) => name.startsWith("TEST_ONLY_"));
      const namespaceEscape = namespace &&
        (normalized.endsWith("km-four-surface-production-bootstrap-v2") ||
         normalized.endsWith("km-four-surface-production-preflight-v2"));
      return importsTestOnly || namespaceEscape ? [`${consumer} -> ${moduleSpecifier}`] : [];
    });
  });
}

describe("DEE-917 production consumer firewall", () => {
  let fixtureRoot = "";
  afterEach(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = "";
  });

  it("keeps SQL and authority providers out of the public production input", () => {
    const acceptsSql: "sql" extends keyof KmFourSurfaceProductionPreflightInputV2
      ? true : false = false;
    const acceptsAuthorityProvider:
      "authorityProvider" extends keyof KmFourSurfaceProductionPreflightInputV2
        ? true : false = false;
    const acceptsDurableLoader:
      "loadDurableAuthority" extends keyof KmFourSurfaceProductionPreflightInputV2
        ? true : false = false;
    expect({ acceptsSql, acceptsAuthorityProvider, acceptsDurableLoader }).toEqual({
      acceptsSql: false,
      acceptsAuthorityProvider: false,
      acceptsDurableLoader: false,
    });

    const source = readFileSync(resolve(process.cwd(), PREFLIGHT), "utf8");
    const publicInput = source.match(
      /export type KmFourSurfaceProductionPreflightInputV2 = Readonly<([\s\S]*?)>;/,
    )?.[1] ?? "";
    expect(publicInput).not.toMatch(/\bsql\b|provider|loadDurableAuthority/);
    expect(source).toContain("withWaiaPostgresClient");
  });

  it("exports only the closed production preflight and never bootstrap internals", () => {
    const index = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/index.ts",
    ), "utf8");
    expect(index).toContain("prepareKmFourSurfaceProductionAuthorityV2");
    expect(index).toContain("KmFourSurfaceProductionPreflightInputV2");
    expect(index).not.toContain("km-four-surface-production-bootstrap-v2");
    expect(index).not.toContain("buildKmFourSurfaceProductionAuthorityV2");
    expect(index).not.toMatch(/export\s+type[\s\S]*\bKmFourSurfaceProductionAuthorityV2\b/);
    expect(index).not.toContain("buildKmFourSurfaceContractV2");
  });

  it("restricts bootstrap and contract imports across every production source root", () => {
    expect(restrictedAuthorityImportOffenders(productionSourceFiles())).toEqual([]);
  });

  it("forbids TEST_ONLY and namespace escapes across every production source root", () => {
    expect(testOnlyImportOffenders(productionSourceFiles())).toEqual([]);
  });

  it("detects extension-qualified deep imports in .ts and services .mjs fixtures", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "dee-917-consumer-firewall-"));
    mkdirSync(join(fixtureRoot, "components"), { recursive: true });
    mkdirSync(join(fixtureRoot, "services"), { recursive: true });
    const componentPath = join(fixtureRoot, "components", "deep-import.ts");
    const servicePath = join(fixtureRoot, "services", "escape.mjs");
    writeFileSync(componentPath,
      'import { buildKmFourSurfaceProductionAuthorityV2 } from "../lib/km-four-surface-production-bootstrap-v2.ts";\n');
    writeFileSync(servicePath,
      'const preflight = await import("../lib/km-four-surface-production-preflight-v2.mjs");\n');

    const paths = productionSourceFiles(fixtureRoot);
    expect(paths.map((path) => projectRelative(path, fixtureRoot)).sort()).toEqual([
      "components/deep-import.ts",
      "services/escape.mjs",
    ]);
    expect(restrictedAuthorityImportOffenders(paths, fixtureRoot)).toEqual([
      "components/deep-import.ts -> ../lib/km-four-surface-production-bootstrap-v2.ts",
    ]);
    expect(testOnlyImportOffenders(paths, fixtureRoot)).toEqual([
      "services/escape.mjs -> ../lib/km-four-surface-production-preflight-v2.mjs",
    ]);
  });
});
