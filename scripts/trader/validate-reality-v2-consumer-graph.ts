import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

type Rule = { id: string; pathPattern: string; disposition: string };
type ConnectorReferenceCheck = {
  file: string;
  method: string;
  occurrences: number;
  disposition: string;
};
type Inventory = {
  canonicalSourceKinds: string[];
  admittedBoundaryFiles: string[];
  sourceDiscovery: {
    roots: string[];
    additionalFiles: string[];
    productionExtensions: string[];
    expectedFileCount: number;
    sortedPathDigestHex: string;
    sortedContentDigestHex: string;
  };
  sourceRules: Rule[];
  consumerDiscovery: {
    roots: string[];
    additionalFiles: string[];
    productionExtensions: string[];
    importMarkers: string[];
    connectorMethods: string[];
    expectedFileCount: number;
    sortedPathDigestHex: string;
    sortedContentDigestHex: string;
  };
  consumerRules: Rule[];
  explicitCompatibilityChecks: ConnectorReferenceCheck[];
  forbiddenRealityImportSegments: string[];
};

export type ConnectorMethodReference = Readonly<{
  file: string;
  method: string;
  line: number;
  form: "PROPERTY" | "OPTIONAL_PROPERTY" | "BRACKET" | "DESTRUCTURE";
}>;

const root = process.cwd();
const inventoryPath = join(root, "docs/ai-trader/reality-v2-source-consumer-inventory.json");

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [relative(root, path)];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walk(join(path, entry.name)));
}

function digest(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n"), "utf8").digest("hex");
}

function contentDigest(paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

function assertRuleClosure(paths: readonly string[], rules: readonly Rule[], label: string): void {
  for (const path of paths) {
    const matches = rules.filter((rule) => new RegExp(rule.pathPattern).test(path));
    if (matches.length !== 1) {
      throw new Error(`${label} ${path} matched ${matches.length} inventory rules`);
    }
  }
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:js|mjs|cjs)$/i.test(file)) return ts.ScriptKind.JS;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

