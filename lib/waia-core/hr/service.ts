import "server-only";

import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";

export const HR_APPLICATION_CONSENT_VERSION = "waia-team-application-v1";
export const HR_APPLICATION_STATUSES = [
  "NEW_APPLICATION",
  "INTERVIEW",
  "CONTRACT",
  "WORK",
  "PAYMENT",
  "TERMINATION",
] as const;

type HrStatus = (typeof HR_APPLICATION_STATUSES)[number];
type HrTarget = "TASK" | "MILESTONE" | "PROJECT" | "GENERAL";

export class HrApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HrApplicationError";
  }
}

export function isHrStatusTransitionAllowed(fromStatus: HrStatus, toStatus: HrStatus): boolean {
  if (fromStatus === toStatus || fromStatus === "TERMINATION") return false;
  if (toStatus === "TERMINATION") return true;
  return (
    HR_APPLICATION_STATUSES.indexOf(toStatus) === HR_APPLICATION_STATUSES.indexOf(fromStatus) + 1
  );
}

function requiredText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string")
    throw new HrApplicationError("INVALID_INPUT", `${field} is required.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new HrApplicationError(
      "INVALID_INPUT",
      `${field} must contain between ${min} and ${max} characters.`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw new HrApplicationError("INVALID_INPUT", `${field} is invalid.`);
  const normalized = value.trim();
  if (normalized.length > max)
    throw new HrApplicationError("INVALID_INPUT", `${field} is too long.`);
  return normalized || null;
}

function optionalPublicUrl(value: unknown): string | null {
  const raw = optionalText(value, "publicProfileUrl", 500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    throw new HrApplicationError("INVALID_INPUT", "publicProfileUrl must be a valid public URL.");
  }
}

function targetType(value: unknown): HrTarget {
  if (value === "TASK" || value === "MILESTONE" || value === "PROJECT" || value === "GENERAL") {
    return value;
  }
  throw new HrApplicationError("INVALID_INPUT", "targetType is invalid.");
}

export async function createPublicHrApplication(input: {
  db: WaiaPostgresDb;
  applicantUserId: string | null;
  authenticatedDisplayName: string | null;
  body: Record<string, unknown>;
}) {
  if (typeof input.body.website === "string" && input.body.website.trim() !== "") {
    throw new HrApplicationError("INVALID_INPUT", "Application could not be accepted.");
  }
  if (input.body.consent !== true) {
    throw new HrApplicationError("CONSENT_REQUIRED", "Consent is required to send an application.");
  }
  const identityName = input.authenticatedDisplayName
    ? requiredText(input.authenticatedDisplayName, "identityName", 2, 120)
    : requiredText(input.body.identityName, "identityName", 2, 120);
  const contactEmail = normalizeEmail(
    requiredText(input.body.contactEmail, "contactEmail", 3, 320),
  );
  if (!isLikelyEmail(contactEmail)) {
    throw new HrApplicationError("INVALID_INPUT", "contactEmail must be a valid email address.");
  }
  const selectedTarget = targetType(input.body.targetType);
  const targetReference =
    selectedTarget === "GENERAL"
      ? null
      : requiredText(input.body.targetReference, "targetReference", 2, 240);
  const now = new Date();
  const recentThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const application = {
    id: crypto.randomUUID(),
    applicantUserId: input.applicantUserId,
    identityName,
    contactEmail,
    publicProfileUrl: optionalPublicUrl(input.body.publicProfileUrl),
    targetType: selectedTarget,
    targetReference,
    competencies: requiredText(input.body.competencies, "competencies", 10, 4000),
    experience: requiredText(input.body.experience, "experience", 10, 8000),
    collaborationTerms: requiredText(input.body.collaborationTerms, "collaborationTerms", 2, 2000),
    context: optionalText(input.body.context, "context", 8000) ?? "",
    consentVersion: HR_APPLICATION_CONSENT_VERSION,
    consentedAt: now,
    source: "PUBLIC_WORK_PLAN",
    status: "NEW_APPLICATION" as const,
    createdAt: now,
    updatedAt: now,
  };
  await input.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contactEmail}, 747))`);
    const recent = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(pgSchema.hrTeamApplications)
      .where(
        and(
          eq(pgSchema.hrTeamApplications.contactEmail, contactEmail),
          gte(pgSchema.hrTeamApplications.createdAt, recentThreshold),
        ),
      );
    if ((recent[0]?.count ?? 0) >= 3) {
      throw new HrApplicationError(
        "RATE_LIMITED",
        "Please wait before sending another application.",
      );
    }
    await tx.insert(pgSchema.hrTeamApplications).values(application);
    await tx.insert(pgSchema.hrApplicationEvents).values({
      id: crypto.randomUUID(),
      applicationId: application.id,
      actorUserId: input.applicantUserId,
      eventType: "CREATED",
      toStatus: "NEW_APPLICATION",
      createdAt: now,
    });
    await writeAuditLogPostgres(tx, {
      actorType: input.applicantUserId ? "user" : "system",
      actorId: input.applicantUserId,
      action: "hr.application.created",
      entityType: "hr_team_application",
      entityId: application.id,
      metadata: { source: application.source, targetType: application.targetType },
    });
  });
  return { id: application.id, status: application.status, createdAt: now.toISOString() };
}

