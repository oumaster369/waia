/** AI-TRADER audit action constants (AT-E1 scaffolding). */
export const traderAuditActions = {
  orgProfileCreated: "trader.org_profile.created",
  credentialCreated: "trader.credential.created",
  credentialRotated: "trader.credential.rotated",
  credentialRevoked: "trader.credential.revoked",
} as const;

export type TraderAuditAction = (typeof traderAuditActions)[keyof typeof traderAuditActions];

/** AI-TRADER audit entity type constants. */
export const traderEntityTypes = {
  orgProfile: "trader.org_profile",
  exchangeCredential: "trader.exchange_credential",
} as const;

export type TraderEntityType = (typeof traderEntityTypes)[keyof typeof traderEntityTypes];

export type TraderAuditInput = {
  actorType: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
  action: TraderAuditAction;
  entityType: TraderEntityType;
  entityId?: string | null;
  organizationId: string;
  metadata?: Record<string, unknown>;
};

export type EnsureTraderOrgProfileInput = {
  organizationId: string;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type EnsureTraderOrgProfileResult = {
  profileId: string;
  created: boolean;
};
