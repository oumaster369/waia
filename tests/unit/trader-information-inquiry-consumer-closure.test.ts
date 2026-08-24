import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1,
  INFORMATION_INQUIRY_FORBIDDEN_AUTHORITY_SEGMENTS_V1,
  INFORMATION_INQUIRY_FORBIDDEN_BYPASS_MARKERS_V1,
  INFORMATION_INQUIRY_GUARDIAN_LANE_V1,
  INFORMATION_INQUIRY_IMPORT_MODULES_V1,
  INFORMATION_INQUIRY_PRODUCERS_V1,
  INFORMATION_INQUIRY_REPLAY_BOUNDARIES_V1,
  INFORMATION_INQUIRY_STANDARD_COMPOSITION_V1,
  INFORMATION_INQUIRY_SUFFICIENCY_CONSUMERS_V1,
  auditInformationInquiryConsumerInventoryV1,
  type InformationInquiryImportV1,
} from "@/lib/trader/intelligence/information-inquiry/information-inquiry-consumer-inventory-v1";

const ROOT = process.cwd();

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
  return relative(ROOT, path).split("\\").join("/");
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function functionBody(source: string, name: string): string {
  const declaration = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (declaration < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf("{", declaration);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

describe("DEE-699 information inquiry producer, consumer, and bypass closure", () => {
  it("pins every producer, direct consumer, and standard composition seam", () => {
    expect(auditInformationInquiryConsumerInventoryV1()).toEqual([]);

    for (const entry of [
      ...INFORMATION_INQUIRY_PRODUCERS_V1,
      ...INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1,
      ...INFORMATION_INQUIRY_STANDARD_COMPOSITION_V1,
    ]) {
      expect(existsSync(join(ROOT, entry.path)), entry.path).toBe(true);
      const source = read(entry.path);
      for (const symbol of entry.symbols) expect(source, `${entry.path}:${symbol}`).toContain(symbol);
    }
  });

  it("accounts exactly for every direct production importer and export", () => {
    const inventoryPath =
      "lib/trader/intelligence/information-inquiry/information-inquiry-consumer-inventory-v1.ts";
    const sources = sourceFiles(join(ROOT, "lib/trader")).filter(
      (path) => repoRelative(path) !== inventoryPath,
    );
    for (const [importKind, modulePath] of Object.entries(
      INFORMATION_INQUIRY_IMPORT_MODULES_V1,
    ) as Array<[InformationInquiryImportV1, string]>) {
      const scanned = sources
        .filter((path) => {
          const source = readFileSync(path, "utf8");
          return source.includes(`"${modulePath}"`) || source.includes(`'${modulePath}'`);
        })
        .map(repoRelative)
        .sort();
      const inventoried = INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1.filter((entry) =>
        (entry.imports as readonly InformationInquiryImportV1[]).includes(importKind),
      )
        .map((entry) => entry.path)
        .sort();
      expect(scanned, importKind).toEqual(inventoried);
    }
  });

  it("keeps replay network-inert and live-provider reachability outside replay", () => {
    expect(INFORMATION_INQUIRY_REPLAY_BOUNDARIES_V1).toEqual([
      "lib/trader/market-data/replay/historical-ingress-gateway.ts",
      "lib/trader/market-data/replay/information-need-replay-selection-v1.ts",
    ]);
    for (const path of INFORMATION_INQUIRY_REPLAY_BOUNDARIES_V1) {
      const source = read(path);
      const importModules = [...source.matchAll(/import[\s\S]*?from\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      for (const forbidden of [
        "market-data-gateway",
        "htx-bar-poll-source",
        "capture-provider-snapshot",
      ]) {
        expect(importModules, `${path}:${forbidden}`).not.toEqual(
          expect.arrayContaining([expect.stringContaining(forbidden)]),
        );
      }
      expect(source, `${path}:globalThis.fetch`).not.toContain("globalThis.fetch");
    }
  });

  it("binds planner, loop, and runtime to the unchanged DEE-621 hard floor", () => {
    const inquirySources = sourceFiles(
      join(ROOT, "lib/trader/intelligence/information-inquiry"),
    );
    const scanned = inquirySources
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes('"@/lib/trader/intelligence/information-sufficiency"') ||
          source.includes("'@/lib/trader/intelligence/information-sufficiency'")
        );
      })
      .map(repoRelative)
      .sort();
    expect(scanned).toEqual(
      INFORMATION_INQUIRY_SUFFICIENCY_CONSUMERS_V1.map((entry) => entry.path).sort(),
    );
    for (const entry of INFORMATION_INQUIRY_SUFFICIENCY_CONSUMERS_V1) {
      const source = read(entry.path);
      for (const symbol of entry.symbols) expect(source, `${entry.path}:${symbol}`).toContain(symbol);
    }
  });

  it("forbids inquiry reachability from reserved authority modules", () => {
    const inquiryImporters = INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1.map((entry) => entry.path);
    expect(
      inquiryImporters.filter((path) =>
        INFORMATION_INQUIRY_FORBIDDEN_AUTHORITY_SEGMENTS_V1.some((segment) =>
          `/${path}`.includes(segment),
        ),
      ),
    ).toEqual([]);

    const forbiddenSources = sourceFiles(join(ROOT, "lib/trader"))
      .map(repoRelative)
      .filter((path) =>
        INFORMATION_INQUIRY_FORBIDDEN_AUTHORITY_SEGMENTS_V1.some((segment) =>
          `/${path}`.includes(segment),
        ),
      )
      .filter((path) => read(path).includes("/information-inquiry/"));
    expect(forbiddenSources).toEqual([]);
  });

  it("keeps Guardian a separate risk-reducing lane", () => {
    expect(INFORMATION_INQUIRY_GUARDIAN_LANE_V1).toEqual({
      path: "lib/trader/paper/paper-cycle-runner.ts",
      symbol: "runGuardianPhase",
      disposition: "SEPARATE_RISK_REDUCING_EXIT_LANE",
      consumesInquiry: false,
      blockedByNewOpportunityInquiry: false,
      createsCapitalAuthority: false,
    });
    const guardian = functionBody(
      read(INFORMATION_INQUIRY_GUARDIAN_LANE_V1.path),
      INFORMATION_INQUIRY_GUARDIAN_LANE_V1.symbol,
    );
    for (const forbidden of [
      "informationInquiry",
      "runInformationInquiry",
      "InformationInquiryCycleAuthorityResolverV1",
    ]) {
      expect(guardian, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the default worker composition resolver-free and therefore fail-closed", () => {
    const worker = INFORMATION_INQUIRY_STANDARD_COMPOSITION_V1.find(
      (entry) => entry.path === "lib/trader/paper/build-worker-deps.ts",
    );
    expect(worker?.disposition).toBe("STANDARD_WORKER_DEFAULT_FAIL_CLOSED");
    expect(read(worker!.path)).not.toContain("informationInquiryResolver");
  });

  it("finds no named inquiry bypass in trader production sources", () => {
    const inventoryPath =
      "lib/trader/intelligence/information-inquiry/information-inquiry-consumer-inventory-v1.ts";
    const bypasses = sourceFiles(join(ROOT, "lib/trader"))
      .map(repoRelative)
      .filter((path) => path !== inventoryPath)
      .flatMap((path) =>
        INFORMATION_INQUIRY_FORBIDDEN_BYPASS_MARKERS_V1.filter((marker) =>
          read(path).includes(marker),
        ).map((marker) => `${path}:${marker}`),
      );
    expect(bypasses).toEqual([]);
  });
});
