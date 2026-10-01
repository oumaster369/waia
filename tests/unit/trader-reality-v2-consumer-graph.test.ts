import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

import {
  assertPerFilePinInventorySchema,
  assertPerFileContentPins,
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
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        status: "PASS",
        // DEE-1126 extracts passive interval durations and the replay minimum.
        // DEE-1151 adds Execution V2 order-path modules plus the credential kill helper.
        sources: 163,
        // DEE-1015 adds exactly one observation-only consumer: the assignment-bound
        // credential read boundary that replaces the generic repository on that path.
        // DEE-1050 adds three public-read consumers: RSS news, Alternative.me, and
        // the HTX public ticker host. None admit Reality or place orders.
        // DEE-1122 pins six DB-only delivery/ownership/equivalence files.
        // DEE-1130 adds one excluded historical reconciliation projector.
        // DEE-1135 pins the HTX account acquisition spec and its PostgreSQL journal
        // on the existing Reality boundary.
        // DEE-1151 adds paper and live callers that import Execution V2, plus the
        // live credential admission module and the pre-post recheck that imports it.
        // skipBlindTail in scripts/trader/ri-evidence-campaign.ts changes an
        // existing consumer's body. Counts and digests are recomputed on the merge.
        // DEE-1151 records an unresolved execution attempt from recovery, which
        // changes that existing consumer's body.
        // DEE-1151 stores a trade credential only when live is enabled, which
        // changes the existing connect-handler consumer body.
        // DEE-1151 stops retrying HTX POST, which changes the existing connector bodies.
        // DEE-1153 adds one observation-only HTX derivatives account-info transport.
        consumers: 151,
        consumerDigestHex: "9bc24c8e3bcb1d438d4cde8f8f1eea78e6f13a4756eda57b2f547631317f5895",
        // DEE-1099 adds one read of freshly validated account permissions,
        // not a financial observation or a venue effect.
        // DEE-1151 keeps that read on the live connector and does not add placeOrder.
        connectorReferences: 26,
        sourceContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
        consumerContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("keeps the live credential permission read outside Reality admission", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const file = "lib/trader/live/live-connector.ts";
    expect(inventory.admittedBoundaryFiles).not.toContain(file);
    expect(
      inventory.explicitCompatibilityChecks.filter(
        (entry: { file: string }) => entry.file === file,
      ),
    ).toEqual([
      {
        file,
        method: "getAccountInfo",
        occurrences: 1,
        disposition: expect.stringContaining("CREDENTIAL_PERMISSION_CHECK_ONLY"),
      },
    ]);
    const references = detectConnectorMethodReferencesInSource(
      readFileSync(join(ROOT, file), "utf8"),
      file,
      ["getAccountInfo", "getBalances", "getOrder", "getTradeHistory", "placeOrder", "cancelOrder"],
    );
    expect(references.map(({ method }) => method)).toEqual(["getAccountInfo"]);
  });

  it("pins the protected store as exactly one observation-only consumer, not an admitted boundary", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const path = "lib/trader/account-observation/credential-store.ts";
    const rules = inventory.consumerRules.filter((rule: { pathPattern: string }) =>
      new RegExp(rule.pathPattern).test(path),
    );
    expect(rules).toEqual([
      {
        id: "ACCOUNT_OBSERVATION_PROTECTED_STORE",
        pathPattern: "^lib/trader/account-observation/credential-store\\.ts$",
        disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY",
        reason: expect.any(String),
      },
    ]);
    expect(inventory.admittedBoundaryFiles).not.toContain(path);
    expect(
      new RegExp(rules[0].pathPattern).test("lib/trader/account-observation/other-store.ts"),
    ).toBe(false);
    expect(
      detectConnectorMethodReferencesInSource(readFileSync(join(ROOT, path), "utf8"), path, [
        "placeOrder",
        "cancelOrder",
        "amendOrder",
        "submitOrder",
        "getAccountInfo",
        "getBalances",
        "getPositions",
        "getOpenOrders",
        "getOrder",
        "getTradeHistory",
      ]),
    ).toEqual([]);
  });

  it("pins the GET-only transport as observation-only with no existing trading client", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const path = "lib/trader/account-observation/htx-get-transport.ts";
    const rule = inventory.consumerRules.find(
      (r: { id: string }) => r.id === "ACCOUNT_OBSERVATION_GET_TRANSPORT",
    );
    expect(rule).toEqual({
      id: "ACCOUNT_OBSERVATION_GET_TRANSPORT",
      pathPattern: "^lib/trader/account-observation/htx-get-transport\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY",
      reason: expect.any(String),
    });
    expect(inventory.admittedBoundaryFiles).not.toContain(path);
    const body = readFileSync(join(ROOT, path), "utf8");
    const ast = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
    const imports = ast.statements
      .filter(ts.isImportDeclaration)
      .map((s) => (s.moduleSpecifier as ts.StringLiteral).text)
      .sort();
    expect(imports).toEqual(
      [
        "server-only",
        "node:crypto",
        "@/lib/trader/connectors/htx/signing",
        "zod",
        "./service",
        "./validation",
        "./types",
        "./htx-reader",
      ].sort(),
    );
    const signer = ast.statements
      .filter(ts.isImportDeclaration)
      .find(
        (s) =>
          (s.moduleSpecifier as ts.StringLiteral).text === "@/lib/trader/connectors/htx/signing",
      )!;
    const named = signer.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named) && named.elements.map((e) => e.name.text)).toEqual([
      "buildSignedQueryString",
      "formatHtxTimestamp",
    ]);
    expect(body).not.toMatch(
      /process\.env|globalThis\.fetch|buildSignedPost|HtxRestClient|import\s*\(|require\s*\(/,
    );
  });

  it("pins only the closed derivatives account-info transport outside canonical financial authority", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
    const file = "lib/trader/account-observation/derivatives/htx-account-transport.ts";
    const rules = inventory.consumerRules.filter((rule: { pathPattern: string }) => new RegExp(rule.pathPattern).test(file));
    expect(rules).toEqual([expect.objectContaining({ id: "ACCOUNT_OBSERVATION_DERIVATIVES_TRANSPORT",
      pathPattern: "^lib/trader/account-observation/derivatives/htx-account-transport\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY" })]);
    expect(inventory.admittedBoundaryFiles).not.toContain(file);
    expect(new RegExp(rules[0].pathPattern).test("lib/trader/account-observation/derivatives/order-transport.ts")).toBe(false);
    const body = readFileSync(join(ROOT, file), "utf8");
    expect(detectConnectorMethodReferencesInSource(body, file, ["placeOrder", "cancelOrder", "amendOrder", "submitOrder"]))
      .toEqual([]);
    expect(body).not.toMatch(/process\.env|globalThis\.fetch|HtxRestClient|import\s*\(|require\s*\(/);
    const ast = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
    const connectorImports = ast.statements.filter(ts.isImportDeclaration)
      .filter(statement => (statement.moduleSpecifier as ts.StringLiteral).text.includes("/connectors/"));
    expect(connectorImports).toHaveLength(1);
    expect((connectorImports[0].moduleSpecifier as ts.StringLiteral).text).toBe("@/lib/trader/connectors/htx/signing");
    const bindings = connectorImports[0].importClause?.namedBindings;
    expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(element => element.name.text))
      .toEqual(["buildSignedPostQueryString", "formatHtxTimestamp"]);
  });

  it("excludes exactly the three normalized account-observation consumers without Reality or venue-write authority", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      consumerRules: { id: string; pathPattern: string; disposition: string }[];
      admittedBoundaryFiles: string[];
    };
    const rule = inventory.consumerRules.find(
      (item) => item.id === "ACCOUNT_OBSERVATION_NORMALIZED_DTOS",
    )!;
    expect(rule).toMatchObject({
      pathPattern: "^lib/trader/account-observation/(service|types|htx-reader)\\.ts$",
      disposition: "EXCLUDED_OBSERVATION_ONLY_NO_CANONICAL_AUTHORITY",
    });
    const paths = [
      "lib/trader/account-observation/htx-reader.ts",
      "lib/trader/account-observation/service.ts",
      "lib/trader/account-observation/types.ts",
    ];
    const candidatePaths = readdirSync(join(ROOT, "lib/trader/account-observation")).map(
      (file) => `lib/trader/account-observation/${file}`,
    );
    expect(candidatePaths.filter((file) => new RegExp(rule.pathPattern).test(file)).sort()).toEqual(
      paths,
    );
    for (const file of paths) {
      expect(
        inventory.consumerRules.filter((item) => new RegExp(item.pathPattern).test(file)),
      ).toEqual([rule]);
      expect(inventory.admittedBoundaryFiles).not.toContain(file);
      const body = readFileSync(join(ROOT, file), "utf8");
      const ast = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement)) {
          const moduleName = (statement.moduleSpecifier as ts.StringLiteral).text;
          if (file.endsWith("/service.ts") && ["./derivatives/types", "./validation"].includes(moduleName)) {
            const bindings = statement.importClause?.namedBindings;
            expect(statement.importClause?.name).toBeUndefined();
            expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(element => ({
              name: element.name.text, original: element.propertyName?.text, typeOnly: element.isTypeOnly,
            }))).toEqual(moduleName === "./derivatives/types" ? [
              { name: "HTX_DERIVATIVES_ACCOUNT_FAMILIES", original: undefined, typeOnly: false },
              { name: "HtxDerivativesAccountFamily", original: undefined, typeOnly: true },
              { name: "HtxDerivativesAccountRow", original: undefined, typeOnly: true },
            ] : [
              { name: "parseAccountObservation", original: undefined, typeOnly: false },
              { name: "sameObservationBinding", original: undefined, typeOnly: false },
            ]);
            continue;
          }
          if (file.endsWith("/types.ts") && moduleName === "./derivatives/types") {
            expect(statement.importClause?.isTypeOnly).toBe(true);
            const bindings = statement.importClause?.namedBindings;
            expect(statement.importClause?.name).toBeUndefined();
            expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(element => element.name.text))
              .toEqual(["HtxDerivativesAccountFamily", "HtxDerivativesAccountRow", "HtxDerivativesAccountSnapshot"]);
            continue;
          }
          if (
            file.endsWith("/htx-reader.ts") &&
            (statement.moduleSpecifier as ts.StringLiteral).text === "./service"
          ) {
            const bindings = statement.importClause?.namedBindings;
            expect(
              bindings && ts.isNamedImports(bindings) && bindings.elements.map((e) => e.name.text),
            ).toEqual(["AccountObservationReadFailure"]);
            continue;
          }
          expect(statement.importClause?.isTypeOnly).toBe(true);
          if (
            file === "lib/trader/account-observation/types.ts" &&
            (statement.moduleSpecifier as ts.StringLiteral).text === "./coverage"
          ) {
            const bindings = statement.importClause?.namedBindings;
            expect(statement.importClause?.name).toBeUndefined();
            expect(
              bindings &&
                ts.isNamedImports(bindings) &&
                bindings.elements.map((element) => ({
                  name: element.name.text,
                  original: element.propertyName?.text,
                })),
            ).toEqual([{ name: "HtxObservationCoverage", original: undefined }]);
            continue;
          }
          expect(["@/lib/trader/connectors/types", "./types"]).toContain(
            (statement.moduleSpecifier as ts.StringLiteral).text,
          );
        }
      }
      expect(
        detectConnectorMethodReferencesInSource(body, file, [
          "placeOrder",
          "cancelOrder",
          "amendOrder",
          "submitOrder",
          "getAccountInfo",
          "getBalances",
          "getPositions",
          "getOpenOrders",
          "getOrder",
          "getTradeHistory",
        ]),
      ).toEqual([]);
      expect(body).not.toMatch(/import\s*\(|require\s*\(|(?:globalThis|window)\.fetch/);
      // The service's local `fetch` parameter is an injected read callback, not global fetch.
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "fetch"
        ) {
          let enclosing: ts.Node | undefined = node.parent;
          while (enclosing && !ts.isFunctionDeclaration(enclosing)) enclosing = enclosing.parent;
          expect(
            enclosing &&
              ts.isFunctionDeclaration(enclosing) &&
              enclosing.parameters.some(
                (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === "fetch",
              ),
          ).toBe(true);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    for (const file of [
      "lib/trader/account-observation/ingress.ts",
      "lib/trader/account-observation/service.tsx",
      "lib/trader/account-observation/types.ts/other.ts",
    ]) {
      expect(new RegExp(rule.pathPattern).test(file)).toBe(false);
    }
  });

  it("keeps the type-only coverage dependency limited to static Zod schemas", () => {
    const file = "lib/trader/account-observation/coverage.ts";
    const body = readFileSync(join(ROOT, file), "utf8");
    const ast = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true);
    const imports = ast.statements.filter(ts.isImportDeclaration);
    expect(
      imports.map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text),
    ).toEqual(["zod"]);
    const bindings = imports[0]!.importClause?.namedBindings;
    expect(
      bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.map((element) => element.name.text),
    ).toEqual(["z"]);
    expect(
      ast.statements.every(
        (statement) =>
          ts.isImportDeclaration(statement) ||
          ts.isVariableStatement(statement) ||
          ts.isTypeAliasDeclaration(statement),
      ),
    ).toBe(true);
    expect(
      ast.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) =>
          statement.declarationList.declarations.map((declaration) =>
            declaration.name.getText(ast),
          ),
        ),
    ).toEqual(["htxObservationReaderLimitsSchema", "htxObservationCoverageSchema"]);
    expect(body).not.toMatch(
      /import\s*\(|require\s*\(|fetch|process\.env|globalThis|window|=>|\bfunction\b/,
    );
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
    expect(inventory.consumerDiscovery.additionalFiles).toEqual(
      expect.arrayContaining(["lib/trader/execution/index.ts", "lib/trader/execution/v2/index.ts"]),
    );
    expect(inventory.consumerDiscovery.productionExtensions).toEqual(
      expect.arrayContaining([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]),
    );
    expect(inventory.consumerDiscovery.connectorMethods).toContain("placeOrder");
  });

  it("detects alias, bind, destructure, bracket, optional, direct-client, and indirect references", () => {
    const methods = [
      "getAccountInfo",
      "getBalances",
      "getPositions",
      "getOpenOrders",
      "getOrder",
      "getTradeHistory",
      "placeOrder",
    ];
    const references = detectConnectorMethodReferencesInSource(
      `
      const alias = connector.getBalances;
      const bound = connector.placeOrder.bind(connector);
      const { getPositions: positions, getOpenOrders } = connector;
      const bracket = connector["getOrder"];
      this.client?.getTradeHistory?.();
      forward(inner.getAccountInfo);
      alias(); bound(input); positions(); getOpenOrders(); bracket(id);
    `,
      "lib/mutated-consumer.ts",
      methods,
    );
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

describe("Reality V2 per-file source/consumer content pins (DEE-1157)", () => {
  const validPins = [
    { path: "lib/a.ts", sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8" },
    { path: "lib/b.ts", sha256: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753" },
  ];
  const fixture = () => {
    const files = new Map([
      ["lib/a.ts", Buffer.from("alpha")],
      ["lib/b.ts", Buffer.from("beta")],
      ["lib/c.ts", Buffer.from("gamma")],
    ]);
    return { files, read: vi.fn((path: string) => files.get(path) ?? Buffer.from("missing")) };
  };

  it("accepts exact path-set pins and rejects changed content per file", () => {
    const { files, read } = fixture();
    expect(() => assertPerFileContentPins(["lib/a.ts", "lib/b.ts"], validPins, read)).not.toThrow();
    read.mockClear();
    files.set("lib/a.ts", Buffer.from("changed"));
    expect(() => assertPerFileContentPins(["lib/a.ts", "lib/b.ts"], validPins, read)).toThrow(/pin mismatch: lib\/a.ts/);
    expect(read).toHaveBeenCalledWith("lib/a.ts");
  });

  it.each([
    { label: "missing pin", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0]], message: /missing pins for discovered files=lib\/b\.ts/ },
    { label: "missing discovered file", paths: ["lib/a.ts"], entries: validPins, message: /stale pins for undiscovered files=lib\/b\.ts/ },
    { label: "extra discovered caller", paths: ["lib/a.ts", "lib/b.ts", "lib/c.ts"], entries: validPins, message: /missing pins for discovered files=lib\/c\.ts/ },
    { label: "stale extra pin", paths: ["lib/a.ts", "lib/b.ts"], entries: [...validPins, { path: "lib/c.ts", sha256: "0".repeat(64) }], message: /stale pins for undiscovered files=lib\/c\.ts/ },
    { label: "same-count replacement", paths: ["lib/a.ts", "lib/c.ts"], entries: validPins, message: /missing pins for discovered files=lib\/c\.ts; stale pins for undiscovered files=lib\/b\.ts/ },
    { label: "duplicate pin", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], validPins[0]], message: /duplicate paths/ },
    { label: "malformed digest", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], { path: "lib/b.ts", sha256: "A".repeat(64) }], message: /malformed at entry 1/ },
    { label: "malformed path", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], { path: "../b.ts", sha256: validPins[1]!.sha256 }], message: /malformed at entry 1/ },
    { label: "non-string path", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], { path: 7, sha256: validPins[1]!.sha256 }], message: /malformed at entry 1/ },
    { label: "non-string digest", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], { path: "lib/b.ts", sha256: 7 }], message: /malformed at entry 1/ },
    { label: "malformed entry", paths: ["lib/a.ts", "lib/b.ts"], entries: [validPins[0], null], message: /malformed at entry 1/ },
  ])("rejects $label before reading files", ({ paths, entries, message }) => {
    const { read } = fixture();
    expect(() => assertPerFileContentPins(paths, entries, read)).toThrow(message);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires v2 and rejects v1 aggregate-only or missing per-file pins", () => {
    expect(() => assertPerFilePinInventorySchema({
      schemaVersion: "reality-v2-source-consumer-inventory/v1",
      sourceDiscovery: { sortedContentDigestHex: "a".repeat(64) },
      consumerDiscovery: { sortedContentDigestHex: "b".repeat(64) },
    })).toThrow(/expected v2 per-file pins/);
    expect(() => assertPerFilePinInventorySchema({
      schemaVersion: "reality-v2-source-consumer-inventory/v2",
      sourceDiscovery: {},
      consumerDiscovery: { contentPins: [] },
    })).toThrow(/sourceDiscovery\.contentPins must be an array/);
    expect(() => assertPerFilePinInventorySchema({
      schemaVersion: "reality-v2-source-consumer-inventory/v2",
      sourceDiscovery: { contentPins: [] },
      consumerDiscovery: {},
    })).toThrow(/consumerDiscovery\.contentPins must be an array/);
  });

  it("rejects non-array content pin collections without reading files", () => {
    const { read } = fixture();
    expect(() => assertPerFileContentPins(["lib/a.ts"], { path: "lib/a.ts" }, read)).toThrow(/contentPins must be an array/);
    expect(read).not.toHaveBeenCalled();
  });
});
