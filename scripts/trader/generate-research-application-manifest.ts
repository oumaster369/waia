/** Maintained pure-policy declaration only. WP2 must separately close its actual owned CLI. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

const output = "lib/trader/paper/research-application-v1/computation-manifest.ts";
const roots = ["lib/trader/paper/research-application-v1/specification.ts"];
// Closed passive-module inventory. No runtime directory wildcard admits effects/authority factories.
const allowed = new Set([
  ...roots, "lib/trader/paper/research-application-v1/contract.ts",
  "lib/trader/intelligence/htr-semantic-canonical-json.ts",
  "lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1.ts",
  "lib/trader/knowledge/navigator/selection-kernel-v2.ts",
  "lib/trader/mi/serialize-hypothesis.ts", "lib/trader/mi/hypothesis.types.ts",
  "lib/trader/mi/serialize-measurement.ts", "lib/trader/mi/measurement.types.ts",
  "lib/trader/paper/serialize-paper-evaluation-export.ts", "lib/trader/paper/paper-evaluation-export.types.ts",
]);
const external = new Set(["node:crypto", "zod"]);
const externalUsed = new Set<string>();
const visited = new Set<string>();
function visit(file: string) {
  if (file === output || visited.has(file)) return;
  if (!allowed.has(file)) throw new Error(`RESEARCH_APPLICATION_IMPORT_FORBIDDEN:${file}`);
  visited.add(file);
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function follow(specifier: ts.Expression) {
    if (!ts.isStringLiteral(specifier)) throw new Error(`RESEARCH_APPLICATION_NONLITERAL_IMPORT:${file}`);
    const spec = specifier.text;
    if (external.has(spec)) { externalUsed.add(spec); return; }
    if (!spec.startsWith("@/") && !spec.startsWith(".")) throw new Error(`RESEARCH_APPLICATION_EXTERNAL_IMPORT:${file}:${spec}`);
    const prefix = spec.startsWith("@/") ? spec.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const found = [prefix, `${prefix}.ts`, `${prefix}/index.ts`].find(p => p.endsWith(".ts") && existsSync(p));
    if (!found) throw new Error(`RESEARCH_APPLICATION_UNRESOLVED_IMPORT:${file}:${spec}`);
    visit(found);
  }
  function inspect(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const onlyType = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(n => n.isTypeOnly));
      if (!onlyType) follow(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly &&
      !(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(n => n.isTypeOnly))) follow(node.moduleSpecifier);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (node.arguments.length !== 1) throw new Error(`RESEARCH_APPLICATION_NONLITERAL_IMPORT:${file}`);
      follow(node.arguments[0]!);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
}
roots.forEach(visit);
const entries = [...visited].sort().map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
const content = `/** Generated pure-policy source declaration; no binary, CLI, persistence or source-authority attestation. */\nexport const APPLICATION_COMPUTATION_SCOPE = "PURE_POLICY_ONLY" as const;\nexport const APPLICATION_COMPUTATION_SOURCE_MANIFEST = ${JSON.stringify(entries, null, 2)} as const;\nexport const APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST = "${digest}";\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== content) throw new Error("RESEARCH_APPLICATION_MANIFEST_STALE");
} else writeFileSync(output, content);
console.log(JSON.stringify({ scope: "PURE_POLICY_ONLY", entries, digest, external: [...externalUsed].sort(), checked: process.argv.includes("--check") }));
