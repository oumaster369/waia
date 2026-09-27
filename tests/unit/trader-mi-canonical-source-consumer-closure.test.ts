import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  CANONICAL_FORBIDDEN_DOWNSTREAM_AUTHORITY_SEGMENTS_V1,
  CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1,
  CANONICAL_NON_PERSISTENCE_PATHS_V1,
  CANONICAL_PROVIDER_PRODUCER_FILES_V1,
  auditCanonicalSourceConsumerInventoryV1,
} from "@/lib/trader/mi/canonical-source-consumer-inventory-v1";
import {
  CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1,
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  EXCLUDED_UNMODELED_GATEWAY_KINDS_V1,
  GATEWAY_PRIMITIVE_DISPOSITION_V1,
} from "@/lib/trader/mi/canonical-observation-v1";
import { MARKET_DATA_PROVIDER_IDS, NORMALIZED_OBSERVATION_KINDS } from "@/lib/trader/market-data/observation-types";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function repoRelative(path: string): string {
  return relative(root, path).split("\\").join("/");
}

const measurementService = "@/lib/trader/mi/canonical-pit-service-postgres";
const measurementDelegates = [
  "persistCanonicalMeasurementDefinitionWithinHeldTransactionV1Postgres",
  "persistCanonicalMeasurementValueLineageWithinHeldTransactionV1Postgres",
] as const;

