import type postgres from "postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  parseRiskAccountProfileV1,
  riskAccountDigestV1,
  RiskCurrentAccountRefusedV1,
  type RiskAccountProfileV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import {
  readCurrentAccountAuthorityV1,
  type CurrentAccountAuthorityV1,
} from "@/lib/trader/risk/v2/risk-current-account-read-v1";
import { foldExpectedEnforcementSuffixV1, holdUnpublishedInclusionsV1 } from "@/lib/trader/risk/v2/risk-account-reconciliation-v1";

type FoldedSuffixInputV1 = Parameters<typeof foldExpectedEnforcementSuffixV1>[0];

const NON_AUTHORITY_ACTIONS = ["PROPOSE", "CANCEL", "REVOKE"] as const;
const ACTIVATION_ACTIONS = ["CONFIRM", "ACTIVATE"] as const;

export type RiskAccountProfileCommandActionV1 =
  | (typeof NON_AUTHORITY_ACTIONS)[number]
  | (typeof ACTIVATION_ACTIONS)[number];

/** A profile command never copies allocation into a current pointer or an order.
 *  CONFIRM and ACTIVATE stay closed until a live envelope producer exists.
 */
export function decideRiskAccountProfileCommandV1(input: {
  action: RiskAccountProfileCommandActionV1;
  liveCapitalEnvelope: null;
}): {
  decision: "NON_AUTHORITY";
  action: (typeof NON_AUTHORITY_ACTIONS)[number];
  currentPointer: null;
  basisWrite: null;
  allowanceId: null;
  orderId: null;
} {
  void input.liveCapitalEnvelope;
  if ((ACTIVATION_ACTIONS as readonly string[]).includes(input.action)) {
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  if (!(NON_AUTHORITY_ACTIONS as readonly string[]).includes(input.action)) {
    throw new RiskCurrentAccountRefusedV1("PROFILE_COMMAND_UNKNOWN");
  }
  return {
    decision: "NON_AUTHORITY",
    action: input.action as (typeof NON_AUTHORITY_ACTIONS)[number],
    currentPointer: null,
    basisWrite: null,
    allowanceId: null,
    orderId: null,
  };
}

/** Current-account bind entry. It does not call the ordinary paper binder.
 *  Every readable pointer still refuses, because no live envelope producer exists.
 */
export async function gateCurrentAccountExecutionBindV1(
  sql: postgres.Sql,
  organizationId: string,
  accountId: string,
): Promise<{
  decision: "REFUSED";
  reason: CurrentAccountAuthorityV1["reason"];
  bindInvoked: false;
}> {
  const authority = await readCurrentAccountAuthorityV1(sql, organizationId, accountId);
  return { decision: "REFUSED", reason: authority.reason, bindInvoked: false };
}

/** Stores a proposal only. The profile allocation is not copied into a current pointer, allowance, or order. */
export async function retainProposedRiskAccountProfileV1(
  sql: postgres.Sql,
  input: { profile: RiskAccountProfileV1; actorId: string; auditId: string; commandId: string },
): Promise<{
  decision: "RETAINED_NON_AUTHORITY";
  action: "PROPOSE";
  profileDigest: string;
  currentPointer: null;
  allowanceId: null;
  orderId: null;
}> {
  const command = decideRiskAccountProfileCommandV1({
    action: "PROPOSE",
    liveCapitalEnvelope: null,
  });
  if (command.action !== "PROPOSE" || command.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  const profile = parseRiskAccountProfileV1(input.profile);
  const { contentDigest, ...profileBody } = profile;
  const profileText = canonicalJsonString(profileBody);
  if (contentDigest !== riskAccountDigestV1(profileBody))
    throw new RiskCurrentAccountRefusedV1("PROFILE_SEAL");
  const eventBody = {
    schemaVersion: "risk-account-profile-event/v1" as const,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    profileDigest: contentDigest,
    action: "PROPOSE" as const,
    actorId: input.actorId,
    eventSequence: 1,
    previousEventDigest: null,
    commandId: input.commandId,
  };
  const eventText = canonicalJsonString(eventBody);
  const eventDigest = riskAccountDigestV1(eventBody);
  let replayDigest: string | null = null;
  await sql.begin(async (tx) => {
    await requireMatchingAuditActorV1(tx as unknown as postgres.Sql, input.auditId, input.actorId, profile.organizationId);
    const [stored] = await tx<{ action: string; profile_digest: string; actor_id: string }[]>`
      select action, profile_digest, actor_id::text as actor_id
      from trader_risk_account_profile_events_v1
      where organization_id = ${profile.organizationId}::uuid and account_id = ${profile.accountId} and command_id = ${input.commandId}::uuid`;
    const replay = decideProfileCommandReplayV1(
      stored ? { action: stored.action, profileDigest: stored.profile_digest, actorId: stored.actor_id } : null,
      { action: "PROPOSE", profileDigest: contentDigest, actorId: input.actorId },
    );
    if (replay === "CONFLICT") throw new RiskCurrentAccountRefusedV1("PROFILE_COMMAND_CONFLICT");
    if (replay === "REPLAY") { replayDigest = stored!.profile_digest; return; }
    const [existing] = await tx<{ n: number }[]>`
      select count(*)::int n from trader_risk_account_profile_events_v1
      where organization_id = ${profile.organizationId}::uuid and account_id = ${profile.accountId}`;
    if ((existing?.n ?? 0) > 0) throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_EXISTS");
    await tx`insert into trader_risk_account_profiles_v1
      (organization_id, account_id, content_digest, body_text, actor_id, audit_id)
      values (${profile.organizationId}::uuid, ${profile.accountId}, ${contentDigest}, ${profileText}, ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    await tx`insert into trader_risk_account_profile_events_v1
      (organization_id, account_id, content_digest, body_text, command_id, profile_digest, event_sequence, previous_event_digest, action, actor_id, audit_id)
      values (${profile.organizationId}::uuid, ${profile.accountId}, ${eventDigest}, ${eventText}, ${input.commandId}::uuid, ${contentDigest}, 1, null, 'PROPOSE', ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    const [current] = await tx<
      { n: number }[]
    >`select count(*)::int n from trader_risk_account_current_v1
      where organization_id = ${profile.organizationId}::uuid and account_id = ${profile.accountId}`;
    if (current?.n !== 0) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  });
  return {
    decision: "RETAINED_NON_AUTHORITY",
    action: "PROPOSE",
    profileDigest: replayDigest ?? contentDigest,
    currentPointer: null,
    allowanceId: null,
    orderId: null,
  };
}


/** Cooling comes from the sealed profile. A caller cannot supply a shorter wait. */
export function coolingOffMsFromProfileBodyV1(bodyText: string): number {
  let coolingOffMs: unknown;
  try {
    coolingOffMs = JSON.parse(bodyText)?.governance?.coolingOffMs;
  } catch {
    throw new RiskCurrentAccountRefusedV1("PROFILE_SEAL");
  }
  if (typeof coolingOffMs !== "number" || !Number.isInteger(coolingOffMs) || coolingOffMs < 1) {
    throw new RiskCurrentAccountRefusedV1("PROFILE_SEAL");
  }
  return coolingOffMs;
}

export function assertProfileCoolingElapsedV1(coolingOffMs: number, previousEventAtMs: number, nowMs: number): void {
  if (!Number.isFinite(previousEventAtMs) || !Number.isFinite(nowMs) || nowMs - previousEventAtMs < coolingOffMs) {
    throw new RiskCurrentAccountRefusedV1("PROFILE_COOLING_OFF");
  }
}


export function decideProfileCommandReplayV1(
  stored: { action: string; profileDigest: string; actorId: string } | null,
  expected: { action: string; profileDigest: string | null; actorId: string },
): "ABSENT" | "REPLAY" | "CONFLICT" {
  if (!stored) return "ABSENT";
  if (stored.action !== expected.action || stored.actorId !== expected.actorId) return "CONFLICT";
  if (expected.profileDigest !== null && stored.profileDigest !== expected.profileDigest) return "CONFLICT";
  return "REPLAY";
}


/** The actor is the audit row's actor. A command cannot name a different person or organization. */
export function assertAuditActorMatchesV1(
  audit: { actorId: string | null; organizationId: string | null } | null,
  expected: { actorId: string; organizationId: string },
): void {
  if (!audit?.actorId || audit.actorId !== expected.actorId || audit.organizationId !== expected.organizationId) {
    throw new RiskCurrentAccountRefusedV1("PROFILE_AUDIT_ACTOR");
  }
}

async function requireMatchingAuditActorV1(tx: postgres.Sql, auditId: string, actorId: string, organizationId: string): Promise<void> {
  const [audit] = await tx<{ actor_id: string | null; organization_id: string | null }[]>`
    select actor_id, organization_id::text as organization_id from audit_logs where id = ${auditId}::uuid`;
  assertAuditActorMatchesV1(
    audit ? { actorId: audit.actor_id, organizationId: audit.organization_id } : null,
    { actorId, organizationId },
  );
}

const STORED_PROFILE_ACTIONS = ["PROPOSE", "CANCEL", "REVOKE", "CONFIRM", "ACTIVATE"] as const;

/** A stored profile, including its allocation figure, never becomes trading authority. */
export async function readStoredProfileAuthorityV1(
  sql: postgres.Sql,
  organizationId: string,
  accountId: string,
): Promise<{
  action: (typeof STORED_PROFILE_ACTIONS)[number] | "ABSENT";
  authority: "NONE";
  currentPointer: null;
  allocationCopied: false;
}> {
  const [row] = await sql<{ action: string; approved_notional: string | null }[]>`
    select e.action, p.body_text::jsonb #>> '{allocation,approvedNotional}' as approved_notional
    from trader_risk_account_profile_events_v1 e
    join trader_risk_account_profiles_v1 p
      on p.organization_id = e.organization_id
     and p.account_id = e.account_id
     and p.content_digest = e.profile_digest
    where e.organization_id = ${organizationId}::uuid and e.account_id = ${accountId}
    order by e.event_sequence desc
    limit 1`;
  void row?.approved_notional;
  const action = row?.action;
  if (!(STORED_PROFILE_ACTIONS as readonly string[]).includes(action ?? "")) {
    return { action: "ABSENT", authority: "NONE", currentPointer: null, allocationCopied: false };
  }
  return {
    action: action as (typeof STORED_PROFILE_ACTIONS)[number],
    authority: "NONE",
    currentPointer: null,
    allocationCopied: false,
  };
}

/** Closes an open proposal. The cancel event does not create a current pointer, allowance, or order. */
export async function cancelStoredProfileProposalV1(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    accountId: string;
    actorId: string;
    auditId: string;
    commandId: string;
  },
): Promise<{
  decision: "RETAINED_NON_AUTHORITY";
  action: "CANCEL";
  profileDigest: string;
  currentPointer: null;
  allowanceId: null;
  orderId: null;
}> {
  const command = decideRiskAccountProfileCommandV1({
    action: "CANCEL",
    liveCapitalEnvelope: null,
  });
  if (command.action !== "CANCEL" || command.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  return sql.begin(async (tx) => {
    await requireMatchingAuditActorV1(tx as unknown as postgres.Sql, input.auditId, input.actorId, input.organizationId);
    const [stored] = await tx<{ action: string; profile_digest: string; actor_id: string }[]>`
      select action, profile_digest, actor_id::text as actor_id
      from trader_risk_account_profile_events_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId} and command_id = ${input.commandId}::uuid`;
    const replay = decideProfileCommandReplayV1(
      stored ? { action: stored.action, profileDigest: stored.profile_digest, actorId: stored.actor_id } : null,
      { action: "CANCEL", profileDigest: null, actorId: input.actorId },
    );
    if (replay === "CONFLICT") throw new RiskCurrentAccountRefusedV1("PROFILE_COMMAND_CONFLICT");
    if (replay === "REPLAY") return {
      decision: "RETAINED_NON_AUTHORITY" as const, action: "CANCEL" as const, profileDigest: stored!.profile_digest,
      currentPointer: null, allowanceId: null, orderId: null,
    };
    const [head] = await tx<
      { content_digest: string; event_sequence: string; profile_digest: string; action: string; created_at: Date | string; body_text: string }[]
    >`
      select e.content_digest, e.event_sequence::text, e.profile_digest, e.action, e.created_at, p.body_text
      from trader_risk_account_profile_events_v1 e
      join trader_risk_account_profiles_v1 p
        on p.organization_id = e.organization_id and p.account_id = e.account_id and p.content_digest = e.profile_digest
      where e.organization_id = ${input.organizationId}::uuid and e.account_id = ${input.accountId}
      order by e.event_sequence desc
      limit 1
      for update of e`;
    if (!head) throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_ABSENT");
    if (head.action !== "PROPOSE")
      throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_NOT_OPEN");
    const [cancelClock] = await tx<{ now: Date | string }[]>`select date_trunc('milliseconds', clock_timestamp()) as now`;
    assertProfileCoolingElapsedV1(coolingOffMsFromProfileBodyV1(head.body_text), new Date(head.created_at).getTime(), new Date(cancelClock?.now ?? "").getTime());
    const eventSequence = Number(head.event_sequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) {
      throw new RiskCurrentAccountRefusedV1("EXPECTED_SEQUENCE");
    }
    const eventBody = {
      schemaVersion: "risk-account-profile-event/v1" as const,
      organizationId: input.organizationId,
      accountId: input.accountId,
      profileDigest: head.profile_digest,
      action: "CANCEL" as const,
      actorId: input.actorId,
      eventSequence: eventSequence + 1,
      previousEventDigest: head.content_digest,
      commandId: input.commandId,
    };
    const eventText = canonicalJsonString(eventBody);
    const eventDigest = riskAccountDigestV1(eventBody);
    await tx`insert into trader_risk_account_profile_events_v1
      (organization_id, account_id, content_digest, body_text, command_id, profile_digest, event_sequence, previous_event_digest, action, actor_id, audit_id)
      values (${input.organizationId}::uuid, ${input.accountId}, ${eventDigest}, ${eventText}, ${input.commandId}::uuid,
        ${head.profile_digest}, ${eventSequence + 1}, ${head.content_digest}, 'CANCEL', ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    const [current] = await tx<
      { n: number }[]
    >`select count(*)::int n from trader_risk_account_current_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}`;
    if (current?.n !== 0) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
    return {
      decision: "RETAINED_NON_AUTHORITY" as const,
      action: "CANCEL" as const,
      profileDigest: head.profile_digest,
      currentPointer: null,
      allowanceId: null,
      orderId: null,
    };
  });
}

/** Reopens a cancelled proposal for the same sealed profile. It still creates no current pointer. */
export async function reproposeStoredProfileV1(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    accountId: string;
    actorId: string;
    auditId: string;
    commandId: string;
    profileDigest: string;
  },
): Promise<{
  decision: "RETAINED_NON_AUTHORITY";
  action: "PROPOSE";
  profileDigest: string;
  currentPointer: null;
  allowanceId: null;
  orderId: null;
}> {
  const command = decideRiskAccountProfileCommandV1({
    action: "PROPOSE",
    liveCapitalEnvelope: null,
  });
  if (command.action !== "PROPOSE" || command.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  return sql.begin(async (tx) => {
    const [head] = await tx<
      { content_digest: string; event_sequence: string; profile_digest: string; action: string; created_at: Date | string; body_text: string }[]
    >`
      select e.content_digest, e.event_sequence::text, e.profile_digest, e.action, e.created_at, p.body_text
      from trader_risk_account_profile_events_v1 e
      join trader_risk_account_profiles_v1 p
        on p.organization_id = e.organization_id and p.account_id = e.account_id and p.content_digest = e.profile_digest
      where e.organization_id = ${input.organizationId}::uuid and e.account_id = ${input.accountId}
      order by e.event_sequence desc
      limit 1
      for update of e`;
    if (!head) throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_ABSENT");
    await requireMatchingAuditActorV1(tx as unknown as postgres.Sql, input.auditId, input.actorId, input.organizationId);
    const [storedPropose] = await tx<{ action: string; profile_digest: string; actor_id: string }[]>`
      select action, profile_digest, actor_id::text as actor_id
      from trader_risk_account_profile_events_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId} and command_id = ${input.commandId}::uuid`;
    const replay = decideProfileCommandReplayV1(
      storedPropose ? { action: storedPropose.action, profileDigest: storedPropose.profile_digest, actorId: storedPropose.actor_id } : null,
      { action: "PROPOSE", profileDigest: input.profileDigest, actorId: input.actorId },
    );
    if (replay === "CONFLICT") throw new RiskCurrentAccountRefusedV1("PROFILE_COMMAND_CONFLICT");
    if (replay === "REPLAY") return {
      decision: "RETAINED_NON_AUTHORITY" as const, action: "PROPOSE" as const, profileDigest: storedPropose!.profile_digest,
      currentPointer: null, allowanceId: null, orderId: null,
    };
    if (head.action !== "CANCEL")
      throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_NOT_CANCELLED");
    if (head.profile_digest !== input.profileDigest)
      throw new RiskCurrentAccountRefusedV1("PROFILE_DIGEST_MISMATCH");
    const [reproposeClock] = await tx<{ now: Date | string }[]>`select date_trunc('milliseconds', clock_timestamp()) as now`;
    assertProfileCoolingElapsedV1(coolingOffMsFromProfileBodyV1(head.body_text), new Date(head.created_at).getTime(), new Date(reproposeClock?.now ?? "").getTime());
    const eventSequence = Number(head.event_sequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) {
      throw new RiskCurrentAccountRefusedV1("EXPECTED_SEQUENCE");
    }
    const eventBody = {
      schemaVersion: "risk-account-profile-event/v1" as const,
      organizationId: input.organizationId,
      accountId: input.accountId,
      profileDigest: head.profile_digest,
      action: "PROPOSE" as const,
      actorId: input.actorId,
      eventSequence: eventSequence + 1,
      previousEventDigest: head.content_digest,
      commandId: input.commandId,
    };
    const eventText = canonicalJsonString(eventBody);
    const eventDigest = riskAccountDigestV1(eventBody);
    await tx`insert into trader_risk_account_profile_events_v1
      (organization_id, account_id, content_digest, body_text, command_id, profile_digest, event_sequence, previous_event_digest, action, actor_id, audit_id)
      values (${input.organizationId}::uuid, ${input.accountId}, ${eventDigest}, ${eventText}, ${input.commandId}::uuid,
        ${head.profile_digest}, ${eventSequence + 1}, ${head.content_digest}, 'PROPOSE', ${input.actorId}::uuid, ${input.auditId}::uuid)`;
    const [current] = await tx<
      { n: number }[]
    >`select count(*)::int n from trader_risk_account_current_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}`;
    if (current?.n !== 0) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
    return {
      decision: "RETAINED_NON_AUTHORITY" as const,
      action: "PROPOSE" as const,
      profileDigest: head.profile_digest,
      currentPointer: null,
      allowanceId: null,
      orderId: null,
    };
  });
}

/** Reads the stored proposal, then refuses confirmation or activation without appending an event. */
export async function refuseStoredProfileActivationV1(
  sql: postgres.Sql,
  input: { organizationId: string; accountId: string; action: "CONFIRM" | "ACTIVATE" },
): Promise<never> {
  await readStoredProfileAuthorityV1(sql, input.organizationId, input.accountId);
  decideRiskAccountProfileCommandV1({ action: input.action, liveCapitalEnvelope: null });
  throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
}

/** Revocation needs an active current pointer. An empty pointer appends no event. */
export async function revokeStoredProfileAuthorityV1(
  sql: postgres.Sql,
  input: { organizationId: string; accountId: string },
): Promise<never> {
  const command = decideRiskAccountProfileCommandV1({
    action: "REVOKE",
    liveCapitalEnvelope: null,
  });
  if (command.currentPointer !== null || command.allowanceId !== null || command.orderId !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  await sql.begin(async (tx) => {
    const rows = await tx<{ organization_id: string }[]>`
      select organization_id from trader_risk_account_current_v1
      where organization_id = ${input.organizationId}::uuid and account_id = ${input.accountId}
      for update`;
    if (rows.length === 0) throw new RiskCurrentAccountRefusedV1("PROFILE_AUTHORITY_ABSENT");
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  });
  throw new RiskCurrentAccountRefusedV1("PROFILE_AUTHORITY_ABSENT");
}

/** An open proposal plus an observed frontier still cannot issue an allowance or an order.
 *  A caller-supplied publication flag is not authority.
 */
export function admitOpenProfileFrontierV1(input: {
  storedAction: "PROPOSE" | "CANCEL" | "REVOKE" | "CONFIRM" | "ACTIVATE" | "ABSENT";
  observed: {
    decision: string;
    publication: { decision: string; reason: string };
    exposureDelta: string;
    pendingDelta: string;
  };
}): {
  decision: "REFUSED";
  reason: "LIVE_CAPITAL_ENVELOPE_ABSENT";
  allowanceId: null;
  orderId: null;
  exposureDelta: string;
  pendingDelta: string;
} {
  if (input.storedAction !== "PROPOSE")
    throw new RiskCurrentAccountRefusedV1("PROFILE_PROPOSAL_NOT_OPEN");
  if (input.observed.decision !== "OBSERVED")
    throw new RiskCurrentAccountRefusedV1("EXPECTED_FRONTIER_UNOBSERVED");
  void input.observed.publication;
  return {
    decision: "REFUSED",
    reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
    allowanceId: null,
    orderId: null,
    exposureDelta: input.observed.exposureDelta,
    pendingDelta: input.observed.pendingDelta,
  };
}

function sameAccountV1(suffix: FoldedSuffixInputV1, organizationId: string, accountId: string): void {
  if (suffix.organizationId !== organizationId || suffix.accountId !== accountId) {
    throw new RiskCurrentAccountRefusedV1("SUFFIX_SCOPE_MISMATCH");
  }
}

/** A fully folded suffix still cannot issue. A structure-only suffix is not enough.
 *  The account and the unpublished inclusion ids must be the ones the fold itself held.
 */
export function admitFoldedSuffixV1(input: {
  storedAction: Parameters<typeof admitOpenProfileFrontierV1>[0]["storedAction"];
  observed: Parameters<typeof admitOpenProfileFrontierV1>[0]["observed"];
  account: { organizationId: string; accountId: string };
  unpublishedTruthRecordIds: readonly string[];
  suffix: FoldedSuffixInputV1;
}): ReturnType<typeof admitOpenProfileFrontierV1> {
  sameAccountV1(input.suffix, input.account.organizationId, input.account.accountId);
  const folded = foldExpectedEnforcementSuffixV1(input.suffix);
  if (!folded.notionalsVerified || folded.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("SUFFIX_NOTIONALS_UNVERIFIED");
  }
  const held = holdUnpublishedInclusionsV1({
    truthRecordIds: input.unpublishedTruthRecordIds,
    alreadyDisposedTruthIds: input.suffix.alreadyDisposedTruthIds,
  });
  if (
    held.truthRecordIds.length !== folded.heldTruthRecordIds.length ||
    held.truthRecordIds.some((id, index) => id !== folded.heldTruthRecordIds[index])
  ) {
    throw new RiskCurrentAccountRefusedV1("INDEPENDENT_INCLUSION_IDENTITY");
  }
  const issue = admitOpenProfileFrontierV1({
    storedAction: input.storedAction,
    observed: input.observed,
  });
  if (issue.allowanceId !== null || issue.orderId !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  return issue;
}

/** Issue and current-account bind both refuse. An unverified suffix never reaches bind. */
export async function refuseProfileBackedExecutionV1(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    accountId: string;
    observed: Parameters<typeof admitOpenProfileFrontierV1>[0]["observed"];
    unpublishedTruthRecordIds: readonly string[];
    suffix: FoldedSuffixInputV1;
  },
): Promise<{
  issue:
    | ReturnType<typeof admitOpenProfileFrontierV1>
    | {
        decision: "REFUSED";
        reason: "PROFILE_PROPOSAL_NOT_OPEN";
        allowanceId: null;
        orderId: null;
      };
  bind: Awaited<ReturnType<typeof gateCurrentAccountExecutionBindV1>>;
}> {
  sameAccountV1(input.suffix, input.organizationId, input.accountId);
  const folded = foldExpectedEnforcementSuffixV1(input.suffix);
  if (!folded.notionalsVerified || folded.currentPointer !== null) {
    throw new RiskCurrentAccountRefusedV1("SUFFIX_NOTIONALS_UNVERIFIED");
  }
  const stored = await readStoredProfileAuthorityV1(sql, input.organizationId, input.accountId);
  const bind = await gateCurrentAccountExecutionBindV1(sql, input.organizationId, input.accountId);
  if (bind.bindInvoked) throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  if (stored.action !== "PROPOSE") {
    return {
      issue: {
        decision: "REFUSED",
        reason: "PROFILE_PROPOSAL_NOT_OPEN",
        allowanceId: null,
        orderId: null,
      },
      bind,
    };
  }
  const issue = admitFoldedSuffixV1({
    storedAction: stored.action,
    observed: input.observed,
    account: { organizationId: input.organizationId, accountId: input.accountId },
    unpublishedTruthRecordIds: input.unpublishedTruthRecordIds,
    suffix: input.suffix,
  });
  if (issue.allowanceId !== null || issue.orderId !== null) {
    throw new RiskCurrentAccountRefusedV1("CURRENT_POINTER_NOT_GRANTED");
  }
  return { issue, bind };
}
