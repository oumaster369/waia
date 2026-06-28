import type { TraderOrgLiveEnableEventType, TraderOrgLiveEnableState } from "@/db/schema";
import type { TraderAuditInput } from "@/lib/trader/types";

export type OrgLiveEnableActor = {
  actorType: TraderAuditInput["actorType"];
  actorId: string | null;
};

export type OrgLiveEnableView = {
  organizationId: string;
  state: TraderOrgLiveEnableState;
  maxNotionalCap: string;
  requestedAt: Date | null;
  coolingOffEndsAt: Date | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  operatorAckPhraseHash: string | null;
  stateVersion: number;
  lastEventSeq: number;
  lastEventDigest: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrgLiveEnableEventDigestInput = {
  organizationId: string;
  seq: number;
  eventType: TraderOrgLiveEnableEventType;
  maxNotionalCap: string | null;
  reason: string | null;
  actorType: TraderAuditInput["actorType"];
  actorId: string | null;
  prevEventDigest: string | null;
};

export type OrgLiveEnableEventRecordPayload = OrgLiveEnableEventDigestInput & {
  schemaVersion: string;
  recordContentDigest: string;
};

export type OrgLiveEnableEventView = OrgLiveEnableEventRecordPayload & {
  id: string;
  createdAt: Date;
};

export type RequestOrgLiveEnableInput = {
  maxNotionalCap: string;
};

export type OrgLiveEnableTransitionInput = {
  expectedStateVersion: number;
  reason?: string | null;
};

export type ConfirmOrgLiveEnableInput = OrgLiveEnableTransitionInput & {
  ackPhrase: string;
};

export type OrgLiveEnablePreview = {
  state: OrgLiveEnableView | null;
  coolingOffMs: number;
  eligibleAt: Date | null;
  remainingMs: number;
  confirmable: boolean;
  enableEligible: boolean;
};
