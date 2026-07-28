/**
 * DEE-436 — mechanically derive T4A shell execution surfaces from operator source.
 *
 * This module MUST NOT import FHV_T4A_DIRECT_EXECUTION_SCRIPTS as input.
 * Tests compare derived sets against the canonical contract for exact equality.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FhvT4aDerivedExecutionGraph = Readonly<{
  directPaths: readonly string[];
  sshStdinPaths: readonly string[];
  sourcedPaths: readonly string[];
}>;

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort();
}

/** Direct repo-root shell invocations referencing `${ctx.repoRoot}/scripts/ops/...`. */
function deriveDirectPathsFromTs(source: string): string[] {
  const paths: string[] = [];
  const pattern = /\$\{ctx\.repoRoot\}\/(scripts\/ops\/[^\s`"]+\.sh)/g;
  for (const match of source.matchAll(pattern)) {
    paths.push(match[1]!);
  }
  return paths;
}

/** SSH stdin bootstrap scripts passed to streamBootstrap(..., "scripts/ops/foo.sh", ...). */
function deriveSshStdinPathsFromExecutor(source: string): string[] {
  const paths: string[] = [];
  const pattern = /streamBootstrap\(\s*ctx,\s*"([^"]+\.sh)"/g;
  for (const match of source.matchAll(pattern)) {
    paths.push(match[1]!);
  }
  return paths;
}

/** Pre-auth bootstrap allowlist entries from fhv-t4a-preauth-ledger.ts. */
function derivePreauthBootstrapPaths(source: string): string[] {
  const paths: string[] = [];
  const blockMatch = source.match(/PREAUTH_BOOTSTRAP_ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/);
  if (!blockMatch?.[1]) {
    return paths;
  }
  for (const match of blockMatch[1].matchAll(/"([^"]+\.sh)"/g)) {
    paths.push(match[1]!);
  }
  return paths;
}

/** Shell helpers sourced by direct-path T4A scripts (relative to scripts/ops). */
function deriveSourcedPathsFromDirectScripts(
  root: string,
  directPaths: readonly string[],
): string[] {
  const sourced = new Set<string>();
  for (const rel of directPaths) {
    const body = read(root, rel);
    for (const match of body.matchAll(/source\s+"\$\{SCRIPT_DIR\}\/([^"]+\.sh)"/g)) {
      sourced.add(`scripts/ops/${match[1]!}`);
    }
    for (const match of body.matchAll(/source\s+"\$\{SCRIPT_DIR_COMMON\}\/\.\.\/([^"]+\.sh)"/g)) {
      sourced.add(`scripts/ops/${match[1]!}`);
    }
    for (const match of body.matchAll(/\$\{SCRIPT_DIR\}\/([^/\s"]+\.sh)/g)) {
      const nested = match[1]!;
      if (nested.startsWith("_") || nested.endsWith(".sh")) {
        if (rel.includes("/fhv-supervisor/")) {
          sourced.add(`scripts/ops/fhv-supervisor/${nested}`);
        }
      }
    }
  }
  return [...sourced];
}

export function deriveFhvT4aExecutionGraphFromSources(
  root: string = process.cwd(),
): FhvT4aDerivedExecutionGraph {
  const executor = read(root, "lib/trader/observability/fhv-t4a-operator-executor.ts");
  const observerQual = read(root, "lib/trader/observability/fhv-t4a-observer-qualification.ts");
  const preauth = read(root, "lib/trader/observability/fhv-t4a-preauth-ledger.ts");

  const directPaths = sortedUnique([
    ...deriveDirectPathsFromTs(executor),
    ...deriveDirectPathsFromTs(observerQual),
  ]);

  const sshStdinPaths = sortedUnique([
    ...deriveSshStdinPathsFromExecutor(executor),
    ...derivePreauthBootstrapPaths(preauth),
  ]);

  const sourcedPaths = sortedUnique(deriveSourcedPathsFromDirectScripts(root, directPaths));

  return { directPaths, sshStdinPaths, sourcedPaths };
}