// Inspect the actual application's imports and calls, not comments or a second runtime API.
function applicationMeasurementBoundaryErrors(source: string): string[] {
  const ast = ts.createSourceFile("application.ts", source, ts.ScriptTarget.Latest, true);
  const errors: string[] = [], imported: string[] = [], called: string[] = [];
  const isBoundary = (name: string) => /canonical-pit|\/mi\/(?:repository-postgres|trust-as-of-repository-postgres)|market-data-gateway/.test(name);
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isBoundary(node.moduleSpecifier.text)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      if (node.moduleSpecifier.text !== measurementService || clause?.name || clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) {
        errors.push("UNAPPROVED_BOUNDARY_IMPORT");
      } else {
        for (const element of bindings.elements) {
          const name = element.name.text;
          if (element.propertyName || element.isTypeOnly || !measurementDelegates.some(allowed => allowed === name)) errors.push("UNAPPROVED_MEASUREMENT_SYMBOL");
          imported.push(name);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isBoundary(node.moduleSpecifier.text)) errors.push("BOUNDARY_REEXPORT");
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if ((target.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(target) && target.text === "require")) &&
        node.arguments.some(argument => ts.isStringLiteral(argument) && isBoundary(argument.text))) errors.push("DYNAMIC_BOUNDARY_IMPORT");
      if (ts.isIdentifier(target) && measurementDelegates.some(name => name === target.text)) {
        called.push(target.text);
        const expectedValue = target.text === measurementDelegates[0] ? "witness.definition" : "witness.value";
        if (node.arguments.map(argument => argument.getText(ast)).join(",") !== `db,selected.context,${expectedValue}`) errors.push("HELD_ARGUMENT_DRIFT");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (JSON.stringify(imported.sort()) !== JSON.stringify([...measurementDelegates])) errors.push("MEASUREMENT_IMPORT_SET");
  if (JSON.stringify(called.sort()) !== JSON.stringify([...measurementDelegates])) errors.push("MEASUREMENT_CALL_SET");
  return errors;
}

function heldMeasurementDelegateBodies(source: string): string[] {
  const ast = ts.createSourceFile("service.ts", source, ts.ScriptTarget.Latest, true);
  return measurementDelegates.map(name => {
    const declaration = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    return declaration?.body?.getText(ast).replace(/\s/g, "") ?? "MISSING";
  });
}

describe("DEE-684 canonical source, consumer, and bypass closure", () => {
  it("accounts for all primitives, gateway kinds, providers, and producer files", () => {
    expect(auditCanonicalSourceConsumerInventoryV1()).toEqual([]);
    expect(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1).toHaveLength(7);
    expect(CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1).toHaveLength(6);
    expect(EXCLUDED_UNMODELED_GATEWAY_KINDS_V1).toHaveLength(11);
    expect(Object.keys(GATEWAY_PRIMITIVE_DISPOSITION_V1).sort()).toEqual(
      [...NORMALIZED_OBSERVATION_KINDS].sort(),
    );
    expect(Object.keys(CANONICAL_PROVIDER_PRODUCER_FILES_V1).sort()).toEqual(
      [...MARKET_DATA_PROVIDER_IDS].sort(),
    );

    for (const [providerId, paths] of Object.entries(CANONICAL_PROVIDER_PRODUCER_FILES_V1)) {
      for (const path of paths) {
        const absolute = join(root, path);
        expect(existsSync(absolute), path).toBe(true);
        const source = readFileSync(absolute, "utf8");
        if (providerId === "coingecko_global") {
          expect(GATEWAY_PRIMITIVE_DISPOSITION_V1.global_market_stats.disposition).toBe(
            "EXCLUDED_UNMODELED",
          );
          expect(source, `${providerId}:${path}`).toContain(
            "CoinGeckoGlobalMarketClient remains registry-covered but is never selected",
          );
          continue;
        }
        expect(source, `${providerId}:${path}`).toContain(`providerId: "${providerId}"`);
      }
    }
  });

  it("pins every ingress, consumer, and known non-persistence path to an existing file", () => {
    const inventoryJson = JSON.stringify(CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1);
    const paths = [...inventoryJson.matchAll(/lib\/trader\/[^\"]+\.ts/g)].map(
      (match) => match[0],
    );
    for (const path of paths) expect(existsSync(join(root, path)), path).toBe(true);
    for (const entry of CANONICAL_NON_PERSISTENCE_PATHS_V1) {
      expect(existsSync(join(root, entry.path)), entry.path).toBe(true);
    }
  });

  it("finds no repository bypass or downstream authority import", () => {
    const sources = sourceFiles(join(root, "lib/trader"));
    const repositoryImporters = sources
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          'from "@/lib/trader/mi/canonical-pit-repository-postgres"',
        ),
      )
      .map(repoRelative);
    expect(repositoryImporters).toEqual(["lib/trader/mi/canonical-pit-service-postgres.ts"]);
    const historicalRatification = readFileSync(
      join(root,
        "lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts"),
      "utf8",
    );
    expect(historicalRatification).toContain(
      "persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres",
    );
    expect(historicalRatification).toContain(
      "readCanonicalPitObservationWithinHeldTransactionV1Postgres",
    );
    expect(historicalRatification).not.toContain("canonical-pit-repository-postgres");

    const serviceImporters = sources
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          'from "@/lib/trader/mi/canonical-pit-service-postgres"',
        ),
      )
      .map(repoRelative);
    expect(serviceImporters).toEqual([
      "lib/trader/market-data/replay/canonical-pit-replay.ts",
      "lib/trader/paper/durable-noncapital/recorded-analysis-v1.ts",
      "lib/trader/paper/durable-noncapital/repository-postgres-v1.ts",
      "lib/trader/paper/research-application-v1/repository-postgres.ts",
      "lib/trader/paper/research-understanding-v1/bounded-source-postgres.ts",
      "lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts",
    ]);

    const application = CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.savedResearchApplication;
    expect(application.consumer).toBe("lib/trader/mi/canonical-pit-service-postgres.ts");
    expect(application.disposition).toBe("INERT_MEASUREMENT_IDENTITY_AND_LINEAGE_ONLY");
    expect(applicationMeasurementBoundaryErrors(readFileSync(join(root, application.boundary), "utf8"))).toEqual([]);

    const recordedReplay = readFileSync(
      join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.recordedNoncapitalReplay.boundary),
      "utf8",
    );
    expect(recordedReplay).toContain("readCanonicalPitObservationWithinHeldTransactionV1Postgres");
    expect(recordedReplay).toContain("hasCanonicalGatewayPitReceiptContentV1");
    expect(recordedReplay).not.toContain("canonical-pit-repository-postgres");
    const research = readFileSync(join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.savedResearchUnderstanding.boundary), "utf8");
    expect(research).toContain("readCanonicalPitObservationWithinHeldTransactionV1Postgres");
    expect(research).toContain("octet_length(to_jsonb(bounded_row)::text)");
    expect(research).not.toContain("canonical-pit-repository-postgres");
    expect(research).not.toMatch(/persistCanonical|recordCanonicalGateway/);
    const recordedTypes = readFileSync(
      join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.recordedNoncapitalReplay.receiptTypeConsumer),
      "utf8",
    );
    expect(recordedTypes).toContain('import type { CanonicalGatewayPitReceiptV1 }');
    expect(CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.recordedNoncapitalReplay.disposition)
      .toBe("PERSISTED_OUTCOME_REPLAY_NO_ANALYTICAL_AUTHORITY");

    const downstreamLeaks = sources
      .map(repoRelative)
      .filter((path) =>
        CANONICAL_FORBIDDEN_DOWNSTREAM_AUTHORITY_SEGMENTS_V1.some((segment) =>
          `/${path}`.includes(segment),
        ),
      )
      .filter((path) => readFileSync(join(root, path), "utf8").includes("canonical-pit"));
    expect(downstreamLeaks).toEqual([]);

    const gateway = readFileSync(
      join(root, "lib/trader/market-data/market-data-gateway.ts"),
      "utf8",
    );
    expect(gateway).toContain("canonicalPitCandidates");
    expect(gateway).not.toContain("canonical-pit-repository-postgres");

    const legacyReader = readFileSync(
      join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.internalMsv.sharedTableReader),
      "utf8",
    );
    expect(
      CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.internalMsv.sharedTableDisposition,
    ).toBe("INTERNAL_MSV_ONLY_FILTERED");
    expect(legacyReader.match(/observationKind, INTERNAL_MSV_KIND/g)).toHaveLength(4);
  });
  it("keeps the two inert measurement delegates inside the existing held transaction", () => {
    const service = readFileSync(join(root, "lib/trader/mi/canonical-pit-service-postgres.ts"), "utf8");
    expect(heldMeasurementDelegateBodies(service)).toEqual([
      "{returnpersistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(db,requireOrgContext(context.organizationId),definition,);}",
      "{returnpersistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(db,requireOrgContext(context.organizationId),value,);}",
    ]);
  });

  it.each([
    `import { processCanonicalPitObservationV1Postgres } from "${measurementService}";`,
    `import { persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres } from "${measurementService}";`,
    `import { readCanonicalPitObservationWithinHeldTransactionV1Postgres } from "${measurementService}";`,
    'import { findSourceByLogicalKeyPostgres } from "@/lib/trader/mi/repository-postgres";',
    'import { resolveAndPersistTrustAsOfV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";',
    'import { persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres } from "@/lib/trader/mi/canonical-pit-repository-postgres";',
    `import * as canonical from "${measurementService}";`,
    `import("${measurementService}");`,
    `require("${measurementService}");`,
    `export * from "${measurementService}";`,
  ])("rejects application boundary capability addition: %s", addition => {
    const source = readFileSync(join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.savedResearchApplication.boundary), "utf8");
    expect(applicationMeasurementBoundaryErrors(`${source}\n${addition}`)).not.toEqual([]);
  });

  it("rejects omission, duplication, or executor substitution of the actual measurement calls", () => {
    const source = readFileSync(join(root, CANONICAL_INGRESS_AND_CONSUMER_PATHS_V1.savedResearchApplication.boundary), "utf8");
    const call = `${measurementDelegates[0]}(db, selected.context, witness.definition)`;
    expect(source).toContain(call);
    for (const changed of [source.replace(call, "Promise.resolve()"), source.replace(call, `${call}; await ${call}`), source.replace(call, call.replace("(db,", "(otherDb,"))]) {
      expect(applicationMeasurementBoundaryErrors(changed)).not.toEqual([]);
    }
  });

});