export function detectConnectorMethodReferencesInSource(
  source: string,
  file: string,
  connectorMethods: readonly string[],
): readonly ConnectorMethodReference[] {
  const methods = new Set(connectorMethods);
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const references: ConnectorMethodReference[] = [];
  const add = (
    node: ts.Node,
    method: string,
    form: ConnectorMethodReference["form"],
  ) => {
    if (!methods.has(method)) return;
    references.push(Object.freeze({
      file,
      method,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      form,
    }));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      add(node, node.name.text, node.questionDotToken ? "OPTIONAL_PROPERTY" : "PROPERTY");
    } else if (ts.isElementAccessExpression(node) &&
      node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
      add(node, node.argumentExpression.text, "BRACKET");
    } else if (ts.isBindingElement(node)) {
      const name = node.propertyName ?? node.name;
      if (ts.isIdentifier(name)) add(node, name.text, "DESTRUCTURE");
      else if (ts.isStringLiteralLike(name)) add(node, name.text, "DESTRUCTURE");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(references);
}

function summarizeReferences(
  references: readonly ConnectorMethodReference[],
): Array<Omit<ConnectorReferenceCheck, "disposition">> {
  const counts = new Map<string, number>();
  for (const reference of references) {
    const key = `${reference.file}\0${reference.method}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, occurrences]) => {
    const [file, method] = key.split("\0");
    return { file: file!, method: method!, occurrences };
  }).sort((left, right) =>
    left.file.localeCompare(right.file) || left.method.localeCompare(right.method));
}

export function assertConnectorReferenceClosure(
  references: readonly ConnectorMethodReference[],
  checks: readonly ConnectorReferenceCheck[],
): void {
  const actual = summarizeReferences(references);
  const expected = checks.map((check) => ({
    file: check.file,
    method: check.method,
    occurrences: check.occurrences,
  }))
    .sort((left, right) => left.file.localeCompare(right.file) || left.method.localeCompare(right.method));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `connector reference closure drift: actual=${JSON.stringify(actual)} ` +
      `expected=${JSON.stringify(expected)}`,
    );
  }
  if (checks.some((check) => check.disposition.trim() === "")) {
    throw new Error("connector reference disposition must be explicit");
  }
}

function validate(): void {
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;
  const sourceExtensions = new Set(inventory.sourceDiscovery.productionExtensions);
  const consumerExtensions = new Set(inventory.consumerDiscovery.productionExtensions);
  const sourceFiles = [...new Set([
    ...inventory.sourceDiscovery.roots.flatMap((path) => walk(join(root, path))),
    ...inventory.sourceDiscovery.additionalFiles,
  ])].filter((path) => sourceExtensions.has(extname(path))).sort();
  assertRuleClosure(sourceFiles, inventory.sourceRules, "source");
  if (sourceFiles.length !== inventory.sourceDiscovery.expectedFileCount ||
    digest(sourceFiles) !== inventory.sourceDiscovery.sortedPathDigestHex ||
    contentDigest(sourceFiles) !== inventory.sourceDiscovery.sortedContentDigestHex) {
    throw new Error(
      `source inventory drift: count=${sourceFiles.length} pathDigest=${digest(sourceFiles)} ` +
      `contentDigest=${contentDigest(sourceFiles)}`,
    );
  }

  const productionFiles = [...new Set(inventory.consumerDiscovery.roots.flatMap((path) =>
    walk(join(root, path))))].filter((path) => consumerExtensions.has(extname(path))).sort();
  const connectorReferences = productionFiles.flatMap((file) =>
    detectConnectorMethodReferencesInSource(
      readFileSync(join(root, file), "utf8"),
      file,
      inventory.consumerDiscovery.connectorMethods,
    ));
  assertConnectorReferenceClosure(connectorReferences, inventory.explicitCompatibilityChecks);

  const referencedFiles = new Set(connectorReferences.map((reference) => reference.file));
  const consumerFiles = [...new Set([
    ...productionFiles.filter((file) => {
      const body = readFileSync(join(root, file), "utf8");
      return referencedFiles.has(file) ||
        inventory.consumerDiscovery.importMarkers.some((marker) => body.includes(marker));
    }),
    ...inventory.consumerDiscovery.additionalFiles,
  ])].sort();
  assertRuleClosure(consumerFiles, inventory.consumerRules, "consumer");
  if (consumerFiles.length !== inventory.consumerDiscovery.expectedFileCount ||
    digest(consumerFiles) !== inventory.consumerDiscovery.sortedPathDigestHex ||
    contentDigest(consumerFiles) !== inventory.consumerDiscovery.sortedContentDigestHex) {
    throw new Error(
      `consumer inventory drift: count=${consumerFiles.length} pathDigest=${digest(consumerFiles)} ` +
      `contentDigest=${contentDigest(consumerFiles)}`,
    );
  }

  for (const file of inventory.admittedBoundaryFiles) {
    if (!existsSync(join(root, file))) throw new Error(`missing admitted Reality boundary: ${file}`);
  }
  const realityFiles = walk(join(root, "lib/trader/reality/v2"))
    .filter((file) => consumerExtensions.has(extname(file)));
  for (const file of realityFiles) {
    const body = readFileSync(join(root, file), "utf8");
    for (const segment of inventory.forbiddenRealityImportSegments) {
      const importPattern = new RegExp(`from ["'][^"']*${segment.replaceAll("/", "\\/")}`);
      if (importPattern.test(body)) {
        throw new Error(`forbidden Expected-State/source import in ${file}: ${segment}`);
      }
    }
  }

  for (const file of productionFiles) {
    if ([
      "lib/trader/reality/v2/contracts.ts",
      "lib/trader/reality/v2/source-admission.ts",
      "lib/trader/reality/v2/ingress.ts",
      "lib/trader/reality/v2/repository-postgres.ts",
      "lib/trader/connectors/htx/reality-adapter.ts",
      "lib/trader/execution/v2/reality-adapter.ts",
    ].includes(file)) continue;
    const body = readFileSync(join(root, file), "utf8");
    if (inventory.canonicalSourceKinds.some((literal) =>
      body.includes(`"${literal}"`) || body.includes(`'${literal}'`))) {
      throw new Error(`unlisted Reality source adapter or bypass: ${file}`);
    }
  }

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    sources: sourceFiles.length,
    consumers: consumerFiles.length,
    connectorReferences: connectorReferences.length,
    sourceDigestHex: digest(sourceFiles),
    sourceContentDigestHex: contentDigest(sourceFiles),
    consumerDigestHex: digest(consumerFiles),
    consumerContentDigestHex: contentDigest(consumerFiles),
  })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) validate();
