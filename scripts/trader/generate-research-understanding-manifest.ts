/** Maintained source declaration for research computation; no runtime binary attestation. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

const output = "lib/trader/paper/research-understanding-v1/computation-manifest.ts";
const runtime = process.argv.includes("--runtime");
const roots = runtime ? ["scripts/trader/paper-bar-close-loop.ts"] : ["lib/trader/paper/research-understanding-v1/evaluate.ts"];
const external = new Set(runtime ? ["node:crypto", "node:buffer", "zod", "node:url", "node:fs/promises", "node:fs", "node:path", "node:module",
  "drizzle-orm", "drizzle-orm/pg-core", "drizzle-orm/sqlite-core", "drizzle-orm/postgres-js", "drizzle-orm/better-sqlite3", "postgres", "server-only", "better-sqlite3", "@opennextjs/cloudflare"] : ["node:crypto", "node:buffer", "zod"]);
const externalUsed = new Set<string>();
const visited = new Set<string>();
function resolve(from: string, specifier: string): string | null {
  if (external.has(specifier)) { externalUsed.add(specifier); return null; }
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) throw new Error(`UNREVIEWED_COMPUTATION_IMPORT:${from}:${specifier}`);
  const prefix = specifier.startsWith("@/") ? specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const found = [prefix, `${prefix}.ts`, `${prefix}/index.ts`].find(p => p.endsWith(".ts") && existsSync(p));
  if (!found) throw new Error(`UNRESOLVED_COMPUTATION_IMPORT:${from}:${specifier}`);
  return found;
}
function visit(file: string) {
  if ((!runtime && file === output) || visited.has(file)) return;
  if (/\/(forecast|hypothesis|decision|execution)\/|evaluation-cycle|evaluate-recorded-analysis|run-recorded-paper-loop|noncapital-cycle-owner|volume-qualification|mtf-bar-aggregator|strategy-[^/]*\.ts$|strategies\/(?!registry-metadata)|market-data-gateway|htx-bar-poll-source|fixture-bar-replay-source|canonical-recurring|shadow-canonical/.test(file))
    throw new Error(`FORBIDDEN_COMPUTATION_MODULE:${file}`);
  visited.add(file);
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function follow(spec: ts.Expression) {
    if (!ts.isStringLiteral(spec)) throw new Error(`NONLITERAL_COMPUTATION_IMPORT:${file}`);
    const resolved = resolve(file, spec.text); if (resolved) {
      try { visit(resolved); } catch (error) { throw new Error(`${file} -> ${resolved}: ${error instanceof Error ? error.message : "IMPORT_ERROR"}`); }
    }
  }
  function inspect(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(n => n.isTypeOnly));
      if (!onlyTypes) follow(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly &&
      !(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(n => n.isTypeOnly))) follow(node.moduleSpecifier);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (node.arguments.length !== 1) throw new Error(`NONLITERAL_COMPUTATION_IMPORT:${file}`); follow(node.arguments[0]!);
    }
    ts.forEachChild(node, inspect);
  }
  if (runtime && file === "scripts/trader/paper-bar-close-loop.ts") {
    // The executable has three explicitly exclusive modes. Inspect the selected early branch
    // and shared module/exit/error code; old branches must remain behind its unconditional return.
    const entry = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "runPaperBarCloseCli");
    if (!entry?.body) throw new Error("RESEARCH_CLI_ENTRY_MISSING");
    const selected = entry.body.statements[1];
    if (!selected || !ts.isIfStatement(selected) || selected.expression.getText(ast) !== 'args.includes("--saved-research-understanding")' || !ts.isBlock(selected.thenStatement))
      throw new Error("RESEARCH_CLI_EARLY_BRANCH_MISSING");
    const final = selected.thenStatement.statements.at(-1);
    if (!final || !ts.isTryStatement(final) || !ts.isReturnStatement(final.tryBlock.statements.at(-1)!))
      throw new Error("RESEARCH_CLI_EXCLUSIVE_RETURN_MISSING");
    for (const statement of ast.statements) if (statement !== entry) inspect(statement);
    inspect(entry.body.statements[0]!); inspect(selected.thenStatement);
  } else inspect(ast);
}
roots.forEach(visit);
const entries = [...visited].sort().map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
const content = `/** Generated by generate-research-understanding-manifest.ts; maintained source identity, not binary attestation. */\nexport const COMPUTATION_SOURCE_MANIFEST = ${JSON.stringify(entries, null, 2)} as const;\nexport const COMPUTATION_SOURCE_MANIFEST_DIGEST = "${digest}";\n`;
if (runtime) {
  console.log(JSON.stringify({ kind: "selected_research_runtime_inventory", entries, digest, external: [...externalUsed].sort(),
    boundaries: { cli: "first explicit research branch and shared exit/error handling", computation: "separately maintained manifest",
      sqliteRuntime: "existing waia-runtime-db imports db/client; postgres mode is checked before factory, getDb is unreachable in this branch",
      claim: "runtime lease modules only; no capital/evaluator/provider caller" } }, null, 2));
  process.exit(0);
}
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== content) throw new Error("RESEARCH_COMPUTATION_MANIFEST_STALE");
} else writeFileSync(output, content);
console.log(JSON.stringify({ count: entries.length, digest, checked: process.argv.includes("--check") }));
