// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { APPLICATION_COMPUTATION_SCOPE, APPLICATION_COMPUTATION_SOURCE_MANIFEST, APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from
  "@/lib/trader/paper/research-application-v1/computation-manifest";
import type { ResearchApplicationFoldV1, ResearchApplicationRelationV1 } from "@/lib/trader/paper/research-application-v1/contract";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import { assertCanonicalRuntimeIntelligenceStateV1, type RuntimeKnowledgeAuthorityV1 } from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { assertKnowledgeSelectionReceiptV2, type KnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";

// These compile-time controls also run under the separately scheduled whole-project typecheck.
function incompatibleTypes(fold: ResearchApplicationFoldV1, relation: ResearchApplicationRelationV1) {
  // @ts-expect-error Research has no ordinary hypotheses, knowledge digest or authority.
  const ordinary: RuntimeKnowledgeAuthorityV1 = fold;
  // @ts-expect-error A research relation is not old MSV-bound MiEvidence.
  const legacyEvidence: MiEvidence = relation;
  return { ordinary, legacyEvidence };
}
void incompatibleTypes;

describe("DEE1132 pure research capability closure", () => {
  it("pins the actual passive dependency closure and refuses to claim a not-yet-built CLI", () => {
    const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/trader/generate-research-application-manifest.ts", "--check"], { encoding: "utf8" }));
    expect(APPLICATION_COMPUTATION_SCOPE).toBe("PURE_POLICY_ONLY"); expect(result.scope).toBe(APPLICATION_COMPUTATION_SCOPE);
    expect(result.entries).toEqual(APPLICATION_COMPUTATION_SOURCE_MANIFEST); expect(result.digest).toBe(APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST);
    expect(result.external).toEqual(["node:crypto", "zod"]);
    const paths = result.entries.map((e: { path: string }) => e.path);
    expect(paths).toContain("lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1.ts");
    expect(paths).toContain("lib/trader/knowledge/navigator/selection-kernel-v2.ts");
    for (const row of APPLICATION_COMPUTATION_SOURCE_MANIFEST) {
      expect(createHash("sha256").update(readFileSync(row.path)).digest("hex")).toBe(row.sha256);
      expect(row.path).not.toMatch(/runtime-knowledge-authority|canonical-runtime-intelligence-fold|repository|service\.ts|\/db\/|\/forecast|predictive-admission|\/execution\/|\/risk\/|\/live\/|gateway|\/connectors\/|run-saved|paper-bar-close-loop/);
    }
  });
  it("existing authority validators refuse explicit research envelopes, even through casts", () => {
    const research = { schemaVersion: "waia.trader.research_application_fold.v1", authority: "RESEARCH_APPLICATION_ONLY", purpose: "RESEARCH_NON_CAPITAL", researchJudgments: [] };
    expect(() => assertCanonicalRuntimeIntelligenceStateV1(research as unknown as RuntimeKnowledgeAuthorityV1)).toThrow();
    expect(() => assertKnowledgeSelectionReceiptV2({ ...research, schemaVersion: "waia.trader.research_application_selection.v1" } as unknown as KnowledgeSelectionReceiptV2)).toThrow();
  });
  it("keeps no invocation of ambient clock/random/source callback in the new policy modules", () => {
    for (const file of ["lib/trader/paper/research-application-v1/contract.ts", "lib/trader/paper/research-application-v1/specification.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(/Date\.now|Math\.random|randomUUID|process\.env|\bfetch\s*\(|\.query\s*\(|\.transaction\s*\(/);
  });
});

// Inert tripwire only: the actual CLI must reject malformed research commands
// before its existing legacy branch can construct any runtime capability.
vi.mock("../../scripts/trader/paper-bar-close-loop-legacy", () => ({
  runLegacyPaperBarCloseLoop: () => { throw new Error("LEGACY_SETUP_REACHED"); },
}));
describe("actual saved application CLI admission", () => {
  it("rejects caller actor flags before legacy setup or runtime acquisition", async () => {
    const previous = process.env.WAIA_TRADER_CLI; process.env.WAIA_TRADER_CLI = "1";
    try {
      const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
      await expect(runPaperBarCloseCli(["--saved-research-application", "--actor=admin"]))
        .rejects.toThrow("APPLICATION_FLAGS_INVALID");
    } finally { if (previous === undefined) delete process.env.WAIA_TRADER_CLI; else process.env.WAIA_TRADER_CLI = previous; }
  });
  it("requires one explicit complete-consumer sequence before file or runtime acquisition", async () => {
    const { parseSavedApplicationOptions } = await import("@/lib/trader/paper/research-application-v1/cli-options");
    const args = ["--saved-research-application", "--application-file=/not-opened", "--operation=complete-consumer",
      "--previous-sequence=0", "--current-sequence=1"];
    for (const tail of [[], ["--consumer-sequence=1"], ["--consumer-sequence=3", "--consumer-sequence=4"],
      ["--consumer-sequence=3", "--holder=caller"], ["--consumer-sequence=3", "--facts=caller"]])
      await expect(parseSavedApplicationOptions([...args, ...tail])).rejects.toThrow("APPLICATION_FLAGS_INVALID");
  });
});

import ts from "typescript";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import { APPLICATION_COMMAND_SOURCE_MANIFEST, APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST, SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST, SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST } from "@/lib/trader/paper/research-application-v1/computation-manifest";
function actualInventoryWithCli(cli: string, selected: "application" | "understanding", savedDomain = false) {
  const filename = `scripts/trader/generate-research-${selected}-manifest.ts`;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const actualRequire = createRequire(`${process.cwd()}/package.json`), output: string[] = [];
  const exit = {};
  try {
    new Function("require", "exports", "process", "console", compiled)((name: string) => name === "node:fs" ? {
      ...fs, readFileSync: (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => String(file) === (savedDomain ? "scripts/trader/saved-research.ts" : "scripts/trader/paper-bar-close-loop.ts")
        ? (rest[0] ? cli : Buffer.from(cli)) : Reflect.apply(fs.readFileSync, fs, [file, ...rest]),
      writeFileSync: () => { throw new Error("UNEXPECTED_INVENTORY_WRITE"); },
    } : actualRequire(name), {}, { argv: ["node", filename, "--runtime", ...(savedDomain ? ["--saved-domain"] : [])], exit: () => { throw exit; } }, { log: (v: string) => output.push(v) });
  } catch (error) { if (error !== exit) throw error; }
  return JSON.parse(output.at(-1)!);
}
describe("actual selected application and compatible Understanding capability inventories", () => {
  const cli = readFileSync("scripts/trader/paper-bar-close-loop.ts", "utf8");
  it("keeps the fixed writer's handle input separate from returned primitive facts and caller callbacks", () => {
    const source = readFileSync("lib/trader/paper/research-understanding-v1/completion-write-postgres.ts", "utf8");
    const writer = ts.createSourceFile("writer.ts", source, ts.ScriptTarget.Latest, true);
    const entry = writer.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "writeFixedResearchCompletion");
    expect(entry?.parameters.map(p => p.name.getText(writer))).toEqual(["db", "prepared", "suppliedHolder", "lifetime"]);
    expect(entry?.body?.getText(writer)).not.toMatch(/\.facts\b|suppliedOutput|evaluator|\.begin\(|\.transaction\(/);
    expect(entry?.body?.getText(writer)).toContain('return writeCompletionCore(db, prepared, { domain: "CAPITAL_LEGACY_V2", holder: copy(suppliedHolder) }, lifetime)');
    const core = writer.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "writeCompletionCore");
    expect(core?.parameters.map(p => p.name.getText(writer))).toEqual(["db", "prepared", "lease", "lifetime"]);
    expect(core?.body?.getText(writer)).toContain("completions.get(prepared)");
    expect(core?.body?.getText(writer)).toContain("captured.lifetime === lifetime && captured.domain === lease.domain");
    expect(core?.body?.getText(writer)).not.toMatch(/\.facts\b|suppliedOutput|evaluator|\.begin\(|\.transaction\(/);
    const owner = readFileSync("lib/trader/paper/research-application-v1/repository-postgres.ts", "utf8");
    expect(owner).toContain("bound.writeCompletion(prepared.prepared, holder.value)");
    expect(owner).toContain("bound.writeSavedDomainCompletion(prepared.prepared, holder.value)");
    expect(owner).not.toMatch(/createSavedResearchOwner|runSavedResearchLoop|writeFixedResearchCompletion\(|new ResearchReadBudget|claimRuntimeControlLeaseAtDatabaseTimeV2/);
    expect(readFileSync("lib/trader/paper/research-understanding-v1/repository-postgres.ts", "utf8"))
      .toContain('if (prepared.outcome === "REPLAYED") return { outcome: prepared.outcome, completion: prepared.completion };');
  });
  it("pins the exact actual new owner closure while keeping the old selected mode separately inspectable", () => {
    const app = actualInventoryWithCli(cli, "application"), old = actualInventoryWithCli(cli, "understanding");
    expect(app.entries).toEqual(APPLICATION_COMMAND_SOURCE_MANIFEST); expect(app.digest).toBe(APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST);
    expect(app.scope).toBe("SELECTED_OWNED_COMMAND");
    const paths = app.entries.map((v: { path: string }) => v.path);
    expect(paths).toContain("lib/trader/paper/research-application-v1/repository-postgres.ts");
    expect(paths).toContain("lib/trader/paper/research-understanding-v1/held-replay.ts");
    expect(paths).toContain("lib/trader/paper/research-understanding-v1/completion-write-postgres.ts");
    expect(paths).toContain("lib/trader/mi/canonical-pit-repository-postgres.ts");
    expect(paths).toContain("lib/trader/mi/canonical-pit-service-postgres.ts");
    const owner = ts.createSourceFile("owner.ts", readFileSync("lib/trader/paper/research-application-v1/repository-postgres.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const canonicalImports = owner.statements.filter(ts.isImportDeclaration)
      .filter(statement => ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.includes("canonical-pit"));
    expect(canonicalImports).toHaveLength(1);
    expect(canonicalImports[0].moduleSpecifier.getText(owner)).toBe('"@/lib/trader/mi/canonical-pit-service-postgres"');
    const bindings = canonicalImports[0].importClause?.namedBindings;
    expect(bindings && ts.isNamedImports(bindings) ? bindings.elements.map(element => element.name.text).sort() : []).toEqual([
      "persistCanonicalMeasurementDefinitionWithinHeldTransactionV1Postgres",
      "persistCanonicalMeasurementValueLineageWithinHeldTransactionV1Postgres",
    ]);
    expect(paths).not.toContain("lib/trader/paper/research-understanding-v1/repository-postgres.ts");
    expect(paths).not.toContain("lib/trader/paper/research-understanding-v1/run-saved-research-loop.ts");
    expect(paths.join("\n")).not.toMatch(/paper-bar-close-loop-legacy|\/forecast\/|predictive-admission|\/execution\/|\/live\/|market-data-gateway|\/connectors\/|hypothesis-service|measurement-service/);
    expect(old.kind).toBe("selected_research_runtime_inventory");
    expect(old.entries.map((v: { path: string }) => v.path)).toContain("lib/trader/paper/research-understanding-v1/completion-write-postgres.ts");
    expect(old.entries.map((v: { path: string }) => v.path)).not.toContain("lib/trader/paper/research-application-v1/repository-postgres.ts");
    expect(old.boundaries.cli).toContain("selected early");
  });
  it("pins the fixed saved entry point independently and applies the same forbidden capability boundary", () => {
    const fixed = readFileSync("scripts/trader/saved-research.ts", "utf8");
    const app = actualInventoryWithCli(fixed, "application", true), research = actualInventoryWithCli(fixed, "understanding", true);
    expect(app.entries).toEqual(SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST);
    expect(app.digest).toBe(SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST);
    expect(app.digest).not.toBe(APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST);
    for (const inventory of [app, research]) {
      const paths = inventory.entries.map((v: { path: string }) => v.path);
      expect(paths).toContain("scripts/trader/saved-research.ts");
      expect(paths).toContain("lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1.ts");
      expect(paths).not.toContain("scripts/trader/paper-bar-close-loop.ts");
      expect(paths.join("\n")).not.toMatch(/paper-bar-close-loop-legacy|\/forecast\/|predictive-admission|\/execution\/|\/live\/|market-data-gateway|\/connectors\/|hypothesis-service|measurement-service/);
    }
    expect(research.entries.map((v: { path: string }) => v.path)).not.toContain("lib/trader/paper/research-application-v1/repository-postgres.ts");
    for (const selected of ["application", "understanding"] as const) {
      for (const changed of [fixed.replace("args = [...args];", 'args = [...args]; console.info("unreviewed");'),
        fixed.replace('console.info(JSON.stringify({ kind: "saved_domain_research_application", ...result })); return result;', 'console.info("missing return");'),
        fixed + '\nimport "@/lib/trader/intelligence/forecast/forecast-v1";\n'])
        expect(() => actualInventoryWithCli(changed, selected, true)).toThrow();
    }
  });
  it.each(["capture", "effect", "unknown-branch", "duplicate", "application-return", "understanding-return"])("rejects actual generator %s prefix/return corruption", kind => {
    let changed = cli;
    if (kind === "capture") changed = cli.replace("args = [...args];", "args = args;");
    if (kind === "effect") changed = cli.replace("args = [...args];", 'args = [...args]; console.info("unreviewed effect");');
    if (kind === "unknown-branch") changed = cli.replace("args = [...args];", 'args = [...args]; if (args.includes("--other")) { try { return null; } finally {} }');
    if (kind === "duplicate") changed = cli.replace('  if (args.includes("--saved-research-understanding"))', '  if (args.includes("--saved-research-understanding")) {}\n  if (args.includes("--saved-research-understanding"))');
    if (kind === "application-return") changed = cli.replace('console.info(JSON.stringify({ kind: "saved_research_application", ...result })); return result;', 'console.info(JSON.stringify({ kind: "saved_research_application", ...result }));');
    if (kind === "understanding-return") changed = cli.replace('      return result;\n    } finally { await disposeWaiaRuntimeDb(runtime); }', '    } finally { await disposeWaiaRuntimeDb(runtime); }');
    expect(changed).not.toBe(cli);
    expect(() => actualInventoryWithCli(changed, "understanding")).toThrow(/RESEARCH_CLI_/);
  });
  it("does not hide a forbidden shared error-path import behind branch-local selection", () => {
    const changed = `${cli}\nimport "@/lib/trader/intelligence/forecast/forecast-v1";\n`;
    expect(() => actualInventoryWithCli(changed, "understanding")).toThrow();
    expect(() => actualInventoryWithCli(changed, "application")).toThrow();
  });
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { researchPureFixture } from "../helpers/research-understanding-fixture";
const acquisition = vi.hoisted(() => ({ get: vi.fn(), dispose: vi.fn(async () => {}) }));
vi.mock("@/db/waia-runtime-db", () => ({ getWaiaRuntimeDb: acquisition.get, disposeWaiaRuntimeDb: acquisition.dispose }));
function cliFile() {
  const f = researchPureFixture(), directory = mkdtempSync(path.join(tmpdir(), "dee1132-cli-"));
  const value = { configuration: { organizationId: f.session.organizationId, accountId: f.session.accountId, symbol: f.session.symbol,
    researchAssignmentDigest: f.assignment.contentDigest, researchSessionId: f.assignment.researchSessionId, sourceSessionId: f.session.sessionId, sourceConfigDigest: f.session.configDigest,
    profileId: f.profile.id, profileContentDigest: f.profile.contentDigest, computation: f.assignment.declarations.computation, computationManifestDigest: f.assignment.declarations.computationManifestDigest,
    applicationComputationManifestDigest: APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST,
    hypothesisId: "h", hypothesisKey: "a".repeat(64), hypothesisVersion: 1, hypothesisDefinitionDigest: "b".repeat(64),
    measurementId: "m", measurementKey: "c".repeat(64), measurementVersion: 1, measurementDefinitionDigest: "d".repeat(64),
    specification: "categorical-trending-persistence/v1", bridge: "saved-what-to-regime-hint/v1", questionMap: "local-categorical-antecedent-analogue/v1", maxAgeMs: 60000 },
    research: { assignment: f.config, profile: { definition: f.profileDefinition }, range: { startSequence: 0, count: 2, leaseDurationMs: 1000 } } };
  const file = path.join(directory, "request.json"); writeFileSync(file, JSON.stringify(value));
  return { directory, file, value, args: ["--saved-research-application", `--application-file=${file}`, "--operation=replay", "--previous-sequence=0", "--current-sequence=1"] };
}
describe("actual selected CLI pool ownership", () => {
  it.each(["false", "0", "no", "off"])("rejects actual per-request flag%s before acquiring any hidden runtime", async flag => {
    const f = cliFile(); const before = { cli: process.env.WAIA_TRADER_CLI, db: process.env.WAIA_DB_BACKEND, owned: process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT, url: process.env.DATABASE_URL_POSTGRES };
    acquisition.get.mockReset(); acquisition.dispose.mockClear();
    process.env.DATABASE_URL_POSTGRES = "postgres://fixture:fixture@127.0.0.1:1/no_connection"; process.env.WAIA_TRADER_CLI = "1"; process.env.WAIA_DB_BACKEND = "postgres"; process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = flag;
    try { const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
      await expect(runPaperBarCloseCli(f.args)).rejects.toThrow("OWNED_POSTGRES_POOL_REQUIRED");
      expect(acquisition.get).not.toHaveBeenCalled(); expect(acquisition.dispose).not.toHaveBeenCalled();
    } finally { for (const [key, value] of Object.entries({ WAIA_TRADER_CLI: before.cli, WAIA_DB_BACKEND: before.db, WAIA_POSTGRES_PER_REQUEST_CLIENT: before.owned, DATABASE_URL_POSTGRES: before.url }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(f.directory, { recursive: true, force: true }); }
  });
  it("uses the actual runner on the owned pool and always disposes a refused read-only invocation", async () => {
    const f = cliFile(); const before = { cli: process.env.WAIA_TRADER_CLI, db: process.env.WAIA_DB_BACKEND, owned: process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT, url: process.env.DATABASE_URL_POSTGRES };
    const queries: string[] = [];
    const held = { savepoint() { throw new Error("NO_SAVEPOINT"); }, unsafe(query: string) { queries.push(query); return Object.assign(Promise.resolve([]), { values: async () => [] }); } };
    const pool = { options: { serializers: {}, parsers: {} }, begin: async (_options: string, fn: (h: typeof held) => unknown) => fn(held) };
    const runtime = { kind: "postgres", _sql: pool, db: {} }; acquisition.get.mockReset().mockResolvedValue(runtime); acquisition.dispose.mockClear();
    process.env.DATABASE_URL_POSTGRES = "postgres://fixture:fixture@127.0.0.1:1/no_connection"; process.env.WAIA_TRADER_CLI = "1"; process.env.WAIA_DB_BACKEND = "postgres"; process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = "true";
    try { const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
      expect(await runPaperBarCloseCli(f.args)).toEqual({ status: "APPLICATION_OPERATION_MISSING", outcome: "REFUSED" });
      expect(acquisition.get).toHaveBeenCalledOnce(); expect(acquisition.dispose).toHaveBeenCalledOnce(); expect(acquisition.dispose).toHaveBeenCalledWith(runtime);
      expect(queries.join("\n")).not.toMatch(/insert|pg_advisory|runtime_control_lease/);
      pool.begin = async () => { throw new Error("SYNTHETIC_BEGIN_FAILURE"); };
      await expect(runPaperBarCloseCli(f.args)).rejects.toThrow("SYNTHETIC_BEGIN_FAILURE");
      expect(acquisition.dispose).toHaveBeenCalledTimes(2); expect(acquisition.dispose).toHaveBeenLastCalledWith(runtime);
    } finally { for (const [key, value] of Object.entries({ WAIA_TRADER_CLI: before.cli, WAIA_DB_BACKEND: before.db, WAIA_POSTGRES_PER_REQUEST_CLIENT: before.owned, DATABASE_URL_POSTGRES: before.url }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(f.directory, { recursive: true, force: true }); }
  });
  it.each(["actor", "mode", "file-extra", "file-size", "repeat"])("refuses%s input before ownership acquisition", async kind => {
    const f = cliFile(); const old = process.env.WAIA_TRADER_CLI; process.env.WAIA_TRADER_CLI = "1"; acquisition.get.mockClear();
    if (kind === "actor") f.args.push("--userId=operator");
    if (kind === "mode") f.args.push("--saved-research-understanding");
    if (kind === "file-extra") writeFileSync(f.file, JSON.stringify({ ...f.value, actor: "operator" }));
    if (kind === "file-size") writeFileSync(f.file, " ".repeat(262145));
    if (kind === "repeat") f.args.push("--operation=consume");
    try { const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
      await expect(runPaperBarCloseCli(f.args)).rejects.toThrow(/APPLICATION_/); expect(acquisition.get).not.toHaveBeenCalled();
    } finally { if (old === undefined) delete process.env.WAIA_TRADER_CLI; else process.env.WAIA_TRADER_CLI = old; rmSync(f.directory, { recursive: true, force: true }); }
  });
});
