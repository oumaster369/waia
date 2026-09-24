import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";

const root = process.cwd();
const handlerDir = join(root, "lib/trader/admin-console/handlers");
const schemaSource = [
  readFileSync(join(root, "db/schema.postgres.ts"), "utf8"),
  readFileSync(join(root, "db/schema.admin-console.postgres.ts"), "utf8"),
].join("\n");

function symbolTables(): Map<string, string> {
  const tables = new Map<string, string>();
  for (const match of schemaSource.matchAll(/export const (\w+) = pgTable\(\s*"([a-z0-9_]+)"/g)) {
    tables.set(match[1], match[2]);
  }
  return tables;
}

function sqlTables(source: string, symbols: Map<string, string>): Set<string> {
  source = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const tables = new Set<string>();
  const ctes = new Set(
    [...source.matchAll(/(?:WITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  for (const match of source.matchAll(/\b(?:FROM|JOIN)\s+(?:LATERAL\s+)?([a-z_][a-z0-9_]*)/gi)) {
    const name = match[1].toLowerCase();
    if (name === "select" || name === "lateral" || ctes.has(name)) continue;
    tables.add(name);
  }
  for (const match of source.matchAll(
    /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin|insert|update|delete)\(\s*(\w+)/g,
  )) {
    const table = symbols.get(match[1]);
    if (table) tables.add(table);
  }
  return tables;
}

function followedSources(source: string, seen = new Set<string>()): string {
  let combined = source;
  for (const match of source.matchAll(/from "@\/lib\/trader\/admin-console\/([^"]+)"/g)) {
    const specifier = match[1];
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    if (
      specifier.startsWith("handler-tables") ||
      specifier.startsWith("handlers/guard") ||
      specifier.startsWith("data-state") ||
      specifier.startsWith("auth") ||
      specifier.startsWith("scope") ||
      specifier.startsWith("cursor") ||
      specifier.startsWith("reason-codes") ||
      specifier.startsWith("modes/") ||
      specifier.startsWith("revision")
    ) {
      continue;
    }
    const imported = readFileSync(
      join(root, "lib/trader/admin-console", `${specifier}.ts`),
      "utf8",
    );
    combined += `\n${specifier.startsWith("sql/") || specifier.startsWith("repositories/") ? followedSources(imported, seen) : imported}`;
  }
  return combined;
}

describe("admin console handler tables match handler SQL", () => {
  const symbols = symbolTables();
  const byKey = new Map<string, string>();
  for (const file of readdirSync(handlerDir)) {
    if (!file.endsWith(".ts") || file === "guard.ts") continue;
    const source = readFileSync(join(handlerDir, file), "utf8");
    for (const match of source.matchAll(/HANDLER_TABLES\.(\w+)/g)) {
      const key = match[1];
      byKey.set(key, `${byKey.get(key) ?? ""}\n${followedSources(source)}`);
    }
  }
  byKey.set(
    "stream",
    [
      followedSources(
        readFileSync(join(root, "lib/trader/admin-console/stream/console-stream.ts"), "utf8"),
      ),
      readFileSync(
        join(root, "lib/trader/admin-console/repositories/change-log.postgres.ts"),
        "utf8",
      ),
    ].join("\n"),
  );

  it.each(Object.keys(HANDLER_TABLES))("%s lists the tables its SQL names", (key) => {
    const source = byKey.get(key);
    expect(source, key).toBeTruthy();
    const found = [...sqlTables(source ?? "", symbols)].sort();
    const declared = [...HANDLER_TABLES[key as keyof typeof HANDLER_TABLES]].sort();
    expect(found).toEqual(declared);
  });
});
