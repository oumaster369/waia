import type {
  KillSwitchEnforcementMode,
  KillSwitchOrigin,
  KillSwitchScopeType,
  KillSwitchState,
  KillSwitchType,
} from "@/db/schema";
import { UnsupportedKillSwitchScopeError } from "@/lib/trader/risk/kill-switch/errors";
import type { AuditLogInput } from "@/lib/waia-core/types";
import type { AuditActorType } from "@/lib/waia-core/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type {
  KillSwitchEnforcementMode,
  KillSwitchOrigin,
  KillSwitchScopeType,
  KillSwitchState,
  KillSwitchType,
} from "@/db/schema";

export type KillSwitchScopeKey = {
  scopeType: KillSwitchScopeType;
  scopeRef: string | null;
  switchType: KillSwitchType;
};

export type KillSwitchOrganizationTarget = {
  scopeType: "organization";
  organizationId: string;
};

export type KillSwitchPlatformTarget = {
  scopeType: "platform";
};

export type KillSwitchTarget = KillSwitchOrganizationTarget | KillSwitchPlatformTarget;

export type KillSwitchActor = {
  actorType: AuditActorType;
  actorId: string | null;
};

export type KillSwitchRow = {
  id: string;
  organizationId: string | null;
  scopeType: KillSwitchScopeType;
  scopeRef: string;
  switchType: KillSwitchType;
  enforcementMode: KillSwitchEnforcementMode;
  state: KillSwitchState;
  origin: KillSwitchOrigin;
  reason: string;
  clearingStartedAt: Date | null;
  coolingOffMs: number | null;
  trippedAt: Date | null;
  clearedAt: Date | null;
  stateVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type KillSwitchView = Omit<KillSwitchRow, "scopeRef"> & {
  scopeRef: string | null;
};

export type KillSwitchTransitionPatch = {
  state: KillSwitchState;
  enforcementMode?: KillSwitchEnforcementMode;
  origin?: KillSwitchOrigin;
  reason?: string;
  clearingStartedAt?: Date | null;
  coolingOffMs?: number | null;
  trippedAt?: Date | null;
  clearedAt?: Date | null;
};

export type InsertKillSwitchRowInput = {
  enforcementMode: KillSwitchEnforcementMode;
  origin: KillSwitchOrigin;
  reason: string;
  state: KillSwitchState;
  clearingStartedAt?: Date | null;
  coolingOffMs?: number | null;
  trippedAt?: Date | null;
  clearedAt?: Date | null;
};

export type EffectiveContribution = {
  killSwitchId: string;
  organizationId: string | null;
  scopeType: KillSwitchScopeType;
  scopeRef: string | null;
  switchType: KillSwitchType;
  enforcementMode: KillSwitchEnforcementMode;
  state: KillSwitchState;
  stateVersion: number;
  reason: string;
};

export type EffectiveKillSwitchState = {
  organizationId: string;
  blocked: boolean;
  enforcementMode: KillSwitchEnforcementMode | null;
  bindingState: "ACTIVE" | "CLEARING" | null;
  resolutionStatus: "ok" | "fail_closed";
  contributors: EffectiveContribution[];
  resolvedAt: string;
};

export type KillSwitchListFilter = {
  state?: KillSwitchState;
  switchType?: KillSwitchType;
};

export type TripKillSwitchInput = {
  enforcementMode: KillSwitchEnforcementMode;
  origin: KillSwitchOrigin;
  reason?: string;
  coolingOffMs?: number | null;
  expectedStateVersion?: number;
};

export type EscalateKillSwitchInput = {
  enforcementMode: KillSwitchEnforcementMode;
  reason?: string;
  expectedStateVersion: number;
};

export type TransitionKillSwitchInput = {
  reason?: string;
  expectedStateVersion: number;
};

export type BeginClearInput = TransitionKillSwitchInput & {
  coolingOffMs?: number | null;
};

/** Default cooling-off period for governed recovery (15 minutes). */
export const DEFAULT_RECOVERY_COOLING_OFF_MS = 900_000;

export function effectiveCoolingOffMs(coolingOffMs: number | null | undefined): number {
  return coolingOffMs ?? DEFAULT_RECOVERY_COOLING_OFF_MS;
}

export type RequestClearInput = {
  reason?: string;
  expectedStateVersion: number;
  coolingOffMs?: number;
};

export type RecoveryPreview = {
  switchType: KillSwitchType;
  scopeType: KillSwitchScopeType;
  scopeRef: string | null;
  state: KillSwitchState;
  origin: KillSwitchOrigin;
  reason: string;
  clearingStartedAt: Date | null;
  coolingOffMs: number;
  eligibleAt: Date | null;
  remainingMs: number;
  confirmable: boolean;
  stateVersion: number;
};

export type GovernedRecoveryService = {
  requestClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: RequestClearInput,
  ): Promise<KillSwitchTransitionResult>;
  previewRecovery(
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
  ): Promise<RecoveryPreview>;
  confirmClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: TransitionKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
  cancelClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: TransitionKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
};

