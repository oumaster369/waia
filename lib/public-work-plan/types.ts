export const PUBLIC_WORK_PLAN_SCHEMA_VERSION = "waia-public-work-plan/v1" as const;

export type PublicWorkPlanStatusType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export type PublicWorkPlanIssue = {
  identifier: string;
  title: string;
  url: string;
  status: {
    label: string;
    type: PublicWorkPlanStatusType;
  };
  priorityLabel: "Urgent" | "High" | "Medium" | "Low" | null;
  dueDate?: string;
};

export type PublicWorkPlanStatusGroup = {
  status: PublicWorkPlanIssue["status"];
  issues: PublicWorkPlanIssue[];
};

export type PublicWorkPlanProject = {
  name: string;
  statuses: PublicWorkPlanStatusGroup[];
};

export type PublicWorkPlanProjection = {
  schemaVersion: typeof PUBLIC_WORK_PLAN_SCHEMA_VERSION;
  state: "available" | "stale" | "unavailable";
  projects: PublicWorkPlanProject[];
  lastSuccessfulSyncAt: string | null;
};
