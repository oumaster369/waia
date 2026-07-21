/** DEE-431 — generic fail-closed validation for FHV operational release identity docs. */

export type FhvReleaseIdentityViolation = Readonly<{
  code: string;
  message: string;
  line?: number;
}>;

export type FhvReleaseIdentityValidationResult = Readonly<{
  ok: boolean;
  violations: readonly FhvReleaseIdentityViolation[];
}>;

const HISTORICAL_HEADINGS = [
  "## Historical evidence",
  "## Historical release cycles",
  "## Grooming preflight",
  "## Post-merge snapshot (historical",
] as const;

const LITERAL_TARGET_SHA = /--target-sha(?:=|\s+)["']?[0-9a-f]{40}["']?/i;
const LITERAL_CHECKOUT_TARGET =
  /(?:fresh clean checkout|provision(?:.*checkout)?|deploy target|released SHA|git checkout)(?:\s+at)?\s+[`"']?[0-9a-f]{40}/i;
const ANY_LITERAL_SHA = /\b[0-9a-f]{40}\b/;
const ABBREVIATED_TARGET = /--target-sha(?:=|\s+)["']?[0-9a-f]{7,39}["']?/i;
const EMPTY_TARGET = /--target-sha(?:=|\s*)["']?\s*["']?(?:\s|$)/;
const WRONG_VARIABLE = /--target-sha\s+"?\$(?!EXECUTION_SERVER_TARGET_SHA\b)[A-Z_]+/;

export function extractFhvActiveOperationalSection(markdown: string): string {
  const lines = markdown.split("\n");
  const active: string[] = [];
  for (const line of lines) {
    if (HISTORICAL_HEADINGS.some((heading) => line.startsWith(heading))) {
      break;
    }
    active.push(line);
  }
  return active.join("\n");
}

export function validateFhvReleaseIdentityMarkdown(
  markdown: string,
  options: { requireSymbolicTarget?: boolean } = {},
): FhvReleaseIdentityValidationResult {
  const violations: FhvReleaseIdentityViolation[] = [];
  const active = extractFhvActiveOperationalSection(markdown);

  if (LITERAL_TARGET_SHA.test(active)) {
    violations.push({
      code: "LITERAL_TARGET_SHA",
      message: "Active section binds --target-sha to a literal 40-character SHA.",
    });
  }
  if (LITERAL_CHECKOUT_TARGET.test(active)) {
    violations.push({
      code: "LITERAL_CHECKOUT_TARGET",
      message: "Active section pins checkout/deploy to a literal SHA.",
    });
  }
  if (ANY_LITERAL_SHA.test(active)) {
    violations.push({
      code: "LITERAL_SHA_IN_ACTIVE_SECTION",
      message: "Active section contains a literal 40-character git SHA.",
    });
  }
  if (ABBREVIATED_TARGET.test(active)) {
    violations.push({
      code: "ABBREVIATED_TARGET_SHA",
      message: "Active section contains abbreviated target SHA.",
    });
  }
  if (WRONG_VARIABLE.test(active)) {
    violations.push({
      code: "WRONG_TARGET_VARIABLE",
      message: "Active section uses a target variable other than EXECUTION_SERVER_TARGET_SHA.",
    });
  }
  if (options.requireSymbolicTarget !== false && !active.includes("$EXECUTION_SERVER_TARGET_SHA")) {
    violations.push({
      code: "MISSING_SYMBOLIC_TARGET",
      message: "Active section must reference $EXECUTION_SERVER_TARGET_SHA.",
    });
  }

  return { ok: violations.length === 0, violations };
}