export type KillSwitchTransitionResult = {
  row: KillSwitchView;
  auditId: string;
  previousState: KillSwitchState | null;
};

export type KillSwitchRepository = {
  getRowForScope(
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
  ): KillSwitchRow | null | Promise<KillSwitchRow | null>;
  listRowsForOrg(
    context: OrgContext,
    filter?: KillSwitchListFilter,
  ): KillSwitchRow[] | Promise<KillSwitchRow[]>;
  listEnforcingRowsForResolution(context: OrgContext): KillSwitchRow[] | Promise<KillSwitchRow[]>;
  insertRow(
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: InsertKillSwitchRowInput,
  ): KillSwitchRow | Promise<KillSwitchRow>;
  updateRowWithVersion(
    target: KillSwitchTarget,
    rowId: string,
    expectedStateVersion: number,
    patch: KillSwitchTransitionPatch,
  ): KillSwitchRow | null | Promise<KillSwitchRow | null>;
};

export type KillSwitchServiceDeps = {
  repository: KillSwitchRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  nowMs: () => number;
  assertOrgMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
  assertPlatformKillSwitchAuthority: (actor: KillSwitchActor) => void | Promise<void>;
  assertRecoveryConfirmAuthority?: (
    actor: KillSwitchActor,
    target: KillSwitchTarget,
  ) => void | Promise<void>;
  runMutation?: <T>(fn: () => T | Promise<T>) => T | Promise<T>;
};

export type KillSwitchService = {
  getEffectiveState(context: OrgContext): Promise<EffectiveKillSwitchState>;
  get(
    context: OrgContext,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
  ): Promise<KillSwitchView | null>;
  list(context: OrgContext, filter?: KillSwitchListFilter): Promise<KillSwitchView[]>;
  trip(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: TripKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
  escalate(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: EscalateKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
  beginClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: BeginClearInput,
  ): Promise<KillSwitchTransitionResult>;
  cancelClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: TransitionKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
  finalizeClear(
    actor: KillSwitchActor,
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    input: TransitionKillSwitchInput,
  ): Promise<KillSwitchTransitionResult>;
};

export function scopeRefToDb(scopeRef: string | null): string {
  return scopeRef ?? "";
}

export function scopeRefFromDb(scopeRef: string): string | null {
  return scopeRef === "" ? null : scopeRef;
}

export function toKillSwitchView(row: KillSwitchRow): KillSwitchView {
  return {
    ...row,
    scopeRef: scopeRefFromDb(row.scopeRef),
  };
}

export function isV0ResolvableScopeType(scopeType: KillSwitchScopeType): boolean {
  return scopeType === "platform" || scopeType === "organization";
}

export function assertV0WritableTarget(target: { scopeType: KillSwitchScopeType }): void {
  if (target.scopeType !== "platform" && target.scopeType !== "organization") {
    throw new UnsupportedKillSwitchScopeError(target.scopeType);
  }
}

export function auditOrganizationIdForTarget(target: KillSwitchTarget): string | null {
  return target.scopeType === "platform" ? null : target.organizationId;
}
