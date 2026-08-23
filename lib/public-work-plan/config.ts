import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

export const PUBLIC_WORK_PLAN_MAX_PROJECTS = 8;
export const PUBLIC_WORK_PLAN_MAX_ISSUES = 96;
export const PUBLIC_WORK_PLAN_TIMEOUT_MS = 5_000;
export const PUBLIC_WORK_PLAN_FRESH_TTL_MS = 5 * 60_000;
export const PUBLIC_WORK_PLAN_MAX_STALE_MS = 24 * 60 * 60_000;

const PROJECT_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export class PublicWorkPlanConfigError extends Error {
  readonly code:
    | "PUBLIC_WORK_PLAN_TOKEN_NOT_CONFIGURED"
    | "PUBLIC_WORK_PLAN_ALLOWLIST_NOT_CONFIGURED"
    | "PUBLIC_WORK_PLAN_ALLOWLIST_INVALID";

  constructor(code: PublicWorkPlanConfigError["code"]) {
    super("Public work plan is not configured.");
    this.name = "PublicWorkPlanConfigError";
    this.code = code;
  }
}

export type PublicWorkPlanConfig = {
  apiKey: string;
  projectRefs: string[];
  dateProjectRefs: Set<string>;
  cacheKey: string;
};

function parseAllowlist(raw: string | undefined, required: boolean): string[] {
  if (raw === undefined || raw.trim() === "") {
    if (required) {
      throw new PublicWorkPlanConfigError("PUBLIC_WORK_PLAN_ALLOWLIST_NOT_CONFIGURED");
    }
    return [];
  }

  const refs = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const normalized = refs.map((value) => value.toLowerCase());
  if (
    refs.length === 0 ||
    refs.length > PUBLIC_WORK_PLAN_MAX_PROJECTS ||
    refs.some((value) => !PROJECT_REF_PATTERN.test(value)) ||
    new Set(normalized).size !== refs.length
  ) {
    throw new PublicWorkPlanConfigError("PUBLIC_WORK_PLAN_ALLOWLIST_INVALID");
  }
  return refs;
}

export function resolvePublicWorkPlanConfig(
  env: Readonly<Record<string, string | undefined>>,
): PublicWorkPlanConfig {
  const apiKey = env.WAIA_PUBLIC_LINEAR_API_KEY?.trim();
  if (!apiKey) {
    throw new PublicWorkPlanConfigError("PUBLIC_WORK_PLAN_TOKEN_NOT_CONFIGURED");
  }

  const projectRefs = parseAllowlist(env.WAIA_PUBLIC_LINEAR_PROJECT_ALLOWLIST, true);
  const dateRefs = parseAllowlist(env.WAIA_PUBLIC_LINEAR_DATE_ALLOWLIST, false);
  const canonicalProjects = new Map(projectRefs.map((ref) => [ref.toLowerCase(), ref]));
  if (dateRefs.some((ref) => !canonicalProjects.has(ref.toLowerCase()))) {
    throw new PublicWorkPlanConfigError("PUBLIC_WORK_PLAN_ALLOWLIST_INVALID");
  }

  const dateProjectRefs = new Set(
    dateRefs.map((ref) => canonicalProjects.get(ref.toLowerCase()) as string),
  );
  const sortedProjectRefs = [...projectRefs].sort((left, right) => left.localeCompare(right));
  const sortedDateRefs = [...dateProjectRefs].sort((left, right) => left.localeCompare(right));
  return {
    apiKey,
    projectRefs,
    dateProjectRefs,
    cacheKey: JSON.stringify([sortedProjectRefs, sortedDateRefs]),
  };
}
