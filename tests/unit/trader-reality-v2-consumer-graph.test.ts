import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  assertConnectorReferenceClosure,
  detectConnectorMethodReferencesInSource,
} from "@/scripts/trader/validate-reality-v2-consumer-graph";

const ROOT = process.cwd();
const INVENTORY = join(ROOT, "docs/ai-trader/reality-v2-source-consumer-inventory.json");
const VALIDATOR = join(ROOT, "scripts/trader/validate-reality-v2-consumer-graph.ts");

describe("Reality V2 whole-repository source/consumer closure (DEE-679)", () => {
  it("passes the pinned repository graph validator", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", VALIDATOR], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      status: "PASS",
      sources: 154,
      consumers: 129,
      connectorReferences: 25,
      sourceContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
      consumerContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("pins the protected store as exactly one observation-only consumer, not an admitted boundary", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const path = "lib/trader/account-observation/credential-store.ts";
    const rules = inventory.consumerRules.filter((rule: { pathPattern: string }) => new RegExp(rule.pathPattern).test(path));
    expect(rules).toEqual([{ id: "ACCOUNT_OBSERVATION_PROTECTED_STORE",
      pathPattern: "^lib/trader/account-observation/credential-store\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY", reason: expect.any(String) }]);
    expect(inventory.admittedBoundaryFiles).not.toContain(path);
    expect(new RegExp(rules[0].pathPattern).test("lib/trader/account-observation/other-store.ts")).toBe(false);
    expect(detectConnectorMethodReferencesInSource(readFileSync(join(ROOT, path), "utf8"), path,
      ["placeOrder", "cancelOrder", "amendOrder", "submitOrder", "getAccountInfo", "getBalances", "getPositions", "getOpenOrders", "getOrder", "getTradeHistory"])).toEqual([]);
  });

  it("pins the GET-only transport as observation-only with no existing trading client", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const path = "lib/trader/account-observation/htx-get-transport.ts";
    const rule = inventory.consumerRules.find((r: { id: string }) => r.id === "ACCOUNT_OBSERVATION_GET_TRANSPORT");
    expect(rule).toEqual({ id: "ACCOUNT_OBSERVATION_GET_TRANSPORT",
      pathPattern: "^lib/trader/account-observation/htx-get-transport\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY", reason: expect.any(String) });
    expect(inventory.admittedBoundaryFiles).not.toContain(path);
    const body = readFileSync(join(ROOT, path), "utf8");
    const ast = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
    const imports = ast.statements.filter(ts.isImportDeclaration)
      .map(s => (s.moduleSpecifier as ts.StringLiteral).text).sort();
    expect(imports).toEqual(["server-only", "node:crypto", "@/lib/trader/connectors/htx/signing",
      "zod", "./service", "./validation", "./types", "./htx-reader"].sort());
    const signer = ast.statements.filter(ts.isImportDeclaration).find(s =>
      (s.moduleSpecifier as ts.StringLiteral).text === "@/lib/trader/connectors/htx/signing")!;
    const named = signer.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named) && named.elements.map(e => e.name.text))
      .toEqual(["buildSignedQueryString", "formatHtxTimestamp"]);
    expect(body).not.toMatch(/process\.env|globalThis\.fetch|buildSignedPost|HtxRestClient|import\s*\(|require\s*\(/);
  });

  it("excludes exactly the three normalized account-observation consumers without Reality or venue-write authority", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      consumerRules: { id: string; pathPattern: string; disposition: string }[];
      admittedBoundaryFiles: string[];
    };
    const rule = inventory.consumerRules.find(item => item.id === "ACCOUNT_OBSERVATION_NORMALIZED_DTOS")!;
    expect(rule).toMatchObject({
      pathPattern: "^lib/trader/account-observation/(service|types|htx-reader)\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY",
    });
    const paths = ["lib/trader/account-observation/htx-reader.ts", "lib/trader/account-observation/service.ts", "lib/trader/account-observation/types.ts"];
    const candidatePaths = readdirSync(join(ROOT, "lib/trader/account-observation"))
      .map(file => `lib/trader/account-observation/${file}`);
    expect(candidatePaths.filter(file => new RegExp(rule.pathPattern).test(file)).sort()).toEqual(paths);
    for (const file of paths) {
      expect(inventory.consumerRules.filter(item => new RegExp(item.pathPattern).test(file))).toEqual([rule]);
      expect(inventory.admittedBoundaryFiles).not.toContain(file);
      const body = readFileSync(join(ROOT, file), "utf8");
      const ast = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement)) {
          if (file.endsWith("/htx-reader.ts") && (statement.moduleSpecifier as ts.StringLiteral).text === "./service") {
            const bindings = statement.importClause?.namedBindings;
            expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(e => e.name.text))
              .toEqual(["AccountObservationReadFailure"]);
            continue;
          }
          expect(statement.importClause?.isTypeOnly).toBe(true);
          if (file === "lib/trader/account-observation/types.ts" &&
            (statement.moduleSpecifier as ts.StringLiteral).text === "./coverage") {
            const bindings = statement.importClause?.namedBindings;
            expect(statement.importClause?.name).toBeUndefined();
            expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(element => ({
              name: element.name.text, original: element.propertyName?.text,
            }))).toEqual([{ name: "HtxObservationCoverage", original: undefined }]);
            continue;
          }
          expect(["@/lib/trader/connectors/types", "./types"]).toContain(
            (statement.moduleSpecifier as ts.StringLiteral).text,
          );
        }
      }
      expect(detectConnectorMethodReferencesInSource(body, file, [
        "placeOrder", "cancelOrder", "amendOrder", "submitOrder", "getAccountInfo",
        "getBalances", "getPositions", "getOpenOrders", "getOrder", "getTradeHistory",
      ])).toEqual([]);
      expect(body).not.toMatch(/import\s*\(|require\s*\(|(?:globalThis|window)\.fetch/);
      // The service's local `fetch` parameter is an injected read callback, not global fetch.
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
          let enclosing: ts.Node | undefined = node.parent;
          while (enclosing && !ts.isFunctionDeclaration(enclosing)) enclosing = enclosing.parent;
          expect(enclosing && ts.isFunctionDeclaration(enclosing) &&
            enclosing.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === "fetch"))
            .toBe(true);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    for (const file of ["lib/trader/account-observation/ingress.ts", "lib/trader/account-observation/service.tsx",
      "lib/trader/account-observation/types.ts/other.ts"]) {
      expect(new RegExp(rule.pathPattern).test(file)).toBe(false);
    }
  });

  it("keeps the type-only coverage dependency limited to static Zod schemas", () => {
    const file = "lib/trader/account-observation/coverage.ts";
    const body = readFileSync(join(ROOT, file), "utf8");
    const ast = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
    const imports = ast.statements.filter(ts.isImportDeclaration);
    expect(imports.map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)).toEqual(["zod"]);
    const bindings = imports[0]!.importClause?.namedBindings;
    expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(element => element.name.text)).toEqual(["z"]);
    expect(ast.statements.every(statement => ts.isImportDeclaration(statement) ||
      ts.isVariableStatement(statement) || ts.isTypeAliasDeclaration(statement))).toBe(true);
    expect(ast.statements.filter(ts.isVariableStatement).flatMap(statement =>
      statement.declarationList.declarations.map(declaration => declaration.name.getText(ast))))
      .toEqual(["htxObservationReaderLimitsSchema", "htxObservationCoverageSchema"]);
    expect(body).not.toMatch(/import\s*\(|require\s*\(|fetch|process\.env|globalThis|window|=>|\bfunction\b/);
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    expect(inventory.admittedBoundaryFiles).not.toContain(file);
  });

  it("binds historical, synthetic, modelled, and Execution V2 barrel surfaces into closure", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      sourceDiscovery: { roots: string[]; additionalFiles: string[] };
      consumerDiscovery: {
        additionalFiles: string[];
        productionExtensions: string[];
        connectorMethods: string[];
      };
    };
    expect(inventory.sourceDiscovery.roots).toContain("lib/trader/market-data");
    expect(inventory.sourceDiscovery.roots).toContain("lib/trader/execution/v2");
    expect(inventory.sourceDiscovery.additionalFiles).toContain("lib/trader/execution/index.ts");
    expect(inventory.consumerDiscovery.additionalFiles).toEqual(expect.arrayContaining([
      "lib/trader/execution/index.ts",
      "lib/trader/execution/v2/index.ts",
    ]));
    expect(inventory.consumerDiscovery.productionExtensions).toEqual(expect.arrayContaining([
      ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
    ]));
    expect(inventory.consumerDiscovery.connectorMethods).toContain("placeOrder");
  });

  it("detects alias, bind, destructure, bracket, optional, direct-client, and indirect references", () => {
    const methods = [
      "getAccountInfo", "getBalances", "getPositions", "getOpenOrders",
      "getOrder", "getTradeHistory", "placeOrder",
    ];
    const references = detectConnectorMethodReferencesInSource(`
      const alias = connector.getBalances;
      const bound = connector.placeOrder.bind(connector);
      const { getPositions: positions, getOpenOrders } = connector;
      const bracket = connector["getOrder"];
      this.client?.getTradeHistory?.();
      forward(inner.getAccountInfo);
      alias(); bound(input); positions(); getOpenOrders(); bracket(id);
    `, "lib/mutated-consumer.ts", methods);
    expect(references.map(({ method, form }) => `${method}:${form}`).sort()).toEqual([
      "getAccountInfo:PROPERTY",
      "getBalances:PROPERTY",
      "getOpenOrders:DESTRUCTURE",
      "getOrder:BRACKET",
      "getPositions:DESTRUCTURE",
      "getTradeHistory:OPTIONAL_PROPERTY",
      "placeOrder:PROPERTY",
    ]);
    expect(() => assertConnectorReferenceClosure(references, [])).toThrow(
      /connector reference closure drift/,
    );
  });

  it("keeps DEE-620 and DEE-634 explicit and separate", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      separateIssues: Record<string, string>;
      canonicalSourceKinds: string[];
    };
    expect(Object.keys(inventory.separateIssues).sort()).toEqual(["DEE-620", "DEE-634"]);
    expect(inventory.canonicalSourceKinds).toEqual([
      "EXECUTION_REPORT_V2",
      "HTX_SPOT_ORDER_REST",
      "HTX_SPOT_FILL_REST",
      "HTX_SPOT_BALANCE_REST",
      "HTX_SPOT_ACCOUNT_REST",
    ]);
  });
});
