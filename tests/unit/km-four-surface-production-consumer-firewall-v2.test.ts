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
const SCIENTIFIC_ADMISSION =
  "lib/trader/research/execopp-qualification/scientific-admission-four-surface-v2.ts";
const SCIENTIFIC_ADMISSION_REPOSITORY =
  "lib/trader/research/execopp-qualification/scientific-admission-four-surface-repository-postgres-v2.ts";
const HISTORICAL_RATIFIED_ADMISSION =
  "lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts";

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
  accessMode:
    | "named-import"
    | "namespace-import"
    | "side-effect-import"
    | "named-export"
    | "export-star"
    | "import-equals"
    | "dynamic-import"
    | "require";
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
        accessMode: bindings
          ? ts.isNamedImports(bindings) ? "named-import" : "namespace-import"
          : "side-effect-import",
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
        accessMode: node.exportClause && ts.isNamedExports(node.exportClause)
          ? "named-export"
          : "export-star",
      });
    } else if (ts.isImportEqualsDeclaration(node) &&
               ts.isExternalModuleReference(node.moduleReference) &&
               node.moduleReference.expression &&
               ts.isStringLiteral(node.moduleReference.expression)) {
      references.push({
        moduleSpecifier: node.moduleReference.expression.text,
        importedNames: [],
        namespace: true,
        accessMode: "import-equals",
      });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 &&
               ts.isStringLiteral(node.arguments[0]!) &&
               (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      references.push({
        moduleSpecifier: node.arguments[0]!.text,
        importedNames: [],
        namespace: true,
        accessMode: node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? "dynamic-import"
          : "require",
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

function scientificAdmissionInternalImportOffenders(
  paths: readonly string[],
  projectRoot = resolve(process.cwd()),
): string[] {
  return paths.flatMap((path) => {
    const consumer = projectRelative(path, projectRoot);
    return moduleReferences(path).flatMap(({ moduleSpecifier, accessMode, importedNames }) => {
      const normalized = normalizedModuleSpecifier(moduleSpecifier);
      const admissionModule = normalized.endsWith("scientific-admission-four-surface-v2");
      const repositoryModule = normalized.endsWith(
        "scientific-admission-four-surface-repository-postgres-v2",
      );
      if (!admissionModule && !repositoryModule) return [];
      const allowedNames = admissionModule
        ? consumer === SCIENTIFIC_ADMISSION_REPOSITORY
          ? [
              "INTERNAL_buildScientificAdmissionFourSurfaceV2",
              "INTERNAL_requireScientificAdmissionFourSurfaceV2",
              "SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2",
              "SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2",
              "INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2",
              "ScientificAdmissionFourSurfaceExpectedV2",
              "ScientificAdmissionFourSurfaceReceiptV2",
            ]
          : []
        : consumer === PREFLIGHT
          ? [
              "INTERNAL_persistScientificAdmissionFourSurfaceV2",
              "ScientificAdmissionFourSurfaceReceiptV2",
            ]
          : consumer === HISTORICAL_RATIFIED_ADMISSION
            ? [
                "requireScientificAdmissionFourSurfaceForOrganizationV2",
                "ScientificAdmissionFourSurfaceReceiptV2",
              ]
            : [];
      // Internal capability and durable-reader modules may only be consumed via ordinary,
      // statically analyzable named imports at their exact trusted composition edges.
      // Namespace/dynamic/CommonJS/re-export forms can conceal or propagate capabilities.
      if (accessMode === "named-import" && importedNames.length > 0 &&
          importedNames.every((name) => allowedNames.includes(name))) return [];
      return [`${consumer} -> ${moduleSpecifier}`];
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
    expect(source).toContain("withRequiredSessionPostgresClient");
    expect(source).not.toContain("withWaiaPostgresClient");
  });

  it("exports only the trusted admission composition and never structural authority internals", () => {
    const index = readFileSync(resolve(
      process.cwd(),
      "lib/trader/research/execopp-qualification/index.ts",
    ), "utf8");
    expect(index).toContain("createKmFourSurfaceScientificAdmissionProductionV2");
    expect(index).toContain("KmFourSurfaceProductionPreflightInputV2");
    expect(index).not.toContain("km-four-surface-production-bootstrap-v2");
    expect(index).not.toContain("buildKmFourSurfaceProductionAuthorityV2");
    expect(index).not.toContain("prepareKmFourSurfaceProductionAuthorityV2");
    expect(index).not.toContain("persistScientificAdmissionFourSurfaceV2");
    expect(index).not.toContain("buildScientificAdmissionFourSurfaceV2");
    expect(index).not.toContain("INTERNAL_");
    expect(index).not.toMatch(/export\s+type[\s\S]*\bKmFourSurfaceProductionAuthorityV2\b/);
    expect(index).not.toContain("buildKmFourSurfaceContractV2");
  });

  it("restricts bootstrap and contract imports across every production source root", () => {
    expect(restrictedAuthorityImportOffenders(productionSourceFiles())).toEqual([]);
  });

  it("forbids TEST_ONLY and namespace escapes across every production source root", () => {
    expect(testOnlyImportOffenders(productionSourceFiles())).toEqual([]);
  });

  it("restricts DEE-918 internal admission composition to the trusted preflight path", () => {
    expect(scientificAdmissionInternalImportOffenders(productionSourceFiles())).toEqual([]);
    expect(readFileSync(resolve(process.cwd(), SCIENTIFIC_ADMISSION), "utf8"))
      .not.toContain("km-four-surface-production-bootstrap-v2");
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

  it("rejects every opaque or propagating DEE-918 internal-module import form", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "dee-918-consumer-firewall-"));
    mkdirSync(join(fixtureRoot, "components"), { recursive: true });
    mkdirSync(join(fixtureRoot, "services"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, "components", "admission-namespace.ts"),
      'import * as admission from "../lib/scientific-admission-four-surface-v2";\n',
    );
    writeFileSync(
      join(fixtureRoot, "components", "admission-require.cjs"),
      'const admission = require("../lib/scientific-admission-four-surface-v2.cjs");\n',
    );
    writeFileSync(
      join(fixtureRoot, "components", "admission-dynamic.mjs"),
      'const admission = await import("../lib/scientific-admission-four-surface-v2.mjs");\n',
    );
    writeFileSync(
      join(fixtureRoot, "components", "admission-export-star.mjs"),
      'export * from "../lib/scientific-admission-four-surface-v2.mjs";\n',
    );
    writeFileSync(
      join(fixtureRoot, "services", "repository-namespace.ts"),
      'import * as repository from "../lib/scientific-admission-four-surface-repository-postgres-v2";\n',
    );
    writeFileSync(
      join(fixtureRoot, "services", "repository-require.cjs"),
      'const repository = require("../lib/scientific-admission-four-surface-repository-postgres-v2.cjs");\n',
    );
    writeFileSync(
      join(fixtureRoot, "services", "repository-dynamic.mjs"),
      'const repository = await import("../lib/scientific-admission-four-surface-repository-postgres-v2.mjs");\n',
    );
    writeFileSync(
      join(fixtureRoot, "services", "repository-export-star.mjs"),
      'export * from "../lib/scientific-admission-four-surface-repository-postgres-v2.mjs";\n',
    );

    expect(scientificAdmissionInternalImportOffenders(
      productionSourceFiles(fixtureRoot),
      fixtureRoot,
    ).sort()).toEqual([
      "components/admission-dynamic.mjs -> ../lib/scientific-admission-four-surface-v2.mjs",
      "components/admission-export-star.mjs -> ../lib/scientific-admission-four-surface-v2.mjs",
      "components/admission-namespace.ts -> ../lib/scientific-admission-four-surface-v2",
      "components/admission-require.cjs -> ../lib/scientific-admission-four-surface-v2.cjs",
      "services/repository-dynamic.mjs -> ../lib/scientific-admission-four-surface-repository-postgres-v2.mjs",
      "services/repository-export-star.mjs -> ../lib/scientific-admission-four-surface-repository-postgres-v2.mjs",
      "services/repository-namespace.ts -> ../lib/scientific-admission-four-surface-repository-postgres-v2",
      "services/repository-require.cjs -> ../lib/scientific-admission-four-surface-repository-postgres-v2.cjs",
    ].sort());
  });
});