export async function listHrApplications(db: WaiaPostgresDb) {
  const [applications, events, assignees] = await Promise.all([
    db
      .select()
      .from(pgSchema.hrTeamApplications)
      .orderBy(desc(pgSchema.hrTeamApplications.createdAt)),
    db
      .select()
      .from(pgSchema.hrApplicationEvents)
      .orderBy(asc(pgSchema.hrApplicationEvents.createdAt)),
    db
      .selectDistinct({
        id: pgSchema.users.id,
        email: pgSchema.users.email,
        displayName: pgSchema.profiles.displayName,
      })
      .from(pgSchema.users)
      .leftJoin(pgSchema.profiles, eq(pgSchema.profiles.userId, pgSchema.users.id))
      .leftJoin(
        pgSchema.userPlatformRoles,
        eq(pgSchema.userPlatformRoles.userId, pgSchema.users.id),
      )
      .leftJoin(
        pgSchema.waiaAdminModuleGrants,
        and(
          eq(pgSchema.waiaAdminModuleGrants.userId, pgSchema.users.id),
          isNull(pgSchema.waiaAdminModuleGrants.revokedAt),
        ),
      )
      .where(
        or(
          eq(pgSchema.userPlatformRoles.role, "admin"),
          eq(pgSchema.waiaAdminModuleGrants.role, "SUPER_ADMIN"),
          eq(pgSchema.waiaAdminModuleGrants.role, "HR_ADMIN"),
        ),
      )
      .orderBy(asc(pgSchema.users.email)),
  ]);
  const eventsByApplication = new Map<string, typeof events>();
  for (const event of events) {
    const bucket = eventsByApplication.get(event.applicationId) ?? [];
    bucket.push(event);
    eventsByApplication.set(event.applicationId, bucket);
  }
  return {
    applications: applications.map((application) => ({
      ...application,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
      consentedAt: application.consentedAt.toISOString(),
      events: (eventsByApplication.get(application.id) ?? []).map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    })),
    assignees,
    statuses: HR_APPLICATION_STATUSES,
  };
}

