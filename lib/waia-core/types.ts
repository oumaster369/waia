/** WAIA Core shared domain types (M1). Enum value sets live in `db/core-enums.ts` (DB-layer source of truth). */

import {
  auditActorTypeEnum,
  organizationKindEnum,
  organizationMemberRoleEnum,
  platformRoleEnum,
  subscriptionStatusEnum,
  waiaModuleEnum,
} from "@/db/core-enums";

export {
  auditActorTypeEnum,
  organizationKindEnum,
  organizationMemberRoleEnum,
  platformRoleEnum,
  subscriptionStatusEnum,
  waiaModuleEnum,
};

export type OrganizationKind = (typeof organizationKindEnum)[number];
export type OrganizationMemberRole = (typeof organizationMemberRoleEnum)[number];
export type PlatformRole = (typeof platformRoleEnum)[number];
export type WaiaModule = (typeof waiaModuleEnum)[number];
export type SubscriptionStatus = (typeof subscriptionStatusEnum)[number];
export type AuditActorType = (typeof auditActorTypeEnum)[number];

/** Baseline entitlement keys resolved from subscriptions (M1). */
export const baselineEntitlementKeys = [...waiaModuleEnum] as const;
export type BaselineEntitlementKey = (typeof baselineEntitlementKeys)[number];

export type CoreProvisioningInput = {
  userId: string;
  displayName: string;
  email?: string;
};

export type AuditLogInput = {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
};

export type PermissionCheckInput = {
  userId: string;
  organizationId: string;
  permission: string;
};

export type EntitlementCheckInput = {
  organizationId: string;
  entitlementKey: string;
  actorUserId?: string;
};
