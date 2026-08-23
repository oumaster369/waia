import {
  PUBLIC_WORK_PLAN_SCHEMA_VERSION,
  type PublicWorkPlanIssue,
  type PublicWorkPlanProject,
  type PublicWorkPlanProjection,
  type PublicWorkPlanStatusType,
} from "@/lib/public-work-plan/types";
import type {
  LinearPublicIssueFact,
  LinearPublicProjectFact,
} from "@/lib/public-work-plan/linear-client";

const STATUS_ORDER: Record<PublicWorkPlanStatusType, number> = {
  started: 0,
  unstarted: 1,
  triage: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
};

const PRIORITY_LABELS: Record<number, PublicWorkPlanIssue["priorityLabel"]> = {
  0: null,
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

const PRIORITY_ORDER: Record<Exclude<PublicWorkPlanIssue["priorityLabel"], null>, number> = {
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
};

function priorityOrder(priority: PublicWorkPlanIssue["priorityLabel"]): number {
  return priority === null ? 5 : PRIORITY_ORDER[priority];
}

function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function issueFromFact(fact: LinearPublicIssueFact, publishDates: boolean): PublicWorkPlanIssue {
  return {
    identifier: fact.identifier,
    title: fact.title,
    url: fact.url,
    status: { label: fact.statusLabel, type: fact.statusType },
    priorityLabel: PRIORITY_LABELS[fact.priority] ?? null,
    ...(publishDates && fact.dueDate ? { dueDate: fact.dueDate } : {}),
  };
}

function projectFromFact(fact: LinearPublicProjectFact): PublicWorkPlanProject {
  const groups = new Map<
    string,
    { status: PublicWorkPlanIssue["status"]; issues: PublicWorkPlanIssue[] }
  >();
  for (const rawIssue of fact.issues) {
    const issue = issueFromFact(rawIssue, fact.publishDates);
    const key = JSON.stringify([issue.status.type, issue.status.label]);
    const existing = groups.get(key);
    if (existing) existing.issues.push(issue);
    else groups.set(key, { status: issue.status, issues: [issue] });
  }

  const statuses = [...groups.values()]
    .map((group) => {
      return {
        status: group.status,
        issues: group.issues.sort(
          (left, right) =>
            priorityOrder(left.priorityLabel) - priorityOrder(right.priorityLabel) ||
            compareIdentifiers(left.identifier, right.identifier),
        ),
      };
    })
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status.type] - STATUS_ORDER[right.status.type] ||
        left.status.label.localeCompare(right.status.label, "en", { sensitivity: "base" }),
    );

  return { name: fact.name, statuses };
}

export function derivePublicWorkPlanProjection(
  facts: LinearPublicProjectFact[],
  syncedAt: Date,
): PublicWorkPlanProjection {
  return {
    schemaVersion: PUBLIC_WORK_PLAN_SCHEMA_VERSION,
    state: "available",
    projects: facts
      .map(projectFromFact)
      .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" })),
    lastSuccessfulSyncAt: syncedAt.toISOString(),
  };
}

export function unavailablePublicWorkPlan(): PublicWorkPlanProjection {
  return {
    schemaVersion: PUBLIC_WORK_PLAN_SCHEMA_VERSION,
    state: "unavailable",
    projects: [],
    lastSuccessfulSyncAt: null,
  };
}