async function assertEligibleAssignee(db: WaiaPostgresDb, userId: string): Promise<void> {
  const rows = await db
    .select({
      platformRole: pgSchema.userPlatformRoles.role,
      grantRole: pgSchema.waiaAdminModuleGrants.role,
    })
    .from(pgSchema.users)
    .leftJoin(pgSchema.userPlatformRoles, eq(pgSchema.userPlatformRoles.userId, pgSchema.users.id))
    .leftJoin(
      pgSchema.waiaAdminModuleGrants,
      and(
        eq(pgSchema.waiaAdminModuleGrants.userId, pgSchema.users.id),
        isNull(pgSchema.waiaAdminModuleGrants.revokedAt),
      ),
    )
    .where(eq(pgSchema.users.id, userId));
  const eligible = rows.some(
    (row) =>
      row.platformRole === "admin" ||
      row.grantRole === "SUPER_ADMIN" ||
      row.grantRole === "HR_ADMIN",
  );
  if (!eligible) throw new HrApplicationError("INVALID_ASSIGNEE", "Assignee must have HR access.");
}

export async function mutateHrApplication(input: {
  db: WaiaPostgresDb;
  actorUserId: string;
  applicationId: string;
  body: Record<string, unknown>;
}) {
  const command = requiredText(input.body.command, "command", 2, 40);
  return input.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pgSchema.hrTeamApplications)
      .where(eq(pgSchema.hrTeamApplications.id, input.applicationId))
      .limit(1)
      .for("update");
    const application = rows[0];
    if (!application) throw new HrApplicationError("NOT_FOUND", "Application was not found.");
    const now = new Date();

    if (command === "comment") {
      const comment = requiredText(input.body.comment, "comment", 1, 4000);
      await tx.insert(pgSchema.hrApplicationEvents).values({
        id: crypto.randomUUID(),
        applicationId: application.id,
        actorUserId: input.actorUserId,
        eventType: "COMMENT_ADDED",
        comment,
        createdAt: now,
      });
    } else if (command === "assign") {
      const assigneeUserId = requiredText(input.body.assigneeUserId, "assigneeUserId", 36, 36);
      await assertEligibleAssignee(tx as WaiaPostgresDb, assigneeUserId);
      if (assigneeUserId === application.assignedToUserId)
        return { id: application.id, status: application.status };
      await tx
        .update(pgSchema.hrTeamApplications)
        .set({ assignedToUserId: assigneeUserId, updatedAt: now })
        .where(eq(pgSchema.hrTeamApplications.id, application.id));
      await tx.insert(pgSchema.hrApplicationEvents).values({
        id: crypto.randomUUID(),
        applicationId: application.id,
        actorUserId: input.actorUserId,
        eventType: "ASSIGNEE_CHANGED",
        previousAssigneeUserId: application.assignedToUserId,
        newAssigneeUserId: assigneeUserId,
        createdAt: now,
      });
    } else if (command === "transition") {
      const toStatus = requiredText(input.body.toStatus, "toStatus", 2, 40) as HrStatus;
      if (!HR_APPLICATION_STATUSES.includes(toStatus)) {
        throw new HrApplicationError("INVALID_STATUS", "Unknown HR status.");
      }
      if (!isHrStatusTransitionAllowed(application.status, toStatus))
        throw new HrApplicationError("INVALID_TRANSITION", "Status transition is not allowed.");
      await tx
        .update(pgSchema.hrTeamApplications)
        .set({ status: toStatus, updatedAt: now })
        .where(eq(pgSchema.hrTeamApplications.id, application.id));
      await tx.insert(pgSchema.hrApplicationEvents).values({
        id: crypto.randomUUID(),
        applicationId: application.id,
        actorUserId: input.actorUserId,
        eventType: "STATUS_CHANGED",
        fromStatus: application.status,
        toStatus,
        createdAt: now,
      });
    } else {
      throw new HrApplicationError("INVALID_COMMAND", "Unknown HR command.");
    }

    await writeAuditLogPostgres(tx, {
      actorType: "admin",
      actorId: input.actorUserId,
      action: `hr.application.${command}`,
      entityType: "hr_team_application",
      entityId: application.id,
      metadata: { command },
    });
    return {
      id: application.id,
      status: command === "transition" ? input.body.toStatus : application.status,
    };
  });
}
