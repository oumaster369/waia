/** Separate maintained policy and actual selected-command identities; not binary attestation. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";

const output = "lib/trader/paper/research-application-v1/computation-manifest.ts";
const runtime = process.argv.includes("--runtime");
const roots = runtime ? ["scripts/trader/paper-bar-close-loop.ts"] : ["lib/trader/paper/research-application-v1/specification.ts"];
// Closed passive-module inventory. No runtime directory wildcard admits effects/authority factories.
const allowed = new Set([
  "lib/trader/paper/research-application-v1/specification.ts", "lib/trader/paper/research-application-v1/contract.ts",
  "lib/trader/intelligence/htr-semantic-canonical-json.ts",
  "lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1.ts",
  "lib/trader/knowledge/navigator/selection-kernel-v2.ts",
  "lib/trader/mi/serialize-hypothesis.ts", "lib/trader/mi/hypothesis.types.ts",
  "lib/trader/mi/serialize-measurement.ts", "lib/trader/mi/measurement.types.ts",
  "lib/trader/paper/serialize-paper-evaluation-export.ts", "lib/trader/paper/paper-evaluation-export.types.ts",
]);
const runtimeAllowed = new Set([
  "db/client.ts",
  "db/core-enums.ts",
  "db/postgres-client.ts",
  "db/runtime-backend.ts",
  "db/schema.admin-console.postgres.ts",
  "db/schema.postgres.ts",
  "db/schema.ts",
  "db/waia-postgres-transaction.ts",
  "db/waia-runtime-db.ts",
  "lib/enforce-server-only.ts",
  "lib/trader/cron/worker-cron-env.ts",
  "lib/trader/exits/atr-estimator.ts",
  "lib/trader/intelligence/feature-engine-v0.ts",
  "lib/trader/intelligence/htr-semantic-canonical-json.ts",
  "lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1.ts",
  "lib/trader/intelligence/information-sufficiency/index.ts",
  "lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres.ts",
  "lib/trader/intelligence/information-sufficiency/information-sufficiency-runtime-authority-v2.ts",
  "lib/trader/intelligence/information-sufficiency/information-sufficiency-v2.ts",
  "lib/trader/intelligence/market-understanding-bridge-v0.ts",
  "lib/trader/intelligence/market-understanding-evidence-attribution-v1.ts",
  "lib/trader/intelligence/market-understanding.types.ts",
  "lib/trader/intelligence/reconstruction/bar-utils.ts",
  "lib/trader/intelligence/reconstruction/build-reconstruction-snapshot.ts",
  "lib/trader/intelligence/reconstruction/reconstruction-assembly.ts",
  "lib/trader/intelligence/reconstruction/reconstruction-kernel.ts",
  "lib/trader/intelligence/reconstruction/reconstruction.types.ts",
  "lib/trader/intelligence/strategies/registry-metadata.ts",
  "lib/trader/intelligence/types.ts",
  "lib/trader/knowledge/navigator/selection-kernel-v2.ts",
  "lib/trader/market-data/canvas/incremental-mtf.ts",
  "lib/trader/market-data/fusion/context-fusion-v1.ts",
  "lib/trader/market-data/fusion/cross-venue-triangulation.ts",
  "lib/trader/market-data/mtf/bar-interval-duration.ts",
  "lib/trader/market-data/mtf/mtf-backdrop-classifier.ts",
  "lib/trader/market-data/mtf/mtf-bucket-accumulator.ts",
  "lib/trader/market-data/mtf/replay-mtf-resampler.ts",
  "lib/trader/market-data/normalization/canonical-pit-contract.ts",
  "lib/trader/market-data/normalization/gateway-to-canonical-pit.ts",
  "lib/trader/market-data/normalization/normalize-observation.ts",
  "lib/trader/market-data/observation-types.ts",
  "lib/trader/market-data/provider-registry.ts",
  "lib/trader/market-data/reliability/freshness-policy.ts",
  "lib/trader/market-data/reliability/provider-health.ts",
  "lib/trader/market-data/replay-bar-limits.ts",
  "lib/trader/market-data/session/asian-range-corridor.ts",
  "lib/trader/market-data/session/session-phase-classifier.ts",
  "lib/trader/market-data/validation/validate-observation.ts",
  "lib/trader/mi/canonical-observation-v1.ts",
  "lib/trader/mi/canonical-pit-repository-postgres.ts",
  "lib/trader/mi/canonical-pit-service-postgres.ts",
  "lib/trader/mi/hypothesis.types.ts",
  "lib/trader/mi/measurement-lineage-v1.ts",
  "lib/trader/mi/measurement.types.ts",
  "lib/trader/mi/observation.types.ts",
  "lib/trader/mi/pit-chronology-v1.ts",
  "lib/trader/mi/repository-postgres.ts",
  "lib/trader/mi/serialize-hypothesis.ts",
  "lib/trader/mi/serialize-measurement.ts",
  "lib/trader/mi/serialize-source-trust.ts",
  "lib/trader/mi/source-trust.types.ts",
  "lib/trader/mi/trust-as-of-repository-postgres.ts",
  "lib/trader/mi/trust-as-of-v1.ts",
  "lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1.ts",
  "lib/trader/paper/durable-noncapital/recorded-analysis-v1.ts",
  "lib/trader/paper/durable-noncapital/recorded-source-read-validation-v1.ts",
  "lib/trader/paper/paper-evaluation-export.types.ts",
  "lib/trader/paper/research-application-v1/bounded-read-postgres.ts",
  "lib/trader/paper/research-application-v1/cli-options.ts",
  "lib/trader/paper/research-application-v1/contract.ts",
  "lib/trader/paper/research-application-v1/repository-postgres.ts",
  "lib/trader/paper/research-application-v1/run-saved-application.ts",
  "lib/trader/paper/research-application-v1/specification.ts",
  "lib/trader/paper/research-understanding-v1/admission.ts",
  "lib/trader/paper/research-understanding-v1/bounded-source-postgres.ts",
  "lib/trader/paper/research-understanding-v1/cli-options.ts",
  "lib/trader/paper/research-understanding-v1/completion-write-postgres.ts",
  "lib/trader/paper/research-understanding-v1/computation-manifest.ts",
  "lib/trader/paper/research-understanding-v1/contract.ts",
  "lib/trader/paper/research-understanding-v1/evaluate.ts",
  "lib/trader/paper/research-understanding-v1/held-replay.ts",
  "lib/trader/paper/research-understanding-v1/repository-postgres.ts",
  "lib/trader/paper/research-understanding-v1/run-saved-research-loop.ts",
  "lib/trader/paper/serialize-paper-evaluation-export.ts",
  "lib/trader/research/digest.ts",
  "lib/trader/risk/numeric.ts",
  "lib/trader/runtime-authority/v2/runtime-authority-assessment-v2.ts",
  "lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2.ts",
  "lib/trader/runtime-authority/v2/runtime-authority-repository-v2.ts",
  "lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2.ts",
  "lib/trader/runtime-v2/recorded-noncapital-input-v2.ts",
  "lib/trader/security/service-org-context.ts",
  "lib/trader/symbols/historical-instrument.ts",
  "lib/waia-core/audit/write.ts",
  "lib/waia-core/scope/org-context.ts",
  "scripts/trader/paper-bar-close-loop.ts"
]);
const external = new Set(runtime ? ["node:crypto", "node:buffer", "zod", "node:url", "node:fs/promises", "node:fs", "node:path", "node:module",
  "drizzle-orm", "drizzle-orm/pg-core", "drizzle-orm/sqlite-core", "drizzle-orm/postgres-js", "drizzle-orm/better-sqlite3", "postgres", "server-only", "better-sqlite3", "@opennextjs/cloudflare"] : ["node:crypto", "zod"]);
const externalUsed = new Set<string>();
const visited = new Set<string>();
function visit(file: string) {
  if (file === output || visited.has(file)) return;
  if (!(runtime ? runtimeAllowed : allowed).has(file)) throw new Error(`RESEARCH_APPLICATION_IMPORT_FORBIDDEN:${file}`);
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
  if (runtime && file === "scripts/trader/paper-bar-close-loop.ts") {
    const entry = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "runPaperBarCloseCli");
    if (!entry?.body || entry.body.statements[0]?.getText(ast) !== "args = [...args];") throw new Error("APPLICATION_CLI_ENTRY_REFUSED");
    const selected = entry.body.statements[1];
    if (!selected || !ts.isIfStatement(selected) || selected.expression.getText(ast) !== 'args.includes("--saved-research-application")' ||
      !ts.isBlock(selected.thenStatement) || selected.elseStatement) throw new Error("APPLICATION_CLI_EARLY_BRANCH_MISSING");
    const same = entry.body.statements.filter(n => ts.isIfStatement(n) && n.expression.getText(ast) === 'args.includes("--saved-research-application")');
    const final = selected.thenStatement.statements.at(-1);
    if (same.length !== 1 || !final || !ts.isTryStatement(final) || final.catchClause || !ts.isReturnStatement(final.tryBlock.statements.at(-1)!))
      throw new Error("APPLICATION_CLI_EXCLUSIVE_RETURN_MISSING");
    for (const node of ast.statements) if (node !== entry) inspect(node);
    inspect(entry.body.statements[0]!); inspect(selected.thenStatement);
  } else inspect(ast);
}
roots.forEach(visit);
const entries = [...visited].sort().map(file => ({ path: file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
if (runtime) {
  console.log(JSON.stringify({ scope: "SELECTED_OWNED_COMMAND", entries, digest, external: [...externalUsed].sort(),
    boundary: "first exclusive application branch plus shared exit/error handling; generic exported factories are not exposed capabilities",
    sqliteRuntime: "existing waia-runtime-db imports db/client; postgres and per-request ownership checked before acquisition" }));
} else {
  // The command inventory is generated by the same closed AST traversal in a separate process.
  const command = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/trader/generate-research-application-manifest.ts", "--runtime"], { encoding: "utf8" }));
  const content = `/** Generated policy and selected-command declarations; maintained source identity, not binary/source-authority attestation. */\nexport const APPLICATION_COMPUTATION_SCOPE = "PURE_POLICY_ONLY" as const;\nexport const APPLICATION_COMPUTATION_SOURCE_MANIFEST = ${JSON.stringify(entries, null, 2)} as const;\nexport const APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST = "${digest}";\nexport const APPLICATION_COMMAND_SOURCE_MANIFEST = ${JSON.stringify(command.entries, null, 2)} as const;\nexport const APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST = "${command.digest}";\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== content) throw new Error("RESEARCH_APPLICATION_MANIFEST_STALE");
  } else writeFileSync(output, content);
  console.log(JSON.stringify({ scope: "PURE_POLICY_ONLY", entries, digest, external: [...externalUsed].sort(), command, checked: process.argv.includes("--check") }));
}
