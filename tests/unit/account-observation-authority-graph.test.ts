// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DEE-1015 capital-safety regression. The dedicated observation runtime, its collector consumer
 * and the provisioning operator are walked transitively: nothing they can reach may hold order,
 * cancel, amend, transfer or withdrawal authority, and the Alpha 0 read-only boundary that
 * DEE-960/978 established must remain exactly as merged.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const ENTRYPOINTS = Object.freeze([
  "scripts/trader/account-observation-collector-host.ts",
  "scripts/ops/account-observation-provision-collection-state-v1.ts",
  "services/ai-trader-account-observation-host/entrypoint.mjs",
  "services/ai-trader-account-observation-host/server.mjs",
]);

/** Any module holding or dispatching venue write authority. */
const FORBIDDEN_MODULES = Object.freeze([
  "lib/trader/execution/v2/connector-dispatch.ts",
  "lib/trader/execution/execution-service.ts",
  "lib/trader/connectors/htx/htx-exchange-connector.ts",
  "lib/trader/connectors/htx/client.ts",
]);

const EXTENSIONS = Object.freeze([".ts", ".tsx", ".mjs", ".js"]);
/** Statement-anchored so a specifier is never attributed across unrelated statements. */
const IMPORT_PATTERN =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

/** Venue endpoints that place, cancel, transfer or withdraw. The single-order GET
 * (`/v1/order/orders/{id}`) is a read and is deliberately not listed. */
const WRITE_ENDPOINTS = Object.freeze([
  "/v1/order/orders/place",
  "/v1/order/batchcancel",
  "/submitcancel",
  "/v1/futures/transfer",
  "/v2/account/transfer",
  "/v1/dw/withdraw",
]);

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isFile(candidate: string): boolean {
  try {
    return readFileSync(candidate).length >= 0;
  } catch {
    return false;
  }
}

/** Transitive first-party closure. Bare specifiers are packages and are not walked. */
function importClosure(entrypoints: readonly string[]): Map<string, string[]> {
  const closure = new Map<string, string[]>();
  const queue = entrypoints.map((entry) => path.join(REPO_ROOT, entry));
  const parents = new Map<string, string | null>();
  for (const entry of queue) parents.set(entry, null);

  while (queue.length > 0) {
    const file = queue.shift()!;
    const relative = path.relative(REPO_ROOT, file);
    if (closure.has(relative)) continue;
    const source = readFileSync(file, "utf8");
    const imported: string[] = [];
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!specifier) continue;
      const target = resolveSpecifier(file, specifier);
      if (!target) continue;
      imported.push(path.relative(REPO_ROOT, target));
      if (!parents.has(target)) parents.set(target, file);
      queue.push(target);
    }
    closure.set(relative, imported);
  }
  return closure;
}

