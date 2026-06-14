export {
  assertPlatformKillSwitchAuthorityPostgres,
  assertPlatformKillSwitchAuthoritySqlite,
} from "@/lib/trader/risk/kill-switch/authorization";
export {
  KillSwitchAuthorizationError,
  KillSwitchConcurrencyError,
  KillSwitchError,
  KillSwitchNotFoundError,
  IllegalKillSwitchTransitionError,
  UnsupportedKillSwitchScopeError,
} from "@/lib/trader/risk/kill-switch/errors";
export {
  createKillSwitchService,
  createPostgresKillSwitchService,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch/kill-switch-service";
export {
  createKillSwitchResolver,
  type KillSwitchResolver,
} from "@/lib/trader/risk/kill-switch/resolver";
export {
  createPostgresKillSwitchRepository,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch/repository-adapters";
export {
  assertAllowedTransition,
  failClosedEffectiveState,
  isEnforcingState,
  mergeEffectiveContributions,
  mostRestrictiveEnforcementMode,
} from "@/lib/trader/risk/kill-switch/transitions";
export type {
  EffectiveContribution,
  EffectiveKillSwitchState,
  EscalateKillSwitchInput,
  InsertKillSwitchRowInput,
  KillSwitchActor,
  KillSwitchListFilter,
  KillSwitchOrganizationTarget,
  KillSwitchPlatformTarget,
  KillSwitchRepository,
  KillSwitchRow,
  KillSwitchScopeKey,
  KillSwitchService,
  KillSwitchServiceDeps,
  KillSwitchTarget,
  KillSwitchTransitionPatch,
  KillSwitchTransitionResult,
  KillSwitchView,
  TripKillSwitchInput,
  TransitionKillSwitchInput,
  KillSwitchEnforcementMode,
  KillSwitchOrigin,
  KillSwitchScopeType,
  KillSwitchState,
  KillSwitchType,
} from "@/lib/trader/risk/kill-switch/types";
export {
  assertV0WritableTarget,
  auditOrganizationIdForTarget,
  isV0ResolvableScopeType,
  scopeRefFromDb,
  scopeRefToDb,
  toKillSwitchView,
} from "@/lib/trader/risk/kill-switch/types";
