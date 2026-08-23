import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  PUBLIC_WORK_PLAN_MAX_ISSUES,
  PUBLIC_WORK_PLAN_TIMEOUT_MS,
  type PublicWorkPlanConfig,
} from "@/lib/public-work-plan/config";
import type { PublicWorkPlanStatusType } from "@/lib/public-work-plan/types";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

export const PUBLIC_WORK_PLAN_LINEAR_QUERY = `
  query PublicWorkPlanProject($projectId: ID!, $projectSlug: String!, $issueLimit: Int!) {
    projects(
      first: 2
      filter: {
        or: [
          { id: { eq: $projectId } }
          { slugId: { eq: $projectSlug } }
        ]
      }
    ) {
      nodes {
        name
        issues(first: $issueLimit, orderBy: updatedAt) {
          nodes {
            identifier
            title
            url
            priority
            dueDate
            state {
              name
              type
            }
          }
        }
      }
    }
  }
`;

const STATUS_TYPES = new Set<PublicWorkPlanStatusType>([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);

export type LinearPublicIssueFact = {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  dueDate: string | null;
  statusLabel: string;
  statusType: PublicWorkPlanStatusType;
};

export type LinearPublicProjectFact = {
  ref: string;
  name: string;
  publishDates: boolean;
  issues: LinearPublicIssueFact[];
};

type JsonRecord = Record<string, unknown>;

const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_ISSUE_IDENTIFIER_LENGTH = 64;
const MAX_ISSUE_TITLE_LENGTH = 300;
const MAX_STATUS_LABEL_LENGTH = 80;
const MAX_PUBLIC_URL_LENGTH = 2_048;
const ISSUE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  return value;
}

function readNullableDate(record: JsonRecord): string | null {
  const value = record.dueDate;
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  return value;
}

function parseIssue(value: unknown): LinearPublicIssueFact {
  if (!isRecord(value) || !isRecord(value.state)) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  const statusType = readString(value.state, "type", 16);
  const priority = value.priority;
  if (
    !STATUS_TYPES.has(statusType as PublicWorkPlanStatusType) ||
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 4
  ) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  const identifier = readString(value, "identifier", MAX_ISSUE_IDENTIFIER_LENGTH);
  if (!ISSUE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  const url = readString(value, "url", MAX_PUBLIC_URL_LENGTH);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "linear.app") {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  return {
    identifier,
    title: readString(value, "title", MAX_ISSUE_TITLE_LENGTH),
    url,
    priority,
    dueDate: readNullableDate(value),
    statusLabel: readString(value.state, "name", MAX_STATUS_LABEL_LENGTH),
    statusType: statusType as PublicWorkPlanStatusType,
  };
}

function parseProjectResponse(
  payload: unknown,
  ref: string,
  publishDates: boolean,
  issueLimit: number,
): LinearPublicProjectFact {
  if (!isRecord(payload) || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
    throw new LinearPublicReadError("LinearPublicProviderError");
  }
  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.projects) || !Array.isArray(data.projects.nodes)) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  const projects = data.projects.nodes;
  const project = projects[0];
  if (projects.length !== 1 || !isRecord(project) || !isRecord(project.issues)) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  const issues = project.issues;
  const nodes = issues.nodes;
  if (!Array.isArray(nodes) || nodes.length > issueLimit) {
    throw new LinearPublicReadError("LinearPublicResponseInvalid");
  }
  return {
    ref,
    name: readString(project, "name", MAX_PROJECT_NAME_LENGTH),
    publishDates,
    issues: nodes.map(parseIssue),
  };
}

export class LinearPublicReadError extends Error {
  constructor(name: "LinearPublicProviderError" | "LinearPublicResponseInvalid") {
    super("Public work plan provider read failed.");
    this.name = name;
  }
}

export type PublicWorkPlanLinearClientDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchLinearPublicProjects(
  config: PublicWorkPlanConfig,
  deps: PublicWorkPlanLinearClientDeps = {},
): Promise<LinearPublicProjectFact[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? PUBLIC_WORK_PLAN_TIMEOUT_MS,
  );
  const issueLimit = Math.max(
    1,
    Math.floor(PUBLIC_WORK_PLAN_MAX_ISSUES / config.projectRefs.length),
  );
  try {
    return await Promise.all(
      config.projectRefs.map(async (ref) => {
        const response = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: PUBLIC_WORK_PLAN_LINEAR_QUERY,
            variables: { projectId: ref, projectSlug: ref, issueLimit },
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new LinearPublicReadError("LinearPublicProviderError");
        }
        return parseProjectResponse(
          await response.json(),
          ref,
          config.dateProjectRefs.has(ref),
          issueLimit,
        );
      }),
    );
  } catch (error) {
    if (error instanceof LinearPublicReadError) throw error;
    throw new LinearPublicReadError("LinearPublicProviderError");
  } finally {
    clearTimeout(timeout);
  }
}
