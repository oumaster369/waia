import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

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
        expect(readFileSync(absolute, "utf8"), `${providerId}:${path}`).toContain(
          `providerId: "${providerId}"`,
        );
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

    const serviceImporters = sources
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          'from "@/lib/trader/mi/canonical-pit-service-postgres"',
        ),
      )
      .map(repoRelative);
    expect(serviceImporters).toEqual([
      "lib/trader/market-data/replay/canonical-pit-replay.ts",
    ]);

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
});
