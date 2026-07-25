/**
 * DEE-436 — strict non-evaluating EnvironmentFile parser for T4A.
 */

export const FHV_T4_ENVIRONMENT_FILE_REQUIRED_KEYS = [
  "FHV_HOST_OS_QUALIFIED",
  "FHV_COMMAND_ENFORCEMENT_ENABLED",
  "FHV_OPERATOR_COMMAND_SECRET",
  "FHV_OBSERVER_TUNNEL_SECRET",
] as const;

export type FhvT4EnvironmentFileRequiredKey =
  (typeof FHV_T4_ENVIRONMENT_FILE_REQUIRED_KEYS)[number];

export type FhvT4EnvironmentFileParseResult = Readonly<{
  keysPresent: readonly FhvT4EnvironmentFileRequiredKey[];
  values: Readonly<Record<FhvT4EnvironmentFileRequiredKey, string>>;
}>;

export class FhvT4EnvironmentFileError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4EnvironmentFileError";
  }
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const UNSAFE_VALUE = /[`$(){}\\]|;\s*$|\|\s*$|&&|\|\||\$\(/;

export function parseFhvT4EnvironmentFileContents(
  contents: string,
): FhvT4EnvironmentFileParseResult {
  const seen = new Map<string, string>();
  for (const [index, rawLine] of contents.split("\n").entries()) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(line)) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_CONTROL_CHAR",
        `Control character in EnvironmentFile line ${index + 1}.`,
      );
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_MALFORMED",
        `Malformed EnvironmentFile line ${index + 1}.`,
      );
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!KEY_PATTERN.test(key)) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_KEY_INVALID",
        `Invalid EnvironmentFile key at line ${index + 1}.`,
      );
    }
    if (UNSAFE_VALUE.test(value)) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_VALUE_UNSAFE",
        `Unsafe EnvironmentFile value at line ${index + 1}.`,
      );
    }
    if (seen.has(key)) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_DUPLICATE_KEY",
        `Duplicate EnvironmentFile key: ${key}.`,
      );
    }
    seen.set(key, value);
  }

  const values = {} as Record<FhvT4EnvironmentFileRequiredKey, string>;
  const keysPresent: FhvT4EnvironmentFileRequiredKey[] = [];
  for (const key of FHV_T4_ENVIRONMENT_FILE_REQUIRED_KEYS) {
    const value = seen.get(key);
    if (value === undefined) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_REQUIRED_KEY_MISSING",
        `Required EnvironmentFile key missing: ${key}.`,
      );
    }
    if (!value.trim()) {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_REQUIRED_KEY_EMPTY",
        `Required EnvironmentFile key empty: ${key}.`,
      );
    }
    if (key === "FHV_HOST_OS_QUALIFIED" && value.trim() !== "true") {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_HOST_OS_UNQUALIFIED",
        "FHV_HOST_OS_QUALIFIED must be true.",
      );
    }
    if (key === "FHV_COMMAND_ENFORCEMENT_ENABLED" && value.trim() !== "true") {
      throw new FhvT4EnvironmentFileError(
        "FHV_T4_ENVIRONMENT_FILE_COMMAND_ENFORCEMENT_DISABLED",
        "FHV_COMMAND_ENFORCEMENT_ENABLED must be true.",
      );
    }
    values[key] = value;
    keysPresent.push(key);
  }

  return { keysPresent, values };
}

export function buildFhvT4ServiceUserEnvironmentArray(
  parsed: FhvT4EnvironmentFileParseResult,
): readonly string[] {
  return Object.entries(parsed.values).map(([key, value]) => `${key}=${value}`);
}
