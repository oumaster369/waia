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

const LEVEL2_HEADING = /^## /;

const LITERAL_TARGET_SHA = /--target-sha(?:=|\s+)["']?[0-9a-f]{40}["']?/i;
const LITERAL_CHECKOUT_TARGET =
  /(?:fresh clean checkout|provision(?:.*checkout)?|deploy target|released SHA|git checkout)(?:\s+at)?\s+[`"']?[0-9a-f]{40}/i;
const ANY_LITERAL_SHA = /\b[0-9a-f]{40}\b/;
const ABBREVIATED_TARGET = /--target-sha(?:=|\s+)["']?[0-9a-f]{7,39}["']?/i;
const EMPTY_TARGET = /--target-sha(?:=|\s*)["']?\s*(?:\n|$)/;
const WRONG_VARIABLE = /--target-sha\s+"?\$(?!EXECUTION_SERVER_TARGET_SHA\b)[A-Z_]+/;

function isHistoricalHeading(line: string): boolean {
  return HISTORICAL_HEADINGS.some((heading) => line.startsWith(heading));
}

export function extractFhvActiveOperationalLines(
  markdown: string,
): Array<{ line: string; lineNumber: number }> {
  const lines = markdown.split("\n");
  const active: Array<{ line: string; lineNumber: number }> = [];
  let inHistorical = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (LEVEL2_HEADING.test(line)) {
      inHistorical = isHistoricalHeading(line);
      continue;
    }
    if (!inHistorical) {
      active.push({ line, lineNumber: index + 1 });
    }
  }
  return active;
}

/** @deprecated use extractFhvActiveOperationalLines */
export function extractFhvActiveOperationalSection(markdown: string): string {
  return extractFhvActiveOperationalLines(markdown)
    .map((entry) => entry.line)
    .join("\n");
}

function scanActiveLine(
  line: string,
  lineNumber: number,
  violations: FhvReleaseIdentityViolation[],
): void {
  if (LITERAL_TARGET_SHA.test(line)) {
    violations.push({
      code: "LITERAL_TARGET_SHA",
      message: "Active section binds --target-sha to a literal 40-character SHA.",
      line: lineNumber,
    });
  }
  if (LITERAL_CHECKOUT_TARGET.test(line)) {
    violations.push({
      code: "LITERAL_CHECKOUT_TARGET",
      message: "Active section pins checkout/deploy to a literal SHA.",
      line: lineNumber,
    });
  }
  if (ANY_LITERAL_SHA.test(line)) {
    violations.push({
      code: "LITERAL_SHA_IN_ACTIVE_SECTION",
      message: "Active section contains a literal 40-character git SHA.",
      line: lineNumber,
    });
  }
  if (ABBREVIATED_TARGET.test(line)) {
    violations.push({
      code: "ABBREVIATED_TARGET_SHA",
      message: "Active section contains abbreviated target SHA.",
      line: lineNumber,
    });
  }
  if (EMPTY_TARGET.test(line)) {
    violations.push({
      code: "EMPTY_TARGET",
      message: "Active section contains an empty --target-sha binding.",
      line: lineNumber,
    });
  }
  if (WRONG_VARIABLE.test(line)) {
    violations.push({
      code: "WRONG_TARGET_VARIABLE",
      message: "Active section uses a target variable other than EXECUTION_SERVER_TARGET_SHA.",
      line: lineNumber,
    });
  }
}

export function validateFhvReleaseIdentityMarkdown(
  markdown: string,
  options: { requireSymbolicTarget?: boolean } = {},
): FhvReleaseIdentityValidationResult {
  const violations: FhvReleaseIdentityViolation[] = [];
  const activeLines = extractFhvActiveOperationalLines(markdown);
  const activeText = activeLines.map((entry) => entry.line).join("\n");

  for (const entry of activeLines) {
    scanActiveLine(entry.line, entry.lineNumber, violations);
  }

  if (
    options.requireSymbolicTarget !== false &&
    !activeText.includes("$EXECUTION_SERVER_TARGET_SHA")
  ) {
    violations.push({
      code: "MISSING_SYMBOLIC_TARGET",
      message: "Active section must reference $EXECUTION_SERVER_TARGET_SHA.",
    });
  }

  return { ok: violations.length === 0, violations };
}
