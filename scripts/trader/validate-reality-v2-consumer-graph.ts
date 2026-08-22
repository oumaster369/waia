import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Rule = { id: string; pathPattern: string; disposition: string };
type Inventory = {
  canonicalSourceKinds: string[];
  admittedBoundaryFiles: string[];
  sourceDiscovery: {
    roots: string[];
    additionalFiles: string[];
    expectedFileCount: number;
    sortedPathDigestHex: string;
    sortedContentDigestHex: string;
  };
  sourceRules: Rule[];
  consumerDiscovery: {
    roots: string[];
    additionalFiles: string[];
    importMarkers: string[];
    connectorCallRoots: string[];
    connectorCallMarkers: string[];
    expectedFileCount: number;
    sortedPathDigestHex: string;
    sortedContentDigestHex: string;
  };
  consumerRules: Rule[];
  explicitCompatibilityChecks: Array<{ file: string; expectedCall: string }>;
  forbiddenRealityImportSegments: string[];
};

const root = process.cwd();
const inventoryPath = join(root, "docs/ai-trader/reality-v2-source-consumer-inventory.json");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;

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

const sourceFiles = [...new Set([
  ...inventory.sourceDiscovery.roots.flatMap((path) => walk(join(root, path))),
  ...inventory.sourceDiscovery.additionalFiles,
])].filter((path) => /\.(?:ts|tsx)$/.test(path)).sort();
assertRuleClosure(sourceFiles, inventory.sourceRules, "source");
if (sourceFiles.length !== inventory.sourceDiscovery.expectedFileCount ||
  digest(sourceFiles) !== inventory.sourceDiscovery.sortedPathDigestHex ||
  contentDigest(sourceFiles) !== inventory.sourceDiscovery.sortedContentDigestHex) {
  throw new Error(
    `source inventory drift: count=${sourceFiles.length} pathDigest=${digest(sourceFiles)} ` +
    `contentDigest=${contentDigest(sourceFiles)}`,
  );
}

const consumerFiles = [...new Set([
  ...inventory.consumerDiscovery.roots.flatMap((path) =>
    walk(join(root, path)).filter((file) => {
      if (!/\.(?:ts|tsx)$/.test(file)) return false;
      const body = readFileSync(join(root, file), "utf8");
      return inventory.consumerDiscovery.importMarkers.some((marker) => body.includes(marker));
    })),
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
for (const check of inventory.explicitCompatibilityChecks) {
  const body = readFileSync(join(root, check.file), "utf8");
  if (!body.includes(check.expectedCall)) {
    throw new Error(`connector consumer compatibility drift: ${check.file} missing ${check.expectedCall}`);
  }
}

for (const file of inventory.consumerDiscovery.connectorCallRoots.flatMap((path) =>
  walk(join(root, path)))) {
  if (!/\.(?:ts|tsx)$/.test(file)) continue;
  const body = readFileSync(join(root, file), "utf8");
  for (const marker of inventory.consumerDiscovery.connectorCallMarkers) {
    if (body.includes(marker) && !inventory.explicitCompatibilityChecks.some((check) =>
      check.file === file && check.expectedCall === marker)) {
      throw new Error(`connector consumer is missing an explicit compatibility check: ${file} ${marker}`);
    }
  }
}

const realityFiles = walk(join(root, "lib/trader/reality/v2")).filter((file) => file.endsWith(".ts"));
for (const file of realityFiles) {
  const body = readFileSync(join(root, file), "utf8");
  for (const segment of inventory.forbiddenRealityImportSegments) {
    const importPattern = new RegExp(`from ["'][^"']*${segment.replaceAll("/", "\\/")}`);
    if (importPattern.test(body)) throw new Error(`forbidden Expected-State/source import in ${file}: ${segment}`);
  }
}

const sourceLiterals = inventory.canonicalSourceKinds;
for (const file of walk(join(root, "lib/trader")).filter((path) => path.endsWith(".ts"))) {
  if ([
    "lib/trader/reality/v2/contracts.ts",
    "lib/trader/reality/v2/source-admission.ts",
    "lib/trader/reality/v2/ingress.ts",
    "lib/trader/reality/v2/repository-postgres.ts",
    "lib/trader/connectors/htx/reality-adapter.ts",
    "lib/trader/execution/v2/reality-adapter.ts",
  ].includes(file)) continue;
  const body = readFileSync(join(root, file), "utf8");
  if (sourceLiterals.some((literal) =>
    body.includes(`"${literal}"`) || body.includes(`'${literal}'`))) {
    throw new Error(`unlisted Reality source adapter or bypass: ${file}`);
  }
}

console.log(JSON.stringify({
  status: "PASS",
  sources: sourceFiles.length,
  consumers: consumerFiles.length,
  sourceDigestHex: digest(sourceFiles),
  sourceContentDigestHex: contentDigest(sourceFiles),
  consumerDigestHex: digest(consumerFiles),
  consumerContentDigestHex: contentDigest(consumerFiles),
}));
