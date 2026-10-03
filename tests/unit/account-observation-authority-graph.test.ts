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

const DERIVATIVES_TRANSPORT = "lib/trader/account-observation/derivatives/htx-account-transport.ts";

/** Reviewed private account, position, and match-results POST reads are allowed, with a closed source shape.
 * Match-results bodies are the fixed trade_type/direct template plus the pinned fill assignment.
 * Behavioral transport tests separately exercise family routing and admission refusal.
 * A renamed/generalized reader must receive a fresh authority review. */
function derivativesBoundaryViolations(source: string): string[] {
  const violations: string[] = [];
  const endpoints = [...source.matchAll(/path:\s*"([^"\n]+)", body: Object\.freeze\((\{[^}]*\})\)/g)]
    .map((match) => [match[1], JSON.parse(match[2]!.replace(/\b(margin_account|trade_type|direct):/g, '"$1":'))]);
  const matchResultsTemplate = { trade_type: 0, direct: "next" };
  const expected = [
    ["/linear-swap-api/v1/swap_account_info", {}],
    ["/linear-swap-api/v1/swap_cross_account_info", { margin_account: "USDT" }],
    ["/swap-api/v1/swap_account_info", {}],
    ["/api/v1/contract_account_info", {}],
    ["/linear-swap-api/v1/swap_position_info", {}],
    ["/linear-swap-api/v1/swap_cross_position_info", {}],
    ["/swap-api/v1/swap_position_info", {}],
    ["/api/v1/contract_position_info", {}],
    ["/linear-swap-api/v3/swap_matchresults", matchResultsTemplate],
    ["/linear-swap-api/v3/swap_cross_matchresults", matchResultsTemplate],
    ["/swap-api/v3/swap_matchresults", matchResultsTemplate],
    ["/api/v3/contract_matchresults", matchResultsTemplate],
  ];
  if (JSON.stringify(endpoints) !== JSON.stringify(expected)) violations.push("fixed endpoint/body inventory");
  const input = source.match(/export function createHtxDerivativesAccountTransport\(input: Readonly<\{([\s\S]*?)\}>\)/)?.[1];
  if (!input || /\b(?:path|body|url|method)\s*[?:]/.test(input)) violations.push("generic request input");
  for (const required of [
    'input.host !== "api.hbdm.com"',
    'const host = input.host;',
    'if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family) || disposed || active || signal.aborted)',
    'const { path, body: template } = (purpose === "account" ? endpoints : purpose === "positions" ? positionEndpoints : fillEndpoints)[family];',
    'const body = purpose === "fills" ? matchResultsBody(family, template, contract, startTime, endTime, fromId) : template;',
    'template.trade_type !== 0 || template.direct !== "next" || Object.keys(template).length !== 2',
    'const filled: Record<string, string | number> = { contract, trade_type: 0, start_time: startTime, end_time: endTime, direct: "next" };',
    'if (family === "coin_delivery_futures") filled.symbol = contract.slice(0, -6);',
    'filled.from_id = Number(fromId);',
    'const verifyReadAdmission = input.verifyReadAdmission;',
    'if (await verifyReadAdmission(admissionRequest, controller.signal) !== true) fail("PERMISSION_DENIED");',
    'const url = `https://${host}${path}?${auth}`;',
    'response = await fetchImpl(url, { method: "POST", signal: controller.signal,',
    'redirect: "error", credentials: "omit", cache: "no-store",',
    'body: JSON.stringify(body)',
    'try { await isCurrent(); } catch (admissionError) { error = admissionError; }',
  ]) if (!source.includes(required)) violations.push(`missing boundary: ${required}`);
  const networkCalls = [...source.matchAll(/\b(?:fetchImpl|fetch)\s*\(|\bhttps?\.request\s*\(/g)];
  const methods = [...source.matchAll(/method:\s*["']([^"']+)["']/g)].map((match) => match[1]);
  if (networkCalls.length !== 1 || JSON.stringify(methods) !== '["POST"]') violations.push("network call/method inventory");
  const checks = [...source.matchAll(/await isCurrent\(\);/g)];
  const fetchAt = source.indexOf("response = await fetchImpl(");
  if (checks.length !== 4 || checks[0]!.index! >= fetchAt || checks[1]!.index! <= fetchAt ||
    checks[1]!.index! >= source.indexOf("return text;") || checks[2]!.index! <= fetchAt ||
    checks[2]!.index! >= source.indexOf("return text;") || checks[3]!.index! <= source.indexOf("catch (error)")) {
    violations.push("pre/post read admission and rejected-fetch recheck");
  }
  return violations;
}

function observationNetworkViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of sources) {
    if (file === DERIVATIVES_TRANSPORT) {
      violations.push(...derivativesBoundaryViolations(source).map((reason) => `${file}: ${reason}`));
      continue;
    }
    // The shared signer declares methods without making requests. No other consumer
    // may call its POST signer, even if it delegates networking to another module.
    if (file !== "lib/trader/connectors/htx/signing.ts" && /buildSignedPostQueryString/.test(source)) {
      violations.push(`${file}: POST signer`);
    }
    if (!/\bfetchImpl\s*\(|\bfetch\s*\(|\bhttps?\.request\s*\(/.test(source)) continue;
    if (/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/.test(source)) violations.push(`${file}: non-GET request`);
  }
  return violations;
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

  it("decrypts only through the narrow boundary, never the generic credential repository", () => {
    expect(closure.has("lib/trader/account-observation/credential-read-boundary.ts")).toBe(true);
    // The generic paths would need whole-table exchange_credentials SELECT and carry
    // store/rotate/revoke/audit authority, so they must stay unreachable from this runtime.
    for (const generic of [
      "lib/trader/credentials/credential-service.ts",
      "lib/trader/credentials/repository-adapters.ts",
      "lib/trader/credentials/repository-postgres.ts",
    ]) {
      expect(closure.has(generic)).toBe(false);
      expect(pathTo(closure, generic)).toEqual([]);
    }
    // Envelope decryption itself is reused rather than reimplemented.
    expect(closure.has("lib/trader/credentials/envelope-crypto.ts")).toBe(true);
  });

  it("selects an explicit credential projection and never SELECT * on exchange_credentials", () => {
    const violations: string[] = [];
    // Only actual projections are inspected, so prose naming a withheld column is not a match.
    const projections = /SELECT\s+([\s\S]{0,400}?)\s+FROM\s+public\.exchange_credentials/gi;
    let matched = 0;
    for (const [file, source] of closureSources) {
      for (const match of source.matchAll(projections)) {
        matched += 1;
        const columns = match[1]!;
        if (columns.trim() === "*") violations.push(`${file}: unprojected credential read`);
        for (const withheld of ["permission_metadata", "api_key_masked", "wrapped_dek_key"]) {
          if (new RegExp(`\\b${withheld}\\b`).test(columns) && !columns.includes("${")) {
            violations.push(`${file}: reads ${withheld}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect(matched).toBeGreaterThan(0);

    const boundary = closureSources.get(
      "lib/trader/account-observation/credential-read-boundary.ts",
    )!;
    expect(boundary).toContain("SET LOCAL ROLE ${ACCOUNT_OBSERVATION_CREDENTIAL_ROLE}");
    expect(boundary).toContain("SET TRANSACTION READ ONLY");
    expect(boundary).toContain("set_config('waia.observation_org'");
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

  it("permits only GET networking plus the closed derivatives account-info reader", () => {
    expect(closure.has(DERIVATIVES_TRANSPORT)).toBe(true);
    expect(closure.has("lib/trader/account-observation/htx-get-transport.ts")).toBe(true);
    expect(observationNetworkViolations(closureSources)).toEqual([]);
    expect(closureSources.get("lib/trader/account-observation/htx-get-transport.ts")).toContain(
      "buildSignedQueryString",
    );
  });

  it.each([
    ["different method", (source: string) => source.replace('method: "POST"', 'method: "PUT"')],
    ["venue write endpoint", (source: string) => source.replace("/api/v1/contract_account_info", "/api/v1/contract_order")],
    ["thirteenth endpoint", (source: string) => source.replace('const uuid =', 'const extra = { path: "/api/v1/extra", body: Object.freeze({}) };\nconst uuid =')],
    ["arbitrary body", (source: string) => source.replace('body: JSON.stringify(body)', 'body: JSON.stringify(input)')],
    ["other host", (source: string) => source.replace('input.host !== "api.hbdm.com"', 'input.host !== "other.example"')],
    ["removed admission", (source: string) => source.replace('await isCurrent();', '')],
    ["bypassed admission", (source: string) => source.replace('if (await verifyReadAdmission(admissionRequest, controller.signal) !== true)', 'if (false)')],
  ] as const)("rejects derivatives authority mutation: %s", (_label, mutate) => {
    const sources = new Map(closureSources);
    sources.set(DERIVATIVES_TRANSPORT, mutate(sources.get(DERIVATIVES_TRANSPORT)!));
    expect(observationNetworkViolations(sources).length).toBeGreaterThan(0);
  });

  it.each([
    ['await fetchImpl("https://example.invalid", { method: "POST" });', "non-GET request"],
    ['const signed = buildSignedPostQueryString(input);', "POST signer"],
  ])("rejects POST authority in any other closure consumer: %s", (extra, reason) => {
    const file = "lib/trader/account-observation/host.ts";
    const sources = new Map(closureSources);
    sources.set(file, `${sources.get(file)}\n${extra}`);
    expect(observationNetworkViolations(sources)).toContain(`${file}: ${reason}`);
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
