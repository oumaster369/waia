/**
 * DEE-436 — CLI wrapper for strict EnvironmentFile parsing (no shell evaluation).
 */

import { readFileSync } from "node:fs";

import {
  buildFhvT4ServiceUserEnvironmentArray,
  FhvT4EnvironmentFileError,
  parseFhvT4EnvironmentFileContents,
} from "@/lib/trader/observability/fhv-t4-environment-file";

function usage(): never {
  console.error("Usage: fhv-t4-parse-environment-file.ts --path PATH [--format env|keys|json]");
  process.exit(2);
}

function parseArgv(argv: readonly string[]): { path: string; format: "env" | "keys" | "json" } {
  let path = "";
  let format: "env" | "keys" | "json" = "env";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--path") {
      path = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    if (arg === "--format") {
      const value = argv[index + 1]?.trim() ?? "";
      if (value === "env" || value === "keys" || value === "json") {
        format = value;
      } else {
        usage();
      }
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
    }
    usage();
  }
  if (!path) {
    usage();
  }
  return { path, format };
}

function main(): void {
  const { path, format } = parseArgv(process.argv.slice(2));
  try {
    const contents = readFileSync(path, "utf8");
    const parsed = parseFhvT4EnvironmentFileContents(contents);
    if (format === "json") {
      console.log(JSON.stringify({ keysPresent: parsed.keysPresent }, null, 0));
      return;
    }
    if (format === "keys") {
      for (const key of parsed.keysPresent) {
        console.log(key);
      }
      return;
    }
    for (const entry of buildFhvT4ServiceUserEnvironmentArray(parsed)) {
      console.log(entry);
    }
  } catch (error) {
    if (error instanceof FhvT4EnvironmentFileError) {
      console.error(`error: ${error.code}: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
}

main();
