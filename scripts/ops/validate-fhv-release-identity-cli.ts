import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateFhvReleaseIdentityMarkdown } from "@/lib/trader/observability/fhv-release-identity-validator";

const ROOT = process.cwd();
const DEFAULT_PATHS = [
  join(ROOT, "docs/ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md"),
  join(ROOT, "docs/ops/FHV-RELEASE-IDENTITY-CONTRACT.md"),
  join(ROOT, "docs/ops/EXECUTION-SERVER-RUNBOOK.md"),
];

function main(): void {
  const paths = process.argv.slice(2);
  const targets = paths.length > 0 ? paths : DEFAULT_PATHS;
  let failed = false;
  for (const file of targets) {
    const markdown = readFileSync(file, "utf8");
    const result = validateFhvReleaseIdentityMarkdown(markdown, {
      requireSymbolicTarget: file.includes("REHEARSAL-CONTRACT"),
    });
    if (result.ok) {
      process.stdout.write(`PASS  ${file}\n`);
      continue;
    }
    failed = true;
    process.stderr.write(`FAIL  ${file}\n`);
    for (const violation of result.violations) {
      process.stderr.write(`  - ${violation.code}: ${violation.message}\n`);
    }
  }
  if (failed) {
    process.exit(1);
  }
  process.stdout.write("validate-fhv-release-identity: all checks passed\n");
}

main();