function pathTo(closure: Map<string, string[]>, target: string): string[] {
  // Breadth-first from each entrypoint so a violation is reported with its actual chain.
  for (const entry of ENTRYPOINTS) {
    const queue: string[][] = [[entry]];
    const seen = new Set<string>([entry]);
    while (queue.length > 0) {
      const chain = queue.shift()!;
      const last = chain[chain.length - 1]!;
      if (last === target) return chain;
      for (const next of closure.get(last) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return [];
}

const closure = importClosure(ENTRYPOINTS);
const closureSources = new Map(
  [...closure.keys()].map((file) => [file, readFileSync(path.join(REPO_ROOT, file), "utf8")]),
);

describe("DEE-1015 observation authority graph", () => {
  it("walks a non-trivial closure that actually includes the reused host", () => {
    expect(closure.size).toBeGreaterThan(10);
    expect([...closure.keys()]).toContain("lib/trader/account-observation/host.ts");
    expect([...closure.keys()]).toContain("lib/trader/account-observation/assignment-manifest.ts");
    for (const entry of ENTRYPOINTS) expect(closure.has(entry)).toBe(true);
  });

  it.each(FORBIDDEN_MODULES)("cannot reach %s", (module) => {
    expect(closure.has(module)).toBe(false);
    expect(pathTo(closure, module)).toEqual([]);
  });

  it("contains no order, cancel, amend, transfer or withdrawal call site", () => {
    const violations: string[] = [];
    const capability =
      /\.(?:placeOrder|placeFuturesOrder|submitOrder|cancelOrder|cancelAllOrders|amendOrder|replaceOrder|transfer|withdraw|createWithdrawal)\s*\(/g;

    for (const [file, source] of closureSources) {
      for (const [index, line] of source.split("\n").entries()) {
        for (const match of line.matchAll(capability)) {
          violations.push(`${file}:${index + 1} ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("reaches no venue write endpoint", () => {
    const violations: string[] = [];
    for (const [file, source] of closureSources) {
      for (const endpoint of WRITE_ENDPOINTS) {
        if (source.includes(endpoint)) violations.push(`${file}: ${endpoint}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("issues no non-GET request from any module that can reach the network", () => {
    const violations: string[] = [];
    for (const [file, source] of closureSources) {
      // A method literal only matters where a request is actually issued; the shared HTX
      // signature builder names methods but performs no I/O.
      if (!/\bfetchImpl\s*\(|\bfetch\s*\(|\bhttps?\.request\s*\(/.test(source)) continue;
      if (/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/.test(source)) {
        violations.push(`${file}: non-GET request`);
      }
    }

    expect(violations).toEqual([]);
    // The assertion is only meaningful if a networking module is present at all.
    expect(closure.has("lib/trader/account-observation/htx-get-transport.ts")).toBe(true);
  });

  it("imports the GET signer and never calls the POST signer", () => {
    const callers: string[] = [];
    for (const [file, source] of closureSources) {
      // signing.ts declares both; only a consumer calling the POST signer is a violation.
      if (file === "lib/trader/connectors/htx/signing.ts") continue;
      if (/buildSignedPostQueryString/.test(source)) callers.push(file);
    }

    expect(callers).toEqual([]);
    expect(closureSources.get("lib/trader/account-observation/htx-get-transport.ts")).toContain(
      "buildSignedQueryString",
    );
  });

  it("keeps the observation transport GET-only", () => {
    const transport = readFileSync(
      path.join(REPO_ROOT, "lib/trader/account-observation/htx-get-transport.ts"),
      "utf8",
    );

    expect(closure.has("lib/trader/account-observation/htx-get-transport.ts")).toBe(true);
    expect(transport).toContain('if (request.method !== "GET"');
    expect(transport).toContain('{ method: "GET"');
    expect(transport).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });

  it("keeps observation admission dependent on a readonly permission", () => {
    const admission = readFileSync(
      path.join(REPO_ROOT, "lib/trader/account-observation/htx-read-admission.ts"),
      "utf8",
    );

    expect(closure.has("lib/trader/account-observation/htx-read-admission.ts")).toBe(true);
    expect(admission).toContain('if (!permissions.includes("readonly")');
    expect(admission).toContain('permission !== "readonly" && permission !== "trade"');
  });

  it("keeps legacy order submission unconditionally disabled", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "lib/trader/execution/execution-service.ts"),
      "utf8",
    );

    expect(source).toContain(
      "function legacyOrderSubmissionDisabled(): boolean {\n  return true;\n}",
    );
    expect(source).toContain("LEGACY_ORDER_SUBMISSION_DISABLED");
    expect(source).toContain("LEGACY_ORDER_CANCELLATION_DISABLED");
  });

  it("keeps the new runtime out of any Cloudflare request or cron surface", () => {
    for (const [file, source] of closureSources) {
      if (!ENTRYPOINTS.includes(file)) continue;
      expect(source, file).not.toMatch(/getCloudflareContext|@opennextjs\/cloudflare/);
      expect(source, file).not.toMatch(/scheduled\s*\(|addEventListener\(\s*["']fetch["']/);
    }
  });
});
